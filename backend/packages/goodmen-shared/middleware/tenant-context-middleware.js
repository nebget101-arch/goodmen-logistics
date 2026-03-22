'use strict';

const knex = require('../config/knex');
const dtLogger = require('../utils/logger');

/** Avoid Postgres uuid cast errors when auth passes a non-UUID (e.g. dev mock user id). */
function looksLikeUuid(value) {
  if (value == null || typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

async function resolveTenantForUser(knexClient, userId) {
  let memberships = [];
  const hasMembershipsTable = await knexClient.schema.hasTable('user_tenant_memberships').catch(() => false);
  if (hasMembershipsTable) {
    memberships = await knexClient('user_tenant_memberships')
      .where({ user_id: userId, is_active: true })
      .orderBy('is_default', 'desc')
      .orderBy('created_at', 'asc');
  }

  if (memberships.length === 1) {
    return memberships[0].tenant_id;
  }

  if (memberships.length > 1) {
    const def = memberships.find((m) => m.is_default);
    return (def || memberships[0]).tenant_id;
  }

  // Transition compatibility: fallback to users.tenant_id if membership rows are not yet seeded.
  const userRow = await knexClient('users').where({ id: userId }).select('tenant_id').first();
  if (userRow?.tenant_id) {
    return userRow.tenant_id;
  }

  // Last fallback: first active tenant in system.
  const tenant = await knexClient('tenants').where({ status: 'active' }).orderBy('created_at', 'asc').first();
  return tenant?.id || null;
}

async function resolveEntityAccessForUser(knexClient, userId, tenantId) {
  const hasUoe = await knexClient.schema.hasTable('user_operating_entities').catch(() => false);
  const hasOe = await knexClient.schema.hasTable('operating_entities').catch(() => false);
  if (!hasUoe || !hasOe) {
    return { allowedOperatingEntityIds: [], defaultEntityId: null };
  }

  const rows = await knexClient('user_operating_entities as uoe')
    .join('operating_entities as oe', 'oe.id', 'uoe.operating_entity_id')
    .where('uoe.user_id', userId)
    .andWhere('uoe.is_active', true)
    .andWhere('oe.is_active', true)
    .modify((qb) => {
      if (tenantId) qb.andWhere('oe.tenant_id', tenantId);
    })
    .select('uoe.operating_entity_id', 'uoe.is_default')
    .orderBy('uoe.is_default', 'desc')
    .orderBy('uoe.created_at', 'asc');

  const allowedOperatingEntityIds = rows.map((row) => row.operating_entity_id);
  const defaultEntityId = (rows.find((row) => row.is_default) || rows[0])?.operating_entity_id || null;

  return { allowedOperatingEntityIds, defaultEntityId };
}

async function isGlobalAdminUser(knexClient, userId, tokenRole) {
  const normalizedTokenRole = (tokenRole || '').toString().trim().toLowerCase();
  // Treat only true platform-level roles as global admins.
  // Do NOT consider generic 'admin' tenant roles as global admin for scoping purposes.
  if (normalizedTokenRole === 'super_admin' || normalizedTokenRole === 'platform_admin') return true;

  const userRow = await knexClient('users').where({ id: userId }).select('role').first();
  const legacyRole = (userRow?.role || '').toString().trim().toLowerCase();
  if (legacyRole === 'super_admin' || legacyRole === 'platform_admin') return true;

  const hasUserRolesTable = await knexClient.schema.hasTable('user_roles');
  const hasRolesTable = await knexClient.schema.hasTable('roles');
  if (!hasUserRolesTable || !hasRolesTable) return false;

  const platformRole = await knexClient('user_roles as ur')
    .join('roles as r', 'r.id', 'ur.role_id')
    .where('ur.user_id', userId)
    .whereIn('r.code', ['super_admin', 'platform_admin'])
    .first('ur.id');

  return !!platformRole;
}

async function isTenantAdminUser(knexClient, userId, tokenRole, tenantId) {
  const normalizedTokenRole = (tokenRole || '').toString().trim().toLowerCase();
  if (normalizedTokenRole === 'admin') return true;

  const userRow = await knexClient('users').where({ id: userId }).select('role').first();
  const legacyRole = (userRow?.role || '').toString().trim().toLowerCase();
  if (legacyRole === 'admin') return true;

  const hasUserRolesTable = await knexClient.schema.hasTable('user_roles');
  const hasRolesTable = await knexClient.schema.hasTable('roles');
  if (!hasUserRolesTable || !hasRolesTable) return false;

  const tenantAdminRole = await knexClient('user_roles as ur')
    .join('roles as r', 'r.id', 'ur.role_id')
    .where('ur.user_id', userId)
    .where('r.code', 'admin')
    .first('ur.id');

  return !!tenantAdminRole;
}

async function countConfiguredEntityAssignments(knexClient, userId, tenantId) {
  const hasUoe = await knexClient.schema.hasTable('user_operating_entities').catch(() => false);
  const hasOe = await knexClient.schema.hasTable('operating_entities').catch(() => false);
  if (!hasUoe || !hasOe) return 0;

  const rows = await knexClient('user_operating_entities as uoe')
    .join('operating_entities as oe', 'oe.id', 'uoe.operating_entity_id')
    .where('uoe.user_id', userId)
    .modify((qb) => {
      if (tenantId) qb.andWhere('oe.tenant_id', tenantId);
    })
    .select('uoe.id');

  return rows.length;
}

async function listActiveTenantEntities(knexClient, tenantId) {
  const hasOe = await knexClient.schema.hasTable('operating_entities').catch(() => false);
  if (!hasOe) return [];

  return knexClient('operating_entities')
    .where({ tenant_id: tenantId, is_active: true })
    .orderBy('created_at', 'asc')
    .select('id');
}

function createTenantContextMiddleware({ knexClient = knex, logger = dtLogger } = {}) {
  return async function tenantContextMiddleware(req, res, next) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return next();
      }

      if (!looksLikeUuid(String(userId))) {
        logger.warn('tenant_context_invalid_user_id', { userId: String(userId) });
        return res.status(403).json({ error: 'Invalid session user id; sign in again or use a valid account token.' });
      }

      const tenantId = await resolveTenantForUser(knexClient, userId);
      if (!tenantId) {
        res.setHeader('X-Debug-Tenant', tenantId || 'null');
        res.setHeader('X-Debug-User', userId || 'null');
        return res.status(403).json({ error: 'Forbidden: tenant access not configured' });
      }

      const isGlobalAdmin = await isGlobalAdminUser(knexClient, userId, req.user?.role);

      let { allowedOperatingEntityIds, defaultEntityId } = await resolveEntityAccessForUser(knexClient, userId, tenantId);

      if (isGlobalAdmin) {
        const allActiveTenantEntities = await listActiveTenantEntities(knexClient, tenantId);
        const allIds = allActiveTenantEntities.map((row) => row.id);
        if (allIds.length > 0) {
          allowedOperatingEntityIds = allIds;
          if (!defaultEntityId || !allowedOperatingEntityIds.includes(defaultEntityId)) {
            defaultEntityId = allIds[0] || null;
          }
        }
      } else {
        // If this user is a tenant-level admin (tenant 'admin' role), allow access to all tenant operating_entities
        const isTenantAdmin = await isTenantAdminUser(knexClient, userId, req.user?.role, tenantId).catch(() => false);
        if (isTenantAdmin) {
          const allActiveTenantEntities = await listActiveTenantEntities(knexClient, tenantId);
          const allIds = allActiveTenantEntities.map((row) => row.id);
          if (allIds.length > 0) {
            allowedOperatingEntityIds = allIds;
            if (!defaultEntityId || !allowedOperatingEntityIds.includes(defaultEntityId)) {
              defaultEntityId = allIds[0] || null;
            }
          }
        }
      }

      const requestedEntityIdHeader = (req.headers['x-operating-entity-id'] || '').toString().trim() || null;
      const requestedEntityIdQuery = (req.query?.operating_entity_id || '').toString().trim() || null;
      const requestedEntityId = requestedEntityIdHeader || requestedEntityIdQuery || null;
      const requestedAllEntities = requestedEntityId?.toLowerCase() === 'all';

      const isTenantAdmin = isGlobalAdmin
        ? true
        : await isTenantAdminUser(knexClient, userId, req.user?.role, tenantId).catch(() => false);

      if (requestedAllEntities && !isTenantAdmin) {
        res.setHeader('X-Debug-Tenant', tenantId);
        res.setHeader('X-Debug-User', userId);
        res.setHeader('X-Debug-Requested-Operating-Entity', requestedEntityId);
        return res.status(403).json({ error: 'Forbidden: operating_entity_id=all is allowed only for admin users' });
      }

      let operatingEntityId = requestedAllEntities ? null : (requestedEntityId || defaultEntityId);

      if (requestedEntityId && !requestedAllEntities && !allowedOperatingEntityIds.includes(requestedEntityId)) {
        res.setHeader('X-Debug-Tenant', tenantId);
        res.setHeader('X-Debug-User', userId);
        res.setHeader('X-Debug-Requested-Operating-Entity', requestedEntityId);
        res.setHeader('X-Debug-Allowed-Operating-Entities', allowedOperatingEntityIds.join(',') || '');
        res.setHeader('X-Debug-Is-Global-Admin', isGlobalAdmin ? '1' : '0');
        return res.status(403).json({ error: 'Forbidden: operating entity not allowed' });
      }

      if (!operatingEntityId && !requestedAllEntities) {
        const configuredEntityAssignments = await countConfiguredEntityAssignments(knexClient, userId, tenantId);
        if (configuredEntityAssignments > 0) {
          res.setHeader('X-Debug-Tenant', tenantId);
          res.setHeader('X-Debug-User', userId);
          res.setHeader('X-Debug-Allowed-Operating-Entities', allowedOperatingEntityIds.join(',') || '');
          return res.status(403).json({ error: 'Forbidden: no active operating entity access configured' });
        }

        const activeTenantEntities = await listActiveTenantEntities(knexClient, tenantId);
        if (activeTenantEntities.length !== 1) {
          res.setHeader('X-Debug-Tenant', tenantId);
          res.setHeader('X-Debug-User', userId);
          res.setHeader('X-Debug-Active-Tenant-Entity-Count', activeTenantEntities.length.toString());
          return res.status(403).json({ error: 'Forbidden: operating entity access not configured' });
        }

        operatingEntityId = activeTenantEntities[0].id;
        allowedOperatingEntityIds = [operatingEntityId];
      }

      // Expose debug headers so callers can observe resolved tenant/context during diagnosis
      res.setHeader('X-Debug-Tenant', tenantId);
      res.setHeader('X-Debug-Operating-Entity', operatingEntityId || 'null');
      res.setHeader('X-Debug-Requested-Operating-Entity', requestedEntityId || '');
      res.setHeader('X-Debug-Allowed-Operating-Entities', allowedOperatingEntityIds.join(',') || '');
      res.setHeader('X-Debug-Default-Operating-Entity', defaultEntityId || 'null');
      res.setHeader('X-Debug-Is-Global-Admin', isGlobalAdmin ? '1' : '0');

      req.context = {
        tenantId,
        operatingEntityId,
        allowedOperatingEntityIds,
        isGlobalAdmin: !!isGlobalAdmin,
        isAllOperatingEntities: !!requestedAllEntities
      };

      return next();
    } catch (error) {
      logger.error('tenant_context_middleware_error', { error: error.message, stack: error.stack });
      const payload = { error: 'Failed to resolve tenant context' };
      if (process.env.NODE_ENV !== 'production' && error?.message) {
        payload.detail = error.message;
      }
      return res.status(500).json(payload);
    }
  };
}

const tenantContextMiddleware = createTenantContextMiddleware();

module.exports = tenantContextMiddleware;
module.exports.createTenantContextMiddleware = createTenantContextMiddleware;
