'use strict';

/**
 * FN-1134: Tests for the lightweight auth-context middleware that surfaces
 * role/permissions from the gateway-forwarded JWT or x-user-permissions
 * header.
 */

const assert = require('node:assert/strict');
const {
  loadAuthContext,
  decodeJwtPayload,
  permissionsForRole,
  parseHeaderPermissions,
  ROLE_PERMISSIONS
} = require('../auth-context');

function fakeJwt(payload) {
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${headerB64}.${payloadB64}.signature`;
}

function runCase(name, fn) {
  try {
    fn();
    // eslint-disable-next-line no-console
    console.log(`  ok  ${name}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`  FAIL ${name}`);
    throw err;
  }
}

(() => {
  // eslint-disable-next-line no-console
  console.log('auth-context');

  runCase('decodeJwtPayload: returns payload object on valid format', () => {
    const token = fakeJwt({ id: 'u1', role: 'admin' });
    const out = decodeJwtPayload(`Bearer ${token}`);
    assert.deepEqual(out, { id: 'u1', role: 'admin' });
  });

  runCase('decodeJwtPayload: null on missing Bearer prefix', () => {
    assert.equal(decodeJwtPayload('JWT abc.def.ghi'), null);
  });

  runCase('decodeJwtPayload: null on bad part count', () => {
    assert.equal(decodeJwtPayload('Bearer foo.bar'), null);
  });

  runCase('decodeJwtPayload: null on garbage payload', () => {
    assert.equal(decodeJwtPayload('Bearer aaa.!!!.ccc'), null);
  });

  runCase('permissionsForRole: super_admin → null wildcard', () => {
    assert.equal(permissionsForRole('super_admin'), null);
  });

  runCase('permissionsForRole: known role returns array', () => {
    const out = permissionsForRole('dispatch_manager');
    assert.ok(Array.isArray(out));
    assert.ok(out.includes('reports.view'));
  });

  runCase('permissionsForRole: unknown role returns empty array', () => {
    assert.deepEqual(permissionsForRole('driver'), []);
  });

  runCase('parseHeaderPermissions: trims and splits CSV', () => {
    assert.deepEqual(parseHeaderPermissions('a, b ,c'), ['a', 'b', 'c']);
  });

  runCase('parseHeaderPermissions: returns null on empty', () => {
    assert.equal(parseHeaderPermissions(''), null);
  });

  runCase('loadAuthContext: populates req.user from JWT role', () => {
    const req = { headers: { authorization: 'Bearer ' + fakeJwt({ id: 'u', role: 'dispatch_manager', tenant_id: 't' }) } };
    loadAuthContext(req, null, () => {});
    assert.equal(req.user.id, 'u');
    assert.equal(req.user.role, 'dispatch_manager');
    assert.equal(req.user.tenantId, 't');
    assert.ok(req.user.permissions.includes('reports.view'));
  });

  runCase('loadAuthContext: x-user-permissions header overrides role map', () => {
    const req = {
      headers: {
        authorization: 'Bearer ' + fakeJwt({ id: 'u', role: 'driver' }),
        'x-user-permissions': 'reports.view,custom.thing'
      }
    };
    loadAuthContext(req, null, () => {});
    assert.deepEqual(req.user.permissions, ['reports.view', 'custom.thing']);
  });

  runCase('loadAuthContext: leaves req.user null when no headers', () => {
    const req = { headers: {} };
    loadAuthContext(req, null, () => {});
    assert.equal(req.user, null);
  });

  runCase('loadAuthContext: respects pre-populated req.user', () => {
    const req = { headers: { authorization: 'Bearer ' + fakeJwt({ role: 'admin' }) }, user: { id: 'pre', role: 'tester', permissions: ['x'] } };
    loadAuthContext(req, null, () => {});
    assert.deepEqual(req.user, { id: 'pre', role: 'tester', permissions: ['x'] });
  });

  runCase('ROLE_PERMISSIONS: contains expected reports-viewing roles', () => {
    for (const role of ['admin', 'dispatch_manager', 'executive_read_only', 'driver_supervisor']) {
      const perms = ROLE_PERMISSIONS[role];
      assert.ok(Array.isArray(perms), `expected array for ${role}`);
      assert.ok(perms.includes('reports.view'), `${role} should include reports.view`);
    }
    assert.equal(ROLE_PERMISSIONS.super_admin, null, 'super_admin is null sentinel');
  });

  // eslint-disable-next-line no-console
  console.log('all tests passed');
})();
