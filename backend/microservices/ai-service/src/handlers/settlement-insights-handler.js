const { buildSystemPrompt } = require('../prompt');
const { logAiInteraction } = require('../analytics/logger');

async function handleSettlementInsights(req, res, deps) {
  try {
    const { openai } = deps;
    const {
      settlement = {},
      driver = {},
      truck = {},
      payableTo = '',
      metrics = {},
      priorPeriod = null,
      expenseBreakdown = {},
      anomalyFlags = []
    } = req.body || {};

    if (!settlement || !settlement.id) {
      return res.status(400).json({
        success: false,
        error: 'settlement payload with id is required',
        code: 'AI_SETTLEMENT_INSIGHTS_BAD_REQUEST'
      });
    }

    const systemPrompt = [
      buildSystemPrompt(),
      '',
      'You are generating concise AI insights for a trucking settlement PDF.',
      'Return JSON only with this exact shape:',
      '{',
      '  "summary": "2-3 sentences max",',
      '  "insights": [',
      '    { "title": "short title", "message": "1-2 sentence explanation", "category": "profitability|fuel|comparison|quality|risk" }',
      '  ]',
      '}',
      '',
      'Rules:',
      '- Keep the tone professional and operational, not conversational.',
      '- Mention actual metrics when they are provided.',
      '- Use at most 4 insight bullets.',
      '- If prior-period data is missing, do not invent comparison values.',
      '- If anomalyFlags are present, include at least one quality or risk insight.',
      '- Never include markdown or text outside the JSON object.'
    ].join('\n');

    const userMessage = JSON.stringify(
      {
        settlement: {
          id: settlement.id,
          settlement_number: settlement.settlement_number,
          settlement_type: settlement.settlement_type,
          date: settlement.date,
          payable_to: payableTo
        },
        driver,
        truck,
        metrics,
        priorPeriod,
        expenseBreakdown,
        anomalyFlags
      },
      null,
      2
    );

    const startedAt = Date.now();
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.2
    });

    const processingTimeMs = Date.now() - startedAt;
    const raw = completion.choices[0]?.message?.content || '{}';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_error) {
      parsed = { summary: raw, insights: [] };
    }

    const response = {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      insights: Array.isArray(parsed.insights)
        ? parsed.insights
          .filter((item) => item && (item.title || item.message))
          .slice(0, 4)
          .map((item) => ({
            title: item.title || 'Settlement insight',
            message: item.message || '',
            category: item.category || 'profitability'
          }))
        : []
    };

    logAiInteraction({
      userId: null,
      route: '/api/ai/settlements/insights',
      message: `settlement=${settlement.id}`,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs
    });

    return res.json(response);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ai-service] settlement insights error', err);

    logAiInteraction({
      userId: null,
      route: '/api/ai/settlements/insights',
      message: null,
      conversationId: null,
      success: false,
      errorCode: 'AI_SETTLEMENT_INSIGHTS_ERROR',
      processingTimeMs: null
    });

    return res.status(502).json({
      success: false,
      error: 'AI settlement insights unavailable',
      code: 'AI_SETTLEMENT_INSIGHTS_ERROR'
    });
  }
}

module.exports = {
  handleSettlementInsights
};
