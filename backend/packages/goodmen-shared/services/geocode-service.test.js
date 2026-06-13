'use strict';

/**
 * FN-1761 — Tests for the forward-geocode service.
 *
 * Nominatim HTTP is mocked via the `opts.search` injection (never touches the
 * network). Covers: row → wire mapping, invalid-coordinate filtering, the
 * cache-hit path (a repeat query within the TTL does not re-call upstream),
 * blank-query short-circuit, and `address_id` enrichment against the tenant's
 * saved `locations` (matched / unmatched) via the injected `query` bridge.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const shared = require('../index');
const geocode = require('./geocode-service');

// A Nominatim `/search` response (format=jsonv2): two hits, one with bad coords.
const NOMINATIM_ROWS = [
  {
    display_name: '1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA',
    lat: '37.4220',
    lon: '-122.0841',
    type: 'house',
    category: 'building',
  },
  {
    display_name: 'Mountain View, Santa Clara County, CA, USA',
    lat: '37.3861',
    lon: '-122.0839',
    type: 'administrative',
  },
  // Malformed — must be dropped.
  { display_name: 'Nowhere', lat: 'NaN', lon: '', type: 'x' },
];

function makeSearch() {
  const fn = async () => NOMINATIM_ROWS;
  const spy = (...args) => {
    spy.calls += 1;
    return fn(...args);
  };
  spy.calls = 0;
  return spy;
}

function setQuery(rows) {
  shared.setDatabase({ query: async () => ({ rows }) });
}

describe('geocode-service (FN-1761)', () => {
  beforeEach(() => {
    geocode.clearCache();
    setQuery([]); // default: no saved locations → no address_id
  });

  it('maps Nominatim rows to wire shape and drops invalid coordinates', async () => {
    const { results, cached } = await geocode.geocode('1600 Amphitheatre', {
      search: makeSearch(),
    });
    assert.strictEqual(cached, false);
    assert.strictEqual(results.length, 2); // malformed row dropped
    assert.deepStrictEqual(results[0], {
      label: '1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA',
      lat: 37.422,
      lng: -122.0841,
      type: 'house',
    });
  });

  it('returns [] for a blank query without calling upstream', async () => {
    const search = makeSearch();
    const { results } = await geocode.geocode('   ', { search });
    assert.deepStrictEqual(results, []);
    assert.strictEqual(search.calls, 0);
  });

  it('serves a repeat query from cache (no second upstream call)', async () => {
    const search = makeSearch();
    const first = await geocode.geocode('Mountain View', { search });
    assert.strictEqual(first.cached, false);

    const second = await geocode.geocode('  mountain   VIEW ', { search }); // same normalized key
    assert.strictEqual(second.cached, true);
    assert.strictEqual(search.calls, 1); // upstream hit exactly once
    assert.deepStrictEqual(second.results, first.results);
  });

  it('re-fetches after clearCache', async () => {
    const search = makeSearch();
    await geocode.geocode('Mountain View', { search });
    geocode.clearCache();
    const again = await geocode.geocode('Mountain View', { search });
    assert.strictEqual(again.cached, false);
    assert.strictEqual(search.calls, 2);
  });

  it('stamps address_id when a result matches a tenant location', async () => {
    setQuery([
      { id: 'loc-1', address: '1600 Amphitheatre Pkwy' },
      { id: 'loc-2', address: '999 Unrelated Rd' },
    ]);
    const { results } = await geocode.geocode('amph', {
      search: makeSearch(),
      context: { tenantId: 'tenant-1' },
    });
    assert.strictEqual(results[0].address_id, 'loc-1');
    assert.strictEqual(results[1].address_id, undefined); // no location matches hit #2
  });

  it('leaves address_id unset when no tenant context is supplied', async () => {
    setQuery([{ id: 'loc-1', address: '1600 Amphitheatre Pkwy' }]);
    const { results } = await geocode.geocode('amph', { search: makeSearch() });
    assert.strictEqual(results[0].address_id, undefined);
  });

  describe('countryCodes (FN-1773 — US restriction)', () => {
    const ENV = 'GEOCODER_COUNTRY_CODES';
    function withEnv(value, fn) {
      const prev = process.env[ENV];
      if (value === undefined) delete process.env[ENV];
      else process.env[ENV] = value;
      try {
        fn();
      } finally {
        if (prev === undefined) delete process.env[ENV];
        else process.env[ENV] = prev;
      }
    }

    it('defaults to "us" when GEOCODER_COUNTRY_CODES is unset', () => {
      withEnv(undefined, () => assert.strictEqual(geocode.countryCodes(), 'us'));
    });

    it('honors the override and normalizes (lowercase, no spaces)', () => {
      withEnv(' US, CA , MX ', () =>
        assert.strictEqual(geocode.countryCodes(), 'us,ca,mx')
      );
    });

    it('returns "" (global) when explicitly set blank', () => {
      withEnv('', () => assert.strictEqual(geocode.countryCodes(), ''));
    });
  });

  describe('buildSearchParams (FN-1773 — country + API key wiring)', () => {
    function withEnv(vars, fn) {
      const prev = {};
      for (const [k, v] of Object.entries(vars)) {
        prev[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      try {
        fn();
      } finally {
        for (const [k, v] of Object.entries(prev)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }
    }

    it('includes countrycodes by default and no key when GEOCODER_API_KEY is unset', () => {
      withEnv({ GEOCODER_COUNTRY_CODES: undefined, GEOCODER_API_KEY: undefined }, () => {
        const p = geocode.buildSearchParams('dallas', 5);
        assert.strictEqual(p.q, 'dallas');
        assert.strictEqual(p.format, 'jsonv2');
        assert.strictEqual(p.countrycodes, 'us');
        assert.strictEqual('key' in p, false);
      });
    });

    it('attaches the API key under the default "key" param when set', () => {
      withEnv({ GEOCODER_API_KEY: 'secret123', GEOCODER_API_KEY_PARAM: undefined }, () => {
        const p = geocode.buildSearchParams('dallas', 5);
        assert.strictEqual(p.key, 'secret123');
      });
    });

    it('honors a custom API-key param name', () => {
      withEnv({ GEOCODER_API_KEY: 'secret123', GEOCODER_API_KEY_PARAM: 'apiKey' }, () => {
        const p = geocode.buildSearchParams('dallas', 5);
        assert.strictEqual(p.apiKey, 'secret123');
        assert.strictEqual('key' in p, false);
      });
    });

    it('omits countrycodes when GEOCODER_COUNTRY_CODES is blank (global)', () => {
      withEnv({ GEOCODER_COUNTRY_CODES: '' }, () => {
        const p = geocode.buildSearchParams('dallas', 5);
        assert.strictEqual('countrycodes' in p, false);
      });
    });
  });
});
