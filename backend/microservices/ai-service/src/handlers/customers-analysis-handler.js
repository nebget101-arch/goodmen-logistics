const { buildSystemPrompt } = require('../prompt');
const { logAiInteraction } = require('../analytics/logger');

/**
 * POST /api/ai/customers/analysis
 * Body: { customers: [{ company_name, customer_type, status, phone, email, default_location_id, last_service_date?, payment_terms?, credit_limit? }] }
 * Returns: { summary, insights: [{ type, title, message, customerIds? }], recommendations: [{ action, detail, customerIds? }] }
 */
async function handleCustomersAnalysis(req, res, deps) {
  try {
    const { openai } = deps;
    const { customers = [] } = req.body || {};

    if (!Array.isArray(customers)) {
      return res.status(400).json({
        success: false,
        error: 'customers array is required',
        code: 'AI_CUSTOMERS_ANALYSIS_BAD_REQUEST'
      });
    }

    const systemPrompt = [
      buildSystemPrompt(),
      '',
      'You are analyzing a customer list for a fleet or service business.',
      'You receive a list of customers with company name, type, status, contact info, default location, last service date, and optionally payment terms and credit limit.',
      'Respond with a JSON object only:',
      '{',
      '  "summary": "2–4 sentence overview: total customers, mix of types and statuses, any patterns (e.g. many inactive, missing contact info, long since last service).",',
      '  "insights": [',
      '    { "type": "string (e.g. INACTIVE_COUNT, MISSING_CONTACT, NO_RECENT_SERVICE, FLEET_CONCENTRATION, PAYMENT_TERMS)", "title": "short title", "message": "1–2 sentence explanation", "customerIds": ["optional", "ids"] }',
      '  ],',
      '  "recommendations": [',
      '    { "action": "short action label", "detail": "1–2 sentence what to do", "customerIds": ["optional", "ids"] }',
      '  ]',
      '}',
      '',
      'Focus on: inactive vs active mix; customers with missing phone or email; customers with no recent service (or very old last_service_date); concentration by type (FLEET, WALK_IN, etc.); payment terms distribution; credit or billing risks. Keep insights and recommendations concise (3–7 items each). customerIds only when referring to specific customers. Never include markdown or text outside the JSON.'
    ].join('\n');

    const customersSummary = customers.length === 0
      ? 'No customer data provided.'
      : `Customers (${customers.length} total):\n${customers.slice(0, 200).map(c => {
          const lastService = c.last_service_date ?? '—';
          return `  ${c.id || '?'} | ${(c.company_name || '').slice(0, 40)} | ${c.customer_type || '-'} | ${c.status || '-'} | phone=${(c.phone || '').slice(0, 15)} | email=${(c.email || '').slice(0, 25)} | location=${c.default_location_id || '-'} | last_service=${lastService} | payment_terms=${c.payment_terms || '-'}`;
        }).join('\n')}${customers.length > 200 ? '\n  ... (truncated)' : ''}`;

    const startedAt = Date.now();

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: customersSummary }
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
      route: '/api/ai/customers/analysis',
      message: `customers=${customers.length}`,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs
    });

    return res.json(response);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ai-service] customers analysis error', err);

    logAiInteraction({
      userId: null,
      route: '/api/ai/customers/analysis',
      message: null,
      conversationId: null,
      success: false,
      errorCode: 'AI_CUSTOMERS_ANALYSIS_ERROR',
      processingTimeMs: null
    });

    return res.status(502).json({
      success: false,
      error: 'AI customers analysis unavailable',
      code: 'AI_CUSTOMERS_ANALYSIS_ERROR'
    });
  }
}

module.exports = {
  handleCustomersAnalysis
};
