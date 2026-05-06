'use strict';

/**
 * FMCSA Reference Service (FN-1427).
 *
 * Single read API over the `fmcsa.*` reference dataset (carriers, authorities,
 * inspections, violations, crashes, basic_scores) populated by the bulk
 * importers. All consumers (`routes/fmcsa-safety.js`, `routes/shop-clients.js`,
 * `routes/brokers.js`) call into this module instead of hitting FMCSA web
 * pages or the legacy `fmcsa_*` snapshot tables.
 *
 * All reads go through `getFmcsaKnex()` — Phase 1 returns the main DB Knex,
 * Phase 2 will swap to a separate connection without touching consumers.
 */

const { getFmcsaKnex } = require('./fmcsa-knex');

const SCHEMA = 'fmcsa';

// ─── Carriers ────────────────────────────────────────────────────────────────

/**
 * Fetch the carrier master record for a DOT number.
 * Returns null if not found.
 */
async function getCarrier(dot) {
  const dotInt = toBigInt(dot);
  if (dotInt === null) return null;
  const knex = getFmcsaKnex();
  const row = await knex(`${SCHEMA}.carriers`).where({ dot: dotInt }).first();
  return row || null;
}

/**
 * Public contact info (phone, fax, email) for a carrier.
 * Returned shape always has the three keys; missing values are null.
 */
async function getCarrierContacts(dot) {
  const carrier = await getCarrier(dot);
  if (!carrier) return null;
  return {
    phone: carrier.phone || null,
    fax: carrier.fax || null,
    email: carrier.email || null,
  };
}

/**
 * Fetch authorities (Common / Contract / Broker) for a DOT.
 * Returns an array; empty if none.
 */
async function getCarrierAuthorities(dot) {
  const dotInt = toBigInt(dot);
  if (dotInt === null) return [];
  const knex = getFmcsaKnex();
  return knex(`${SCHEMA}.authorities`)
    .where({ dot: dotInt })
    .orderBy('authority_type', 'asc');
}

/**
 * Fuzzy carrier search (legal_name, dba_name, mc_number).
 * Uses the GIN trigram indexes on legal_name/dba_name when present.
 * @returns {{ rows, total }}
 */
async function searchCarriers({ q = '', limit = 50, offset = 0 } = {}) {
  const knex = getFmcsaKnex();
  const term = String(q || '').trim();
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const base = knex(`${SCHEMA}.carriers as c`);
  if (term) {
    const like = `%${term}%`;
    base.where(function whereSearch() {
      this.whereRaw('COALESCE(c.legal_name, \'\') ILIKE ?', [like])
        .orWhereRaw('COALESCE(c.dba_name, \'\') ILIKE ?', [like])
        .orWhereRaw('COALESCE(c.mc_number, \'\') ILIKE ?', [like]);
    });
  }

  const [{ total }] = await base.clone().count('* as total');
  const rows = await base
    .clone()
    .select('*')
    .orderByRaw('COALESCE(c.legal_name, c.dba_name) ASC NULLS LAST')
    .limit(safeLimit)
    .offset(safeOffset);

  return { rows, total: Number(total) || 0, limit: safeLimit, offset: safeOffset };
}

// ─── Brokers ─────────────────────────────────────────────────────────────────

/**
 * Lookup an active broker authority by MC number, joined with carrier
 * fields (legal_name, address, contacts) when available.
 * Returns null if no active Broker authority for that MC exists.
 */
async function getBroker(mc) {
  const mcStr = String(mc || '').trim();
  if (!mcStr) return null;
  const knex = getFmcsaKnex();
  const row = await knex(`${SCHEMA}.authorities as a`)
    .leftJoin(`${SCHEMA}.carriers as c`, 'a.dot', 'c.dot')
    .where('a.mc_number', mcStr)
    .where('a.authority_type', 'Broker')
    .where('a.status', 'Active')
    .select(
      'a.dot',
      'a.mc_number',
      'a.authority_type',
      'a.status',
      'a.authority_status_changed_at',
      'a.insurance_carriers',
      'a.insurance_amounts',
      'a.fmcsa_synced_at',
      'c.legal_name',
      'c.dba_name',
      'c.address_line1',
      'c.address_line2',
      'c.city',
      'c.state',
      'c.zip_code',
      'c.country',
      'c.phone',
      'c.fax',
      'c.email',
    )
    .first();
  return row || null;
}

/**
 * Fuzzy search across active broker authorities + carrier names.
 */
