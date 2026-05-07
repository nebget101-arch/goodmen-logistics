'use strict';

/**
 * FN-1455 — live integration test against data.transportation.gov.
 *
 * Skipped by default. Run with `FMCSA_LIVE_TEST=true` (and optionally
 * `FMCSA_SOCRATA_APP_TOKEN=<token>`) to verify that the modern
 * `/resource/{id}.csv` endpoint returns a non-empty CSV page for both the
 * Census and Authority datasets. CI does not set `FMCSA_LIVE_TEST`, so this
 * suite is a no-op there — guarding against accidentally hammering the
 * public Socrata endpoint on every PR.
 */

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const axios = require('axios');

const { DEFAULT_CENSUS_URL } = require('../census');
const { DEFAULT_AUTHORITY_URL } = require('../authority');

const LIVE = process.env.FMCSA_LIVE_TEST === 'true';
const describeLive = LIVE ? describe : describe.skip;

function buildHeaders() {
  const headers = {
    'User-Agent': 'FleetNeuron/fmcsa-importer-live-test (+contact@fleetneuron.app)',
  };
  if (process.env.FMCSA_SOCRATA_APP_TOKEN) {
    headers['X-App-Token'] = process.env.FMCSA_SOCRATA_APP_TOKEN;
  }
  return headers;
}

async function fetchPage(url) {
  return axios.get(url, {
    responseType: 'text',
    timeout: 30000,
    headers: buildHeaders(),
    // Don't throw on 4xx so the assertion below reports the real status.
    validateStatus: () => true,
  });
}

describeLive('FN-1455 FMCSA live source — Socrata /resource endpoint', () => {
  it('census dataset returns 200 + a 5-row CSV page', async () => {
    const url = `${DEFAULT_CENSUS_URL}?$limit=5`;
    const res = await fetchPage(url);
    assert.equal(res.status, 200, `expected 200 from ${url}, got ${res.status}`);
    assert.ok(typeof res.data === 'string' && res.data.length > 0, 'expected non-empty body');
    const lines = res.data.split(/\r?\n/).filter(Boolean);
    assert.ok(lines.length >= 2, `expected header + at least 1 data row, got ${lines.length} lines`);
  });

  it('authority dataset returns 200 + a 5-row CSV page', async () => {
    const url = `${DEFAULT_AUTHORITY_URL}?$limit=5`;
    const res = await fetchPage(url);
    assert.equal(res.status, 200, `expected 200 from ${url}, got ${res.status}`);
    assert.ok(typeof res.data === 'string' && res.data.length > 0, 'expected non-empty body');
    const lines = res.data.split(/\r?\n/).filter(Boolean);
    assert.ok(lines.length >= 2, `expected header + at least 1 data row, got ${lines.length} lines`);
  });
});
