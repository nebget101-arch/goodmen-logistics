'use strict';

/**
 * FN-1330: Action Queue alert grouper.
 *
 * Takes raw Smart Alerts (from smart-alerts-aggregator) and Compliance Alerts
 * (from reporting-service /api/dashboard/alerts), normalizes them into a
 * common shape, dedupes by (source, category, message_template), filters by
 * window + severity, and returns one row per group with `count`, `severity`,
 * `latest_at`, `targets[]`, and a representative `message`.
 *
 * Severity bucketing:
 *   smart-alert numeric (0-100):
 *     >= 80 → critical
 *     >= 60 → high
 *     >= 40 → medium
 *     <  40 → low
 *   compliance string:
 *     'critical' → critical
 *     'warning'  → high
 *     anything else → medium
 *
 * Group key:
 *   smart:    `smart:${type}`              (e.g. smart:hos_imminent)
 *   compliance: `compliance:${category}:${template}`
 *
 * Group-level dismissals (POST /dismiss with group_id) are stored in the
 * existing dismissals store keyed by groupId; new alerts that fall into a
 * dismissed group are filtered out for the dismissal TTL.
 */

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const VALID_WINDOWS = new Set(['today', '7d', '30d']);
const DEFAULT_WINDOW = '7d';
const DEFAULT_SEVERITY = 'all';

const COMPLIANCE_TEMPLATES = [
  { match: /medical certificate has expired/i, template: 'medical_cert_expired', label: 'Medical certificate expired' },
  { match: /medical certificate expires soon/i, template: 'medical_cert_expiring', label: 'Medical certificate expiring soon' },
  { match: /CDL has expired/i, template: 'cdl_expired', label: 'CDL expired' },
  { match: /DQF is .* complete/i, template: 'dqf_incomplete', label: 'DQF incomplete' },
  { match: /Clearinghouse query pending/i, template: 'clearinghouse_pending', label: 'Clearinghouse query pending' },
  { match: /is out of service/i, template: 'vehicle_oos', label: 'Vehicle out of service' },
  { match: /preventive maintenance is overdue/i, template: 'pm_overdue', label: 'Preventive maintenance overdue' },
  { match: /preventive maintenance due soon/i, template: 'pm_due_soon', label: 'Preventive maintenance due soon' }
];

const SMART_LABELS = {
  hos_imminent: 'HOS violation imminent',
  fatigue: 'Driver fatigue risk',
  inspection_overdue: 'Inspection overdue',
  late_load_risk: 'Late delivery risk'
};

function bucketSmartSeverity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'medium';
  if (n >= 80) return 'critical';
  if (n >= 60) return 'high';
  if (n >= 40) return 'medium';
  return 'low';
}

function bucketComplianceSeverity(value) {
  const s = String(value || '').toLowerCase();
  if (s === 'critical') return 'critical';
  if (s === 'warning') return 'high';
  if (VALID_SEVERITIES.has(s)) return s;
  return 'medium';
}

function templatizeCompliance(alert) {
  const message = alert.message || '';
  for (const t of COMPLIANCE_TEMPLATES) {
    if (t.match.test(message)) return { template: t.template, label: t.label };
  }
  // Fallback: collapse the message to a coarse signature so unknown alerts
  // still group by category rather than fanning out one-row-per-target.
  return { template: `${alert.category || 'other'}_uncategorized`, label: alert.category || 'Compliance alert' };
}

function toIso(value, fallback) {
  if (!value) return fallback;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toISOString();
}

function normalizeSmartAlert(alert, generatedAt) {
  const severity = bucketSmartSeverity(alert.severity);
  const groupId = `smart:${alert.type || 'unknown'}`;
  const targetId = String(alert.subjectId || alert.id || '');
  const target = {
    id: targetId,
    label: alert.title || targetId,
    route: routeForSubject(alert.subjectKind, targetId),
    raw_alert_id: alert.id
  };
  const action = alert.action && typeof alert.action === 'object'
    ? { label: alert.action.label || 'View', action_id: alert.action.kind || 'view', payload: alert.action }
    : { label: 'View', action_id: 'view', payload: { subjectId: targetId, subjectKind: alert.subjectKind } };
  return {
    source: 'smart',
    raw_id: alert.id,
    group_id: groupId,
    group_label: SMART_LABELS[alert.type] || alert.title || 'Smart alert',
    category: alert.subjectKind || 'other',
    severity,
    latest_at: generatedAt,
    target,
    primary_action: action,
    message: alert.title || SMART_LABELS[alert.type] || 'Smart alert'
  };
}

function routeForSubject(kind, id) {
  if (!id) return null;
  if (kind === 'driver') return `/drivers/${id}`;
  if (kind === 'vehicle') return `/vehicles/${id}`;
  if (kind === 'load') return `/loads/${id}`;
  return null;
}

function routeForCompliance(alert) {
  if (alert.driverId) return `/drivers/${alert.driverId}`;
  if (alert.vehicleId) return `/vehicles/${alert.vehicleId}`;
  return null;
}

