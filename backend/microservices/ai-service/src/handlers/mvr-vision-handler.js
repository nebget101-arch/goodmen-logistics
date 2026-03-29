'use strict';

/**
 * FN-477: AI-powered MVR (Motor Vehicle Report) analysis handler.
 * Uses Claude Vision API to extract driving record data from uploaded
 * MVR/PSP report images for pre-hire risk assessment.
 */

const { logAiInteraction } = require('../analytics/logger');

const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

function buildMvrVisionPrompt() {
  return `You are a Motor Vehicle Report (MVR) analyst for a fleet management system called FleetNeuron.

You will be given an image of a driver's MVR (Motor Vehicle Report) or PSP (Pre-Employment Screening Program) report.

## Your Task

Extract ALL driving record data from the image and return a JSON object:

### Output JSON Schema

{
  "driverInfo": {
    "fullName": "<string or null>",
    "dateOfBirth": "<YYYY-MM-DD or null>",
    "licenseNumber": "<string or null>",
    "licenseState": "<2-letter state code or null>",
    "licenseClass": "<CDL class: A, B, C, or non-CDL>",
    "licenseStatus": "<valid, suspended, revoked, expired, or null>",
    "endorsements": ["<H, N, P, T, X, S, etc.>"],
    "restrictions": ["<string>"],
    "reportDate": "<YYYY-MM-DD or null>",
    "reportPeriodYears": <number or null>
  },
  "movingViolations": [
    {
      "date": "<YYYY-MM-DD>",
      "description": "<violation description>",
      "code": "<violation code if visible>",
      "severity": "<minor, major, serious>",
      "points": <number or null>,
      "state": "<2-letter state code>",
      "disposition": "<convicted, dismissed, pending, or null>"
    }
  ],
  "accidents": [
    {
      "date": "<YYYY-MM-DD>",
      "description": "<accident description>",
      "severity": "<property_damage, injury, fatality>",
      "atFault": <boolean or null>,
      "state": "<2-letter state code>"
    }
  ],
  "suspensions": [
    {
      "startDate": "<YYYY-MM-DD>",
      "endDate": "<YYYY-MM-DD or null>",
      "reason": "<reason for suspension>",
      "type": "<suspension, revocation, disqualification>",
      "reinstated": <boolean or null>
    }
  ],
  "riskAssessment": {
    "totalViolations": <number>,
    "totalAccidents": <number>,
    "totalSuspensions": <number>,
    "majorViolationsCount": <number>,
    "redFlags": ["<string describing each concern>"],
    "riskLevel": "<low, medium, high, critical>",
    "hireRecommendation": "<recommend, caution, decline>",
    "hireRecommendationReason": "<1-2 sentence explanation>"
  },
  "confidence": <0.0 to 1.0>,
  "warnings": ["<any extraction uncertainties>"]
}

## Violation Severity Classification

**Serious violations** (CDL-specific):
- Excessive speeding (15+ mph over)
- Reckless driving
- Following too closely
- Lane change violations
- CDL violations

**Major violations**:
- DUI/DWI/OUI
- Hit and run
- Driving while suspended/revoked
- Using vehicle in commission of a felony
- Leaving scene of accident
- Railroad crossing violations

**Minor violations**:
- Speeding (under 15 mph over)
- Failure to signal
- Improper lane change
- Expired registration
- Equipment violations

## Rules

1. Extract EVERY violation, accident, and suspension listed.
2. Dates must be in YYYY-MM-DD format.
3. State codes should be 2-letter uppercase.
4. For risk assessment: 3+ moving violations in 3 years = "high"; any major violation = "high"; DUI/suspension = "critical".
5. Hire recommendation: "decline" for critical risk, "caution" for high, "recommend" for low/medium.
6. If the image is blurry or data partially visible, note in warnings.
7. Return ONLY valid JSON.`;
}

function parseAiResponse(content) {
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  }
  return JSON.parse(cleaned);
}

function validateMvrResult(result) {
  if (!result || typeof result !== 'object') {
    throw new Error('AI returned invalid response structure');
  }
  if (!result.driverInfo) result.driverInfo = {};
  if (!Array.isArray(result.movingViolations)) result.movingViolations = [];
  if (!Array.isArray(result.accidents)) result.accidents = [];
  if (!Array.isArray(result.suspensions)) result.suspensions = [];
  if (!result.riskAssessment) {
    result.riskAssessment = {
      totalViolations: result.movingViolations.length,
      totalAccidents: result.accidents.length,
      totalSuspensions: result.suspensions.length,
      majorViolationsCount: 0,
      redFlags: [],
      riskLevel: 'low',
      hireRecommendation: 'recommend',
      hireRecommendationReason: 'Insufficient data for assessment'
    };
  }
  if (typeof result.confidence !== 'number') result.confidence = 0.5;
  if (!Array.isArray(result.warnings)) result.warnings = [];
  return result;
}

async function handleMvrVision(req, res, deps) {
  const startedAt = Date.now();
  try {
    const { openai } = deps;
    const { imageBase64, mediaType } = req.body || {};

    if (!imageBase64) {
      return res.status(400).json({ success: false, error: 'imageBase64 is required', code: 'AI_BAD_REQUEST' });
    }

    const resolvedMediaType = mediaType || 'image/jpeg';

    const prompt = buildMvrVisionPrompt();

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: 'You are a precise MVR report data extraction assistant. Return ONLY valid JSON.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${resolvedMediaType};base64,${imageBase64}`,
                detail: 'high'
              }
            }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 4096,
    });

    const processingTimeMs = Date.now() - startedAt;
    const aiContent = completion.choices[0]?.message?.content || '{}';

    let result;
    try {
      result = parseAiResponse(aiContent);
      result = validateMvrResult(result);
    } catch (parseErr) {
      console.error('[ai-service] MVR vision parse error', parseErr.message);
      return res.status(502).json({ success: false, error: 'AI returned unparseable response', code: 'AI_PARSE_ERROR' });
    }

    logAiInteraction({
      userId: null,
      route: '/safety/mvr-vision',
      message: `MVR analysis: ${result.movingViolations.length} violations, ${result.accidents.length} accidents, risk=${result.riskAssessment.riskLevel}`,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs,
    });

    return res.json({ success: true, data: result, processingTimeMs });
  } catch (err) {
    const processingTimeMs = Date.now() - startedAt;
    console.error('[ai-service] MVR vision error', err.message || err);

    logAiInteraction({
      userId: null,
      route: '/safety/mvr-vision',
      message: `MVR vision failed: ${err.message || 'Unknown error'}`,
      conversationId: null,
      success: false,
      errorCode: err.status ? `HTTP_${err.status}` : 'AI_ERROR',
      processingTimeMs,
    });

    return res.status(502).json({ success: false, error: 'AI MVR analysis failed', code: 'AI_VISION_ERROR' });
  }
}

module.exports = { handleMvrVision };
