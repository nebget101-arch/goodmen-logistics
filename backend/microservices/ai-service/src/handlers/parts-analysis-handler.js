const { buildSystemPrompt } = require('../prompt');
const { logAiInteraction } = require('../analytics/logger');

/**
 * POST /api/ai/parts/analysis
 * Body: { parts: [{ sku, name, category, manufacturer, unit_cost, unit_price, quantity_on_hand, reorder_level, status }], categories?: [], manufacturers?: [] }
 * Returns: { summary, insights: [{ type, title, message, partSkus? }], recommendations: [{ action, detail, partSkus? }] }
 */
async function handlePartsAnalysis(req, res, deps) {
  try {
    const { openai } = deps;
    const { parts = [], categories = [], manufacturers = [] } = req.body || {};

    if (!Array.isArray(parts)) {
      return res.status(400).json({
        success: false,
        error: 'parts array is required',
        code: 'AI_PARTS_ANALYSIS_BAD_REQUEST'
      });
    }

    const systemPrompt = [
      buildSystemPrompt(),
      '',
      'You are analyzing a parts catalog for a fleet or warehouse.',
      'You receive a list of parts (SKU, name, category, manufacturer, cost, price, quantity on hand, reorder level, status).',
      'Respond with a JSON object only:',
      '{',
      '  "summary": "2–4 sentence overview of the catalog: total parts, categories, any obvious risks (e.g. many zero-stock, low reorder levels).",',
      '  "insights": [',
      '    { "type": "string (e.g. LOW_STOCK, ZERO_STOCK, COST_CONCENTRATION, CATEGORY_SPREAD)", "title": "short title", "message": "1–2 sentence explanation", "partSkus": ["optional", "skus"] }',
      '  ],',
      '  "recommendations": [',
      '    { "action": "short action label", "detail": "1–2 sentence what to do", "partSkus": ["optional", "skus"] }',
      '  ]',
      '}',
      '',
      'Focus on: parts with zero or very low quantity_on_hand; parts below reorder_level; high unit_cost parts with low stock; category/manufacturer distribution; duplicate-like SKUs or names; missing reorder_level. Keep insights and recommendations concise (3–7 items each). partSkus should be included when referring to specific parts. Never include markdown or text outside the JSON.'
    ].join('\n');

    const partsSummary = parts.length === 0
      ? 'No parts data provided.'
      : `Parts (${parts.length} total):\n${parts.slice(0, 300).map(p => {
          const qty = p.quantity_on_hand ?? p.on_hand ?? 0;
          const reorder = p.reorder_level ?? p.min_stock_level ?? null;
          return `  ${p.sku || '?'} | ${(p.name || '').slice(0, 50)} | ${p.category || '-'} | ${p.manufacturer || '-'} | cost=${p.unit_cost ?? '-'} | qty=${qty} | reorder=${reorder ?? '-'} | ${p.status || 'ACTIVE'}`;
        }).join('\n')}${parts.length > 300 ? '\n  ... (truncated)' : ''}`;

    const meta = [];
    if (categories.length) meta.push(`Categories (${categories.length}): ${categories.slice(0, 20).join(', ')}${categories.length > 20 ? '…' : ''}`);
    if (manufacturers.length) meta.push(`Manufacturers (${manufacturers.length}): ${manufacturers.slice(0, 15).join(', ')}${manufacturers.length > 15 ? '…' : ''}`);
    const userMessage = [partsSummary, meta.length ? '\n' + meta.join('\n') : ''].join('\n');

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
    const raw = completion.choices[0]?.message?.content || '{}';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { summary: raw, insights: [], recommendations: [] };
    }

    const response = {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      insights: Array.isArray(parsed.insights) ? parsed.insights : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : []
    };

    logAiInteraction({
      userId: null,
      route: '/api/ai/parts/analysis',
      message: `parts=${parts.length}`,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs
    });

    return res.json(response);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ai-service] parts analysis error', err);

    logAiInteraction({
      userId: null,
      route: '/api/ai/parts/analysis',
      message: null,
      conversationId: null,
      success: false,
      errorCode: 'AI_PARTS_ANALYSIS_ERROR',
      processingTimeMs: null
    });

    return res.status(502).json({
      success: false,
      error: 'AI parts analysis unavailable',
      code: 'AI_PARTS_ANALYSIS_ERROR'
    });
  }
}

module.exports = {
  handlePartsAnalysis
};
