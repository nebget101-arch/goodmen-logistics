exports.up = async function(knex) {
  // Add nullable tenant_id and operating_entity_id columns to audit_logs for scoping
  const has = await knex.schema.hasTable('audit_logs');
  if (!has) return;

  const hasTenant = await knex.schema.hasColumn('audit_logs', 'tenant_id');
  const hasEntity = await knex.schema.hasColumn('audit_logs', 'operating_entity_id');

  await knex.schema.alterTable('audit_logs', (table) => {
    if (!hasTenant) table.uuid('tenant_id').nullable();
    if (!hasEntity) table.uuid('operating_entity_id').nullable();
  });
};

exports.down = async function(knex) {
  const has = await knex.schema.hasTable('audit_logs');
  if (!has) return;

  await knex.schema.alterTable('audit_logs', (table) => {
    if (knex.schema.hasColumn('audit_logs', 'tenant_id')) table.dropColumn('tenant_id');
    if (knex.schema.hasColumn('audit_logs', 'operating_entity_id')) table.dropColumn('operating_entity_id');
  });
};
