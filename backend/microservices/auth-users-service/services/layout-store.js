'use strict';

/**
 * FN-1172 (parent FN-1130) — Control Center per-user layout store.
 *
 * Reads/writes `user_dashboard_layouts` (see migration
 * 20260504200000_create_user_dashboard_layouts.js) and exposes the
 * role-based default layout used when a user has not yet persisted one.
 *
 * The default-layout shape is intentionally a simple ordered list of
 * card identifiers; per-role content variants (e.g. Smart Alerts filter
 * by HOS vs maintenance) are applied on the frontend (FN-1171).
 *
 * FN-1342 (parent FN-1327): the role default is now sourced from the
 * `dashboard_layout_presets` table via `preset-store.js`. The hard-coded
 * ROLE_DEFAULTS map below is retained as a rollback-safe last-resort
 * fallback used when the table is empty, the row is malformed, or the
 * query fails.
 */

const { createPresetStore } = require('./preset-store');

const ROLE_DEFAULTS = Object.freeze({
  dispatcher: {
    cards: ['daily-briefing', 'action-queue', 'predictive-insights', 'quick-actions']
  },
  safety: {
    cards: ['daily-briefing', 'action-queue', 'predictive-insights', 'quick-actions']
  },
  maintenance: {
    cards: ['daily-briefing', 'action-queue', 'predictive-insights', 'quick-actions']
  },
  owner: {
    cards: ['daily-briefing', 'predictive-insights', 'action-queue', 'quick-actions']
  }
});

const DEFAULT_ROLE_KEY = 'dispatcher';

const ROLE_ALIASES = Object.freeze({
  dispatcher: 'dispatcher',
  dispatch: 'dispatcher',
  safety: 'safety',
  safety_manager: 'safety',
  maintenance: 'maintenance',
  mechanic: 'maintenance',
  technician: 'maintenance',
  owner: 'owner',
  admin: 'owner',
  super_admin: 'owner',
  platform_admin: 'owner',
  accounting: 'owner'
});

function normalizeRoleKey(role) {
  if (!role || typeof role !== 'string') return DEFAULT_ROLE_KEY;
  const key = role.trim().toLowerCase();
  return ROLE_ALIASES[key] || DEFAULT_ROLE_KEY;
}

function getRoleDefault(role) {
  const key = normalizeRoleKey(role);
  return JSON.parse(JSON.stringify(ROLE_DEFAULTS[key]));
}

function parseLayoutJson(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (_err) {
      return null;
    }
  }
  return value;
}

async function resolveRoleDefaultLayout({ presetStore, role }) {
  const roleKey = normalizeRoleKey(role);
  if (presetStore && typeof presetStore.getDefaultForRole === 'function') {
    try {
      const preset = await presetStore.getDefaultForRole(roleKey);
      if (preset && preset.layout) {
        return JSON.parse(JSON.stringify(preset.layout));
      }
    } catch (err) {
      // Defense-in-depth: presets table missing/unavailable falls through
      // to the hard-coded ROLE_DEFAULTS map. This preserves the FN-1172
      // behavior contract during DB outages or pre-migration deploys.
      console.warn(
        '[layout-store] preset lookup failed, falling back to ROLE_DEFAULTS',
        err && err.message ? err.message : err
      );
    }
  }
  return getRoleDefault(role);
}

function createLayoutStore({ knex, presetStore } = {}) {
  if (!knex) throw new Error('layout-store requires a knex instance');
  const presets = presetStore || createPresetStore({ knex });

  async function getLayout({ userId, role }) {
    const row = await knex('user_dashboard_layouts')
      .where({ user_id: userId })
      .first('layout_json', 'updated_at');

    if (!row) {
      return {
        layout: await resolveRoleDefaultLayout({ presetStore: presets, role }),
        is_default: true,
        role: normalizeRoleKey(role),
        updated_at: null
      };
    }

    const parsed = parseLayoutJson(row.layout_json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        layout: await resolveRoleDefaultLayout({ presetStore: presets, role }),
        is_default: true,
        role: normalizeRoleKey(role),
        updated_at: row.updated_at || null
      };
    }

    return {
      layout: parsed,
      is_default: false,
      role: normalizeRoleKey(role),
      updated_at: row.updated_at || null
    };
  }

  async function putLayout({ userId, tenantId, role, layout }) {
    const now = new Date();
    const serialized = JSON.stringify(layout);

    await knex('user_dashboard_layouts')
      .insert({
        user_id: userId,
        tenant_id: tenantId,
        layout_json: serialized,
        updated_at: now
      })
      .onConflict('user_id')
      .merge({
        tenant_id: tenantId,
        layout_json: serialized,
        updated_at: now
      });

    return {
      layout,
      is_default: false,
      role: normalizeRoleKey(role),
      updated_at: now.toISOString()
    };
  }

  async function deleteLayout({ userId }) {
    return knex('user_dashboard_layouts').where({ user_id: userId }).del();
  }

  return { getLayout, putLayout, deleteLayout };
}

module.exports = {
  createLayoutStore,
  getRoleDefault,
  normalizeRoleKey,
  resolveRoleDefaultLayout,
  ROLE_DEFAULTS,
  DEFAULT_ROLE_KEY
};
