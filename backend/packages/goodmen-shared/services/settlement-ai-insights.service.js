const knex = require('../config/knex');

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:4100';
const AI_TIMEOUT_MS = 12000;

function asNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function roundMoney(value) {
  return Number(asNumber(value).toFixed(2));
}

function roundMetric(value, digits = 2) {
  return Number(asNumber(value).toFixed(digits));
}

function safeText(value, fallback = '—') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function getDriverName(driver) {
  return [driver?.first_name, driver?.last_name].filter(Boolean).join(' ').trim() || 'Driver';
}

function getPayableTo(payload) {
  if (payload?.settlement?.settlement_type === 'equipment_owner') {
    return safeText(payload?.equipmentOwner?.name || payload?.primaryPayee?.name);
  }
  return safeText(payload?.primaryPayee?.name || getDriverName(payload?.driver));
}

async function getSettlementsColumnSet() {
  const rows = await knex('information_schema.columns')
    .select('column_name')
    .where({ table_schema: 'public', table_name: 'settlements' });
  return new Set(rows.map((row) => row.column_name));
}

async function getFuelMetrics(settlementId) {
  const rows = await knex('settlement_adjustment_items as sai')
    .join('fuel_transactions as ft', 'ft.id', 'sai.source_reference_id')
    .where('sai.settlement_id', settlementId)
    .andWhere('sai.source_type', 'imported_fuel')
    .select('ft.id', 'ft.gallons', 'ft.amount');

  const gallons = rows.reduce((sum, row) => sum + asNumber(row.gallons), 0);
  const grossFuelSpend = rows.reduce((sum, row) => sum + asNumber(row.amount), 0);
  return {
    transactionCount: rows.length,
    gallons: roundMetric(gallons, 2),
    grossFuelSpend: roundMoney(grossFuelSpend)
  };
}

async function getTollMetrics(settlementId) {
  const rows = await knex('settlement_adjustment_items as sai')
    .join('toll_transactions as tt', 'tt.id', 'sai.source_reference_id')
    .where('sai.settlement_id', settlementId)
    .andWhere('sai.source_type', 'imported_toll')
    .select('tt.id', 'tt.amount');

  return {
    transactionCount: rows.length,
    grossTollSpend: roundMoney(rows.reduce((sum, row) => sum + asNumber(row.amount), 0))
  };
}

function buildExpenseBreakdown(adjustmentItems = []) {
  const totals = {
    scheduledDeductions: 0,
    manualAdjustments: 0,
    fuelDeductions: 0,
    tollDeductions: 0,
    otherDeductions: 0
  };

  for (const item of adjustmentItems) {
    const amount = Math.abs(asNumber(item?.amount));
    if (item?.source_type === 'scheduled_rule') {
      totals.scheduledDeductions += amount;
    } else if (item?.source_type === 'manual') {
      totals.manualAdjustments += amount;
    } else if (item?.source_type === 'imported_fuel') {
      totals.fuelDeductions += amount;
    } else if (item?.source_type === 'imported_toll') {
      totals.tollDeductions += amount;
    } else {
      totals.otherDeductions += amount;
    }
  }

  return Object.fromEntries(
    Object.entries(totals).map(([key, value]) => [key, roundMoney(value)])
  );
}

async function getPriorPeriodSettlement(settlement) {
  const query = knex('settlements')
    .where({
      driver_id: settlement.driver_id,
      settlement_type: settlement.settlement_type
    })
    .whereNot('settlement_status', 'void')
    .where('date', '<', settlement.date)
    .whereNot('id', settlement.id)
    .orderBy('date', 'desc')
    .first();

  if (settlement.truck_id) {
    query.where('truck_id', settlement.truck_id);
  }

  return query;
}

async function getPriorLoadedMiles(settlementId) {
  const rows = await knex('settlement_load_items')
    .where({ settlement_id: settlementId })
    .sum({ miles: 'loaded_miles' })
    .first();
  return roundMetric(rows?.miles || 0, 2);
}

