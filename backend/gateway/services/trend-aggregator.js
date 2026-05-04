'use strict';

/**
 * FN-1152: Predictive Insights & Trends aggregator.
 *
 * Derives 4 trend series for a tenant from existing tables:
 *   - loadVolume   : count of completed loads per day
 *   - maintenance  : count of work_orders opened per day
 *   - onTimePct    : on-time delivery percentage per day
 *   - fuelCost     : sum of fuel_transactions amount per day
 *
 * Each series returns { actual, predicted } where:
 *   - actual    is a 7-day window ending today (UTC), oldest → newest
 *   - predicted is a 7-day forecast for the following week, derived via
 *     simple linear regression over the actual values; insufficient data
 *     yields nulls rather than throwing (sparse-data graceful nulls).
 */

const FUTURE_WINDOW_DAYS = 7;

function dateOnlyUtc(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

function buildPastWindow(today, days) {
  const start = dateOnlyUtc(today);
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(isoDay(d));
  }
  return out;
}

function buildFutureWindow(today, days) {
  const start = dateOnlyUtc(today);
  const out = [];
  for (let i = 1; i <= days; i += 1) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    out.push(isoDay(d));
  }
  return out;
}

function rowDayKey(rawDay) {
  if (rawDay == null) return null;
  if (typeof rawDay === 'string') return rawDay.slice(0, 10);
  if (rawDay instanceof Date) return isoDay(rawDay);
  return String(rawDay).slice(0, 10);
}

function fillSeriesByDay(rows, days, valueKey) {
  const map = new Map();
  for (const r of rows) {
    const k = rowDayKey(r.day);
    if (k == null) continue;
    const v = r[valueKey];
    map.set(k, v == null ? null : Number(v));
  }
  return days.map((d) => ({
    date: d,
    value: map.has(d) ? map.get(d) : null
  }));
}

function linearForecast(actualSeries, futureDays) {
  const points = [];
  actualSeries.forEach((p, i) => {
    if (p.value != null && Number.isFinite(p.value)) {
      points.push({ x: i, y: p.value });
    }
  });
  if (points.length < 2) {
    return futureDays.map((d) => ({ date: d, value: null }));
  }
  const n = points.length;
  const sumX = points.reduce((a, p) => a + p.x, 0);
  const sumY = points.reduce((a, p) => a + p.y, 0);
  const sumXY = points.reduce((a, p) => a + p.x * p.y, 0);
  const sumXX = points.reduce((a, p) => a + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) {
    const avg = sumY / n;
    return futureDays.map((d) => ({ date: d, value: avg }));
  }
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return futureDays.map((d, i) => {
    const xi = actualSeries.length + i;
    return { date: d, value: slope * xi + intercept };
  });
}

function emptySeries(actualDays, futureDays) {
  return {
    actual: actualDays.map((d) => ({ date: d, value: null })),
    predicted: futureDays.map((d) => ({ date: d, value: null }))
  };
}

async function safeQuery(label, fn, errors) {
  try {
    return await fn();
  } catch (err) {
    errors.push({
      source: label,
      error: err && err.message ? err.message : String(err)
    });
    return null;
  }
}

async function loadVolumeQuery(knex, tenantId, startDay, endDay) {
  const result = await knex.raw(
    `
      SELECT completed_date::date AS day, COUNT(*)::int AS count
      FROM loads
      WHERE tenant_id = ?
        AND completed_date IS NOT NULL
        AND completed_date >= ?
        AND completed_date <= ?
      GROUP BY day
      ORDER BY day
    `,
    [tenantId, startDay, endDay]
  );
  return result.rows || [];
}

async function maintenanceQuery(knex, tenantId, startDay, endDay) {
  const result = await knex.raw(
    `
      SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS count
      FROM work_orders
      WHERE tenant_id = ?
        AND created_at >= ?::timestamptz
        AND created_at < (?::date + INTERVAL '1 day')
      GROUP BY day
      ORDER BY day
    `,
    [tenantId, `${startDay}T00:00:00Z`, endDay]
  );
  return result.rows || [];
}

