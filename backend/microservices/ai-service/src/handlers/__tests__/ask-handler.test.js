'use strict';

/**
 * FN-1148: Tests for ask-handler + query-classifier.
 * Runs standalone with `node`. Anthropic client is mocked via deps.anthropic.
 */

const assert = require('node:assert/strict');

const {
  handleAsk,
  validateRequest,
  validateAnswer,
  parseAiResponse,
  ANSWER_KINDS,
  DOMAIN_PROMPTS
} = require('../ask-handler');
const {
  classifyIntent,
  classifyByKeyword,
  validateClassification,
  INTENTS
} = require('../../services/query-classifier');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

// Anthropic mock that responds differently depending on the system prompt.
// Classifier prompts include the word "classify"; answer prompts contain "headline".
function makeRoutedAnthropic({ classifyOutput, answerOutput, model = 'mock-model' }) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (args) => {
        calls.push(args);
        const sys = String(args.system || '');
        const isClassifier = /classify/i.test(sys);
        const text = isClassifier
          ? JSON.stringify(classifyOutput)
          : JSON.stringify(answerOutput);
        return {
          model,
          content: [{ type: 'text', text }]
        };
      }
    }
  };
}

function makeFailingAnthropic(err) {
  return {
    messages: {
      create: async () => { throw err; }
    }
  };
}

const VALID_ANSWER = {
  kind: 'text',
  headline: '11 of 14 loads delivered today',
  detail: 'Three loads remain pending; pace matches plan within one unit.'
};

const SAMPLE_BRIEFING = {
  throughput: { headline: '11 of 14 loads', detail: 'detail', metric: '11/14' },
  exceptions: { headline: '2 open', detail: 'detail', metric: '2 open' }
};

