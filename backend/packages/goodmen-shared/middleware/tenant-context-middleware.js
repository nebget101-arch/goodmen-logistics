'use strict';

const knex = require('../config/knex');
const dtLogger = require('../utils/logger');

async function resolveTenantForUser(userId) {
  const memberships = await knex('user_tenant_memberships')
    .where({ user_id: userId, is_active: true })
    .orderBy('is_default', 'desc')
    .orderBy('created_at', 'asc');

  if (memberships.length === 1) {
    return memberships[0].tenant_id;
  }

  if (memberships.length > 1) {
    const def = memberships.find((m) => m.is_default);
    return (def || memberships[0]).tenant_id;
  }

  // Transition compatibility: fallback to users.tenant_id if membership rows are not yet seeded.
  const userRow = await knex('users').where({ id: userId }).select('tenant_id').first();
  if (userRow?.tenant_id) {
    return userRow.tenant_id;
  }

  // Last fallback: first active tenant in system.
  const tenant = await knex('tenants').where({ status: 'active' }).orderBy('created_at', 'asc').first();
  return tenant?.id || null;
}

async function resolveEntityAccessForUser(userId, tenantId) {
  const rows = await knex('user_operating_entities as uoe')
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

module.exports = async function tenantContextMiddleware(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next();
    }

    const tenantId = await resolveTenantForUser(userId);
    if (!tenantId) {
      return res.status(403).json({ error: 'Forbidden: tenant access not configured' });
    }

    const { allowedOperatingEntityIds, defaultEntityId } = await resolveEntityAccessForUser(userId, tenantId);

    const requestedEntityId = (req.headers['x-operating-entity-id'] || '').toString().trim() || null;
    let operatingEntityId = requestedEntityId || defaultEntityId;

    if (requestedEntityId && !allowedOperatingEntityIds.includes(requestedEntityId)) {
      return res.status(403).json({ error: 'Forbidden: operating entity not allowed' });
    }

    if (!operatingEntityId) {
      const fallback = await knex('operating_entities')
        .where({ tenant_id: tenantId, is_active: true })
        .orderBy('created_at', 'asc')
        .first();
      operatingEntityId = fallback?.id || null;
    }

    req.context = {
      tenantId,
      operatingEntityId,
      allowedOperatingEntityIds
    };

    return next();
  } catch (error) {
    dtLogger.error('tenant_context_middleware_error', { error: error.message });
    return res.status(500).json({ error: 'Failed to resolve tenant context' });
  }
};
