'use strict';

/**
 * FN-759 — Email-to-Load: Create inbound_emails log table.
 *
 * Stores a record of every inbound email received by the email-to-load
 * pipeline so operators can audit processing outcomes and replay failures.
 *
 * Schema
 *   id                 UUID PK
 *   tenant_id          UUID NOT NULL (FK → tenants.id)
 *   from_email         TEXT
 *   subject            TEXT
 *   body_text          TEXT
 *   body_html          TEXT
 *   received_at        TIMESTAMPTZ DEFAULT now()
 *   load_id            UUID FK → loads.id (nullable; set when a DRAFT load is created)
 *   processing_status  TEXT — one of: pending | success | failed | rejected
 *   error_message      TEXT
 *
 * Indexes
 *   INDEX (tenant_id, received_at DESC) — list latest inbound emails per tenant
 */

const PROCESSING_STATUSES = ['pending', 'success', 'failed', 'rejected'];

exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  const hasTable = await knex.schema.hasTable('inbound_emails');
  if (hasTable) return;

  await knex.schema.createTable('inbound_emails', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table
      .uuid('tenant_id')
      .notNullable()
      .references('id')
      .inTable('tenants')
      .onDelete('CASCADE');
    table.text('from_email').nullable();
    table.text('subject').nullable();
    table.text('body_text').nullable();
    table.text('body_html').nullable();
    table
      .timestamp('received_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .uuid('load_id')
      .nullable()
      .references('id')
      .inTable('loads')
      .onDelete('SET NULL');
    table.text('processing_status').notNullable().defaultTo('pending');
    table.text('error_message').nullable();
  });

  await knex.raw(
    `ALTER TABLE inbound_emails
       ADD CONSTRAINT inbound_emails_processing_status_check
       CHECK (processing_status IN (${PROCESSING_STATUSES.map((s) => `'${s}'`).join(', ')}))`
  );

  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_inbound_emails_tenant_received_at ' +
      'ON inbound_emails (tenant_id, received_at DESC)'
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('inbound_emails');
};
