const express = require('express');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const db = require('../internal/db');
const knex = require('../internal/db').knex;
const baseAuth = require('../middleware/auth-middleware');
const authWithRole = require('./auth-middleware');
const requirePlanAccess = require('../middleware/plan-access-middleware');
const { loadUserRbac, requirePermission, requireAnyPermission } = require('../middleware/rbac-middleware');
const { normalizePlanId } = require('../config/plans');

const router = express.Router();
const rbac = [baseAuth, loadUserRbac];
const requireMultiMcPlan = requirePlanAccess('/admin/multi-mc');

function supportsLocationScoping(planId) {
  return planId === 'end_to_end' || planId === 'enterprise';
}

async function getTenantPlanForTenant(tenantId) {
  if (!tenantId) return 'basic';
  const tenantRow = await knex('tenants').where({ id: tenantId }).first('subscription_plan');
  return normalizePlanId(tenantRow?.subscription_plan, 'basic');
}

function normalizeUsername(value) {
  return (value || '').toString().trim().toLowerCase().replace(/\s+/g, '.');
}

const LEGACY_ROLE_TO_CANONICAL = {
  admin: 'super_admin',
  safety: 'safety_manager',
  fleet: 'dispatcher',
  dispatch: 'dispatcher',
  driver: 'driver',
  accounting: 'carrier_accountant',
  service_advisor: 'service_writer'
};

const CANONICAL_ROLE_ALIASES = {
  company_admin: 'super_admin'
};

const ALLOWED_CANONICAL_ROLE_CODES = new Set([
  'super_admin',
  'executive_read_only',
  'dispatch_manager',
  'dispatcher',
  'safety_manager',
  'carrier_accountant',
  'shop_manager',
  'service_writer',
  'shop_clerk',
  'mechanic',
  'technician',
  'parts_manager',
  'parts_clerk',
  'inventory_auditor',
  'company_accountant',
  'driver',
  'customer'
]);

function normalizeRoleCode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  const mappedLegacy = LEGACY_ROLE_TO_CANONICAL[raw] || raw;
  return CANONICAL_ROLE_ALIASES[mappedLegacy] || mappedLegacy;
}

function mapCanonicalRoleToLegacyRole(canonicalRoleCode) {
  const code = normalizeRoleCode(canonicalRoleCode) || 'dispatcher';
  if (code === 'super_admin' || code === 'executive_read_only') return 'admin';
  if (code === 'dispatch_manager' || code === 'dispatcher') return 'dispatch';
  if (code === 'safety_manager') return 'safety';
  if (code === 'driver') return 'driver';
  // For shop/parts/accounting/future roles, keep backward-compatible legacy fallback.
  return 'fleet';
}

async function generateUniqueUsername(base, dbClient) {
  const normalized = normalizeUsername(base);
  if (!normalized) return '';

  const existing = await dbClient.query('SELECT username FROM users WHERE username = $1', [normalized]);
  if (existing.rows.length === 0) return normalized;

  let suffix = 1;
  while (suffix < 1000) {
    const candidate = `${normalized}.${suffix}`;
    const found = await dbClient.query('SELECT username FROM users WHERE username = $1', [candidate]);
    if (found.rows.length === 0) return candidate;
    suffix += 1;
  }
  return `${normalized}.${Date.now()}`;
}

