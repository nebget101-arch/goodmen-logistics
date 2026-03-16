'use strict';

const knex = require('../config/knex');

function round2(value) {
  const n = Number(value || 0);
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function quarterStartEnd(quarter, year) {
  const q = Number(quarter);
  const y = Number(year);
  const startMonth = (q - 1) * 3;
  const start = new Date(Date.UTC(y, startMonth, 1));
  const end = new Date(Date.UTC(y, startMonth + 3, 0));
  return { start, end };
}

function dateOnly(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function isDateInQuarter(dateValue, quarter, year) {
  const iso = dateOnly(dateValue);
  if (!iso) return false;
  const d = new Date(`${iso}T00:00:00.000Z`);
  const { start, end } = quarterStartEnd(quarter, year);
  return d >= start && d <= end;
}

function inferSeverity(type) {
  if ([
    'missing_trucks',
    'missing_miles',
    'missing_fuel',
    'invalid_quarter_year',
    'zero_gallons_nonzero_miles'
  ].includes(type)) return 'blocker';
  if ([
    'jurisdiction_miles_without_fuel',
    'duplicate_receipt_suspected',
    'truck_mpg_outlier',
    'purchase_date_outside_quarter',
    'inactive_truck_selected'
  ].includes(type)) return 'warning';
  return 'info';
}

async function getQuarterById(quarterId, tenantId, operatingEntityId = null, trx = knex) {
  const q = trx('ifta_quarters').where({ id: quarterId, tenant_id: tenantId });
  if (operatingEntityId) q.andWhere('operating_entity_id', operatingEntityId);
  return q.first();
}

async function loadTrucksForTenant(tenantId, trx = knex) {
  const candidates = ['vehicles', 'all_vehicles'];

  for (const table of candidates) {
    // Check relation exists (table or view) without raising SQL errors.
    // eslint-disable-next-line no-await-in-loop
    const colsRes = await trx('information_schema.columns')
      .select('column_name')
      .where({ table_name: table });

    if (!colsRes.length) {
      // eslint-disable-next-line no-continue
      continue;
    }

    const colSet = new Set(colsRes.map((r) => String(r.column_name || '').toLowerCase()));
    if (!colSet.has('id') || !colSet.has('unit_number')) {
      // eslint-disable-next-line no-continue
      continue;
    }

    const q = trx(table).select('id', 'unit_number');
    if (colSet.has('status')) q.select('status');
    if (colSet.has('is_active')) q.select('is_active');
    if (colSet.has('tenant_id')) q.where({ tenant_id: tenantId });

    // eslint-disable-next-line no-await-in-loop
    const rows = await q;
    return rows.map((r) => ({
      id: r.id,
      unit_number: r.unit_number,
      status: r.status ?? null,
      is_active: r.is_active ?? null,
    }));
  }

  return [];
}

async function loadIftaEntries(tableName, { quarterId, tenantId, operatingEntityId = null, trx = knex }) {
  const colsRes = await trx('information_schema.columns')
    .select('column_name')
    .where({ table_name: tableName });
  if (!colsRes.length) return [];

  const colSet = new Set(colsRes.map((r) => String(r.column_name || '').toLowerCase()));
  const q = trx(tableName);

  if (colSet.has('quarter_id')) q.where({ quarter_id: quarterId });
  if (colSet.has('tenant_id')) q.andWhere({ tenant_id: tenantId });
  if (colSet.has('is_deleted')) q.andWhere('is_deleted', false);
  if (operatingEntityId && colSet.has('operating_entity_id')) {
    q.andWhere('operating_entity_id', operatingEntityId);
  }

  return q;
}

async function listJurisdictionRates(trx = knex) {
  const rows = await trx('ifta_tax_rates')
    .where('effective_from', '<=', trx.fn.now())
    .andWhere(function andOpenEnded() {
      this.whereNull('effective_to').orWhere('effective_to', '>=', trx.fn.now());
    })
    .orderBy('jurisdiction', 'asc');

  const byCode = new Map();
  for (const r of rows) {
    const code = String(r.jurisdiction || '').trim().toUpperCase();
    if (!code || byCode.has(code)) continue;
    byCode.set(code, Number(r.tax_rate || 0));
  }
  return byCode;
}

async function computeAndPersistQuarterSummary({ quarterId, tenantId, operatingEntityId = null, userId = null, trx = null }) {
  const executor = trx || knex;
  const quarter = await getQuarterById(quarterId, tenantId, operatingEntityId, executor);
  if (!quarter) throw new Error('IFTA quarter not found');

  // Fetch sequentially so a single SQL error is surfaced directly (and not masked by 25P02).
  const mileRows = await loadIftaEntries('ifta_miles_entries', {
    quarterId,
    tenantId,
    operatingEntityId,
    trx: executor,
  });
  const fuelRows = await loadIftaEntries('ifta_fuel_entries', {
    quarterId,
    tenantId,
    operatingEntityId,
    trx: executor,
  });

  const rates = await listJurisdictionRates(executor);

  const totalTaxableMiles = round2(mileRows.reduce((acc, r) => acc + Number(r.taxable_miles || 0), 0));
  const totalFleetMiles = round2(mileRows.reduce((acc, r) => acc + Number(r.total_miles || 0), 0));
  const totalGallons = round2(fuelRows.reduce((acc, r) => acc + Number(r.gallons || 0), 0));
  const fleetMpg = totalGallons > 0 ? round2(totalTaxableMiles / totalGallons) : 0;

  const byJurisdiction = new Map();

  for (const m of mileRows) {
    const j = String(m.jurisdiction || '').trim().toUpperCase();
    if (!j) continue;
    if (!byJurisdiction.has(j)) {
      byJurisdiction.set(j, {
        jurisdiction: j,
        total_miles: 0,
        taxable_miles: 0,
        tax_paid_gallons: 0,
        total_gallons: 0,
        taxable_gallons: 0,
        net_taxable_gallons: 0,
        tax_rate: rates.get(j) ?? 0,
        tax_due_credit: 0,
      });
    }
    const row = byJurisdiction.get(j);
    row.total_miles = round2(row.total_miles + Number(m.total_miles || 0));
    row.taxable_miles = round2(row.taxable_miles + Number(m.taxable_miles || 0));
  }

  for (const f of fuelRows) {
    const j = String(f.jurisdiction || '').trim().toUpperCase();
    if (!j) continue;
    if (!byJurisdiction.has(j)) {
      byJurisdiction.set(j, {
        jurisdiction: j,
        total_miles: 0,
        taxable_miles: 0,
        tax_paid_gallons: 0,
        total_gallons: 0,
        taxable_gallons: 0,
        net_taxable_gallons: 0,
        tax_rate: rates.get(j) ?? 0,
        tax_due_credit: 0,
      });
    }
    const row = byJurisdiction.get(j);
    const gallons = Number(f.gallons || 0);
    row.total_gallons = round2(row.total_gallons + gallons);
    if (f.tax_paid) row.tax_paid_gallons = round2(row.tax_paid_gallons + gallons);
  }

  const summaryRows = Array.from(byJurisdiction.values()).map((row) => {
    const taxableGallons = fleetMpg > 0 ? round2(Number(row.taxable_miles || 0) / fleetMpg) : 0;
    const netTaxableGallons = round2(taxableGallons - Number(row.tax_paid_gallons || 0));
    const taxRate = Number(row.tax_rate || 0);
    const taxDueCredit = round2(netTaxableGallons * taxRate);
    return {
      ...row,
      taxable_gallons: taxableGallons,
      net_taxable_gallons: netTaxableGallons,
      tax_due_credit: taxDueCredit,
      tax_rate: taxRate,
    };
  }).sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction));

  const totalDueCredit = round2(summaryRows.reduce((acc, r) => acc + Number(r.tax_due_credit || 0), 0));

  const nextSnapshot = Number(quarter.latest_snapshot_version || 0) + 1;

  await executor('ifta_jurisdiction_summary')
    .where({ quarter_id: quarterId, tenant_id: tenantId, is_current: true })
    .update({ is_current: false, updated_at: executor.fn.now() });

  if (summaryRows.length) {
    await executor('ifta_jurisdiction_summary').insert(
      summaryRows.map((r) => ({
        quarter_id: quarterId,
        tenant_id: tenantId,
        operating_entity_id: quarter.operating_entity_id || null,
        snapshot_version: nextSnapshot,
        is_current: true,
        jurisdiction: r.jurisdiction,
        total_miles: r.total_miles,
        taxable_miles: r.taxable_miles,
        tax_paid_gallons: r.tax_paid_gallons,
        total_gallons: r.total_gallons,
        taxable_gallons: r.taxable_gallons,
        net_taxable_gallons: r.net_taxable_gallons,
        tax_rate: r.tax_rate,
        tax_due_credit: r.tax_due_credit,
        created_by: userId,
        updated_by: userId,
      }))
    );
  }

  const [updatedQuarter] = await executor('ifta_quarters')
    .where({ id: quarterId, tenant_id: tenantId })
    .update({
      total_taxable_miles: totalTaxableMiles,
      total_fleet_miles: totalFleetMiles,
      total_gallons: totalGallons,
      fleet_mpg: fleetMpg,
      total_due_credit: totalDueCredit,
      latest_snapshot_version: nextSnapshot,
      updated_by: userId,
      updated_at: executor.fn.now(),
    })
    .returning('*');

  return {
    quarter: updatedQuarter,
    cards: {
      total_fleet_miles: totalFleetMiles,
      total_taxable_miles: totalTaxableMiles,
      total_gallons: totalGallons,
      fleet_mpg: fleetMpg,
      total_due_credit: totalDueCredit,
    },
    summaryRows,
  };
}

