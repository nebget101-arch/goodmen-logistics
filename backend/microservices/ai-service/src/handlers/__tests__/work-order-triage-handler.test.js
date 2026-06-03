'use strict';

/**
 * FN-1441: Tests for work-order-triage-handler.
 * Runs standalone with `node`. No jest/mocha required.
 * The OpenAI client is mocked via deps.openai so no real API calls are made.
 */

const assert = require('node:assert/strict');
const {
  handleWorkOrderTriage,
  TRIAGE_SYSTEM_PROMPT,
  normalizePart
} = require('../work-order-triage-handler');

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

function makeMockOpenAI(modelOutput) {
  const calls = [];
  const text =
    typeof modelOutput === 'string' ? modelOutput : JSON.stringify(modelOutput);
  return {
    calls,
    chat: {
      completions: {
        create: async (params) => {
          calls.push(params);
          return {
            choices: [{ message: { content: text } }]
          };
        }
      }
    }
  };
}

function makeFailingOpenAI() {
  return {
    chat: {
      completions: {
        create: async () => {
          throw new Error('upstream openai failure');
        }
      }
    }
  };
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('work-order-triage-handler tests');

  // ---- 1. bad request: missing description
  {
    const res = makeRes();
    await handleWorkOrderTriage({ body: {} }, res, {
      openai: makeMockOpenAI({})
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'AI_TRIAGE_BAD_REQUEST');
    // eslint-disable-next-line no-console
    console.log('  ok  missing description returns 400');
  }

  // ---- 2. bad request: non-string description
  {
    const res = makeRes();
    await handleWorkOrderTriage({ body: { description: 42 } }, res, {
      openai: makeMockOpenAI({})
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'AI_TRIAGE_BAD_REQUEST');
    // eslint-disable-next-line no-console
    console.log('  ok  non-string description returns 400');
  }

  // ---- 3. happy path: model returns new shape, response normalized
  {
    const res = makeRes();
    const openai = makeMockOpenAI({
      tasks: [{ description: 'Replace front brake pads', estimatedHours: 1.5 }],
      parts: [
        {
          partName: 'Brake pad set, front',
          manufacturerHint: 'Bosch',
          suggestedSku: 'BP-F-2024',
          qty: 1,
          confidence: 0.9
        },
        {
          partName: 'Brake rotor, front',
          manufacturerHint: null,
          suggestedSku: null,
          qty: 2,
          confidence: 0.6
        }
      ],
      priority: 'HIGH',
      notes: 'Front brakes squeal under braking.'
    });

    await handleWorkOrderTriage(
      { body: { description: 'front brakes squealing', vehicleId: 'V-1' } },
      res,
      { openai }
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.priority, 'HIGH');
    assert.equal(res.body.parts.length, 2);

    assert.deepEqual(res.body.parts[0], {
      partName: 'Brake pad set, front',
      manufacturerHint: 'Bosch',
      suggestedSku: 'BP-F-2024',
      qty: 1,
      confidence: 0.9
    });
    assert.deepEqual(res.body.parts[1], {
      partName: 'Brake rotor, front',
      manufacturerHint: null,
      suggestedSku: null,
      qty: 2,
      confidence: 0.6
    });

    // legacy field still populated for one release
    assert.deepEqual(res.body.partsLegacy, [
      { query: 'Brake pad set, front', qty: 1 },
      { query: 'Brake rotor, front', qty: 2 }
    ]);

    // prompt cache hint + static system prompt sent verbatim
    assert.equal(openai.calls.length, 1);
    assert.equal(openai.calls[0].prompt_cache_key, 'work-order-triage-v2');
    assert.equal(openai.calls[0].messages[0].role, 'system');
    assert.equal(openai.calls[0].messages[0].content, TRIAGE_SYSTEM_PROMPT);
    // eslint-disable-next-line no-console
    console.log('  ok  normalizes new-shape parts + populates legacy field');
  }

  // ---- 4. backward-compat: model returns old shape ({ query, qty }), still normalized
  {
    const res = makeRes();
    const openai = makeMockOpenAI({
      tasks: [],
      parts: [
        { query: 'oil filter', qty: 1 },
        { query: 'engine oil 5W-30', qty: 5 }
      ],
      priority: 'LOW',
      notes: ''
    });

    await handleWorkOrderTriage(
      { body: { description: 'routine oil change' } },
      res,
      { openai }
    );

    assert.equal(res.body.parts.length, 2);
    assert.equal(res.body.parts[0].partName, 'oil filter');
    assert.equal(res.body.parts[0].suggestedSku, null);
    assert.equal(res.body.parts[0].manufacturerHint, null);
    assert.equal(res.body.parts[0].qty, 1);
    assert.equal(typeof res.body.parts[0].confidence, 'number');
    assert.deepEqual(res.body.partsLegacy, [
      { query: 'oil filter', qty: 1 },
      { query: 'engine oil 5W-30', qty: 5 }
    ]);
    // eslint-disable-next-line no-console
    console.log('  ok  normalizes old-shape model output');
  }

  // ---- 5. malformed model output → empty parts, fallback notes carry raw text
  {
    const res = makeRes();
    const openai = makeMockOpenAI('not json — just prose');

    await handleWorkOrderTriage(
      { body: { description: 'something' } },
      res,
      { openai }
    );

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.parts, []);
    assert.deepEqual(res.body.partsLegacy, []);
    assert.equal(res.body.priority, 'MEDIUM');
    assert.equal(res.body.notes, 'not json — just prose');
    // eslint-disable-next-line no-console
    console.log('  ok  malformed model output falls back gracefully');
  }

  // ---- 6. coerces bad qty/confidence values
  {
    const res = makeRes();
    const openai = makeMockOpenAI({
      tasks: [],
      parts: [
        { partName: 'wiper blade', qty: 0, confidence: 1.7 },
        { partName: 'air filter', qty: -3, confidence: -0.4 },
        { partName: 'cabin filter', qty: '2', confidence: '0.55' }
      ],
      priority: 'MEDIUM',
      notes: ''
    });

    await handleWorkOrderTriage(
      { body: { description: 'replace wear items' } },
      res,
      { openai }
    );

    assert.equal(res.body.parts[0].qty, 1);
    assert.equal(res.body.parts[0].confidence, 1);
    assert.equal(res.body.parts[1].qty, 1);
    assert.equal(res.body.parts[1].confidence, 0);
    assert.equal(res.body.parts[2].qty, 2);
    assert.equal(res.body.parts[2].confidence, 0.55);
    // eslint-disable-next-line no-console
    console.log('  ok  coerces out-of-range qty + confidence');
  }

  // ---- 7. drops parts with no usable name
  {
    const res = makeRes();
    const openai = makeMockOpenAI({
      tasks: [],
      parts: [
        { qty: 2, confidence: 0.8 }, // no name → dropped
        null,                         // not an object → dropped
        'just a string',              // not an object → dropped
        { partName: 'good part' }
      ],
      priority: 'MEDIUM',
      notes: ''
    });

    await handleWorkOrderTriage(
      { body: { description: 'noisy data' } },
      res,
      { openai }
    );

    assert.equal(res.body.parts.length, 1);
    assert.equal(res.body.parts[0].partName, 'good part');
    // eslint-disable-next-line no-console
    console.log('  ok  drops nameless / non-object parts');
  }

  // ---- 8. upstream failure → 502
  {
    const res = makeRes();
    await handleWorkOrderTriage(
      { body: { description: 'anything' } },
      res,
      { openai: makeFailingOpenAI() }
    );
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, 'AI_TRIAGE_ERROR');
    // eslint-disable-next-line no-console
    console.log('  ok  upstream openai failure returns 502');
  }

  // ---- 9. normalizePart unit checks
  {
    assert.equal(normalizePart(null), null);
    assert.equal(normalizePart('foo'), null);
    assert.equal(normalizePart({ qty: 1 }), null); // no name → null

    const fromQuery = normalizePart({ query: 'old shape', qty: 4 });
    assert.equal(fromQuery.partName, 'old shape');
    assert.equal(fromQuery.qty, 4);
    assert.equal(fromQuery.suggestedSku, null);
    assert.equal(fromQuery.manufacturerHint, null);

    const fromSku = normalizePart({
      partName: 'X',
      sku: 'SKU-1', // legacy alias for suggestedSku
      qty: 1
    });
    assert.equal(fromSku.suggestedSku, 'SKU-1');
    // eslint-disable-next-line no-console
    console.log('  ok  normalizePart edge cases');
  }

  // eslint-disable-next-line no-console
  console.log('all tests passed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
