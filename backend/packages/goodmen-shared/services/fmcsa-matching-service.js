'use strict';

/**
 * FN-474: FMCSA Inspection Fleet Matching Service.
 * Matches FMCSA inspection records to fleet vehicles and drivers
 * using a prioritized matching chain: VIN → plate → CDL → fuzzy name.
 */

const knex = require('../config/knex');
const dtLogger = require('../utils/logger');

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:4100';
const AI_MATCH_TIMEOUT_MS = 15000;

// ─── Match by VIN (highest confidence) ──────────────────────────────────────
async function matchByVin(tenantId, inspection) {
  const vehicles = inspection.vehicles || [];
  for (const v of vehicles) {
    const vin = (v.vin || '').toString().trim().toUpperCase();
    if (vin.length < 6) continue;
    const vehicle = await knex('vehicles')
      .where({ tenant_id: tenantId })
      .whereRaw('UPPER(TRIM(vin)) = ?', [vin])
      .first('id', 'unit_number');
    if (vehicle) {
      return { vehicleId: vehicle.id, method: 'vin', confidence: 1.0, detail: `VIN ${vin}` };
    }
  }
  return null;
}

// ─── Match by plate number ──────────────────────────────────────────────────
async function matchByPlate(tenantId, inspection) {
  const plate = (inspection.plate_number || '').toString().trim().toUpperCase();
  if (!plate || plate.length < 3) return null;
  const vehicle = await knex('vehicles')
    .where({ tenant_id: tenantId })
    .whereRaw('UPPER(TRIM(plate_number)) = ?', [plate])
    .first('id', 'unit_number');
  if (vehicle) {
    return { vehicleId: vehicle.id, method: 'plate', confidence: 0.9, detail: `Plate ${plate}` };
  }
  return null;
}

// ─── Match driver by CDL number ─────────────────────────────────────────────
async function matchDriverByCdl(tenantId, inspection) {
  const violations = inspection.violations || [];
  // CDL number might be in inspection details or driver info
  const driverLicense = (inspection.driver_license_number || '').toString().trim().toUpperCase();
  if (!driverLicense || driverLicense.length < 5) return null;

  const license = await knex('driver_licenses')
    .join('drivers', 'drivers.id', 'driver_licenses.driver_id')
    .where('drivers.tenant_id', tenantId)
    .whereRaw('UPPER(TRIM(driver_licenses.license_number)) = ?', [driverLicense])
    .first('drivers.id as driver_id', 'drivers.first_name', 'drivers.last_name');

  if (license) {
    return { driverId: license.driver_id, method: 'cdl', confidence: 0.95, detail: `CDL ${driverLicense}` };
  }
  return null;
}

// ─── Match driver by name (fuzzy) ───────────────────────────────────────────
async function matchDriverByName(tenantId, inspection) {
  const driverName = (inspection.driver_name || '').toString().trim();
  if (!driverName || driverName.length < 3) return null;

  const parts = driverName.split(/[\s,]+/).filter(Boolean);
  if (parts.length < 2) return null;

  // Try first_name + last_name match (case-insensitive)
  const driver = await knex('drivers')
    .where({ tenant_id: tenantId })
    .whereRaw(
      `LOWER(TRIM(first_name)) || ' ' || LOWER(TRIM(last_name)) = LOWER(?)`,
      [driverName]
    )
    .first('id', 'first_name', 'last_name');

  if (driver) {
    return { driverId: driver.id, method: 'name_exact', confidence: 0.85, detail: `Name "${driverName}"` };
  }

  // Try reversed order (Last, First format common in FMCSA)
  const reversed = `${parts[parts.length - 1]} ${parts.slice(0, -1).join(' ')}`;
  const driverReversed = await knex('drivers')
    .where({ tenant_id: tenantId })
    .whereRaw(
      `LOWER(TRIM(first_name)) || ' ' || LOWER(TRIM(last_name)) = LOWER(?)`,
      [reversed]
    )
    .first('id', 'first_name', 'last_name');

  if (driverReversed) {
    return { driverId: driverReversed.id, method: 'name_reversed', confidence: 0.75, detail: `Name reversed "${driverName}"` };
  }

  return null;
}