async function buildValidationFindings({ quarterId, tenantId, operatingEntityId = null, trx = knex }) {
  const quarter = await getQuarterById(quarterId, tenantId, operatingEntityId, trx);
  if (!quarter) throw new Error('IFTA quarter not found');

  const mileRows = await loadIftaEntries('ifta_miles_entries', {
    quarterId,
    tenantId,
    operatingEntityId,
    trx,
  });
  const fuelRows = await loadIftaEntries('ifta_fuel_entries', {
    quarterId,
    tenantId,
    operatingEntityId,
    trx,
  });
  const trucks = await loadTrucksForTenant(tenantId, trx);

  const findings = [];
  const selectedTruckIds = Array.isArray(quarter.selected_truck_ids) ? quarter.selected_truck_ids : [];

  if (!Number.isInteger(Number(quarter.quarter)) || Number(quarter.quarter) < 1 || Number(quarter.quarter) > 4 || Number(quarter.tax_year) < 2000) {
    findings.push({ type: 'invalid_quarter_year', severity: 'blocker', title: 'Quarter/Year is invalid', details: 'Quarter must be Q1-Q4 and tax year must be valid.' });
  }
  if (!selectedTruckIds.length) {
    findings.push({ type: 'missing_trucks', severity: 'blocker', title: 'No trucks selected', details: 'Select at least one truck before finalizing.' });
  }
  if (!mileRows.length) {
    findings.push({ type: 'missing_miles', severity: 'blocker', title: 'No mileage entries', details: 'Import or enter mileage rows before finalizing.' });
  }
  if (!fuelRows.length) {
    findings.push({ type: 'missing_fuel', severity: 'blocker', title: 'No fuel entries', details: 'Import or enter fuel purchases before finalizing.' });
  }

  const totalTaxableMiles = mileRows.reduce((a, r) => a + Number(r.taxable_miles || 0), 0);
  const totalGallons = fuelRows.reduce((a, r) => a + Number(r.gallons || 0), 0);
  if (totalTaxableMiles > 0 && totalGallons <= 0) {
    findings.push({
      type: 'zero_gallons_nonzero_miles',
      severity: 'blocker',
      title: 'Zero gallons with non-zero miles',
      details: 'Fuel gallons are zero while taxable miles are greater than zero.'
    });
  }

  const milesJur = new Set(mileRows.map((r) => String(r.jurisdiction || '').trim().toUpperCase()).filter(Boolean));
  const fuelJur = new Set(fuelRows.map((r) => String(r.jurisdiction || '').trim().toUpperCase()).filter(Boolean));
  const milesWithoutFuel = Array.from(milesJur).filter((j) => !fuelJur.has(j));
  if (milesWithoutFuel.length) {
    findings.push({
      type: 'jurisdiction_miles_without_fuel',
      severity: 'warning',
      title: 'Miles with no jurisdiction fuel purchases',
      details: `Jurisdictions: ${milesWithoutFuel.join(', ')}`
    });
  }

  const dupKey = new Map();
  const dupReceipts = new Set();
  for (const f of fuelRows) {
    const key = `${String(f.unit || '').toUpperCase()}|${String(f.receipt_invoice_number || '').toUpperCase()}|${dateOnly(f.purchase_date)}`;
    if (!String(f.receipt_invoice_number || '').trim()) continue;
    if (dupKey.has(key)) dupReceipts.add(String(f.receipt_invoice_number || '').trim());
    dupKey.set(key, true);
  }
  if (dupReceipts.size) {
    findings.push({
      type: 'duplicate_receipt_suspected',
      severity: 'warning',
      title: 'Potential duplicate receipts detected',
      details: `Receipts: ${Array.from(dupReceipts).join(', ')}`
    });
  }

  const { start, end } = quarterStartEnd(quarter.quarter, quarter.tax_year);
  const outside = fuelRows.filter((f) => !isDateInQuarter(f.purchase_date, quarter.quarter, quarter.tax_year));
  if (outside.length) {
    findings.push({
      type: 'purchase_date_outside_quarter',
      severity: 'warning',
      title: 'Fuel purchases outside selected quarter',
      details: `${outside.length} purchase(s) fall outside ${dateOnly(start)} to ${dateOnly(end)}.`
    });
  }

  const truckById = new Map(trucks.map((t) => [t.id, t]));
  const inactiveSelected = selectedTruckIds
    .map((id) => truckById.get(id))
    .filter((t) => t && (t.status === 'inactive' || t.is_active === false));
  if (inactiveSelected.length) {
    findings.push({
      type: 'inactive_truck_selected',
      severity: 'warning',
      title: 'Inactive trucks are selected',
      details: inactiveSelected.map((t) => t.unit_number || t.id).join(', ')
    });
  }

  const milesByTruck = new Map();
  const gallonsByTruck = new Map();
  for (const r of mileRows) {
    const key = r.truck_id || r.unit || 'unknown';
    milesByTruck.set(key, round2((milesByTruck.get(key) || 0) + Number(r.taxable_miles || 0)));
  }
  for (const f of fuelRows) {
    const key = f.truck_id || f.unit || 'unknown';
    gallonsByTruck.set(key, round2((gallonsByTruck.get(key) || 0) + Number(f.gallons || 0)));
  }
  const outlierUnits = [];
  for (const [key, miles] of milesByTruck.entries()) {
    const gallons = Number(gallonsByTruck.get(key) || 0);
    if (gallons <= 0) continue;
    const mpg = miles / gallons;
    if (mpg < 3 || mpg > 12) {
      outlierUnits.push(`${key} (${round2(mpg)} MPG)`);
    }
  }
  if (outlierUnits.length) {
    findings.push({
      type: 'truck_mpg_outlier',
      severity: 'warning',
      title: 'MPG outlier detected',
      details: outlierUnits.join(', ')
    });
  }

  if (!findings.length) {
    findings.push({
      type: 'quarter_ready',
      severity: 'info',
      title: 'Quarter appears filing-ready',
      details: 'No major blockers or warnings detected.'
    });
  }

  return findings.map((f) => ({ ...f, severity: f.severity || inferSeverity(f.type) }));
}

function buildNarrative({ quarter, cards, findings }) {
  const warningCount = findings.filter((f) => f.severity === 'warning' && !f.resolved).length;
  const blockerCount = findings.filter((f) => f.severity === 'blocker' && !f.resolved).length;
  const readiness = blockerCount > 0 ? 'not filing-ready' : warningCount > 0 ? 'close to filing-ready' : 'filing-ready';

  return `For Q${quarter.quarter} ${quarter.tax_year}, the fleet recorded ${cards.total_fleet_miles.toLocaleString()} total miles and ${cards.total_gallons.toLocaleString()} gallons, yielding an estimated fleet MPG of ${cards.fleet_mpg}. Net jurisdiction tax exposure is ${cards.total_due_credit >= 0 ? 'due' : 'credit'} ${Math.abs(cards.total_due_credit).toFixed(2)} USD. The quarter is currently ${readiness}, with ${warningCount} warning(s) and ${blockerCount} blocker(s).`;
}

module.exports = {
  round2,
  dateOnly,
  quarterStartEnd,
  isDateInQuarter,
  buildValidationFindings,
  computeAndPersistQuarterSummary,
  buildNarrative,
  getQuarterById,
};