async function searchBrokers({ q = '', limit = 50, offset = 0 } = {}) {
  const knex = getFmcsaKnex();
  const term = String(q || '').trim();
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const base = knex(`${SCHEMA}.authorities as a`)
    .leftJoin(`${SCHEMA}.carriers as c`, 'a.dot', 'c.dot')
    .where('a.authority_type', 'Broker')
    .where('a.status', 'Active');

  if (term) {
    const like = `%${term}%`;
    base.where(function whereSearch() {
      this.whereRaw('COALESCE(c.legal_name, \'\') ILIKE ?', [like])
        .orWhereRaw('COALESCE(c.dba_name, \'\') ILIKE ?', [like])
        .orWhereRaw('a.mc_number ILIKE ?', [like]);
    });
  }

  const [{ total }] = await base.clone().count('* as total');
  const rows = await base
    .clone()
    .select(
      'a.dot',
      'a.mc_number',
      'a.authority_type',
      'a.status',
      'a.fmcsa_synced_at',
      'c.legal_name',
      'c.dba_name',
      'c.address_line1',
      'c.address_line2',
      'c.city',
      'c.state',
      'c.zip_code',
      'c.country',
      'c.phone',
      'c.email',
    )
    .orderByRaw('COALESCE(c.legal_name, c.dba_name) ASC NULLS LAST')
    .limit(safeLimit)
    .offset(safeOffset);

  return { rows, total: Number(total) || 0, limit: safeLimit, offset: safeOffset };
}

// ─── Inspections / Crashes ───────────────────────────────────────────────────

/**
 * Fetch inspections for a DOT, optionally restricted to dates >= since.
 * Newest first.
 */
async function getInspections(dot, { since } = {}) {
  const dotInt = toBigInt(dot);
  if (dotInt === null) return [];
  const knex = getFmcsaKnex();
  const q = knex(`${SCHEMA}.inspections`)
    .where({ dot: dotInt })
    .orderBy('inspection_date', 'desc');
  if (since) q.where('inspection_date', '>=', since);
  return q;
}

/**
 * Aggregate inspection counts and out-of-service rates over a window.
 * Replaces the pre-computed snapshot fields previously read from
 * `fmcsa_safety_snapshots`.
 */
async function getInspectionStats(dot, { since } = {}) {
  const dotInt = toBigInt(dot);
  if (dotInt === null) return emptyInspectionStats();
  const knex = getFmcsaKnex();
  const q = knex(`${SCHEMA}.inspections`).where({ dot: dotInt });
  if (since) q.where('inspection_date', '>=', since);
  const row = await q
    .select(
      knex.raw('COUNT(*)::int AS inspection_count'),
      knex.raw('COALESCE(SUM(vehicle_count), 0)::int AS vehicle_inspection_count'),
      knex.raw('COALESCE(SUM(driver_count), 0)::int AS driver_inspection_count'),
      knex.raw('COALESCE(SUM(hazmat_count), 0)::int AS hazmat_inspection_count'),
      knex.raw('COALESCE(SUM(vehicle_oos_count), 0)::int AS vehicle_oos_count'),
      knex.raw('COALESCE(SUM(driver_oos_count), 0)::int AS driver_oos_count'),
      knex.raw('COALESCE(SUM(hazmat_oos_count), 0)::int AS hazmat_oos_count'),
    )
    .first();
  if (!row) return emptyInspectionStats();
  return {
    ...row,
    vehicle_oos_rate: pctRate(row.vehicle_oos_count, row.vehicle_inspection_count),
    driver_oos_rate: pctRate(row.driver_oos_count, row.driver_inspection_count),
    hazmat_oos_rate: pctRate(row.hazmat_oos_count, row.hazmat_inspection_count),
  };
}

async function getCrashes(dot) {
  const dotInt = toBigInt(dot);
  if (dotInt === null) return [];
  const knex = getFmcsaKnex();
  return knex(`${SCHEMA}.crashes`).where({ dot: dotInt }).orderBy('crash_date', 'desc');
}

// ─── BASIC scores ────────────────────────────────────────────────────────────

/**
 * BASIC scores for a DOT.
 * - Default `latest=true`: one row per BASIC, the most recent computed_at.
 * - `latest=false`: full history (reverse-chronological), used for trend charts.
 */
async function getBasicScores(dot, { latest = true } = {}) {
  const dotInt = toBigInt(dot);
  if (dotInt === null) return [];
  const knex = getFmcsaKnex();
  if (latest) {
    return knex(`${SCHEMA}.basic_scores`)
      .where({ dot: dotInt })
      .distinctOn('basic')
      .orderBy('basic')
      .orderBy('computed_at', 'desc');
  }
  return knex(`${SCHEMA}.basic_scores`)
    .where({ dot: dotInt })
    .orderBy('basic', 'asc')
    .orderBy('computed_at', 'desc');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toBigInt(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

function pctRate(num, denom) {
  const n = Number(num) || 0;
  const d = Number(denom) || 0;
  if (d === 0) return 0;
  return Number(((n / d) * 100).toFixed(2));
}

function emptyInspectionStats() {
  return {
    inspection_count: 0,
    vehicle_inspection_count: 0,
    driver_inspection_count: 0,
    hazmat_inspection_count: 0,
    vehicle_oos_count: 0,
    driver_oos_count: 0,
    hazmat_oos_count: 0,
    vehicle_oos_rate: 0,
    driver_oos_rate: 0,
    hazmat_oos_rate: 0,
  };
}

module.exports = {
  getCarrier,
  getCarrierContacts,
  getCarrierAuthorities,
  searchCarriers,
  getBroker,
  searchBrokers,
  getInspections,
  getInspectionStats,
  getCrashes,
  getBasicScores,
};
