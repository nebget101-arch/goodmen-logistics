'use strict';

/**
 * FN-478: Claude Vision PSP report extraction HTTP handler.
 * Uses the native Anthropic SDK for image/PDF document support.
 * Accepts a PSP report as base64 and extracts structured inspection + crash data.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { logAiInteraction } = require('../analytics/logger');
const { PSP_EXTRACTION_PROMPT, normalizeExtraction } = require('../../../../packages/goodmen-shared/services/psp-extraction-service');

const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

// Lazy-init Anthropic client
let anthropicClient = null;
function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic.default({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropicClient;
}

async function handlePspReportVision(req, res, _deps) {
  const startedAt = Date.now();
  try {
    const client = getAnthropicClient();
    const { fileBase64, mediaType } = req.body || {};

    if (!fileBase64) {
      return res.status(400).json({
        success: false,
        error: 'fileBase64 is required',
        code: 'AI_BAD_REQUEST',
      });
    }

    const resolvedMediaType = (mediaType || 'image/jpeg').toLowerCase();
    if (!SUPPORTED_MEDIA_TYPES.includes(resolvedMediaType)) {
      return res.status(400).json({
        success: false,
        error: `Unsupported media type: ${resolvedMediaType}. Supported: ${SUPPORTED_MEDIA_TYPES.join(', ')}`,
        code: 'AI_BAD_REQUEST',
      });
    }

    const isPdf = resolvedMediaType === 'application/pdf';
    const contentBlock = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } }
      : { type: 'image', source: { type: 'base64', media_type: resolvedMediaType, data: fileBase64 } };

    const model = process.env.ANTHROPIC_VISION_MODEL || 'claude-sonnet-4-20250514';

    const message = await client.messages.create({
      model,
      max_tokens: 8192,
      system: 'You are a precise PSP report data extraction assistant. Return ONLY valid JSON.',
      messages: [
        {
          role: 'user',
          content: [contentBlock, { type: 'text', text: PSP_EXTRACTION_PROMPT }],
        },
      ],
      temperature: 0.1,
    });

    const processingTimeMs = Date.now() - startedAt;
    const aiContent = message.content[0]?.text || '{}';

    let result;
    try {
      let raw = aiContent.trim();
      if (raw.startsWith('```')) {
        raw = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      result = normalizeExtraction(JSON.parse(raw));
    } catch (parseErr) {
      console.error('[ai-service] PSP vision parse error', parseErr.message);
      return res.status(502).json({
        success: false,
        error: 'AI returned unparseable response',
        code: 'AI_PARSE_ERROR',
      });
    }

    logAiInteraction({
      userId: null,
      route: '/drivers/psp-vision',
      message: `PSP extraction: ${result.inspections.length} inspections, ${result.crashes.length} crashes`,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs,
    });

    return res.json({
      success: true,
      data: result,
      processingTimeMs,
    });
  } catch (err) {
    const processingTimeMs = Date.now() - startedAt;
    console.error('[ai-service] PSP vision error', err.message || err);

    logAiInteraction({
      userId: null,
      route: '/drivers/psp-vision',
      message: `PSP vision failed: ${err.message || 'Unknown error'}`,
      conversationId: null,
      success: false,
      errorCode: err.status ? `HTTP_${err.status}` : 'AI_ERROR',
      processingTimeMs,
    });

    return res.status(502).json({
      success: false,
      error: 'AI PSP report extraction failed',
      code: 'AI_VISION_ERROR',
      details: err.message || 'Unknown error',
    });
  }
}

module.exports = { handlePspReportVision };