async function runCase(name, fn) {
  try {
    await fn();
    // eslint-disable-next-line no-console
    console.log(`  ok  ${name}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`  FAIL ${name}`);
    throw err;
  }
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('ask-handler tests');

  // ── classifyByKeyword ──────────────────────────────────────────────
  await runCase('keyword: loads', () => {
    const r = classifyByKeyword('show me pending loads from broker Smith');
    assert.equal(r.intent, 'loads');
    assert.ok(r.confidence > 0.5);
  });

  await runCase('keyword: drivers', () => {
    const r = classifyByKeyword('which drivers are near HOS limit');
    assert.equal(r.intent, 'drivers');
  });

  await runCase('keyword: vehicles', () => {
    const r = classifyByKeyword('which trucks are overdue for PM');
    assert.equal(r.intent, 'vehicles');
  });

  await runCase('keyword: generic when no domain words', () => {
    const r = classifyByKeyword('hi how are you');
    assert.equal(r.intent, 'generic');
  });

  await runCase('keyword: generic when multi-domain tie', () => {
    const r = classifyByKeyword('driver and truck status');
    assert.equal(r.intent, 'generic');
  });

  await runCase('keyword: empty prompt -> generic', () => {
    const r = classifyByKeyword('');
    assert.equal(r.intent, 'generic');
  });

  // ── validateClassification ─────────────────────────────────────────
  await runCase('validateClassification rejects unknown intent', () => {
    assert.equal(validateClassification({ intent: 'bogus', confidence: 0.9 }), null);
  });

  await runCase('validateClassification clamps confidence and trims reasoning', () => {
    const out = validateClassification({
      intent: 'LOADS',
      confidence: 1.7,
      reasoning: 'x'.repeat(200)
    });
    assert.equal(out.intent, 'loads');
    assert.equal(out.confidence, 1);
    assert.equal(out.reasoning.length, 120);
  });

  // ── classifyIntent (with mocked Anthropic) ─────────────────────────
  await runCase('classifyIntent returns AI verdict when valid', async () => {
    const anthropic = {
      messages: {
        create: async () => ({
          model: 'm',
          content: [{ type: 'text', text: JSON.stringify({ intent: 'drivers', confidence: 0.92, reasoning: 'driver kw' }) }]
        })
      }
    };
    const out = await classifyIntent('which drivers are near HOS', { anthropic });
    assert.equal(out.intent, 'drivers');
    assert.equal(out.source, 'ai');
    assert.equal(out.confidence, 0.92);
  });

  await runCase('classifyIntent falls back to heuristic on parse error', async () => {
    const anthropic = {
      messages: {
        create: async () => ({
          model: 'm',
          content: [{ type: 'text', text: 'not json' }]
        })
      }
    };
    const out = await classifyIntent('show me pending loads', { anthropic });
    assert.equal(out.source, 'heuristic_fallback');
    assert.equal(out.intent, 'loads');
  });

  await runCase('classifyIntent falls back to heuristic on upstream error', async () => {
    const anthropic = makeFailingAnthropic(new Error('boom'));
    const out = await classifyIntent('truck PM status', { anthropic });
    assert.equal(out.source, 'heuristic_error');
    assert.equal(out.intent, 'vehicles');
  });

  // ── validateRequest ────────────────────────────────────────────────
  await runCase('validateRequest: missing prompt', () => {
    assert.match(validateRequest({}).error, /prompt/);
    assert.match(validateRequest({ prompt: '   ' }).error, /prompt/);
  });

  await runCase('validateRequest: rejects non-object briefingContext', () => {
    const r = validateRequest({ prompt: 'hi', briefingContext: 'no' });
    assert.match(r.error, /briefingContext/);
  });

  await runCase('validateRequest: long prompt rejected', () => {
    const r = validateRequest({ prompt: 'x'.repeat(1100) });
    assert.match(r.error, /1000/);
  });

  await runCase('validateRequest: accepts minimal', () => {
    const r = validateRequest({ prompt: 'hello' });
    assert.equal(r.prompt, 'hello');
    assert.equal(r.briefingContext, null);
    assert.equal(r.tenantId, null);
  });

  // ── validateAnswer ─────────────────────────────────────────────────
  await runCase('validateAnswer: trims & enforces shape', () => {
    const out = validateAnswer({
      kind: 'text',
      headline: 'a'.repeat(200),
      detail: 'b'.repeat(500)
    });
    assert.ok(out);
    assert.equal(out.headline.length, 60);
    assert.equal(out.detail.length, 320);
  });

  await runCase('validateAnswer: unknown kind rejected', () => {
    assert.equal(validateAnswer({ kind: 'chart', headline: 'a', detail: 'b' }), null);
  });

  await runCase('validateAnswer: empty headline rejected', () => {
    assert.equal(validateAnswer({ kind: 'text', headline: '', detail: 'b' }), null);
  });

  await runCase('parseAiResponse strips markdown fences', () => {
    assert.deepEqual(parseAiResponse('```json\n{"a":1}\n```'), { a: 1 });
  });

  // ── handleAsk integration with mocked Anthropic ────────────────────
  await runCase('happy path returns intent + answer', async () => {
    const anthropic = makeRoutedAnthropic({
      classifyOutput: { intent: 'loads', confidence: 0.88, reasoning: 'loads kw' },
      answerOutput: VALID_ANSWER,
      model: 'claude-test-1'
    });
    const res = makeRes();
    await handleAsk(
      { body: { prompt: 'how many loads delivered today', briefingContext: SAMPLE_BRIEFING } },
      res,
      { anthropic }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.intent, 'loads');
    assert.equal(res.body.answer.kind, 'text');
    assert.equal(res.body.answer.headline, VALID_ANSWER.headline);
    assert.equal(res.body.classification.source, 'ai');
    assert.ok(res.body.meta.processingTimeMs >= 0);
    // classifier + answer = 2 calls
    assert.equal(anthropic.calls.length, 2);
    // verify briefing context was forwarded into answer prompt
    const answerCall = anthropic.calls[1];
    const userMsg = JSON.parse(answerCall.messages[0].content);
    assert.equal(userMsg.question, 'how many loads delivered today');
    assert.deepEqual(userMsg.briefingContext, SAMPLE_BRIEFING);
  });

  await runCase('classifier failure -> heuristic still produces answer', async () => {
    let callIdx = 0;
    const anthropic = {
      messages: {
        create: async (args) => {
          callIdx += 1;
          if (callIdx === 1) {
            // classifier call fails
            throw new Error('classifier 503');
          }
          return {
            model: 'm',
            content: [{ type: 'text', text: JSON.stringify(VALID_ANSWER) }]
          };
        }
      }
    };
    const res = makeRes();
    await handleAsk(
      { body: { prompt: 'how many loads delivered today' } },
      res,
      { anthropic }
    );
    assert.equal(res.body.success, true);
    assert.equal(res.body.intent, 'loads', 'heuristic picked loads from keyword');
    assert.match(res.body.classification.source, /heuristic/);
  });

  await runCase('answer upstream error returns 502 AI_UNAVAILABLE', async () => {
    let callIdx = 0;
    const anthropic = {
      messages: {
        create: async (args) => {
          callIdx += 1;
          if (callIdx === 1) {
            return {
              model: 'm',
              content: [{ type: 'text', text: JSON.stringify({ intent: 'generic', confidence: 0.5, reasoning: 'r' }) }]
            };
          }
          const e = new Error('boom');
          e.status = 503;
          throw e;
        }
      }
    };
    const res = makeRes();
    await handleAsk({ body: { prompt: 'hi' } }, res, { anthropic });
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, 'AI_UNAVAILABLE');
    assert.equal(res.body.meta.intent, 'generic');
  });

  await runCase('unparseable answer returns 502 AI_PARSE_ERROR', async () => {
    const anthropic = makeRoutedAnthropic({
      classifyOutput: { intent: 'generic', confidence: 0.5, reasoning: 'r' },
      answerOutput: VALID_ANSWER
    });
    // override answer to raw string
    anthropic.messages.create = async (args) => {
      if (/classify/i.test(String(args.system))) {
        return { model: 'm', content: [{ type: 'text', text: JSON.stringify({ intent: 'generic', confidence: 0.5, reasoning: 'r' }) }] };
      }
      return { model: 'm', content: [{ type: 'text', text: 'not json at all' }] };
    };
    const res = makeRes();
    await handleAsk({ body: { prompt: 'overall status?' } }, res, { anthropic });
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, 'AI_PARSE_ERROR');
  });

  await runCase('answer schema mismatch returns 502 AI_SCHEMA_ERROR', async () => {
    const anthropic = makeRoutedAnthropic({
      classifyOutput: { intent: 'generic', confidence: 0.5, reasoning: 'r' },
      answerOutput: { kind: 'chart', headline: 'x', detail: 'y' } // wrong kind
    });
    const res = makeRes();
    await handleAsk({ body: { prompt: 'overall status?' } }, res, { anthropic });
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, 'AI_SCHEMA_ERROR');
  });

  await runCase('missing prompt returns 400', async () => {
    const anthropic = makeRoutedAnthropic({
      classifyOutput: { intent: 'generic', confidence: 0.5, reasoning: 'r' },
      answerOutput: VALID_ANSWER
    });
    const res = makeRes();
    await handleAsk({ body: {} }, res, { anthropic });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
  });

  await runCase('domain prompts are defined for every intent', () => {
    for (const intent of INTENTS) {
      assert.ok(DOMAIN_PROMPTS[intent], `missing domain prompt for ${intent}`);
    }
  });

  await runCase('ANSWER_KINDS includes text', () => {
    assert.ok(ANSWER_KINDS.includes('text'));
  });

  // eslint-disable-next-line no-console
  console.log('all tests passed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
