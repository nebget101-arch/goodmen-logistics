'use strict';

/**
 * Unit tests for security layer helpers.
 *
 * Run:
 *   cd backend/microservices/integrations-service
 *   node --test services/inbound-email-security.test.js
 *
 * Only pure logic (`matchesWhitelist`) is exercised without stubbing knex.
 * The DB-touching helpers (`checkRateLimit`, `checkWhitelist`, CRUD) are
 * covered by the QA E2E in FN-763, and ClamAV over TCP is covered by manual
 * smoke tests documented in docs/stories/FN-729.md deployment section.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Avoid requiring knex pool when importing security helpers by stubbing
// the shared-config/knex module resolver to a fake before the first require.
const Module = require('module');
const originalResolve = Module._resolveFilename.bind(Module);
Module._resolveFilename = function patched(request, parent, ...rest) {
  if (request === '@goodmen/shared/config/knex') {
    return require.resolve('./__fixtures__/fake-knex.js');
  }
  if (request === '@goodmen/shared/utils/logger') {
    return require.resolve('./__fixtures__/fake-logger.js');
  }
  return originalResolve(request, parent, ...rest);
};

const { matchesWhitelist } = require('./inbound-email-security');

describe('matchesWhitelist', () => {
  it('matches exact address case-insensitively', () => {
    const rows = [{ pattern: 'ops@broker.com', is_domain: false }];
    assert.equal(matchesWhitelist('OPS@broker.com', rows), true);
    assert.equal(matchesWhitelist('other@broker.com', rows), false);
  });

  it('matches `@domain` entries against sender domain', () => {
    const rows = [{ pattern: '@broker.com', is_domain: true }];
    assert.equal(matchesWhitelist('ops@broker.com', rows), true);
    assert.equal(matchesWhitelist('ops@otherbroker.com', rows), false);
  });

  it('detects domain pattern even if `is_domain` flag missing', () => {
    const rows = [{ pattern: '@broker.com' }];
    assert.equal(matchesWhitelist('ops@broker.com', rows), true);
  });

  it('returns false when sender empty or rows empty', () => {
    assert.equal(matchesWhitelist('', [{ pattern: 'ops@a.com' }]), false);
    assert.equal(matchesWhitelist('ops@a.com', []), false);
    assert.equal(matchesWhitelist('ops@a.com', null), false);
  });

  it('ignores blank pattern rows', () => {
    const rows = [{ pattern: '', is_domain: false }, { pattern: 'ops@a.com' }];
    assert.equal(matchesWhitelist('ops@a.com', rows), true);
  });
});
