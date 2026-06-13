const { buildSystemPrompt } = require('../prompt');
const { logAiInteraction } = require('../analytics/logger');

const ROUTE = '/api/ai/vehicle/fault-diagnosis';

const URGENCY_LEVELS = ['low', 'medium', 'high', 'critical'];

// Safety-critical systems: any high/critical fault touching these must escalate.
const SAFETY_CRITICAL_PATTERN =
  /\b(engine|oil\s*pressure|oil\b|brake|coolant|overheat|over\s*heat|temperature|abs|steering)\b/i;

/**
 * Higher index = more urgent. Returns the more-urgent of two urgency strings.
 */
function maxUrgency(a, b) {
  const ia = URGENCY_LEVELS.indexOf(a);
  const ib = URGENCY_LEVELS.indexOf(b);
  return ia >= ib ? a : b;
}

function normalizeUrgency(value) {
  if (typeof value === 'string' && URGENCY_LEVELS.includes(value.toLowerCase())) {
    return value.toLowerCase();
  }
  return 'medium';
}

/**
 * Normalize the inbound faultCodes array to clean { code, description, severity }
 * objects, dropping entries that have neither a code nor a description.
 */
function sanitizeFaultCodes(faultCodes) {
  if (!Array.isArray(faultCodes)) return [];
  return faultCodes
    .map((f) => {
      const item = f && typeof f === 'object' ? f : {};
      return {
        code: typeof item.code === 'string' ? item.code.trim() : '',
        description:
          typeof item.description === 'string' ? item.description.trim() : '',
        severity:
          typeof item.severity === 'string' ? item.severity.trim().toLowerCase() : ''
      };
    })
    .filter((f) => f.code || f.description);
}

/**
 * A fault is safety-critical when its severity is high/critical AND its
 * code/description mentions a safety-critical system.
 */
function isSafetyCritical(fault) {
  const sev = (fault.severity || '').toLowerCase();
  if (sev !== 'high' && sev !== 'critical') return false;
  const text = `${fault.code} ${fault.description}`;
  return SAFETY_CRITICAL_PATTERN.test(text);
}

function benignNoFaultResponse() {
  return {
    summary: 'No active fault codes. No issues detected from the available telemetry.',
    immediateAttention: false,
    urgency: 'low',
    recommendedAction: 'No action required. Continue normal operation.',
    perFault: []
  };
}

async function handleVehicleFaultDiagnosis(req, res, deps) {
  const { openai } = deps;
  const { vehicleId, unitNumber, faultCodes } = req.body || {};

  const faults = sanitizeFaultCodes(faultCodes);

  // Empty/missing faultCodes => benign response WITHOUT calling the model.
  if (faults.length === 0) {
    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `vehicleId=${vehicleId || 'null'} no-faults`,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs: 0
    });
    return res.json(benignNoFaultResponse());
  }

  try {
    const systemPrompt = [
      buildSystemPrompt(),
      '',
      'You are now helping a fleet operator interpret active vehicle fault codes.',
      'The codes are J1939 (SPN/FMI) or OBD-II (P/B/C/U) style diagnostic trouble codes.',
      'Given a list of active fault codes (code, description, severity), produce:',
      '- A 1-2 sentence plain-English overall assessment (summary).',
      '- Whether the vehicle needs immediate attention (pull over / service now).',
      '- An overall urgency: critical, high, medium, or low.',
      '- A concrete recommended action for the operator.',
      '- A per-fault likely cause and whether that specific fault needs immediate attention.',
      '',
      'SAFETY BIAS: Be conservative. Any critical or high severity fault affecting the',
      'engine, oil pressure, brakes, coolant, or overheating MUST set immediateAttention=true',
      'and urgency of at least "high". When in doubt, escalate.',
      '',
      'IMPORTANT: Respond as a single JSON object ONLY, with this exact shape:',
      '{',
      '  "summary": "string",',
      '  "immediateAttention": true | false,',
      '  "urgency": "critical" | "high" | "medium" | "low",',
      '  "recommendedAction": "string",',
      '  "perFault": [',
      '    { "code": "string", "likelyCause": "string", "immediateAttention": true | false }',
      '  ]',
      '}',
      '',
      'Include one perFault entry for every input fault code, keyed by its code.',
      'Never include markdown, comments, or any extra text outside the JSON object.'
    ].join('\n');

    const faultLines = faults
      .map(
        (f, i) =>
          `${i + 1}. code=${f.code || 'n/a'} | severity=${f.severity || 'unknown'} | description=${f.description || 'n/a'}`
      )
      .join('\n');

    const userMessage = [
      `Unit: ${unitNumber || vehicleId || 'unknown'}`,
      'Active fault codes:',
      faultLines
    ].join('\n');

    const startedAt = Date.now();

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });

    const processingTimeMs = Date.now() - startedAt;
    const choice = completion.choices[0];
    const raw = choice?.message?.content || '{}';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }

    const response = normalizeDiagnosis(parsed, faults);

    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `vehicleId=${vehicleId || 'null'} faults=${faults.length}`,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs
    });

    return res.json(response);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ai-service] vehicle fault diagnosis error', err);

    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `vehicleId=${vehicleId || 'null'} faults=${faults.length}`,
      conversationId: null,
      success: false,
      errorCode: 'AI_FAULT_DIAGNOSIS_ERROR',
      processingTimeMs: null
    });

    return res.status(502).json({
      success: false,
      error: 'AI fault diagnosis unavailable',
      code: 'AI_FAULT_DIAGNOSIS_ERROR'
    });
  }
}

