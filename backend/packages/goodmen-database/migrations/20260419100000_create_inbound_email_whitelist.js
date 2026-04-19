/**
 * FN-761: Create `inbound_email_whitelist` table — tenant-managed allowlist
 * of sender addresses/domains for the inbound-email webhook (FN-729 / FN-760).
 *
 * Schema
 *   id              UUID PK (auto)
 *   tenant_id       UUID NOT NULL  — scoped per tenant
 *   pattern         TEXT NOT NULL  — either `user@domain` or `@domain`
 *   is_domain       BOOLEAN NOT NULL DEFAULT false  — true when pattern begins with `@`
 *   created_by_user_id UUID NULL FK users.id ON DELETE SET NULL
 *   created_at      TIMESTAMPTZ DEFAULT now()
 *
 * Constraints
 *   UNIQUE (tenant_id, LOWER(pattern))
 *   INDEX  (tenant_id)
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('inbound_email_whitelist');
  if (hasTable) return;

  await knex.schema.createTable('inbound_email_whitelist', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.text('pattern').notNullable();
    t.boolean('is_domain').notNullable().defaultTo(false);
    t.uuid('created_by_user_id').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_inbound_email_whitelist_tenant_pattern
    ON inbound_email_whitelist (tenant_id, LOWER(pattern))
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_inbound_email_whitelist_tenant
    ON inbound_email_whitelist (tenant_id)
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('inbound_email_whitelist');
};
