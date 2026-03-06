const { buildSystemPrompt } = require('../prompt');
const { logAiInteraction } = require('../analytics/logger');

async function handleWorkOrderTriage(req, res, deps) {
  try {
    const { openai } = deps;
    const { description, vehicleId, customerId, locationId } = req.body || {};

    if (!description || typeof description !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'description is required',
        code: 'AI_TRIAGE_BAD_REQUEST'
      });
    }

    const systemPrompt = [
      buildSystemPrompt(),
      '',
      'You are now helping a service advisor triage a maintenance work order.',
      'Given a short free-text description of the problem, and optional vehicle/customer/location IDs, you must propose:',
      '- A small list of suggested labor tasks (description + estimated hours).',
      '- A small list of suggested parts to consider (free-text part description or SKU if obvious, plus quantity).',
      '- An overall suggested priority: LOW, MEDIUM, or HIGH.',
      '- Optional short notes explaining your reasoning.',
      '',
      'IMPORTANT: Respond as a single JSON object ONLY, with this shape:',
      '{',
      '  "tasks": [',
      '    { "description": "string", "estimatedHours": number }',
      '  ],',
      '  "parts": [',
      '    { "query": "string", "qty": number }',
      '  ],',
      '  "priority": "LOW" | "MEDIUM" | "HIGH",',
      '  "notes": "short string"',
      '}',
      '',
      'If you are unsure, keep the lists short and include your uncertainty in notes.',
      'Never include markdown, comments, or any extra text outside the JSON object.'
    ].join('\n');

    const userMessage = [
      'Problem description:',
      description,
      '',
      `Context: vehicleId=${vehicleId || 'null'}, customerId=${customerId || 'null'}, locationId=${locationId || 'null'}.`
    ].join('\n');

    const startedAt = Date.now();

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3
    });

    const processingTimeMs = Date.now() - startedAt;
    const choice = completion.choices[0];
    const raw = choice?.message?.content || '{}';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {
        tasks: [],
        parts: [],
        priority: 'MEDIUM',
        notes: raw
      };
    }

    const response = {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      parts: Array.isArray(parsed.parts) ? parsed.parts : [],
      priority: typeof parsed.priority === 'string' ? parsed.priority : 'MEDIUM',
      notes: typeof parsed.notes === 'string' ? parsed.notes : ''
    };

    logAiInteraction({
      userId: null,
      route: '/api/ai/work-order/triage',
      message: description,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs
    });

    return res.json(response);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ai-service] work-order triage error', err);

    logAiInteraction({
      userId: null,
      route: '/api/ai/work-order/triage',
      message: req.body?.description,
      conversationId: null,
      success: false,
      errorCode: 'AI_TRIAGE_ERROR',
      processingTimeMs: null
    });

    return res.status(502).json({
      success: false,
      error: 'AI triage unavailable',
      code: 'AI_TRIAGE_ERROR'
    });
  }
}

module.exports = {
  handleWorkOrderTriage
};

