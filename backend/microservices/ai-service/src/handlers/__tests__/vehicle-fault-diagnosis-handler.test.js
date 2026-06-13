'use strict';

/**
 * FN-1770: Tests for vehicle-fault-diagnosis-handler.
 * Runs standalone with `node`. No jest/mocha required.
 * The OpenAI client is mocked via deps.openai so no real API calls are made.
 */

const assert = require('node:assert/strict');
const {
  handleVehicleFaultDiagnosis,
  normalizeDiagnosis,
  sanitizeFaultCodes,
  isSafetyCritical
} = require('../vehicle-fault-diagnosis-handler');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function makeMockOpenAI(modelOutputObj) {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: JSON.stringify(modelOutputObj) } }]
        })
      }
    }
  };
}

function makeBrokenOpenAI(rawText) {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: rawText } }]
        })
      }
    }
  };
}

function makeThrowingOpenAI() {
  return {
    chat: {
      completions: {
        create: async () => {
          throw new Error('upstream unavailable');
        }
      }
    }
  };
}

let callCount = 0;
function makeCountingOpenAI() {
  return {
    chat: {
      completions: {
        create: async () => {
          callCount += 1;
          return { choices: [{ message: { content: '{}' } }] };
        }
      }
    }
  };
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('vehicle-fault-diagnosis-handler tests');

  // --- pure helpers ---------------------------------------------------------
  assert.deepEqual(
    sanitizeFaultCodes([{ code: ' P0420 ', description: ' x ', severity: 'MEDIUM' }]),
    [{ code: 'P0420', description: 'x', severity: 'medium' }]
  );
  assert.deepEqual(sanitizeFaultCodes(null), []);
  assert.deepEqual(sanitizeFaultCodes([{}, { code: '', description: '' }]), []);
  // eslint-disable-next-line no-console
  console.log('  ok  sanitizeFaultCodes trims/normalizes and drops empties');

  assert.equal(
    isSafetyCritical({ code: 'SPN-100', description: 'Engine oil pressure low', severity: 'high' }),
    true
  );
  assert.equal(
    isSafetyCritical({ code: 'SPN-100', description: 'Engine oil pressure low', severity: 'low' }),
    false
  );
  assert.equal(
    isSafetyCritical({ code: 'P0420', description: 'Catalyst efficiency', severity: 'high' }),
    false
  );
  // eslint-disable-next-line no-console
  console.log('  ok  isSafetyCritical requires high/critical severity AND a critical system');

  // --- empty faultCodes => benign, no model call ----------------------------
  {
    callCount = 0;
    const res = makeRes();
    await handleVehicleFaultDiagnosis({ body: { faultCodes: [] } }, res, {
      openai: makeCountingOpenAI()
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.immediateAttention, false);
    assert.equal(res.body.urgency, 'low');
    assert.deepEqual(res.body.perFault, []);
    assert.equal(callCount, 0, 'model must NOT be called for empty faultCodes');
    // eslint-disable-next-line no-console
    console.log('  ok  empty faultCodes returns benign response without a model call');
  }

  {
    callCount = 0;
    const res = makeRes();
    await handleVehicleFaultDiagnosis({ body: {} }, res, { openai: makeCountingOpenAI() });
    assert.equal(res.body.urgency, 'low');
    assert.equal(callCount, 0);
    // eslint-disable-next-line no-console
    console.log('  ok  missing faultCodes returns benign response without a model call');
  }

  // --- happy path: contract shape -------------------------------------------
  {
    const res = makeRes();
    await handleVehicleFaultDiagnosis(
      {
        body: {
          unitNumber: 'T-101',
          faultCodes: [{ code: 'P0420', description: 'Catalyst efficiency', severity: 'medium' }]
        }
      },
      res,
      {
        openai: makeMockOpenAI({
          summary: 'Emissions-related fault.',
          immediateAttention: false,
          urgency: 'medium',
          recommendedAction: 'Schedule service.',
          perFault: [{ code: 'P0420', likelyCause: 'Catalyst aging', immediateAttention: false }]
        })
      }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.summary, 'Emissions-related fault.');
    assert.equal(res.body.immediateAttention, false);
    assert.equal(res.body.urgency, 'medium');
    assert.equal(res.body.recommendedAction, 'Schedule service.');
    assert.deepEqual(res.body.perFault, [
      { code: 'P0420', likelyCause: 'Catalyst aging', immediateAttention: false }
    ]);
    // eslint-disable-next-line no-console
    console.log('  ok  happy path returns the contract shape');
  }

  // --- safety bias overrides a too-soft model -------------------------------
  {
    const res = makeRes();
    await handleVehicleFaultDiagnosis(
      {
        body: {
          faultCodes: [
            { code: 'SPN-100', description: 'Engine oil pressure low', severity: 'high' }
          ]
        }
      },
      res,
      {
        // Model wrongly downplays a safety-critical fault.
        openai: makeMockOpenAI({
          summary: 'Minor issue.',
          immediateAttention: false,
          urgency: 'low',
          recommendedAction: 'Keep driving.',
          perFault: [{ code: 'SPN-100', likelyCause: 'Sensor', immediateAttention: false }]
        })
      }
    );
    assert.equal(res.body.immediateAttention, true, 'safety bias forces immediate attention');
    assert.equal(res.body.urgency, 'high', 'safety bias forces urgency >= high');
    assert.equal(res.body.perFault[0].immediateAttention, true);
    // eslint-disable-next-line no-console
    console.log('  ok  safety bias escalates a downplayed engine/oil/brake fault');
  }

  // --- safety bias never DOWNGRADES a critical model rating -----------------
  {
    const out = normalizeDiagnosis(
      {
        summary: 'Severe.',
        immediateAttention: true,
        urgency: 'critical',
        recommendedAction: 'Stop now.',
        perFault: [{ code: 'SPN-100', likelyCause: 'Pump failure', immediateAttention: true }]
      },
      sanitizeFaultCodes([
        { code: 'SPN-100', description: 'Engine oil pressure low', severity: 'critical' }
      ])
    );
    assert.equal(out.urgency, 'critical', 'must not downgrade critical to high');
    assert.equal(out.immediateAttention, true);
    // eslint-disable-next-line no-console
    console.log('  ok  safety bias keeps urgency at critical (no downgrade)');
  }

  // --- unparseable model output still yields a valid contract shape ---------
  {
    const res = makeRes();
    await handleVehicleFaultDiagnosis(
      {
        body: {
          faultCodes: [{ code: 'P0128', description: 'Coolant temp below thermostat', severity: 'medium' }]
        }
      },
      res,
      { openai: makeBrokenOpenAI('not json, just prose') }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(typeof res.body.summary, 'string');
    assert.ok(['critical', 'high', 'medium', 'low'].includes(res.body.urgency));
    assert.equal(res.body.perFault.length, 1);
    assert.equal(res.body.perFault[0].code, 'P0128');
    assert.ok(res.body.perFault[0].likelyCause);
    // eslint-disable-next-line no-console
    console.log('  ok  unparseable model output is normalized to the contract shape');
  }

  // --- perFault always covers every input fault -----------------------------
  {
    const out = normalizeDiagnosis(
      { perFault: [] },
      sanitizeFaultCodes([
        { code: 'A1', description: 'desc a', severity: 'low' },
        { code: 'B2', description: 'desc b', severity: 'low' }
      ])
    );
    assert.equal(out.perFault.length, 2);
    assert.deepEqual(
      out.perFault.map((p) => p.code),
      ['A1', 'B2']
    );
    // eslint-disable-next-line no-console
    console.log('  ok  perFault entry produced for every input fault even if model omits them');
  }

  // --- upstream failure => 502 ----------------------------------------------
  {
    const res = makeRes();
    await handleVehicleFaultDiagnosis(
      { body: { faultCodes: [{ code: 'X', description: 'y', severity: 'high' }] } },
      res,
      { openai: makeThrowingOpenAI() }
    );
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'AI_FAULT_DIAGNOSIS_ERROR');
    // eslint-disable-next-line no-console
    console.log('  ok  upstream failure returns 502 with error code');
  }

  // eslint-disable-next-line no-console
  console.log('all tests passed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
