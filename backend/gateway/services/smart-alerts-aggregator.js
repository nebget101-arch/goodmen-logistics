'use strict';

/**
 * FN-1161: Smart Alerts aggregator.
 *
 * Fans out to drivers-compliance, vehicles-maintenance, and logistics to
 * collect raw signals (HOS imminent, fatigue, inspection overdue, late-load
 * risk), then asks ai-service `/api/ai/score-alert` to rank each signal by
 * severity 0-100. Filters out alerts the user has dismissed, sorts by
 * severity desc, returns the top N.
 *
 *   const aggregator = buildSmartAlertsAggregator({ fetcher, ... });
 *   const result = await aggregator.collect({ tenantId, userId, authHeader });
 *   // result = { tenantId, alerts: [...], upstreamErrors: [...] }
 *
 * Failure modes are intentionally lenient: a single upstream timeout produces
 * a `null` slice and an entry in `upstreamErrors`, but the response still
 * returns 200 with whatever signals did load. AI scoring failures fall back
 * to a per-type baseline severity so the panel still shows alerts.
 */

const DEFAULT_UPSTREAM_TIMEOUT_MS = 8000;
const DEFAULT_AI_TIMEOUT_MS = 12000;
const DEFAULT_TOP_N = 25;

const FALLBACK_SEVERITY = {
  hos_imminent: 75,
  fatigue: 60,
  inspection_overdue: 65,
  late_load_risk: 55
};

