'use strict';

/**
 * FN-1330: Pure unit tests for the action-queue alert grouper.
 *
 *   node backend/gateway/__tests__/alert-grouper.test.js
 */

const assert = require('node:assert/strict');
const {
  buildAlertGrouper,
  bucketSmartSeverity,
  bucketComplianceSeverity,
  templatizeCompliance
} = require('../services/alert-grouper');

const NOW_ISO = new Date().toISOString();

function smart(overrides) {
  return {
    id: 'hos:drv-1:t',
    type: 'hos_imminent',
    subjectId: 'drv-1',
    subjectKind: 'driver',
    title: 'HOS imminent: Alice',
    severity: 90,
    scoredBy: 'ai',
    action: { kind: 'view', subjectId: 'drv-1' },
    ...overrides
  };
}

function compliance(overrides) {
  return {
    type: 'critical',
    category: 'maintenance',
    message: 'Unit-101 preventive maintenance is overdue',
    vehicleId: 'veh-1',
    date: NOW_ISO,
    ...overrides
  };
}

function testSeverityBuckets() {
  assert.equal(bucketSmartSeverity(95), 'critical');
  assert.equal(bucketSmartSeverity(80), 'critical');
  assert.equal(bucketSmartSeverity(75), 'high');
  assert.equal(bucketSmartSeverity(60), 'high');
  assert.equal(bucketSmartSeverity(45), 'medium');
  assert.equal(bucketSmartSeverity(40), 'medium');
  assert.equal(bucketSmartSeverity(10), 'low');
  assert.equal(bucketSmartSeverity('not-a-number'), 'medium');

  assert.equal(bucketComplianceSeverity('critical'), 'critical');
  assert.equal(bucketComplianceSeverity('warning'), 'high');
  assert.equal(bucketComplianceSeverity('medium'), 'medium');
  assert.equal(bucketComplianceSeverity('unknown'), 'medium');
}

function testTemplates() {
  const t1 = templatizeCompliance({ category: 'maintenance', message: 'Unit-101 preventive maintenance is overdue' });
  assert.equal(t1.template, 'pm_overdue');
  const t2 = templatizeCompliance({ category: 'driver', message: "Alice Smith's medical certificate expires soon" });
  assert.equal(t2.template, 'medical_cert_expiring');
  const t3 = templatizeCompliance({ category: 'driver', message: 'unrecognized text' });
  assert.equal(t3.template, 'driver_uncategorized');
}

function testGroupingDedupe() {
  const grouper = buildAlertGrouper();
  const compliances = [
    compliance({ vehicleId: 'veh-1', message: 'Unit-101 preventive maintenance is overdue' }),
    compliance({ vehicleId: 'veh-2', message: 'Unit-102 preventive maintenance is overdue' }),
    compliance({ vehicleId: 'veh-3', message: 'Unit-103 preventive maintenance is overdue' }),
    compliance({ vehicleId: 'veh-3', message: 'Unit-103 preventive maintenance is overdue' }) // duplicate target
  ];
  const result = grouper.group({ smartAlerts: [], complianceAlerts: compliances, generatedAt: NOW_ISO });
  assert.equal(result.groups.length, 1, 'PM-overdue collapses to one group');
  const g = result.groups[0];
  assert.equal(g.id, 'compliance:maintenance:pm_overdue');
  assert.equal(g.count, 3, 'duplicate target deduped');
  assert.equal(g.targets.length, 3);
  assert.match(g.message, /3 vehicles/);
}

function testRanking() {
  const grouper = buildAlertGrouper();
  const result = grouper.group({
    smartAlerts: [
      smart({ id: 'hos:1', severity: 95, type: 'hos_imminent', subjectId: 'drv-1' }), // critical
      smart({ id: 'fatigue:1', severity: 65, type: 'fatigue', subjectId: 'drv-2' })   // high
    ],
    complianceAlerts: [
      compliance({ type: 'critical', message: "Bob's CDL has expired", driverId: 'drv-3', category: 'driver' }),
      compliance({ type: 'warning', message: "Carol's medical certificate expires soon", driverId: 'drv-4', category: 'driver' })
    ],
    generatedAt: NOW_ISO
  });
  // Order: critical → high → medium → low; tie-break by latest_at desc
  const sevs = result.groups.map((g) => g.severity);
  // First two should be critical
  assert.equal(sevs[0], 'critical');
  assert.equal(sevs[1], 'critical');
  // Last two should be high
  assert.equal(sevs[2], 'high');
  assert.equal(sevs[3], 'high');
}

