'use strict';

const express = require('express');
const { handleRoadsideTriage } = require('../triage/triage.controller');

function buildTriageRouter(deps) {
  const router = express.Router();

  /**
   * @openapi
   * /api/ai/roadside/triage:
   *   post:
   *     summary: AI roadside incident triage (FN-1215)
   *     description: >
   *       Classifies an inbound roadside assistance incident into severity,
   *       serviceCategory, urgency, and required vendorSkills using Anthropic
   *       Claude with prompt caching on the system + policy blocks. PII in the
   *       description is scrubbed before the model call. Returns a structured
   *       triage record with audit fields (prompt_version, model_name,
   *       cache_read_tokens, cache_creation_tokens, latency_ms).
   *     tags:
   *       - AI
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - tenantId
   *               - description
   *             properties:
   *               tenantId:
   *                 type: string
   *               description:
   *                 type: string
   *                 description: Free-text incident description from driver or dispatcher
   *               vehicleType:
   *                 type: string
   *                 description: e.g. "semi", "pickup", "box truck"
   *               location:
   *                 type: string
   *                 description: e.g. "I-35 northbound near exit 42"
   *     responses:
   *       200:
   *         description: Structured triage record
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     severity:
   *                       type: string
   *                       enum: [CRITICAL, HIGH, MEDIUM, LOW]
   *                     serviceCategory:
   *                       type: string
   *                       enum: [TOWING, TIRE_CHANGE, JUMP_START, FUEL_DELIVERY, LOCKOUT, ACCIDENT_RECOVERY, MECHANICAL, OTHER]
   *                     urgency:
   *                       type: string
   *                       enum: [IMMEDIATE, WITHIN_HOUR, SCHEDULED]
   *                     vendorSkills:
   *                       type: array
   *                       items:
   *                         type: string
   *                     rationale:
   *                       type: string
   *                     safetyRisk:
   *                       type: boolean
   *                     prompt_version:
   *                       type: string
   *                     model_name:
   *                       type: string
   *                     cache_read_tokens:
   *                       type: integer
   *                     cache_creation_tokens:
   *                       type: integer
   *                     latency_ms:
   *                       type: integer
   *       400:
   *         description: Missing tenantId or description
   *       502:
   *         description: AI upstream or parse failure
   */
  router.post('/', (req, res) => handleRoadsideTriage(req, res, deps));

  return router;
}

module.exports = { buildTriageRouter };
