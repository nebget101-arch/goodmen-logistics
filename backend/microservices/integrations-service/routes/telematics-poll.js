'use strict';

/**
 * POST /api/telematics/poll — FN-1661
 *
 * Manual / cron trigger for the telematics polling fallback. Intended to be
 * called by an external Render cron job (provisioned by FN-1662) or by an
 * operator. Returns the run summary.
 */

const express = require('express');
const dtLogger = require('@goodmen/shared/utils/logger');
const { runPollingFallback } = require('../services/telematics-polling-service');

const router = express.Router();

/**
 * @openapi
 * /api/telematics/poll:
 *   post:
 *     summary: Run the telematics polling fallback
 *     description: Polls provider REST APIs for stale devices and persists pings.
 *     tags:
 *       - Telematics
 *     responses:
 *       200: { description: Poll run summary }
 */
router.post('/poll', async (req, res) => {
  try {
    const summary = await runPollingFallback();
    return res.json({ success: true, summary });
  } catch (err) {
    dtLogger.error('telematics_poll_route_failed', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

module.exports = router;
