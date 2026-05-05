'use strict';

/**
 * FN-1342 (parent FN-1327) — preset-store unit tests.
 *
 * Uses a hand-rolled knex builder mock so we can verify the exact filter
 * shape (`role_key = ? AND is_default_for_role = true`) without spinning
 * up Postgres. The integration with real Postgres is covered by
 * dashboard-layout.test.js's existing in-memory store + the QA subtask
 * (FN-1344) Karate flow.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { createPresetStore } = require('./preset-store');

function makeKnexStub({ rows }) {
  const calls = [];
  function knex(table) {
    const builder = {
      _filter: null,
      where(filter) {
        this._filter = { ...filter };
        return this;
      },
      async first(...columns) {
        calls.push({ table, filter: this._filter, columns });
        const match = rows.find((r) => {
          if (!this._filter) return true;
          return Object.entries(this._filter).every(([k, v]) => r[k] === v);
        });
        if (!match) return undefined;
        return columns.reduce((out, col) => {
          out[col] = match[col];
          return out;
        }, {});
      }
    };
    return builder;
  }
  knex.calls = calls;
  return knex;
}

describe('preset-store (FN-1342)', () => {
  describe('createPresetStore', () => {
    it('throws when knex is not provided', () => {
      assert.throws(() => createPresetStore({}), /requires a knex instance/);
    });
  });

  describe('getDefaultForRole', () => {
    it('returns the parsed layout when a default row exists for the role', async () => {
      const layout = { cards: ['daily-briefing', 'action-queue'] };
      const knex = makeKnexStub({
        rows: [
          {
            preset_key: 'dispatcher-default',
            role_key: 'dispatcher',
            display_name: 'Dispatcher',
            layout_json: layout,
            is_default_for_role: true
          }
        ]
      });
      const store = createPresetStore({ knex });
      const result = await store.getDefaultForRole('dispatcher');
      assert.deepStrictEqual(result, {
        preset_key: 'dispatcher-default',
        role_key: 'dispatcher',
        display_name: 'Dispatcher',
        layout
      });
      assert.deepStrictEqual(knex.calls[0].filter, {
        role_key: 'dispatcher',
        is_default_for_role: true
      });
      assert.deepStrictEqual(knex.calls[0].columns, [
        'preset_key',
        'role_key',
        'display_name',
        'layout_json'
      ]);
      assert.strictEqual(knex.calls[0].table, 'dashboard_layout_presets');
    });

    it('parses layout_json when stored as a string (defensive)', async () => {
      const layout = { cards: ['quick-actions'] };
      const knex = makeKnexStub({
        rows: [
          {
            preset_key: 'owner-default',
            role_key: 'owner',
            display_name: 'Owner',
            layout_json: JSON.stringify(layout),
            is_default_for_role: true
          }
        ]
      });
      const store = createPresetStore({ knex });
      const result = await store.getDefaultForRole('owner');
      assert.deepStrictEqual(result.layout, layout);
    });

    it('returns null when no default row exists for the role', async () => {
      const knex = makeKnexStub({ rows: [] });
      const store = createPresetStore({ knex });
      const result = await store.getDefaultForRole('maintenance');
      assert.strictEqual(result, null);
    });

    it('returns null when the matching row has malformed layout_json', async () => {
      const knex = makeKnexStub({
        rows: [
          {
            preset_key: 'broken',
            role_key: 'safety',
            display_name: 'Broken',
            layout_json: 'not-json{',
            is_default_for_role: true
          }
        ]
      });
      const store = createPresetStore({ knex });
      const result = await store.getDefaultForRole('safety');
      assert.strictEqual(result, null);
    });

    it('returns null when layout_json is an array (must be an object)', async () => {
      const knex = makeKnexStub({
        rows: [
          {
            preset_key: 'arr',
            role_key: 'safety',
            display_name: 'Arr',
            layout_json: [1, 2, 3],
            is_default_for_role: true
          }
        ]
      });
      const store = createPresetStore({ knex });
      const result = await store.getDefaultForRole('safety');
      assert.strictEqual(result, null);
    });

    it('returns null for empty/invalid role keys without hitting the DB', async () => {
      const knex = makeKnexStub({
        rows: [
          {
            preset_key: 'owner-default',
            role_key: 'owner',
            display_name: 'Owner',
            layout_json: { cards: [] },
            is_default_for_role: true
          }
        ]
      });
      const store = createPresetStore({ knex });
      assert.strictEqual(await store.getDefaultForRole(''), null);
      assert.strictEqual(await store.getDefaultForRole(null), null);
      assert.strictEqual(await store.getDefaultForRole(undefined), null);
      assert.strictEqual(await store.getDefaultForRole(42), null);
      assert.strictEqual(knex.calls.length, 0, 'must not query for invalid role');
    });
  });
});