// ─── Match driver by AI fuzzy name (FN-476) ─────────────────────────────────
async function matchDriverByAi(tenantId, inspection) {
  const driverName = (inspection.driver_name || inspection.driver_name_raw || '').toString().trim();
  if (!driverName || driverName.length < 3) return null;

  // Fetch fleet drivers for this tenant
  const fleetDrivers = await knex('drivers')
    .where({ tenant_id: tenantId })
    .select('id', 'first_name', 'last_name');

  if (!fleetDrivers.length) return null;

  // Also try to get CDL numbers for additional context
  const driverIds = fleetDrivers.map((d) => d.id);
  const licenses = await knex('driver_licenses')
    .whereIn('driver_id', driverIds)
    .select('driver_id', 'license_number');

  const licenseMap = {};
  for (const lic of licenses) {
    licenseMap[lic.driver_id] = lic.license_number;
  }

  const driversPayload = fleetDrivers.map((d) => ({
    id: d.id,
    first_name: d.first_name,
    last_name: d.last_name,
    cdl_number: licenseMap[d.id] || null,
  }));

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_MATCH_TIMEOUT_MS);

    const response = await fetch(`${AI_SERVICE_URL}/api/ai/fmcsa/match-driver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fmcsaDriverName: driverName,
        fleetDrivers: driversPayload,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      dtLogger.warn('fmcsa_ai_match_http_error', { status: response.status, driverName });
      return null;
    }

    const data = await response.json();
    if (!data.success || !data.match) {
      return {
        driverId: null,
        method: 'ai_fuzzy',
        confidence: 0,
        detail: `AI fuzzy: no match for "${driverName}"`,
        matchDetails: data,
      };
    }

    return {
      driverId: data.match.driverId,
      method: 'ai_fuzzy',
      confidence: data.match.confidence,
      detail: `AI fuzzy: ${data.match.reasoning}`,
      matchDetails: {
        status: data.status,
        match: data.match,
        candidates: data.candidates,
        meta: data.meta,
      },
    };
  } catch (err) {
    // Log but don't fail the matching chain — AI is a best-effort fallback
    dtLogger.warn('fmcsa_ai_match_error', {
      error: err.message,
      driverName,
      isTimeout: err.name === 'AbortError',
    });
    return null;
  }
}

// ─── Cross-validate vehicle-driver assignment ───────────────────────────────
async function crossValidateAssignment(tenantId, vehicleId, driverId) {
  if (!vehicleId || !driverId) return null;
  // Check if the driver is currently assigned to this vehicle
  const assignment = await knex('drivers')
    .where({ id: driverId, tenant_id: tenantId })
    .first('assigned_vehicle_id');
  if (assignment?.assigned_vehicle_id === vehicleId) {
    return { validated: true, detail: 'Driver currently assigned to matched vehicle' };
  }
  return { validated: false, detail: 'Driver not assigned to matched vehicle — review recommended' };
}

/**
 * Run the full matching chain for a single inspection record.
 * Returns { vehicleId, driverId, method, confidence, details }
 */
async function matchInspection(tenantId, inspection) {
  const result = { vehicleId: null, driverId: null, vehicleMethod: null, driverMethod: null, confidence: 0, details: [] };

  // Step 1: Match vehicle (VIN → plate)
  const vinMatch = await matchByVin(tenantId, inspection);
  if (vinMatch) {
    result.vehicleId = vinMatch.vehicleId;
    result.vehicleMethod = vinMatch.method;
    result.confidence = Math.max(result.confidence, vinMatch.confidence);
    result.details.push(vinMatch.detail);
  } else {
    const plateMatch = await matchByPlate(tenantId, inspection);
    if (plateMatch) {
      result.vehicleId = plateMatch.vehicleId;
      result.vehicleMethod = plateMatch.method;
      result.confidence = Math.max(result.confidence, plateMatch.confidence);
      result.details.push(plateMatch.detail);
    }
  }

  // Step 2: Match driver (CDL → name → AI fuzzy)
  const cdlMatch = await matchDriverByCdl(tenantId, inspection);
  if (cdlMatch) {
    result.driverId = cdlMatch.driverId;
    result.driverMethod = cdlMatch.method;
    result.confidence = Math.max(result.confidence, cdlMatch.confidence);
    result.details.push(cdlMatch.detail);
  } else {
    const nameMatch = await matchDriverByName(tenantId, inspection);
    if (nameMatch) {
      result.driverId = nameMatch.driverId;
      result.driverMethod = nameMatch.method;
      result.confidence = Math.max(result.confidence, nameMatch.confidence);
      result.details.push(nameMatch.detail);
    } else {
      // FN-476: AI fuzzy name matching as final fallback
      const aiMatch = await matchDriverByAi(tenantId, inspection);
      if (aiMatch && aiMatch.driverId && aiMatch.confidence >= 0.5) {
        result.driverId = aiMatch.driverId;
        result.driverMethod = aiMatch.method;
        result.confidence = Math.max(result.confidence, aiMatch.confidence);
        result.details.push(aiMatch.detail);
        result.matchDetails = aiMatch.matchDetails;
      } else if (aiMatch?.matchDetails) {
        // Store AI details even when no match, for debugging
        result.matchDetails = aiMatch.matchDetails;
      }
    }
  }

  // Step 3: Cross-validate
  if (result.vehicleId && result.driverId) {
    const cv = await crossValidateAssignment(tenantId, result.vehicleId, result.driverId);
    if (cv) result.details.push(cv.detail);
  }

  // Determine overall method
  const method = [result.vehicleMethod, result.driverMethod].filter(Boolean).join('+') || null;

  return {
    vehicleId: result.vehicleId,
    driverId: result.driverId,
    method,
    confidence: result.confidence,
    matched: !!(result.vehicleId || result.driverId),
    details: result.details,
    matchDetails: result.matchDetails || null,
  };
}

/**
 * Create a driver_risk_event from a matched inspection.
 */
async function createRiskEvent(tenantId, inspection, matchResult) {
  if (!matchResult.driverId) return null;

  const violationCount = Array.isArray(inspection.violations) ? inspection.violations.length : 0;
  const oosFlag = !!(inspection.driver_oos || inspection.vehicle_oos);
  const severity = oosFlag ? 'high' : violationCount > 3 ? 'medium' : violationCount > 0 ? 'low' : 'low';
  const severityWeight = oosFlag ? 10 : violationCount > 3 ? 5 : violationCount > 0 ? 2 : 1;

  // Check for existing event (dedup by source_id)
  const existing = await knex('driver_risk_events')
    .where({ driver_id: matchResult.driverId, event_source: 'fmcsa', source_id: inspection.id })
    .first('id');
  if (existing) return existing;

  const [event] = await knex('driver_risk_events').insert({
    tenant_id: tenantId,
    driver_id: matchResult.driverId,
    vehicle_id: matchResult.vehicleId,
    event_type: 'inspection',
    event_source: 'fmcsa',
    source_id: inspection.id,
    event_date: inspection.inspection_date,
    description: `FMCSA Inspection ${inspection.report_number || ''} — ${violationCount} violation(s)${oosFlag ? ', OOS' : ''}`,
    severity,
    severity_weight: severityWeight,
    oos_flag: oosFlag,
    violation_count: violationCount,
    details: JSON.stringify({ report_number: inspection.report_number, violations: inspection.violations }),
    match_method: matchResult.method,
    match_confidence: matchResult.confidence
  }).returning('*');

  return event;
}

/**
 * Batch match all unmatched inspections for a carrier/tenant.
 */
async function rematchInspections(tenantId, carrierId) {
  const unmatched = await knex('fmcsa_inspection_history')
    .where({ carrier_id: carrierId })
    .whereIn('match_status', ['unmatched', 'failed'])
    .select('*');

  let matched = 0;
  let failed = 0;

  for (const insp of unmatched) {
    const result = await matchInspection(tenantId, insp);
    if (result.matched) {
      const updateData = {
        match_status: 'matched',
        match_method: result.method,
        match_confidence: result.confidence,
        matched_driver_id: result.driverId,
        matched_vehicle_id: result.vehicleId,
        matched_at: new Date(),
      };
      if (result.matchDetails) {
        updateData.match_details = JSON.stringify(result.matchDetails);
      }
      await knex('fmcsa_inspection_history').where({ id: insp.id }).update(updateData);
      await createRiskEvent(tenantId, insp, result);
      matched++;
    } else {
      const failUpdate = { match_status: 'failed' };
      if (result.matchDetails) {
        failUpdate.match_details = JSON.stringify(result.matchDetails);
      }
      await knex('fmcsa_inspection_history').where({ id: insp.id }).update(failUpdate);
      failed++;
    }
  }

  dtLogger.info('fmcsa_rematch_complete', { tenantId, carrierId, total: unmatched.length, matched, failed });
  return { total: unmatched.length, matched, failed };
}

module.exports = {
  matchInspection,
  createRiskEvent,
  rematchInspections,
  matchByVin,
  matchByPlate,
  matchDriverByCdl,
  matchDriverByName,
  matchDriverByAi,
};