/**
 * Validate/normalize raw model output into the exact contract shape, then apply
 * the deterministic safety bias so a model that under-rates a safety-critical
 * fault can never downgrade urgency below "high".
 */
function normalizeDiagnosis(parsed, faults) {
  const safe = parsed && typeof parsed === 'object' ? parsed : {};

  // Index model perFault entries by code for merging.
  const modelPerFault = Array.isArray(safe.perFault) ? safe.perFault : [];
  const byCode = new Map();
  for (const pf of modelPerFault) {
    if (pf && typeof pf === 'object' && typeof pf.code === 'string') {
      byCode.set(pf.code.trim(), pf);
    }
  }

  let escalate = false;

  const perFault = faults.map((f) => {
    const model = byCode.get(f.code) || {};
    const critical = isSafetyCritical(f);
    if (critical) escalate = true;

    const immediate =
      critical || model.immediateAttention === true;

    return {
      code: f.code,
      likelyCause:
        typeof model.likelyCause === 'string' && model.likelyCause.trim()
          ? model.likelyCause.trim()
          : f.description || 'Cause undetermined; inspect the affected system.',
      immediateAttention: immediate
    };
  });

  let urgency = normalizeUrgency(safe.urgency);
  let immediateAttention =
    safe.immediateAttention === true || perFault.some((p) => p.immediateAttention);

  // Safety bias: a safety-critical fault forces immediate attention + urgency >= high.
  if (escalate) {
    immediateAttention = true;
    urgency = maxUrgency(urgency, 'high');
  }

  const summary =
    typeof safe.summary === 'string' && safe.summary.trim()
      ? safe.summary.trim()
      : `${faults.length} active fault code${faults.length === 1 ? '' : 's'} detected.`;

  const recommendedAction =
    typeof safe.recommendedAction === 'string' && safe.recommendedAction.trim()
      ? safe.recommendedAction.trim()
      : immediateAttention
        ? 'Stop the vehicle safely and schedule service immediately.'
        : 'Monitor the vehicle and schedule service at the next opportunity.';

  return {
    summary,
    immediateAttention,
    urgency,
    recommendedAction,
    perFault
  };
}

module.exports = {
  handleVehicleFaultDiagnosis,
  // Exported for tests
  normalizeDiagnosis,
  sanitizeFaultCodes,
  isSafetyCritical,
  benignNoFaultResponse
};