function testWindowFilter() {
  const grouper = buildAlertGrouper();
  const oldIso = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const recentIso = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const result7d = grouper.group({
    smartAlerts: [],
    complianceAlerts: [
      compliance({ vehicleId: 'veh-1', date: oldIso, message: 'Unit-101 preventive maintenance is overdue' }),
      compliance({ vehicleId: 'veh-2', date: recentIso, message: 'Unit-102 preventive maintenance is overdue' })
    ],
    generatedAt: recentIso,
    window: '7d'
  });
  const g = result7d.groups[0];
  assert.equal(g.count, 1, 'old alert filtered by 7d window');
  assert.equal(g.targets[0].id, 'veh-2');

  const result30d = grouper.group({
    smartAlerts: [],
    complianceAlerts: [
      compliance({ vehicleId: 'veh-1', date: oldIso, message: 'Unit-101 preventive maintenance is overdue' }),
      compliance({ vehicleId: 'veh-2', date: recentIso, message: 'Unit-102 preventive maintenance is overdue' })
    ],
    generatedAt: recentIso,
    window: '30d'
  });
  assert.equal(result30d.groups[0].count, 1, 'old alert still filtered by 30d window');
}

function testSeverityFilter() {
  const grouper = buildAlertGrouper();
  const out = grouper.group({
    smartAlerts: [smart({ severity: 95 })],
    complianceAlerts: [compliance({ type: 'warning', message: "Carol's medical certificate expires soon", driverId: 'd1', category: 'driver' })],
    generatedAt: NOW_ISO,
    severity: 'critical'
  });
  assert.equal(out.groups.length, 1);
  assert.equal(out.groups[0].severity, 'critical');
}

function testGroupDismissal() {
  const grouper = buildAlertGrouper();
  const out = grouper.group({
    smartAlerts: [],
    complianceAlerts: [
      compliance({ vehicleId: 'veh-1', message: 'Unit-101 preventive maintenance is overdue' }),
      compliance({ vehicleId: 'veh-2', message: 'Unit-102 preventive maintenance is overdue' })
    ],
    generatedAt: NOW_ISO,
    dismissedGroupIds: new Set(['compliance:maintenance:pm_overdue'])
  });
  assert.equal(out.groups.length, 0, 'whole group dropped when group_id dismissed');
}

function testTargetDismissal() {
  const grouper = buildAlertGrouper();
  const out = grouper.group({
    smartAlerts: [],
    complianceAlerts: [
      compliance({ vehicleId: 'veh-1', message: 'Unit-101 preventive maintenance is overdue' }),
      compliance({ vehicleId: 'veh-2', message: 'Unit-102 preventive maintenance is overdue' })
    ],
    generatedAt: NOW_ISO,
    dismissedTargetIds: new Set(['compliance:maintenance:pm_overdue:veh-1'])
  });
  assert.equal(out.groups[0].count, 1, 'individual target dismissed but group stays');
  assert.equal(out.groups[0].targets[0].id, 'veh-2');
}

function testNoRegressionInCount() {
  // Sum of grouped row counts must equal sum of unique underlying alerts.
  const grouper = buildAlertGrouper();
  const compliances = Array.from({ length: 12 }, (_, i) =>
    compliance({ vehicleId: `veh-${i}`, message: `Unit-${100 + i} preventive maintenance is overdue` })
  );
  const smarts = Array.from({ length: 3 }, (_, i) =>
    smart({ id: `hos:drv-${i}`, subjectId: `drv-${i}`, severity: 90 - i })
  );
  const result = grouper.group({
    smartAlerts: smarts,
    complianceAlerts: compliances,
    generatedAt: NOW_ISO
  });
  const totalCount = result.groups.reduce((acc, g) => acc + g.count, 0);
  assert.equal(totalCount, 15, 'no alerts lost during grouping');
}

function testDefaultsApplied() {
  const grouper = buildAlertGrouper();
  const out = grouper.group({ smartAlerts: [], complianceAlerts: [], generatedAt: NOW_ISO });
  assert.equal(out.window, '7d');
  assert.equal(out.severity, 'all');
  assert.equal(out.total, 0);
  assert.deepEqual(out.groups, []);
}

(async () => {
  const cases = [
    ['severity buckets', testSeverityBuckets],
    ['compliance message templates', testTemplates],
    ['grouping + dedupe', testGroupingDedupe],
    ['ranking by severity', testRanking],
    ['window filter', testWindowFilter],
    ['severity filter', testSeverityFilter],
    ['group dismissal', testGroupDismissal],
    ['target dismissal', testTargetDismissal],
    ['no regression in count', testNoRegressionInCount],
    ['defaults applied', testDefaultsApplied]
  ];
  let failed = 0;
  for (const [name, fn] of cases) {
    try {
      await fn();
      // eslint-disable-next-line no-console
      console.log(`PASS  ${name}`);
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error(`FAIL  ${name}\n${err && err.stack ? err.stack : err}`);
    }
  }
  if (failed > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n${failed} test(s) failed.`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`\nAll ${cases.length} test(s) passed.`);
})();