async function buildSettlementInsightMetrics(payload) {
  const settlement = payload?.settlement || {};
  const loadItems = payload?.loadItems || [];
  const highlightedPay = settlement?.settlement_type === 'equipment_owner'
    ? asNumber(settlement.subtotal_additional_payee)
    : asNumber(settlement.subtotal_driver_pay);
  const netPay = settlement?.settlement_type === 'equipment_owner'
    ? asNumber(settlement.net_pay_additional_payee)
    : asNumber(settlement.net_pay_driver);
  const loadedMiles = roundMetric(loadItems.reduce((sum, item) => sum + asNumber(item?.loaded_miles), 0), 2);
  const fuelMetrics = settlement?.id ? await getFuelMetrics(settlement.id) : { transactionCount: 0, gallons: 0, grossFuelSpend: 0 };
  const tollMetrics = settlement?.id ? await getTollMetrics(settlement.id) : { transactionCount: 0, grossTollSpend: 0 };

  return {
    highlightedPay: roundMoney(highlightedPay),
    netPay: roundMoney(netPay),
    grossRevenue: roundMoney(settlement.subtotal_gross),
    totalDeductions: roundMoney(settlement.total_deductions),
    loadedMiles,
    loadCount: loadItems.length,
    revenuePerMile: loadedMiles > 0 ? roundMetric(highlightedPay / loadedMiles, 2) : null,
    ratePerMile: loadedMiles > 0 ? roundMetric(asNumber(settlement.subtotal_gross) / loadedMiles, 2) : null,
    fuelSpendPerMile: loadedMiles > 0 ? roundMetric(fuelMetrics.grossFuelSpend / loadedMiles, 2) : null,
    mpg: fuelMetrics.gallons > 0 && loadedMiles > 0 ? roundMetric(loadedMiles / fuelMetrics.gallons, 2) : null,
    fuel: fuelMetrics,
    tolls: tollMetrics
  };
}

function buildAnomalyFlags(metrics, expenseBreakdown) {
  const flags = [];
  if (!metrics.loadedMiles) {
    flags.push('Loaded miles are missing on this settlement, so per-mile metrics may be incomplete.');
  }
  if (metrics.netPay < 0) {
    flags.push('Net pay is negative for this settlement period.');
  }
  if (metrics.revenuePerMile !== null && metrics.revenuePerMile < 1.25) {
    flags.push('Revenue per mile is low relative to the highlighted pay on this settlement.');
  }
  if (metrics.fuelSpendPerMile !== null && metrics.fuelSpendPerMile > 1.1) {
    flags.push('Fuel spend per mile is elevated for this settlement.');
  }
  if (expenseBreakdown.fuelDeductions > metrics.highlightedPay * 0.45) {
    flags.push('Fuel deductions consume more than 45% of the highlighted pay amount.');
  }
  if (expenseBreakdown.scheduledDeductions > 0 && expenseBreakdown.scheduledDeductions > metrics.highlightedPay * 0.25) {
    flags.push('Scheduled deductions account for a large share of the highlighted pay amount.');
  }
  return flags;
}

function buildPriorPeriodComparison(settlement, priorSettlement, priorLoadedMiles) {
  if (!priorSettlement) return null;
  const currentHighlighted = settlement?.settlement_type === 'equipment_owner'
    ? asNumber(settlement.subtotal_additional_payee)
    : asNumber(settlement.subtotal_driver_pay);
  const priorHighlighted = priorSettlement?.settlement_type === 'equipment_owner'
    ? asNumber(priorSettlement.subtotal_additional_payee)
    : asNumber(priorSettlement.subtotal_driver_pay);
  const currentNet = settlement?.settlement_type === 'equipment_owner'
    ? asNumber(settlement.net_pay_additional_payee)
    : asNumber(settlement.net_pay_driver);
  const priorNet = priorSettlement?.settlement_type === 'equipment_owner'
    ? asNumber(priorSettlement.net_pay_additional_payee)
    : asNumber(priorSettlement.net_pay_driver);

  return {
    settlementId: priorSettlement.id,
    settlementNumber: priorSettlement.settlement_number,
    date: priorSettlement.date,
    highlightedPay: roundMoney(priorHighlighted),
    netPay: roundMoney(priorNet),
    loadedMiles: priorLoadedMiles,
    grossRevenue: roundMoney(priorSettlement.subtotal_gross),
    payDelta: roundMoney(currentHighlighted - priorHighlighted),
    netDelta: roundMoney(currentNet - priorNet)
  };
}

