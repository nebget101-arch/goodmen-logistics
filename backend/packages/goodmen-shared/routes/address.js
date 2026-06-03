/**
 * Address autocomplete proxy — SmartyStreets US Autocomplete Pro
 *
 * FN-525: Public route (no JWT) used by the employment application form.
 * Keeps SmartyStreets credentials server-side so they are never exposed
 * to the browser.
 *
 * GET /api/address/autocomplete?q=<partial-address>
 */

const express = require('express');
const axios = require('axios');
const dtLogger = require('../utils/logger');

const router = express.Router();

const SMARTY_BASE_URL = 'https://us-autocomplete-pro.api.smarty.com/lookup';
const MAX_RESULTS = 10;
const MIN_QUERY_LENGTH = 3;
const MAX_QUERY_LENGTH = 100;

router.get('/autocomplete', async (req, res) => {
  const authId = process.env.SMARTY_AUTH_ID;
  const authToken = process.env.SMARTY_AUTH_TOKEN;

  if (!authId || !authToken) {
    dtLogger.warn('SmartyStreets env vars not configured (SMARTY_AUTH_ID / SMARTY_AUTH_TOKEN)');
    return res.status(503).json({
      success: false,
      error: 'Address autocomplete not configured'
    });
  }

  const rawQuery = (req.query.q || '').toString().trim();

  if (rawQuery.length < MIN_QUERY_LENGTH) {
    return res.json({ success: true, data: [] });
  }

  // Basic protection: cap query length
  const q = rawQuery.slice(0, MAX_QUERY_LENGTH);

  try {
    const response = await axios.get(SMARTY_BASE_URL, {
      params: {
        search: q,
        max_results: MAX_RESULTS,
        'auth-id': authId,
        'auth-token': authToken
      },
      timeout: 5000
    });

    const suggestions = (response.data?.suggestions || []).map((s) => ({
      street: s.street_line || '',
      city: s.city || '',
      state: s.state || '',
      zip: s.zipcode || ''
    }));

    return res.json({ success: true, data: suggestions });
  } catch (err) {
    dtLogger.error('SmartyStreets autocomplete request failed', {
      status: err.response?.status,
      message: err.message
    });
    return res.status(502).json({
      success: false,
      error: 'Address lookup failed'
    });
  }
});

module.exports = router;