// Get current user (from JWT payload, no DB dependency)
router.get('/me', baseAuth, (req, res) => {
  const payload = req.user || {};
  if (!payload || (!payload.id && !payload.sub)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const data = {
    id: payload.id || payload.sub || null,
    username: payload.username || '',
    first_name: payload.first_name || null,
    last_name: payload.last_name || null,
    email: payload.email || null,
    role: payload.role || null
  };
  res.json({ success: true, data });
});

// Tenant-scoped users list (admin/RBAC)
router.get('/', rbac, requireAnyPermission(['users.view', 'users.manage', 'roles.manage']), async (req, res) => {
  try {
    if (!knex) return res.status(503).json({ success: false, error: 'Database not available' });
    const tenantId = req.context?.tenantId || null;

    const rows = await knex('users')
      .modify((qb) => {
        if (tenantId) qb.where('tenant_id', tenantId);
      })
      .orderBy('first_name', 'asc')
      .orderBy('last_name', 'asc')
      .orderBy('username', 'asc')
      .select('id', 'username', 'first_name', 'last_name', 'email', 'role', 'tenant_id', 'created_at');

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[users] list failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Operating entities list for admin management
router.get('/operating-entities', rbac, requireMultiMcPlan, requireAnyPermission(['users.manage', 'roles.manage']), async (req, res) => {
  try {
    if (!knex) return res.status(503).json({ success: false, error: 'Database not available' });
    const tenantId = req.context?.tenantId || null;
    if (!tenantId) return res.status(403).json({ success: false, error: 'Forbidden: tenant context missing' });

    const rows = await knex('operating_entities')
      .where({ tenant_id: tenantId })
      .orderBy('name', 'asc')
      .select(
        'id',
        'tenant_id',
        'entity_type',
        'name',
        'legal_name',
        'dba_name',
        'mc_number',
        'dot_number',
        'address_line1',
        'city',
        'state',
        'zip_code',
        'is_active',
        'created_at',
        'updated_at'
      );

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[users] list operating entities failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/operating-entities', rbac, requireMultiMcPlan, requireAnyPermission(['users.manage', 'roles.manage']), async (req, res) => {
  try {
    if (!knex) return res.status(503).json({ success: false, error: 'Database not available' });
    const tenantId = req.context?.tenantId || null;
    if (!tenantId) return res.status(403).json({ success: false, error: 'Forbidden: tenant context missing' });

    const {
      name,
      legal_name,
      dba_name,
      mc_number,
      dot_number,
      address_line1,
      city,
      state,
      zip_code,
      entity_type,
      is_active
    } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: 'name is required' });
    }

    const payload = {
      tenant_id: tenantId,
      name: String(name).trim(),
      legal_name: legal_name ? String(legal_name).trim() : null,
      dba_name: dba_name ? String(dba_name).trim() : null,
      mc_number: mc_number ? String(mc_number).trim() : null,
      dot_number: dot_number ? String(dot_number).trim() : null,
      address_line1: address_line1 ? String(address_line1).trim() : null,
      city: city ? String(city).trim() : null,
      state: state ? String(state).trim() : null,
      zip_code: zip_code ? String(zip_code).trim() : null,
      entity_type: entity_type ? String(entity_type).trim() : 'carrier',
      is_active: is_active === false ? false : true
    };

    const [row] = await knex('operating_entities').insert(payload).returning('*');
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({ success: false, error: 'MC/DOT already exists' });
    }
    console.error('[users] create operating entity failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/operating-entities/:entityId', rbac, requireMultiMcPlan, requireAnyPermission(['users.manage', 'roles.manage']), async (req, res) => {
  try {
    if (!knex) return res.status(503).json({ success: false, error: 'Database not available' });
    const tenantId = req.context?.tenantId || null;
    if (!tenantId) return res.status(403).json({ success: false, error: 'Forbidden: tenant context missing' });

    const updates = {};
    const fields = ['name', 'legal_name', 'dba_name', 'mc_number', 'dot_number', 'address_line1', 'city', 'state', 'zip_code', 'entity_type', 'is_active'];
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
        const value = req.body[field];
        if (field === 'is_active') {
          updates[field] = !!value;
        } else if (value == null || String(value).trim() === '') {
          updates[field] = null;
        } else {
          updates[field] = String(value).trim();
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    updates.updated_at = knex.fn.now();

    const [row] = await knex('operating_entities')
      .where({ id: req.params.entityId, tenant_id: tenantId })
      .update(updates)
      .returning('*');

    if (!row) return res.status(404).json({ success: false, error: 'Operating entity not found' });

    res.json({ success: true, data: row });
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({ success: false, error: 'MC/DOT already exists' });
    }
    console.error('[users] update operating entity failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// User operating entity access list (for admin assign UI)
router.get('/:id/operating-entities', rbac, requireMultiMcPlan, requireAnyPermission(['users.manage', 'roles.manage']), async (req, res) => {
  try {
    if (!knex) return res.status(503).json({ success: false, error: 'Database not available' });
    const tenantId = req.context?.tenantId || null;
    if (!tenantId) return res.status(403).json({ success: false, error: 'Forbidden: tenant context missing' });

    const user = await knex('users').where({ id: req.params.id, tenant_id: tenantId }).first('id');
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const entities = await knex('operating_entities as oe')
      .leftJoin('user_operating_entities as uoe', function joinUoe() {
        this.on('uoe.operating_entity_id', '=', 'oe.id').andOn('uoe.user_id', '=', knex.raw('?', [req.params.id]));
      })
      .where('oe.tenant_id', tenantId)
      .orderBy('oe.name', 'asc')
      .select(
        'oe.id',
        'oe.name',
        'oe.mc_number',
        'oe.dot_number',
        'oe.is_active',
        knex.raw('COALESCE(uoe.is_active, false) as assigned'),
        knex.raw('COALESCE(uoe.is_default, false) as is_default')
      );

    res.json({ success: true, data: { userId: req.params.id, entities } });
  } catch (err) {
    console.error('[users] get user operating entities failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Replace user operating entity access and default
router.put('/:id/operating-entities', rbac, requireMultiMcPlan, requireAnyPermission(['users.manage', 'roles.manage']), async (req, res) => {
  try {
    if (!knex) return res.status(503).json({ success: false, error: 'Database not available' });
    const tenantId = req.context?.tenantId || null;
    if (!tenantId) return res.status(403).json({ success: false, error: 'Forbidden: tenant context missing' });

    const user = await knex('users').where({ id: req.params.id, tenant_id: tenantId }).first('id');
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const operatingEntityIds = Array.isArray(req.body?.operatingEntityIds) ? req.body.operatingEntityIds : [];
    const defaultOperatingEntityId = (req.body?.defaultOperatingEntityId || '').toString().trim() || null;

    const allowedEntities = await knex('operating_entities')
      .where('tenant_id', tenantId)
      .whereIn('id', operatingEntityIds)
      .select('id');
    const allowedSet = new Set(allowedEntities.map((row) => row.id));

    if (operatingEntityIds.length !== allowedSet.size) {
      return res.status(400).json({ success: false, error: 'One or more operatingEntityIds are invalid for this tenant' });
    }

    if (defaultOperatingEntityId && !allowedSet.has(defaultOperatingEntityId)) {
      return res.status(400).json({ success: false, error: 'defaultOperatingEntityId must be included in operatingEntityIds' });
    }

    await knex.transaction(async (trx) => {
      await trx('user_operating_entities').where('user_id', req.params.id).del();

      if (operatingEntityIds.length > 0) {
        const rows = operatingEntityIds.map((operatingEntityId) => ({
          user_id: req.params.id,
          operating_entity_id: operatingEntityId,
          is_active: true,
          is_default: defaultOperatingEntityId ? operatingEntityId === defaultOperatingEntityId : false
        }));
        await trx('user_operating_entities').insert(rows);
      }
    });

    const updated = await knex('user_operating_entities as uoe')
      .join('operating_entities as oe', 'oe.id', 'uoe.operating_entity_id')
      .where('uoe.user_id', req.params.id)
      .where('oe.tenant_id', tenantId)
      .orderBy('oe.name', 'asc')
      .select('oe.id', 'oe.name', 'oe.mc_number', 'oe.dot_number', 'uoe.is_default', 'uoe.is_active');

    res.json({ success: true, data: { userId: req.params.id, entities: updated } });
  } catch (err) {
    console.error('[users] put user operating entities failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all technicians (for dropdown selection)
router.get('/technicians', async (req, res) => {
  try {
    const technicians = await db.query(
      'SELECT id, username, first_name, last_name, email FROM users WHERE role IN ($1, $2) ORDER BY username',
      ['safety', 'fleet']
    );
    res.json({ success: true, data: technicians.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch technicians.' });
  }
});

// ---- RBAC: user access (must be before /:id) ----
router.get('/:id/access', rbac, requireAnyPermission(['users.manage', 'roles.manage']), async (req, res) => {
  try {
    if (!knex) return res.status(503).json({ success: false, error: 'Database not available' });
    const tenantId = req.context?.tenantId || null;
    if (!tenantId) return res.status(403).json({ success: false, error: 'Forbidden: tenant context missing' });

    const user = await knex('users').where({ id: req.params.id, tenant_id: tenantId }).first('id');
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    const [roles, locationRows] = await Promise.all([
      knex('user_roles as ur').join('roles as r', 'ur.role_id', 'r.id').where('ur.user_id', req.params.id).select('r.id', 'r.code', 'r.name'),
      knex('user_locations as ul')
        .join('locations as l', 'ul.location_id', 'l.id')
        .where('ul.user_id', req.params.id)
        .andWhere('l.tenant_id', tenantId)
        .select('l.id', 'l.code', 'l.name')
    ]);
    res.json({ success: true, data: { userId: req.params.id, roles, locations: locationRows } });
  } catch (err) {
    console.error('[users] access failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id/roles', rbac, requirePermission('users.manage'), async (req, res) => {
  try {
    if (!knex) return res.status(503).json({ success: false, error: 'Database not available' });
    const user = await knex('users').where('id', req.params.id).first('id');
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    const roleIds = Array.isArray(req.body.roleIds) ? req.body.roleIds : [];
    await knex('user_roles').where('user_id', req.params.id).del();
    if (roleIds.length) {
      await knex('user_roles').insert(roleIds.map((rid) => ({ user_id: req.params.id, role_id: rid })));
    }
    const roles = await knex('user_roles as ur').join('roles as r', 'ur.role_id', 'r.id').where('ur.user_id', req.params.id).select('r.id', 'r.code', 'r.name');
    res.json({ success: true, data: roles });
  } catch (err) {
    console.error('[users] put roles failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id/locations', rbac, requirePermission('users.manage'), async (req, res) => {
  try {
    if (!knex) return res.status(503).json({ success: false, error: 'Database not available' });
    const tenantId = req.context?.tenantId || null;
    if (!tenantId) return res.status(403).json({ success: false, error: 'Forbidden: tenant context missing' });

    const planId = await getTenantPlanForTenant(tenantId);
    if (!supportsLocationScoping(planId)) {
      return res.status(403).json({ success: false, error: 'Location assignment is available only for Advanced and Enterprise plans' });
    }

    const user = await knex('users').where({ id: req.params.id, tenant_id: tenantId }).first('id');
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const locationIds = Array.isArray(req.body.locationIds) ? req.body.locationIds : [];
    if (locationIds.length > 0) {
      const validLocations = await knex('locations')
        .where('tenant_id', tenantId)
        .whereIn('id', locationIds)
        .select('id');
      if (validLocations.length !== locationIds.length) {
        return res.status(400).json({ success: false, error: 'One or more locations are invalid for this tenant' });
      }
    }

    await knex('user_locations').where('user_id', req.params.id).del();
    if (locationIds.length) {
      await knex('user_locations').insert(locationIds.map((lid) => ({ user_id: req.params.id, location_id: lid })));
    }
    const locations = await knex('user_locations as ul')
      .join('locations as l', 'ul.location_id', 'l.id')
      .where('ul.user_id', req.params.id)
      .andWhere('l.tenant_id', tenantId)
      .select('l.id', 'l.code', 'l.name');
    res.json({ success: true, data: locations });
  } catch (err) {
    console.error('[users] put locations failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await db.query(
      'SELECT id, username, first_name, last_name, email, role FROM users WHERE id = $1',
      [id]
    );
    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json({ success: true, data: user.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user.' });
  }
});

// Only admin can create users (legacy role check; RBAC users.manage can be added later)
router.post('/', authWithRole(['admin']), async (req, res) => {
  const { username, password, role, firstName, lastName, email, locationIds } = req.body;
  const roleInputs = Array.isArray(req.body?.roles) && req.body.roles.length
    ? req.body.roles
    : (role ? [role] : []);

  if (!password || roleInputs.length === 0) {
    return res.status(400).json({ error: 'Password and role are required.' });
  }

  const normalizedRoleCodes = Array.from(
    new Set(
      roleInputs
        .map((value) => normalizeRoleCode(value))
        .filter((value) => Boolean(value))
    )
  );

  const invalidRoleCodes = normalizedRoleCodes.filter((code) => !ALLOWED_CANONICAL_ROLE_CODES.has(code));
  if (invalidRoleCodes.length > 0 || normalizedRoleCodes.length === 0) {
    return res.status(400).json({
      error: 'Invalid role.',
      details: {
        invalidRoles: invalidRoleCodes,
        allowedRoles: Array.from(ALLOWED_CANONICAL_ROLE_CODES)
      }
    });
  }

  const primaryRoleCode = normalizedRoleCodes[0];
  const legacyRoleForUsersColumn = mapCanonicalRoleToLegacyRole(primaryRoleCode);

  try {
    const actorUserId = req.user?.id || req.user?.sub;
    if (!actorUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const actor = await knex('users').where({ id: actorUserId }).first('tenant_id');
    const tenantId = actor?.tenant_id || null;
    if (!tenantId) {
      return res.status(403).json({ error: 'Tenant context missing' });
    }

    const tenantPlanId = await getTenantPlanForTenant(tenantId);

    let resolvedUsername = normalizeUsername(username);
    if (!resolvedUsername) {
      const base = `${(firstName || '').trim()}.${(lastName || '').trim()}`;
      resolvedUsername = await generateUniqueUsername(base, db);
    }
    if (!resolvedUsername) {
      return res.status(400).json({ error: 'Username or first/last name is required.' });
    }

    const existing = await db.query('SELECT id FROM users WHERE username = $1', [resolvedUsername]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username already exists.' });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const id = uuidv4();

    const normalizedLocationIds = Array.isArray(locationIds)
      ? locationIds.map((x) => String(x || '').trim()).filter(Boolean)
      : [];

    if (normalizedLocationIds.length > 0 && !supportsLocationScoping(tenantPlanId)) {
      return res.status(400).json({ error: 'Locations are available only for Advanced and Enterprise plans.' });
    }

    await knex.transaction(async (trx) => {
      const [
        hasFirstName,
        hasLastName,
        hasEmail,
        hasTenantId,
        hasCreatedAt,
        hasUpdatedAt
      ] = await Promise.all([
        trx.schema.hasColumn('users', 'first_name'),
        trx.schema.hasColumn('users', 'last_name'),
        trx.schema.hasColumn('users', 'email'),
        trx.schema.hasColumn('users', 'tenant_id'),
        trx.schema.hasColumn('users', 'created_at'),
        trx.schema.hasColumn('users', 'updated_at')
      ]);

      const userInsertPayload = {
        id,
        username: resolvedUsername,
        password_hash,
        role: legacyRoleForUsersColumn
      };

      if (hasFirstName) userInsertPayload.first_name = firstName || null;
      if (hasLastName) userInsertPayload.last_name = lastName || null;
      if (hasEmail) userInsertPayload.email = email || null;
      if (hasTenantId) userInsertPayload.tenant_id = tenantId;
      if (hasCreatedAt) userInsertPayload.created_at = knex.fn.now();
      if (hasUpdatedAt) userInsertPayload.updated_at = knex.fn.now();

      await trx('users').insert(userInsertPayload);

      const [hasRolesTable, hasUserRolesTable] = await Promise.all([
        trx.schema.hasTable('roles'),
        trx.schema.hasTable('user_roles')
      ]);

      if (hasRolesTable && hasUserRolesTable) {
        const roleRows = await trx('roles').whereIn('code', normalizedRoleCodes).select('id', 'code');
        if (roleRows.length > 0) {
          await trx('user_roles').insert(
            roleRows.map((row) => ({ user_id: id, role_id: row.id }))
          );
        }
      }

      if (normalizedLocationIds.length > 0) {
        const validLocations = await trx('locations')
          .where('tenant_id', tenantId)
          .whereIn('id', normalizedLocationIds)
          .select('id');

        if (validLocations.length !== normalizedLocationIds.length) {
          throw new Error('One or more locations are invalid for this tenant.');
        }

        await trx('user_locations').insert(
          normalizedLocationIds.map((locationId) => ({ user_id: id, location_id: locationId }))
        );
      }
    });

    res.status(201).json({ message: 'User created successfully.', username: resolvedUsername });
  } catch (err) {
    if (err?.code === '23505') {
      const detail = String(err?.detail || '').toLowerCase();
      const constraint = String(err?.constraint || '').toLowerCase();

      if (detail.includes('(username)') || constraint.includes('username')) {
        return res.status(409).json({ error: 'Username already exists.' });
      }

      if (detail.includes('(email)') || constraint.includes('email')) {
        return res.status(409).json({ error: 'Email already exists.' });
      }

      return res.status(409).json({ error: 'Duplicate value violates a unique constraint.' });
    }

    if (err?.code === '22P02') {
      return res.status(400).json({ error: 'Invalid id format in request payload.' });
    }

    if (String(err?.message || '').includes('invalid for this tenant')) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[users] create failed', err);
    res.status(500).json({ error: 'Failed to create user.' });
  }
});

module.exports = router;
