'use strict';

/**
 * Agreement templates + detected field map (FN-1792 / FN-1787).
 *
 * Stores uploaded agreement documents (PDFs in R2) and the AI-detected
 * field/signature map used for role assignment and e-sign placement.
 *
 * Additive and backward-compatible — every create is guarded by hasTable.
 */
exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  if (!(await knex.schema.hasTable('agreement_templates'))) {
    await knex.schema.createTable('agreement_templates', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable(); // company scope
      t.uuid('operating_entity_id').nullable(); // MC / entity scope
      t.text('name').notNullable();
      t.text('document_type').notNullable().defaultTo('generic'); // lease_agreement | generic | ...
      t.text('source_storage_key').nullable(); // R2 key of uploaded PDF
      t.integer('page_count').notNullable().defaultTo(0);
      t.text('status').notNullable().defaultTo('draft'); // draft | ready
      t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamps(true, true);
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_agreement_templates_tenant ON agreement_templates(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_agreement_templates_entity ON agreement_templates(operating_entity_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_agreement_templates_status ON agreement_templates(status)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_agreement_templates_document_type ON agreement_templates(document_type)');
  }

  if (!(await knex.schema.hasTable('agreement_template_fields'))) {
    await knex.schema.createTable('agreement_template_fields', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('template_id').notNullable().references('id').inTable('agreement_templates').onDelete('CASCADE');
      t.text('field_key').notNullable();
      t.text('label').nullable();
      t.text('field_type').notNullable().defaultTo('text'); // text | date | number | checkbox | signature | initials
      t.integer('page').notNullable().defaultTo(1);
      t.jsonb('bbox').nullable(); // [x, y, w, h] in page coordinates (per detect-fields contract)
      t.text('role').notNullable().defaultTo('signer'); // internal | signer
      t.text('suggested_role').nullable();
      t.text('suggested_value').nullable();
      t.decimal('confidence', 5, 4).nullable(); // 0.0000 - 1.0000
      t.integer('sort_order').notNullable().defaultTo(0);
      t.timestamps(true, true);
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_agreement_template_fields_template ON agreement_template_fields(template_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_agreement_template_fields_role ON agreement_template_fields(role)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_agreement_template_fields_page ON agreement_template_fields(template_id, page, sort_order)');
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('agreement_template_fields');
  await knex.schema.dropTableIfExists('agreement_templates');
};