function buildPlaceholderSettlementInsights(payload, metrics, priorPeriod, expenseBreakdown, anomalyFlags) {
  const settlementType = payload?.settlement?.settlement_type === 'equipment_owner'
    ? 'equipment owner'
    : 'driver';
  const summaryParts = [
    `${safeText(payload?.settlement?.settlement_number, 'This settlement')} reflects $${roundMoney(metrics.highlightedPay).toFixed(2)} in ${settlementType} pay across ${metrics.loadCount} load(s).`,
    metrics.loadedMiles
      ? `The run covered ${metrics.loadedMiles.toFixed(2)} loaded miles with a net pay of $${roundMoney(metrics.netPay).toFixed(2)}.`
      : `Net pay closed at $${roundMoney(metrics.netPay).toFixed(2)}.`
  ];
  if (priorPeriod) {
    const direction = priorPeriod.netDelta >= 0 ? 'up' : 'down';
    summaryParts.push(`Compared with the prior period, net pay is ${direction} $${Math.abs(priorPeriod.netDelta).toFixed(2)}.`);
  } else {
    summaryParts.push('Prior-period comparison is unavailable for this report.');
  }

  const insights = [
    metrics.ratePerMile !== null
      ? {
        title: 'Rate per mile',
        message: `Gross revenue is tracking at $${metrics.ratePerMile.toFixed(2)} per loaded mile for this settlement.`,
        category: 'profitability'
      }
      : {
        title: 'Mileage pending',
        message: 'Loaded miles are not fully available yet, so per-mile profitability cannot be computed.',
        category: 'quality'
      },
    metrics.mpg !== null
      ? {
        title: 'Fuel efficiency',
        message: `Referenced fuel transactions total ${metrics.fuel.gallons.toFixed(2)} gallons, which implies ${metrics.mpg.toFixed(2)} MPG across the loaded miles.`,
        category: 'fuel'
      }
      : {
        title: 'Fuel efficiency unavailable',
        message: 'Fuel gallons are unavailable for this settlement, so MPG could not be calculated.',
        category: 'fuel'
      },
    priorPeriod
      ? {
        title: 'Period-over-period comparison',
        message: `Highlighted pay changed by $${priorPeriod.payDelta.toFixed(2)} and net pay changed by $${priorPeriod.netDelta.toFixed(2)} versus the previous settlement.`,
        category: 'comparison'
      }
      : {
        title: 'Comparison baseline missing',
        message: 'No prior matching settlement was found for an automated period-over-period comparison.',
        category: 'comparison'
      },
    anomalyFlags.length
      ? {
        title: 'Quality checks',
        message: anomalyFlags[0],
        category: 'risk'
      }
      : {
        title: 'Quality checks',
        message: 'No high-signal settlement anomalies were detected from the currently linked miles, deductions, and fuel data.',
        category: 'quality'
      }
  ];

  return {
    status: 'placeholder',
    source: 'fallback',
    generatedAt: new Date().toISOString(),
    summary: summaryParts.join(' '),
    insights,
    metrics,
    priorPeriod,
    expenseBreakdown,
    anomalyFlags
  };
}

async function requestAiSettlementInsights(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/ai/settlements/insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`AI settlement insights HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function persistInsights(settlementId, insights) {
  const columns = await getSettlementsColumnSet();
  if (!columns.has('ai_insights') || !settlementId) return;
  await knex('settlements')
    .where({ id: settlementId })
    .update({ ai_insights: insights });
}

async function ensureSettlementAiInsights(payload) {
  const existing = payload?.settlement?.ai_insights;
  if (typeof existing === 'string') {
    try {
      const parsed = JSON.parse(existing);
      if (parsed && parsed.summary) {
        if (payload?.settlement) payload.settlement.ai_insights = parsed;
        return parsed;
      }
    } catch (_error) {
      // Ignore malformed historical cache payloads and regenerate.
    }
  }
  if (existing && typeof existing === 'object' && existing.summary) {
    return existing;
  }

  const settlement = payload?.settlement || {};
  const metrics = await buildSettlementInsightMetrics(payload);
  const expenseBreakdown = buildExpenseBreakdown(payload?.adjustmentItems || []);
  const anomalyFlags = buildAnomalyFlags(metrics, expenseBreakdown);
  const priorSettlement = settlement?.id ? await getPriorPeriodSettlement(settlement) : null;
  const priorLoadedMiles = priorSettlement?.id ? await getPriorLoadedMiles(priorSettlement.id) : 0;
  const priorPeriod = buildPriorPeriodComparison(settlement, priorSettlement, priorLoadedMiles);

  const aiRequest = {
    settlement: {
      id: settlement.id,
      settlement_number: settlement.settlement_number,
      settlement_type: settlement.settlement_type,
      date: settlement.date
    },
    driver: {
      name: getDriverName(payload?.driver)
    },
    truck: {
      unit_number: payload?.truck?.unit_number || null,
      plate_number: payload?.truck?.plate_number || null
    },
    payableTo: getPayableTo(payload),
    metrics,
    priorPeriod,
    expenseBreakdown,
    anomalyFlags
  };

  let insights = null;
  try {
    const aiResponse = await requestAiSettlementInsights(aiRequest);
    insights = {
      status: 'ready',
      source: 'ai',
      generatedAt: new Date().toISOString(),
      summary: safeText(aiResponse?.summary, ''),
      insights: Array.isArray(aiResponse?.insights) ? aiResponse.insights.slice(0, 4) : [],
      metrics,
      priorPeriod,
      expenseBreakdown,
      anomalyFlags
    };
    if (!insights.summary) {
      insights = null;
    }
  } catch (_error) {
    insights = null;
  }

  if (!insights) {
    insights = buildPlaceholderSettlementInsights(payload, metrics, priorPeriod, expenseBreakdown, anomalyFlags);
  }

  await persistInsights(settlement.id, insights);
  if (payload?.settlement) {
    payload.settlement.ai_insights = insights;
  }
  return insights;
}

module.exports = {
  ensureSettlementAiInsights,
  buildSettlementInsightMetrics,
  buildPlaceholderSettlementInsights
};
