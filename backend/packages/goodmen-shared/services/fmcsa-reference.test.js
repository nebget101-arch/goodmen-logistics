'use strict';

const assert = require('node:assert/strict');
const { describe, it, before, after } = require('node:test');

const SKIPPABLE =
  /ECONNREFUSED|ENOTFOUND|password authentication|database .* does not exist|relation .* does not exist|schema .* does not exist|getaddrinfo|self.signed/i;

let fmcsaRef;
let mainKnex;
try {
  fmcsaRef = require('./fmcsa-reference');
  mainKnex = require('../config/knex');
} catch (err) {
  if (err && err.code === 'MODULE_NOT_FOUND') {
    describe('fmcsa-reference (e2e)', () => {
      it('skipped — module not installed locally', (t) => {
        t.skip(`run npm install in goodmen-shared to enable (${err.message})`);
      });
    });
  } else {
    throw err;
  }
}

const FIXTURE_DOT = 999_001;
const FIXTURE_BROKER_DOT = 999_002;

if (fmcsaRef) {
  describe('fmcsa-reference (e2e)', () => {
    let dbAvailable = false;

    before(async () => {
      // Pre-flight + seed fixture rows. If the fmcsa schema isn't reachable,
      // mark unavailable so each test self-skips with a clear message.
      try {
        await mainKnex.raw('SELECT 1 FROM fmcsa.carriers LIMIT 1');
        dbAvailable = true;
      } catch (err) {
        if (err && SKIPPABLE.test(err.message || '')) return;
        throw err;
      }

      // Cleanup any leftover fixture rows from prior runs so seeds are deterministic.
      await mainKnex('fmcsa.basic_scores').whereIn('dot', [FIXTURE_DOT, FIXTURE_BROKER_DOT]).del();
      await mainKnex('fmcsa.violations')
        .whereIn('inspection_report_number', ['INSP-FXT-1', 'INSP-FXT-2'])
        .del();
      await mainKnex('fmcsa.inspections')
        .whereIn('inspection_report_number', ['INSP-FXT-1', 'INSP-FXT-2'])
        .del();
      await mainKnex('fmcsa.crashes').whereIn('dot', [FIXTURE_DOT, FIXTURE_BROKER_DOT]).del();
      await mainKnex('fmcsa.authorities').whereIn('dot', [FIXTURE_DOT, FIXTURE_BROKER_DOT]).del();
      await mainKnex('fmcsa.carriers').whereIn('dot', [FIXTURE_DOT, FIXTURE_BROKER_DOT]).del();

      // Seed.
      await mainKnex('fmcsa.carriers').insert([
        {
          dot: FIXTURE_DOT,
          mc_number: 'MC-FXT-1',
          legal_name: 'FN-1427 Fixture Carrier',
          dba_name: 'FixtureCo',
          phone: '555-0100',
          fax: '555-0101',
          email: 'ops@fixture.example',
          city: 'Austin',
          state: 'TX',
          zip_code: '78701',
          country: 'US',
          power_units: 12,
          drivers: 18,
          status: 'ACTIVE',
        },
        {
          dot: FIXTURE_BROKER_DOT,
          mc_number: 'MC-FXT-2',
          legal_name: 'FN-1427 Fixture Broker LLC',
          city: 'Dallas',
          state: 'TX',
          country: 'US',
        },
      ]);

      await mainKnex('fmcsa.authorities').insert([
        {
          dot: FIXTURE_DOT,
          mc_number: 'MC-FXT-1',
          authority_type: 'Common',
          status: 'Active',
          insurance_carriers: JSON.stringify(['ACME Insurance']),
          insurance_amounts: JSON.stringify({ BIPD: '750,000' }),
        },
        {
          dot: FIXTURE_BROKER_DOT,
          mc_number: 'MC-FXT-2',
          authority_type: 'Broker',
          status: 'Active',
          insurance_carriers: JSON.stringify([]),
          insurance_amounts: JSON.stringify({}),
        },
      ]);

      await mainKnex('fmcsa.inspections').insert([
        {
          inspection_report_number: 'INSP-FXT-1',
          dot: FIXTURE_DOT,
          inspection_date: '2026-01-15',
          state: 'TX',
          level: 1,
          vehicle_count: 1,
          driver_count: 1,
          hazmat_count: 0,
          vehicle_oos_count: 1,
          driver_oos_count: 0,
          hazmat_oos_count: 0,
          severity_weight: 5,
        },
        {
          inspection_report_number: 'INSP-FXT-2',
          dot: FIXTURE_DOT,
          inspection_date: '2026-03-10',
          state: 'OK',
          level: 2,
          vehicle_count: 1,
          driver_count: 1,
          hazmat_count: 0,
          vehicle_oos_count: 0,
          driver_oos_count: 1,
          hazmat_oos_count: 0,
          severity_weight: 3,
        },
      ]);

      await mainKnex('fmcsa.basic_scores').insert([
        {
          dot: FIXTURE_DOT,
          basic: 'Unsafe Driving',
          computed_at: new Date('2026-04-01T00:00:00Z'),
          measure_value: '12.34',
          percentile: '45.5',
        },
        {
          dot: FIXTURE_DOT,
          basic: 'Unsafe Driving',
          computed_at: new Date('2026-05-01T00:00:00Z'),
          measure_value: '13.10',
          percentile: '47.0',
        },
        {
          dot: FIXTURE_DOT,
          basic: 'HOS Compliance',
          computed_at: new Date('2026-05-01T00:00:00Z'),
          measure_value: '8.20',
          percentile: '30.0',
        },
      ]);
    });

    after(async () => {
      if (!dbAvailable) {
        if (mainKnex) await mainKnex.destroy();
        return;
      }
      // Tear down fixtures to leave a clean DB.
      await mainKnex('fmcsa.basic_scores').whereIn('dot', [FIXTURE_DOT, FIXTURE_BROKER_DOT]).del();
      await mainKnex('fmcsa.violations')
        .whereIn('inspection_report_number', ['INSP-FXT-1', 'INSP-FXT-2'])
        .del();
      await mainKnex('fmcsa.inspections')
        .whereIn('inspection_report_number', ['INSP-FXT-1', 'INSP-FXT-2'])
        .del();
      await mainKnex('fmcsa.crashes').whereIn('dot', [FIXTURE_DOT, FIXTURE_BROKER_DOT]).del();
      await mainKnex('fmcsa.authorities').whereIn('dot', [FIXTURE_DOT, FIXTURE_BROKER_DOT]).del();
      await mainKnex('fmcsa.carriers').whereIn('dot', [FIXTURE_DOT, FIXTURE_BROKER_DOT]).del();
      await mainKnex.destroy();
    });

    it('getCarrier returns the carrier row for a known DOT', async (t) => {
      if (!dbAvailable) return t.skip('no FMCSA-schema database available');
      const c = await fmcsaRef.getCarrier(FIXTURE_DOT);
      assert.ok(c, 'expected carrier row');
      assert.equal(String(c.dot), String(FIXTURE_DOT));
      assert.equal(c.legal_name, 'FN-1427 Fixture Carrier');
      assert.equal(c.power_units, 12);
    });

    it('getCarrier returns null for an unknown / invalid DOT', async (t) => {
      if (!dbAvailable) return t.skip('no FMCSA-schema database available');
      assert.equal(await fmcsaRef.getCarrier(0), null);
      assert.equal(await fmcsaRef.getCarrier('not-a-number'), null);
      assert.equal(await fmcsaRef.getCarrier(null), null);
      const missing = await fmcsaRef.getCarrier(1);
      assert.equal(missing, null);
    });

    it('getCarrierContacts surfaces phone/fax/email', async (t) => {
      if (!dbAvailable) return t.skip('no FMCSA-schema database available');
      const contacts = await fmcsaRef.getCarrierContacts(FIXTURE_DOT);
      assert.deepEqual(contacts, {
        phone: '555-0100',
        fax: '555-0101',
        email: 'ops@fixture.example',
      });
    });

    it('getCarrierContacts returns null for unknown DOT', async (t) => {
      if (!dbAvailable) return t.skip('no FMCSA-schema database available');
      assert.equal(await fmcsaRef.getCarrierContacts(1), null);
    });

    it('searchCarriers finds the fixture by legal_name', async (t) => {
      if (!dbAvailable) return t.skip('no FMCSA-schema database available');
      const result = await fmcsaRef.searchCarriers({ q: 'FN-1427 Fixture Carrier' });
      assert.ok(Array.isArray(result.rows));
      assert.ok(result.rows.some((r) => String(r.dot) === String(FIXTURE_DOT)));
      assert.ok(result.total >= 1);
    });

    it('getBroker returns active broker authority joined with carrier fields', async (t) => {
      if (!dbAvailable) return t.skip('no FMCSA-schema database available');
      const broker = await fmcsaRef.getBroker('MC-FXT-2');
      assert.ok(broker, 'expected broker row');
      assert.equal(broker.authority_type, 'Broker');
      assert.equal(broker.status, 'Active');
      assert.equal(broker.legal_name, 'FN-1427 Fixture Broker LLC');
    });

    it('getBroker returns null for inactive / unknown MC', async (t) => {
      if (!dbAvailable) return t.skip('no FMCSA-schema database available');
      assert.equal(await fmcsaRef.getBroker('MC-DOES-NOT-EXIST'), null);
      assert.equal(await fmcsaRef.getBroker(''), null);
    });

    it('searchBrokers finds the fixture broker', async (t) => {
      if (!dbAvailable) return t.skip('no FMCSA-schema database available');
      const result = await fmcsaRef.searchBrokers({ q: 'FN-1427 Fixture Broker' });
      assert.ok(result.rows.length >= 1);
      assert.equal(result.rows[0].authority_type, 'Broker');
    });

    it('getInspections returns inspections newest-first; honors `since`', async (t) => {
      if (!dbAvailable) return t.skip('no FMCSA-schema database available');
      const all = await fmcsaRef.getInspections(FIXTURE_DOT);
      assert.equal(all.length, 2);
      assert.equal(all[0].inspection_report_number, 'INSP-FXT-2'); // 2026-03-10 > 2026-01-15

      const filtered = await fmcsaRef.getInspections(FIXTURE_DOT, { since: '2026-02-01' });
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].inspection_report_number, 'INSP-FXT-2');
    });

    it('getInspectionStats aggregates counts and OOS rates', async (t) => {
      if (!dbAvailable) return t.skip('no FMCSA-schema database available');
      const stats = await fmcsaRef.getInspectionStats(FIXTURE_DOT);
      assert.equal(stats.inspection_count, 2);
      assert.equal(stats.vehicle_inspection_count, 2);
      assert.equal(stats.driver_inspection_count, 2);
      assert.equal(stats.vehicle_oos_count, 1);
      assert.equal(stats.driver_oos_count, 1);
      assert.equal(stats.vehicle_oos_rate, 50);
      assert.equal(stats.driver_oos_rate, 50);
    });

    it('getInspectionStats returns zeros for an unknown DOT', async (t) => {
      if (!dbAvailable) return t.skip('no FMCSA-schema database available');
      const stats = await fmcsaRef.getInspectionStats(1);
      assert.equal(stats.inspection_count, 0);
      assert.equal(stats.vehicle_oos_rate, 0);
    });

    it('getCrashes returns an array (possibly empty)', async (t) => {
      if (!dbAvailable) return t.skip('no FMCSA-schema database available');
      const crashes = await fmcsaRef.getCrashes(FIXTURE_DOT);
      assert.ok(Array.isArray(crashes));
    });

    it('getBasicScores latest=true returns one row per BASIC (most recent)', async (t) => {
      if (!dbAvailable) return t.skip('no FMCSA-schema database available');
      const latest = await fmcsaRef.getBasicScores(FIXTURE_DOT);
      assert.equal(latest.length, 2); // Unsafe Driving + HOS Compliance
      const unsafeDriving = latest.find((r) => r.basic === 'Unsafe Driving');
      assert.ok(unsafeDriving);
      assert.equal(Number(unsafeDriving.percentile), 47);
    });

    it('getBasicScores latest=false returns full history', async (t) => {
      if (!dbAvailable) return t.skip('no FMCSA-schema database available');
      const all = await fmcsaRef.getBasicScores(FIXTURE_DOT, { latest: false });
      assert.equal(all.length, 3);
    });

    it('getCarrierAuthorities returns authority rows for a DOT', async (t) => {
      if (!dbAvailable) return t.skip('no FMCSA-schema database available');
      const auths = await fmcsaRef.getCarrierAuthorities(FIXTURE_DOT);
      assert.equal(auths.length, 1);
      assert.equal(auths[0].authority_type, 'Common');
    });
  });
}
