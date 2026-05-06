'use strict';

/**
 * FN-1342 (parent FN-1327) — layout-store preset integration tests.
 *
 * Verifies that `createLayoutStore` reads the role default from the
 * presets-table-backed preset store, and falls back to the hard-coded
 * ROLE_DEFAULTS map when:
 *   - the table has no default row for the role,
 *   - the preset store throws (DB outage / pre-migration deploy),
 *   - or the preset row's layout_json is unusable.
 *
 * Existing route-level tests live in `routes/dashboard-layout.test.js`
 * and use a fully-faked store, so they are unaffected by these changes.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  createLayoutStore,
  ROLE_DEFAULTS,
  normalizeRoleKey
} = require('./layout-store');

function makeUserLayoutsKnex({ row = null } = {}) {
  return function knex(table) {
    assert.strictEqual(table, 'user_dashboard_layouts');
    return {
      where() {
        return this;
      },
      async first() {
        return row;
      }
    };
  };
}

function makePresetStore(byRole = {}, { throwFor } = {}) {
  return {
    calls: [],
    async getDefaultForRole(roleKey) {
      this.calls.push(roleKey);
      if (throwFor && throwFor.has(roleKey)) {
        throw new Error('simulated db outage');
      }
      const hit = byRole[roleKey];
      if (!hit) return null;
      return {
        preset_key: hit.preset_key,
        role_key: roleKey,
        display_name: hit.display_name,
        layout: hit.layout
      };
    }
  };
}

describe('layout-store + preset-store integration (FN-1342)', () => {
  describe('GET path with no per-user row', () => {
    it('returns the preset-table layout for all four shipped role keys', async () => {
      const ownerLayout = { cards: ['owner-from-table'] };
      const dispatcherLayout = { cards: ['dispatcher-from-table'] };
      const safetyLayout = { cards: ['safety-from-table'] };
      const maintenanceLayout = { cards: ['maintenance-from-table'] };
      const presetStore = makePresetStore({
        owner: { preset_key: 'owner-default', display_name: 'Owner', layout: ownerLayout },
        dispatcher: {
          preset_key: 'dispatcher-default',
          display_name: 'Dispatcher',
          layout: dispatcherLayout
        },
        safety: {
          preset_key: 'compliance-default',
          display_name: 'Compliance',
          layout: safetyLayout
        },
        maintenance: {
          preset_key: 'maintenance-default',
          display_name: 'Maintenance',
          layout: maintenanceLayout
        }
      });

      for (const [role, expected] of [
        ['owner', ownerLayout],
        ['dispatcher', dispatcherLayout],
        ['safety', safetyLayout],
        ['maintenance', maintenanceLayout]
      ]) {
        const store = createLayoutStore({
          knex: makeUserLayoutsKnex(),
          presetStore
        });
        const result = await store.getLayout({ userId: 'u', role });
        assert.deepStrictEqual(
          result.layout,
          expected,
          `role=${role} should use preset-table layout`
        );
        assert.strictEqual(result.is_default, true, `role=${role} is_default`);
        assert.strictEqual(result.role, normalizeRoleKey(role), `role=${role} normalize`);
        assert.strictEqual(result.updated_at, null, `role=${role} updated_at`);
      }
    });

    it('returns a deep copy so callers cannot mutate the preset cache', async () => {
      const layout = { cards: ['a', 'b'] };
      const presetStore = makePresetStore({
        dispatcher: { preset_key: 'd', display_name: 'D', layout }
      });
      const store = createLayoutStore({
        knex: makeUserLayoutsKnex(),
        presetStore
      });
      const r1 = await store.getLayout({ userId: 'u', role: 'dispatcher' });
      r1.layout.cards.push('mutated');
      const r2 = await store.getLayout({ userId: 'u', role: 'dispatcher' });
      assert.deepStrictEqual(r2.layout, layout);
    });

    it('falls back to ROLE_DEFAULTS when the presets table has no row for the role', async () => {
      const presetStore = makePresetStore({});
      const store = createLayoutStore({
        knex: makeUserLayoutsKnex(),
        presetStore
      });
      for (const role of ['dispatcher', 'safety', 'maintenance', 'owner']) {
        const result = await store.getLayout({ userId: 'u', role });
        assert.deepStrictEqual(
          result.layout,
          ROLE_DEFAULTS[role],
          `role=${role} should fall back to hard-coded default`
        );
        assert.strictEqual(result.is_default, true);
      }
    });

    it('falls back to ROLE_DEFAULTS when the preset store throws', async () => {
      const presetStore = makePresetStore(
        {
          owner: {
            preset_key: 'owner-default',
            display_name: 'Owner',
            layout: { cards: ['unreachable'] }
          }
        },
        { throwFor: new Set(['owner']) }
      );
      const store = createLayoutStore({
        knex: makeUserLayoutsKnex(),
        presetStore
      });
      const result = await store.getLayout({ userId: 'u', role: 'owner' });
      assert.deepStrictEqual(result.layout, ROLE_DEFAULTS.owner);
      assert.strictEqual(result.is_default, true);
    });

    it('normalizes role aliases before querying the preset store', async () => {
      const presetStore = makePresetStore({
        owner: {
          preset_key: 'owner-default',
          display_name: 'Owner',
          layout: { cards: ['from-owner-row'] }
        }
      });
      const store = createLayoutStore({
        knex: makeUserLayoutsKnex(),
        presetStore
      });
      const result = await store.getLayout({ userId: 'u', role: 'admin' });
      assert.deepStrictEqual(result.layout, { cards: ['from-owner-row'] });
      assert.strictEqual(presetStore.calls[0], 'owner');
    });
  });

  describe('GET path with a malformed per-user row', () => {
    it('uses the preset-table layout when the persisted row is unparseable', async () => {
      const presetStore = makePresetStore({
        safety: {
          preset_key: 'compliance-default',
          display_name: 'Compliance',
          layout: { cards: ['from-table'] }
        }
      });
      const knex = makeUserLayoutsKnex({
        row: { layout_json: 'not-json{', updated_at: '2026-05-05T10:00:00Z' }
      });
      const store = createLayoutStore({ knex, presetStore });
      const result = await store.getLayout({ userId: 'u', role: 'safety' });
      assert.deepStrictEqual(result.layout, { cards: ['from-table'] });
      assert.strictEqual(result.is_default, true);
      assert.strictEqual(result.updated_at, '2026-05-05T10:00:00Z');
    });
  });

  describe('GET path with a valid per-user row', () => {
    it('returns the persisted layout and does not query the preset store', async () => {
      const presetStore = makePresetStore({
        owner: {
          preset_key: 'owner-default',
          display_name: 'Owner',
          layout: { cards: ['from-table'] }
        }
      });
      const persisted = { cards: ['user-custom'] };
      const knex = makeUserLayoutsKnex({
        row: {
          layout_json: JSON.stringify(persisted),
          updated_at: '2026-05-05T11:00:00Z'
        }
      });
      const store = createLayoutStore({ knex, presetStore });
      const result = await store.getLayout({ userId: 'u', role: 'owner' });
      assert.deepStrictEqual(result.layout, persisted);
      assert.strictEqual(result.is_default, false);
      assert.strictEqual(presetStore.calls.length, 0);
    });
  });

  describe('createLayoutStore guards', () => {
    it('throws when knex is not provided', () => {
      assert.throws(
        () => createLayoutStore({ presetStore: makePresetStore({}) }),
        /requires a knex instance/
      );
    });
  });
});