async function onTimePctQuery(knex, tenantId, startDay, endDay) {
  const result = await knex.raw(
    `
      SELECT
        l.completed_date::date AS day,
        COUNT(*)::int AS total,
        SUM(
          CASE
            WHEN ls.last_delivery IS NULL OR l.completed_date <= ls.last_delivery
            THEN 1 ELSE 0
          END
        )::int AS on_time
      FROM loads l
      LEFT JOIN (
        SELECT load_id, MAX(stop_date) AS last_delivery
        FROM load_stops
        WHERE stop_type = 'DELIVERY'
        GROUP BY load_id
      ) ls ON ls.load_id = l.id
      WHERE l.tenant_id = ?
        AND l.status = 'DELIVERED'
        AND l.completed_date IS NOT NULL
        AND l.completed_date >= ?
        AND l.completed_date <= ?
      GROUP BY day
      ORDER BY day
    `,
    [tenantId, startDay, endDay]
  );
  return (result.rows || []).map((r) => ({
    day: r.day,
    pct: r.total > 0 ? (r.on_time / r.total) * 100 : null
  }));
}

async function fuelCostQuery(knex, tenantId, startDay, endDay) {
  const result = await knex.raw(
    `
      SELECT transaction_date::date AS day,
             SUM(amount)::float AS total
      FROM fuel_transactions
      WHERE tenant_id = ?
        AND transaction_date >= ?
        AND transaction_date <= ?
      GROUP BY day
      ORDER BY day
    `,
    [tenantId, startDay, endDay]
  );
  return result.rows || [];
}

function buildTrendAggregator(deps) {
  const { knex, cache, now = () => new Date() } = deps;
  if (!knex) throw new Error('trend-aggregator: knex is required');
  if (!cache) throw new Error('trend-aggregator: cache is required');

  async function compute(tenantId, range) {
    const today = now();
    const actualDays = buildPastWindow(today, 7);
    const futureDays = buildFutureWindow(today, FUTURE_WINDOW_DAYS);
    const startDay = actualDays[0];
    const endDay = actualDays[actualDays.length - 1];

    const errors = [];

    const [loadRows, maintRows, onTimeRows, fuelRows] = await Promise.all([
      safeQuery('loadVolume', () => loadVolumeQuery(knex, tenantId, startDay, endDay), errors),
      safeQuery('maintenance', () => maintenanceQuery(knex, tenantId, startDay, endDay), errors),
      safeQuery('onTimePct', () => onTimePctQuery(knex, tenantId, startDay, endDay), errors),
      safeQuery('fuelCost', () => fuelCostQuery(knex, tenantId, startDay, endDay), errors)
    ]);

    const series = {
      loadVolume: loadRows
        ? (() => {
            const actual = fillSeriesByDay(loadRows, actualDays, 'count');
            return { actual, predicted: linearForecast(actual, futureDays) };
          })()
        : emptySeries(actualDays, futureDays),
      maintenance: maintRows
        ? (() => {
            const actual = fillSeriesByDay(maintRows, actualDays, 'count');
            return { actual, predicted: linearForecast(actual, futureDays) };
          })()
        : emptySeries(actualDays, futureDays),
      onTimePct: onTimeRows
        ? (() => {
            const actual = fillSeriesByDay(onTimeRows, actualDays, 'pct');
            return { actual, predicted: linearForecast(actual, futureDays) };
          })()
        : emptySeries(actualDays, futureDays),
      fuelCost: fuelRows
        ? (() => {
            const actual = fillSeriesByDay(fuelRows, actualDays, 'total');
            return { actual, predicted: linearForecast(actual, futureDays) };
          })()
        : emptySeries(actualDays, futureDays)
    };

    return {
      tenantId,
      range,
      generatedAt: now().toISOString(),
      window: { actualDays, futureDays },
      series,
      upstreamErrors: errors
    };
  }

  async function getTrends({ tenantId, range = '7d', refresh = false } = {}) {
    if (!tenantId) throw new Error('trend-aggregator: tenantId is required');
    if (range !== '7d') {
      const err = new Error(`Unsupported range '${range}'; only '7d' is supported`);
      err.statusCode = 400;
      throw err;
    }
    if (refresh) cache.invalidate(tenantId, range);
    else {
      const hit = cache.get(tenantId, range);
      if (hit) return { ...hit, cached: true };
    }
    const data = await compute(tenantId, range);
    cache.set(tenantId, range, data);
    return { ...data, cached: false };
  }

  return { getTrends, compute };
}

module.exports = {
  buildTrendAggregator,
  // exported for tests
  _internals: {
    buildPastWindow,
    buildFutureWindow,
    fillSeriesByDay,
    linearForecast,
    emptySeries
  }
};
