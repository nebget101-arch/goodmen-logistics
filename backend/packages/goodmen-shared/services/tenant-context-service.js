'use strict';

/**
 * Minimal, non-breaking helper for future multi-MC rollout work.
 *
 * Phase 2 keeps this service read-only and optional so existing routes can adopt it
 * incrementally without changing request behavior yet.
 */

async function getDefaultTenant(knex) {
  return knex('tenants')
    .where({ status: 'active' })
    .orderBy('created_at', 'asc')
    .first();
}

async function getDefaultOperatingEntity(knex, tenantId) {
  const query = knex('operating_entities').where({ is_active: true });

  if (tenantId) {
    query.andWhere({ tenant_id: tenantId });
  }

  return query.orderBy('created_at', 'asc').first();
}

async function getUserTenantMemberships(knex, userId) {
  return knex('user_tenant_memberships')
    .select('user_tenant_memberships.*', 'tenants.name as tenant_name', 'tenants.status as tenant_status')
    .join('tenants', 'tenants.id', 'user_tenant_memberships.tenant_id')
    .where('user_tenant_memberships.user_id', userId)
    .andWhere('user_tenant_memberships.is_active', true)
    .orderBy('user_tenant_memberships.is_default', 'desc')
    .orderBy('tenants.name', 'asc');
}

async function getUserOperatingEntities(knex, userId) {
  return knex('user_operating_entities')
    .select(
      'user_operating_entities.*',
      'operating_entities.tenant_id',
      'operating_entities.name as operating_entity_name',
      'operating_entities.mc_number',
      'operating_entities.dot_number'
    )
    .join('operating_entities', 'operating_entities.id', 'user_operating_entities.operating_entity_id')
    .where('user_operating_entities.user_id', userId)
    .andWhere('user_operating_entities.is_active', true)
    .orderBy('user_operating_entities.is_default', 'desc')
    .orderBy('operating_entities.name', 'asc');
}

async function getDefaultContextForUser(knex, userId) {
  const memberships = await getUserTenantMemberships(knex, userId);
  const defaultMembership = memberships.find((membership) => membership.is_default) || memberships[0] || null;

  const entities = await getUserOperatingEntities(knex, userId);
  const defaultEntity = entities.find((entity) => entity.is_default) || entities[0] || null;

  if (defaultMembership || defaultEntity) {
    return {
      tenant: defaultMembership,
      operatingEntity: defaultEntity
    };
  }

  const fallbackTenant = await getDefaultTenant(knex);
  const fallbackEntity = await getDefaultOperatingEntity(knex, fallbackTenant?.id);

  return {
    tenant: fallbackTenant || null,
    operatingEntity: fallbackEntity || null
  };
}

module.exports = {
  getDefaultTenant,
  getDefaultOperatingEntity,
  getUserTenantMemberships,
  getUserOperatingEntities,
  getDefaultContextForUser
};
