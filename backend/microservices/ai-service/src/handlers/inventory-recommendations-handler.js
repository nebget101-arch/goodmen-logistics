const { buildSystemPrompt } = require('../prompt');
const { logAiInteraction } = require('../analytics/logger');

/**
 * POST /api/ai/inventory/recommendations
 * Body: { locationName?, onHand: [{ sku, name, on_hand_qty, reserved_qty, available_qty, status?, min_stock_level?, reorder_qty? }], recentTransactions?: [...] }
 * Returns: { reorderSuggestions: [...], anomalies: [...], notes }
 */
async function handleInventoryRecommendations(req, res, deps) {
  try {
    const { openai } = deps;
    const { locationName, onHand = [], recentTransactions = [] } = req.body || {};

    if (!Array.isArray(onHand)) {
      return res.status(400).json({
        success: false,
        error: 'onHand array is required',
        code: 'AI_INVENTORY_BAD_REQUEST'
      });
    }

    const systemPrompt = [
      buildSystemPrompt(),
      '',
      'You are helping a fleet or warehouse manager with inventory at a single location.',
      'You receive the current on-hand inventory (SKU, name, quantities, status) and optionally recent transaction history.',
      'You must respond with exactly two lists and optional notes:',
      '1. reorderSuggestions: Parts that should be reordered. For each: sku, name (or part name), currentQty (available or on-hand), suggestedReorderQty (suggested order quantity), reason (short explanation, e.g. "Out of stock" or "Below min").',
      '2. anomalies: Suspicious or noteworthy patterns. For each: type (e.g. "LOW_STOCK", "OUT_OF_STOCK", "NO_RECENT_ACTIVITY", "LARGE_CONSUMPTION"), partSku (if applicable), message (short description).',
      'Base reorder suggestions on: status OUT or LOW, zero or very low available quantity, and any min_stock_level or reorder_qty if provided.',
      'Keep suggestions concise; suggest a reasonable reorder quantity when current qty is 0 or low (e.g. 2–4 weeks of typical use if unknown).',
      '',
      'IMPORTANT: Respond as a single JSON object ONLY, with this shape:',
      '{',
      '  "reorderSuggestions": [',
      '    { "sku": "string", "name": "string", "currentQty": number, "suggestedReorderQty": number, "reason": "string" }',
      '  ],',
      '  "anomalies": [',
      '    { "type": "string", "partSku": "string or null", "message": "string" }',
      '  ],',
      '  "notes": "short optional summary"',
      '}',
      '',
      'Never include markdown, comments, or any extra text outside the JSON object.'
    ].join('\n');

    const locationContext = locationName ? `Location: ${locationName}.` : 'Location not specified.';
    const onHandSummary = onHand.length === 0
      ? 'No on-hand inventory data provided.'
      : `On-hand (${onHand.length} items):\n${onHand.slice(0, 200).map(r => {
          const s = (r.status || '').toString();
          const min = r.min_stock_level != null ? ` min=${r.min_stock_level}` : '';
          const reorder = r.reorder_qty != null ? ` reorder_qty=${r.reorder_qty}` : '';
          return `  ${r.sku || '?'} | ${(r.name || '').slice(0, 40)} | on_hand=${r.on_hand_qty ?? r.on_hand} | reserved=${r.reserved_qty ?? r.reserved} | available=${r.available_qty ?? r.available ?? '-'} | status=${s}${min}${reorder}`;
        }).join('\n')}`;
    const txSummary = recentTransactions.length === 0
      ? ''
      : `Recent transactions (last ${recentTransactions.length}):\n${recentTransactions.slice(0, 50).map(t =>
          `  ${t.created_at || t.when} ${t.tx_type_effective || t.tx_type || t.transaction_type} ${t.part_sku || ''} qty=${t.qty_change ?? ''}`
        ).join('\n')}`;

    const userMessage = [
      locationContext,
      '',
      onHandSummary,
      txSummary ? '\n' + txSummary : ''
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
    const raw = completion.choices[0]?.message?.content || '{}';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { reorderSuggestions: [], anomalies: [], notes: raw };
    }

    const response = {
      reorderSuggestions: Array.isArray(parsed.reorderSuggestions) ? parsed.reorderSuggestions : [],
      anomalies: Array.isArray(parsed.anomalies) ? parsed.anomalies : [],
      notes: typeof parsed.notes === 'string' ? parsed.notes : ''
    };

    logAiInteraction({
      userId: null,
      route: '/api/ai/inventory/recommendations',
      message: `onHand=${onHand.length}`,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs
    });

    return res.json(response);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ai-service] inventory recommendations error', err);

    logAiInteraction({
      userId: null,
      route: '/api/ai/inventory/recommendations',
      message: null,
      conversationId: null,
      success: false,
      errorCode: 'AI_INVENTORY_ERROR',
      processingTimeMs: null
    });

    return res.status(502).json({
      success: false,
      error: 'AI inventory recommendations unavailable',
      code: 'AI_INVENTORY_ERROR'
    });
  }
}

module.exports = {
  handleInventoryRecommendations
};
