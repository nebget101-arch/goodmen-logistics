'use strict';

/**
 * FN-1159: Rule-based severity scoring for Smart Alerts.
 *
 * Pure functions only — no I/O, no Anthropic calls. The score-alert handler
 * combines the baseline produced here with a Claude-derived contextual boost.
 *
 * Alert types and their `facts` shape are defined by FN-1161
 * (backend/gateway/services/smart-alerts-aggregator.js). Keep this file in
 * sync with that contract.
 */

const SUPPORTED_TYPES = Object.freeze([
  'hos_imminent',
  'fatigue',
  'inspection_overdue',
  'late_load_risk'
]);

const SUPPORTED_SUBJECT_KINDS = Object.freeze([
  'driver',
  'vehicle',
  'load'
]);

const TYPE_DEFAULT_BASELINE = Object.freeze({
  hos_imminent: 75,
  fatigue: 60,
  inspection_overdue: 65,
  late_load_risk: 55
});

const UNKNOWN_TYPE_BASELINE = 40;

const MAX_REASONING_LENGTH = 160;
const MAX_ACTION_LENGTH = 80;

function clampSeverity(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function coerceNumber(value) {
  if (isFiniteNumber(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function scoreHosImminent(facts) {
  const minutes = coerceNumber(facts && facts.minutesRemaining);
  if (minutes === null) return TYPE_DEFAULT_BASELINE.hos_imminent;
  if (minutes <= 15) return 95;
  if (minutes <= 30) return 90;
  if (minutes <= 60) return 85;
  if (minutes <= 120) return 80;
  if (minutes <= 240) return 75;
  return 70;
}

function scoreFatigue(facts) {
  const fatigueScore = coerceNumber(facts && facts.fatigueScore);
  if (fatigueScore !== null) {
    return clampSeverity(Math.max(50, Math.min(95, fatigueScore)));
  }
  const dutyHours = coerceNumber(facts && facts.consecutiveDutyHours);
  if (dutyHours === null) return TYPE_DEFAULT_BASELINE.fatigue;
  if (dutyHours >= 13) return 80;
  if (dutyHours >= 11) return 70;
  if (dutyHours >= 9) return 60;
  return 50;
}

function scoreInspectionOverdue(facts) {
  const days = coerceNumber(facts && facts.daysOverdue);
  if (days === null) return TYPE_DEFAULT_BASELINE.inspection_overdue;
  if (days >= 30) return 90;
  if (days >= 14) return 80;
  if (days >= 7) return 70;
  if (days >= 1) return 65;
  return 60;
}

function scoreLateLoadRisk(facts) {
  const etaDelta = coerceNumber(facts && facts.etaDelta);
  if (etaDelta === null) return TYPE_DEFAULT_BASELINE.late_load_risk;
  if (etaDelta >= 240) return 80;
  if (etaDelta >= 120) return 70;
  if (etaDelta >= 60) return 60;
  if (etaDelta >= 30) return 55;
  return 50;
}

function computeBaseScore(alert) {
  if (!alert || typeof alert !== 'object') return UNKNOWN_TYPE_BASELINE;
  const facts = alert.facts || {};
  switch (alert.type) {
    case 'hos_imminent':
      return scoreHosImminent(facts);
    case 'fatigue':
      return scoreFatigue(facts);
    case 'inspection_overdue':
      return scoreInspectionOverdue(facts);
    case 'late_load_risk':
      return scoreLateLoadRisk(facts);
    default:
      return UNKNOWN_TYPE_BASELINE;
  }
}

function fallbackReasoning(alert) {
  const facts = (alert && alert.facts) || {};
  switch (alert && alert.type) {
    case 'hos_imminent': {
      const minutes = coerceNumber(facts.minutesRemaining);
      if (minutes !== null) {
        return `HOS window closes in ${minutes} min for ${facts.driverName || 'driver'}.`;
      }
      return `HOS violation imminent for ${facts.driverName || 'driver'}.`;
    }
    case 'fatigue': {
      const score = coerceNumber(facts.fatigueScore);
      if (score !== null) {
        return `Fatigue score ${score} for ${facts.driverName || 'driver'}.`;
      }
      const hours = coerceNumber(facts.consecutiveDutyHours);
      if (hours !== null) {
        return `${hours}h consecutive duty for ${facts.driverName || 'driver'}.`;
      }
      return `Fatigue risk elevated for ${facts.driverName || 'driver'}.`;
    }
    case 'inspection_overdue': {
      const days = coerceNumber(facts.daysOverdue);
      if (days !== null) {
        return `Inspection ${days}d overdue on ${facts.unit || 'vehicle'}.`;
      }
      return `Inspection overdue on ${facts.unit || 'vehicle'}.`;
    }
    case 'late_load_risk': {
      const eta = coerceNumber(facts.etaDelta);
      if (eta !== null) {
        return `Load ${facts.loadNumber || ''} ETA slipping ${eta} min late.`.trim();
      }
      return `Late delivery risk on load ${facts.loadNumber || ''}.`.trim();
    }
    default:
      return 'Operational alert raised.';
  }
}

function fallbackAction(alert) {
  switch (alert && alert.type) {
    case 'hos_imminent':
      return 'Call driver to confirm parking plan';
    case 'fatigue':
      return 'Verify driver duty status with dispatch';
    case 'inspection_overdue':
      return 'Pull vehicle from service for inspection';
    case 'late_load_risk':
      return 'Contact broker with revised ETA';
    default:
      return 'Review alert in Control Center';
  }
}

function trimToMax(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function clampBoost(value) {
  if (!isFiniteNumber(value)) return 0;
  if (value < -10) return -10;
  if (value > 20) return 20;
  return Math.round(value);
}

function combineScore({ baseScore, boost }) {
  return clampSeverity(baseScore + clampBoost(boost));
}

function validateAlert(alert) {
  if (!alert || typeof alert !== 'object') {
    return { valid: false, error: 'alert object is required' };
  }
  if (typeof alert.id !== 'string' || !alert.id.trim()) {
    return { valid: false, error: 'alert.id is required' };
  }
  if (typeof alert.type !== 'string' || !SUPPORTED_TYPES.includes(alert.type)) {
    return {
      valid: false,
      error: `alert.type must be one of: ${SUPPORTED_TYPES.join(', ')}`
    };
  }
  if (alert.subjectKind != null && !SUPPORTED_SUBJECT_KINDS.includes(alert.subjectKind)) {
    return {
      valid: false,
      error: `alert.subjectKind must be one of: ${SUPPORTED_SUBJECT_KINDS.join(', ')}`
    };
  }
  if (alert.facts != null && (typeof alert.facts !== 'object' || Array.isArray(alert.facts))) {
    return { valid: false, error: 'alert.facts must be an object when present' };
  }
  return { valid: true };
}

module.exports = {
  SUPPORTED_TYPES,
  SUPPORTED_SUBJECT_KINDS,
  TYPE_DEFAULT_BASELINE,
  UNKNOWN_TYPE_BASELINE,
  MAX_REASONING_LENGTH,
  MAX_ACTION_LENGTH,
  clampSeverity,
  clampBoost,
  combineScore,
  computeBaseScore,
  fallbackReasoning,
  fallbackAction,
  trimToMax,
  validateAlert
};
