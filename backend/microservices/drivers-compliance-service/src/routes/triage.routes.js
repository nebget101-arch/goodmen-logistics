'use strict';

const express = require('express');
const router = express.Router();
const { postTriage, getTriage } = require('../controllers/triage.controller');

/**
 * @openapi
 * /api/incidents/{id}/triage:
 *   post:
 *     summary: Run AI triage for an incident
 *     description: Calls ai-service triage and persists the result. Each call creates a new audit row (insert-only).
 *     tags:
 *       - Triage
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roadside incident (call) ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               incidentSummary:
 *                 type: string
 *               additionalContext:
 *                 type: object
 *     responses:
 *       201:
 *         description: Triage result created
 *       400:
 *         description: Missing tenant context
 *       500:
 *         description: AI service or DB error
 */
router.post('/:id/triage', postTriage);

/**
 * @openapi
 * /api/incidents/{id}/triage:
 *   get:
 *     summary: Get latest triage record for an incident
 *     description: Returns the most recent triage result for the incident, scoped by tenant.
 *     tags:
 *       - Triage
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roadside incident (call) ID
 *     responses:
 *       200:
 *         description: Latest triage record
 *       400:
 *         description: Missing tenant context
 *       404:
 *         description: No triage record found
 *       500:
 *         description: DB error
 */
router.get('/:id/triage', getTriage);

module.exports = router;
