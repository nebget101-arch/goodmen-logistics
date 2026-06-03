/**
 * FN-752 — Create load_templates table.
 *
 * Stores named, reusable snapshots of load data per tenant. Used by the
 * "Save as Template" / "Use Template" flows on the Loads page so a user
 * can pre-fill the load wizard from a previously saved template.
 *
 * Schema
 *   id            UUID PK  (auto-generated)
 *   tenant_id     UUID NOT NULL
 *   name          TEXT NOT NULL
 *   description   TEXT NULL
 *   template_data JSONB NOT NULL  (full snapshot consumed by the wizard)
 *   created_by    UUID NOT NULL  (FK users.id, RESTRICT)
 *   last_used_at  TIMESTAMPTZ NULL
 *   created_at    TIMESTAMPTZ DEFAULT now()
 *   updated_at    TIMESTAMPTZ DEFAULT now()
 *
 * Constraints
 *   UNIQUE (tenant_id, name)  — template names are unique within a tenant
 *   INDEX  (tenant_id)        — list/scope queries are always tenant-scoped
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('load_templates');
  if (hasTable) return;

  await knex.schema.createTable('load_templates', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('tenant_id').notNullable();
    table.text('name').notNullable();
    table.text('description').nullable();
    table.jsonb('template_data').notNullable();
    table
      .uuid('created_by')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT');
    table.timestamp('last_used_at', { useTz: true }).nullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.raw(`
    ALTER TABLE load_templates
    ADD CONSTRAINT uq_load_templates_tenant_name
    UNIQUE (tenant_id, name)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_load_templates_tenant_id
    ON load_templates (tenant_id)
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('load_templates');
};