function normalizeComplianceAlert(alert, generatedAt) {
  const { template, label } = templatizeCompliance(alert);
  const severity = bucketComplianceSeverity(alert.type);
  const category = alert.category || 'compliance';
  const groupId = `compliance:${category}:${template}`;
  const targetId = String(alert.driverId || alert.vehicleId || '');
  const route = routeForCompliance(alert);
  // Compliance alerts have no stable id; synthesize one so dismissals work.
  const rawId = `compliance:${category}:${template}:${targetId}`;
  return {
    source: 'compliance',
    raw_id: rawId,
    group_id: groupId,
    group_label: label,
    category,
    severity,
    latest_at: toIso(alert.date, generatedAt),
    target: {
      id: targetId,
      label: extractTargetLabel(alert.message, targetId),
      route,
      raw_alert_id: rawId
    },
    primary_action: route
      ? { label: 'Open', action_id: 'open', payload: { route } }
      : { label: 'View list', action_id: 'view_list', payload: { group: groupId } },
    message: alert.message || label
  };
}

function extractTargetLabel(message, fallback) {
  if (!message) return fallback;
  // Compliance messages start with "<First Last>" or "<Unit#>". Take the
  // text up to the first apostrophe-s, hyphen, or " is/preventive/medical/CDL/DQF".
  const apos = message.match(/^([^']+)'s\b/);
  if (apos) return apos[1].trim();
  const dash = message.match(/^(.+?)\s+-\s/);
  if (dash) return dash[1].trim();
  const verb = message.match(/^(\S+(?:\s+\S+)?)\s+(?:is|preventive|medical|CDL|DQF|out)/i);
  if (verb) return verb[1].trim();
  return message.split(/\s+/).slice(0, 2).join(' ') || fallback;
}

function windowStartMs(window, now) {
  switch (window) {
    case 'today': {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    case '7d':
      return now - 7 * 24 * 60 * 60 * 1000;
    case '30d':
      return now - 30 * 24 * 60 * 60 * 1000;
    default:
      return now - 7 * 24 * 60 * 60 * 1000;
  }
}

function buildAlertGrouper() {
  function group({ smartAlerts = [], complianceAlerts = [], window, severity, generatedAt, dismissedGroupIds = new Set(), dismissedTargetIds = new Set() }) {
    const win = VALID_WINDOWS.has(window) ? window : DEFAULT_WINDOW;
    const sev = (typeof severity === 'string' && (severity.toLowerCase() === 'all' || VALID_SEVERITIES.has(severity.toLowerCase())))
      ? severity.toLowerCase()
      : DEFAULT_SEVERITY;

    const nowMs = Date.now();
    const cutoff = windowStartMs(win, nowMs);
    const genIso = generatedAt || new Date(nowMs).toISOString();

    const normalized = [
      ...smartAlerts.map((a) => normalizeSmartAlert(a, genIso)),
      ...complianceAlerts.map((a) => normalizeComplianceAlert(a, genIso))
    ];

    const groups = new Map();
    for (const item of normalized) {
      if (dismissedGroupIds.has(item.group_id)) continue;
      if (dismissedTargetIds.has(item.raw_id)) continue;
      const ts = new Date(item.latest_at).getTime();
      if (Number.isFinite(ts) && ts < cutoff) continue;
      if (sev !== 'all' && item.severity !== sev) continue;

      let g = groups.get(item.group_id);
      if (!g) {
        g = {
          id: item.group_id,
          source: item.source,
          severity: item.severity,
          category: item.category,
          message: item.group_label,
          count: 0,
          latest_at: item.latest_at,
          targets: [],
          target_ids: new Set(),
          primary_action: item.primary_action
        };
        groups.set(item.group_id, g);
      }
      // Severity escalates to the worst within the group.
      if (SEVERITY_RANK[item.severity] > SEVERITY_RANK[g.severity]) {
        g.severity = item.severity;
      }
      if (new Date(item.latest_at).getTime() > new Date(g.latest_at).getTime()) {
        g.latest_at = item.latest_at;
      }
      if (!g.target_ids.has(item.target.id)) {
        g.targets.push(item.target);
        g.target_ids.add(item.target.id);
        g.count += 1;
      }
    }

    const ranked = Array.from(groups.values())
      .map((g) => {
        // Adjust group message if there are multiple targets.
        const summary = g.count > 1
          ? `${g.count} ${pluralizeForCategory(g.category, g.count)} — ${g.message}`
          : g.message;
        // eslint-disable-next-line no-unused-vars
        const { target_ids, ...exposed } = g;
        return { ...exposed, message: summary };
      })
      .sort((a, b) => {
        const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
        if (sevDiff !== 0) return sevDiff;
        return new Date(b.latest_at).getTime() - new Date(a.latest_at).getTime();
      });

    return {
      groups: ranked,
      total: ranked.length,
      window: win,
      severity: sev,
      generatedAt: genIso
    };
  }

  return { group };
}

function pluralizeForCategory(category, count) {
  const noun = ({
    driver: 'drivers',
    vehicle: 'vehicles',
    load: 'loads',
    maintenance: 'vehicles',
    compliance: 'items'
  })[category] || 'items';
  return count === 1 ? noun.replace(/s$/, '') : noun;
}

module.exports = {
  buildAlertGrouper,
  bucketSmartSeverity,
  bucketComplianceSeverity,
  templatizeCompliance,
  SEVERITY_RANK,
  VALID_SEVERITIES,
  VALID_WINDOWS
};
