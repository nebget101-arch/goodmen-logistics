'use strict';

/**
 * E-signature requests + captured signatures (FN-1796 / FN-1788).
 *
 * Backs the "fill fields → send secure e-sign link → capture signature →
 * generate signed PDF" flow built on top of the agreement templates from
 * FN-1792. Mirrors the token/consent shape of employer_investigation_tokens
 * and consent_records.
 *
 *   signature_requests        — one per agreement sent for signature
 *   signature_request_fields  — per-field values (internal-filled + signer-filled)
 *   signatures                — captured signature + tokenized signing-link credential
 *
 * Additive and backward-compatible — every create is guarded by hasTable, and
 * the FK to agreement_templates is only attached when that table exists (story 1
 * may not have merged to this branch yet).
 */
exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  const hasUsers = await knex.schema.hasTable('users');
  const hasAgreementTemplates = await knex.schema.hasTable('agreement_templates');

  // 1) signature_requests
  if (!(await knex.schema.hasTable('signature_requests'))) {
    await knex.schema.createTable('signature_requests', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable(); // company scope
      t.uuid('operating_entity_id').nullable(); // MC / entity scope

      const templateId = t.uuid('template_id').nullable(); // source agreement template
      if (hasAgreementTemplates) {
        templateId.references('id').inTable('agreement_templates').onDelete('SET NULL');
      }

      t.text('document_type').notNullable().defaultTo('generic'); // lease_agreement | generic | ...
      // draft | sent | viewed | signed | completed | expired | voided
      t.text('status').notNullable().defaultTo('draft');

      // Intended signer (customer / driver)
      t.text('signer_name').nullable();
      t.text('signer_email').nullable();
      t.text('signer_phone').nullable();
      t.text('signer_role').nullable(); // human label, e.g. "Lessee", "Driver"

      t.text('signed_pdf_storage_key').nullable(); // R2 key of generated signed PDF

      t.timestamp('sent_at', { useTz: true }).nullable();
      t.timestamp('viewed_at', { useTz: true }).nullable();
      t.timestamp('signed_at', { useTz: true }).nullable();
      t.timestamp('expires_at', { useTz: true }).nullable();

      const createdBy = t.uuid('created_by').nullable();
      if (hasUsers) {
        createdBy.references('id').inTable('users').onDelete('SET NULL');
      }

      t.timestamps(true, true);
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_signature_requests_tenant ON signature_requests(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_signature_requests_entity ON signature_requests(operating_entity_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_signature_requests_template ON signature_requests(template_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_signature_requests_status ON signature_requests(status)');
  }

  // 2) signature_request_fields
  if (!(await knex.schema.hasTable('signature_request_fields'))) {
    await knex.schema.createTable('signature_request_fields', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('request_id').notNullable().references('id').inTable('signature_requests').onDelete('CASCADE');
      t.text('field_key').notNullable();
      t.text('role').notNullable().defaultTo('signer'); // internal | signer
      t.text('value').nullable(); // filled value (text or JSON-encoded for structured fields)

      const filledBy = t.uuid('filled_by').nullable(); // internal user; null when filled by the public signer
      if (hasUsers) {
        filledBy.references('id').inTable('users').onDelete('SET NULL');
      }
      t.timestamp('filled_at', { useTz: true }).nullable();

      t.timestamps(true, true);

      t.unique(['request_id', 'field_key'], { indexName: 'uq_signature_request_fields_request_key' });
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_signature_request_fields_request ON signature_request_fields(request_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_signature_request_fields_role ON signature_request_fields(role)');
  }

  // 3) signatures — captured signature + tokenized signing-link credential
  if (!(await knex.schema.hasTable('signatures'))) {
    await knex.schema.createTable('signatures', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('request_id').notNullable().references('id').inTable('signature_requests').onDelete('CASCADE');

      t.string('token_hash', 64).notNullable(); // SHA-256 of the secure signing link token
      t.timestamp('expires_at', { useTz: true }).nullable(); // link expiry

      t.text('signer_name').nullable();
      t.text('signature_value').nullable(); // typed name = signature (optional drawn payload)
      t.text('ip_address').nullable();
      t.text('user_agent').nullable();
      t.timestamp('signed_at', { useTz: true }).nullable();
      t.text('consent_text_snapshot').nullable(); // legal text shown at signing time

      t.timestamps(true, true);

      t.unique(['token_hash'], { indexName: 'uq_signatures_token_hash' });
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_signatures_request ON signatures(request_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_signatures_token_hash ON signatures(token_hash)');
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('signatures');
  await knex.schema.dropTableIfExists('signature_request_fields');
  await knex.schema.dropTableIfExists('signature_requests');
};