async function fetchWithTimeout(url, options, fetcher, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`upstream ${url} responded ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  if (value && Array.isArray(value.data)) return value.data;
  return [];
}

function normalizeHosImminent(items) {
  return asArray(items).map((item) => ({
    id: `hos:${item.driverId || item.driver_id || item.id}:${item.windowEndsAt || item.window_ends_at || ''}`,
    type: 'hos_imminent',
    subjectId: String(item.driverId || item.driver_id || item.id || ''),
    subjectKind: 'driver',
    title: item.title || `HOS violation imminent: ${item.driverName || item.driver_name || item.driverId || 'driver'}`,
    facts: {
      driverName: item.driverName || item.driver_name || null,
      minutesRemaining: item.minutesRemaining ?? item.minutes_remaining ?? null,
      windowType: item.windowType || item.window_type || null
    }
  }));
}

function normalizeFatigue(items) {
  return asArray(items).map((item) => ({
    id: `fatigue:${item.driverId || item.driver_id || item.id}`,
    type: 'fatigue',
    subjectId: String(item.driverId || item.driver_id || item.id || ''),
    subjectKind: 'driver',
    title: item.title || `Driver fatigue risk: ${item.driverName || item.driver_name || item.driverId || 'driver'}`,
    facts: {
      driverName: item.driverName || item.driver_name || null,
      fatigueScore: item.fatigueScore ?? item.fatigue_score ?? item.score ?? null,
      consecutiveDutyHours: item.consecutiveDutyHours ?? item.consecutive_duty_hours ?? null
    }
  }));
}

function normalizeInspectionOverdue(items) {
  return asArray(items).map((item) => ({
    id: `inspection:${item.vehicleId || item.vehicle_id || item.id}`,
    type: 'inspection_overdue',
    subjectId: String(item.vehicleId || item.vehicle_id || item.id || ''),
    subjectKind: 'vehicle',
    title: item.title || `Inspection overdue: ${item.unit || item.vin || item.vehicleId || 'vehicle'}`,
    facts: {
      unit: item.unit || null,
      daysOverdue: item.daysOverdue ?? item.days_overdue ?? null,
      inspectionType: item.inspectionType || item.inspection_type || null
    }
  }));
}

function normalizeLateLoadRisk(items) {
  return asArray(items).map((item) => ({
    id: `load:${item.loadId || item.load_id || item.id}`,
    type: 'late_load_risk',
    subjectId: String(item.loadId || item.load_id || item.id || ''),
    subjectKind: 'load',
    title: item.title || `Late delivery risk: ${item.loadNumber || item.load_number || item.loadId || 'load'}`,
    facts: {
      loadNumber: item.loadNumber || item.load_number || null,
      etaDelta: item.etaDelta ?? item.eta_delta ?? null,
      destination: item.destination || null
    }
  }));
}

function buildSmartAlertsAggregator(deps) {
  const {
    fetcher,
    driversUrl,
    vehiclesUrl,
    logisticsUrl,
    aiUrl,
    upstreamTimeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS,
    aiTimeoutMs = DEFAULT_AI_TIMEOUT_MS,
    topN = DEFAULT_TOP_N
  } = deps;

  if (!fetcher) throw new Error('smart-alerts-aggregator: fetcher is required');
  if (!driversUrl) throw new Error('smart-alerts-aggregator: driversUrl is required');
  if (!vehiclesUrl) throw new Error('smart-alerts-aggregator: vehiclesUrl is required');
  if (!logisticsUrl) throw new Error('smart-alerts-aggregator: logisticsUrl is required');
  if (!aiUrl) throw new Error('smart-alerts-aggregator: aiUrl is required');

  function buildAuthHeaders(authHeader) {
    const h = { Accept: 'application/json' };
    if (authHeader) h.Authorization = authHeader;
    return h;
  }

  async function fanOutSignals({ authHeader }) {
    const headers = buildAuthHeaders(authHeader);
    const opts = { method: 'GET', headers };

    const targets = [
      { key: 'hosImminent', url: `${driversUrl}/api/hos/violations/imminent?limit=20`, normalize: normalizeHosImminent },
      { key: 'fatigue', url: `${driversUrl}/api/drivers/fatigue/top?limit=20`, normalize: normalizeFatigue },
      { key: 'inspectionsOverdue', url: `${vehiclesUrl}/api/vehicles/inspections/overdue?limit=20`, normalize: normalizeInspectionOverdue },
      { key: 'lateLoads', url: `${logisticsUrl}/api/loads/late-risk?limit=20`, normalize: normalizeLateLoadRisk }
    ];

    const settled = await Promise.allSettled(
      targets.map((t) => fetchWithTimeout(t.url, opts, fetcher, upstreamTimeoutMs))
    );

    const rawAlerts = [];
    const upstreamErrors = [];
    settled.forEach((result, idx) => {
      const target = targets[idx];
      if (result.status === 'fulfilled') {
        rawAlerts.push(...target.normalize(result.value));
      } else {
        upstreamErrors.push({
          source: target.key,
          error: String(result.reason?.message || result.reason)
        });
      }
    });

    return { rawAlerts, upstreamErrors };
  }

  async function scoreAlert({ tenantId, authHeader, alert }) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    if (authHeader) headers.Authorization = authHeader;

    try {
      const body = JSON.stringify({
        tenantId,
        alert: {
          id: alert.id,
          type: alert.type,
          subjectId: alert.subjectId,
          subjectKind: alert.subjectKind,
          facts: alert.facts
        }
      });
      const result = await fetchWithTimeout(
        `${aiUrl}/api/ai/score-alert`,
        { method: 'POST', headers, body },
        fetcher,
        aiTimeoutMs
      );
      const severity = Number(result?.severity);
      const reasoning = typeof result?.reasoning === 'string' ? result.reasoning : null;
      const action = result?.action || null;
      if (Number.isFinite(severity)) {
        return {
          severity: Math.max(0, Math.min(100, severity)),
          reasoning,
          action,
          scoredBy: 'ai'
        };
      }
      return {
        severity: FALLBACK_SEVERITY[alert.type] ?? 50,
        reasoning: null,
        action: null,
        scoredBy: 'fallback:invalid-ai-response'
      };
    } catch (err) {
      return {
        severity: FALLBACK_SEVERITY[alert.type] ?? 50,
        reasoning: null,
        action: null,
        scoredBy: 'fallback:ai-error',
        scoreError: String(err?.message || err)
      };
    }
  }

  async function collect({ tenantId, userId, authHeader, dismissalsStore }) {
    if (!tenantId) throw new Error('smart-alerts-aggregator: tenantId is required');

    const { rawAlerts, upstreamErrors } = await fanOutSignals({ authHeader });

    const visible = [];
    for (const raw of rawAlerts) {
      if (dismissalsStore && userId) {
        // eslint-disable-next-line no-await-in-loop
        const dismissed = await dismissalsStore.isDismissed({
          tenantId,
          userId,
          alertId: raw.id
        });
        if (dismissed) continue;
      }
      visible.push(raw);
    }

    // Score in parallel (bounded by Promise.all; in practice rawAlerts is small).
    const scored = await Promise.all(
      visible.map(async (raw) => {
        const score = await scoreAlert({ tenantId, authHeader, alert: raw });
        return { ...raw, ...score };
      })
    );

    scored.sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0));
    const ranked = scored.slice(0, topN);

    return {
      tenantId,
      alerts: ranked,
      upstreamErrors,
      generatedAt: new Date().toISOString()
    };
  }

  return { collect };
}

module.exports = {
  buildSmartAlertsAggregator,
  FALLBACK_SEVERITY,
  // exported for tests
  _normalize: {
    hosImminent: normalizeHosImminent,
    fatigue: normalizeFatigue,
    inspectionOverdue: normalizeInspectionOverdue,
    lateLoadRisk: normalizeLateLoadRisk
  }
};
