/**
 * FN-203: Create consent management tables with versioning & audit trail.
 *
 * Tables:
 * - consent_templates      — versioned consent/disclosure templates
 * - driver_consents        — individual driver consent records
 * - consent_audit_log      — immutable audit trail for consent lifecycle
 *
 * Seeds 9 FMCSA/FCRA consent templates (version 1).
 */

exports.up = async function up(knex) {
  const hasDrivers = await knex.schema.hasTable('drivers');
  const hasUsers = await knex.schema.hasTable('users');
  const hasPackets = await knex.schema.hasTable('driver_onboarding_packets');

  // ── 1) consent_templates ──────────────────────────────────────────────
  const hasConsentTemplates = await knex.schema.hasTable('consent_templates');
  if (!hasConsentTemplates) {
    await knex.schema.createTable('consent_templates', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('key', 100).notNullable();
      table.string('title', 255).notNullable();
      table.text('body_text').notNullable();
      table.integer('version').notNullable().defaultTo(1);
      table.date('effective_date');
      table.boolean('is_active').defaultTo(true);
      table.string('cfr_reference', 100);
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

      table.unique(['key', 'version']);
    });

    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_consent_templates_key ON consent_templates(key)'
    );
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_consent_templates_is_active ON consent_templates(is_active)'
    );
  }

  // ── 2) driver_consents ────────────────────────────────────────────────
  const hasDriverConsents = await knex.schema.hasTable('driver_consents');
  if (!hasDriverConsents) {
    await knex.schema.createTable('driver_consents', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

      const driverId = table.uuid('driver_id').notNullable();
      if (hasDrivers) {
        driverId.references('id').inTable('drivers').onDelete('CASCADE');
      }

      table
        .uuid('consent_template_id')
        .notNullable()
        .references('id')
        .inTable('consent_templates');

      table.string('consent_key', 100).notNullable();
      table
        .text('status')
        .notNullable()
        .defaultTo('pending');
      table.timestamp('signed_at', { useTz: true });
      table.timestamp('expires_at', { useTz: true });
      table.string('signer_name', 255);
      table.string('signature_type', 50);
      table.text('signature_value');
      table.string('ip_address', 45);
      table.text('user_agent');
      table.text('consent_text_snapshot');
      table.integer('consent_version');

      const packetId = table.uuid('packet_id');
      if (hasPackets) {
        packetId
          .references('id')
          .inTable('driver_onboarding_packets')
          .onDelete('SET NULL');
      }

      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    });

    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_driver_consents_driver_id ON driver_consents(driver_id)'
    );
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_driver_consents_consent_key ON driver_consents(consent_key)'
    );
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_driver_consents_status ON driver_consents(status)'
    );
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_driver_consents_packet_id ON driver_consents(packet_id)'
    );
  }

  // ── 3) consent_audit_log ──────────────────────────────────────────────
  const hasAuditLog = await knex.schema.hasTable('consent_audit_log');
  if (!hasAuditLog) {
    await knex.schema.createTable('consent_audit_log', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

      table
        .uuid('driver_consent_id')
        .notNullable()
        .references('id')
        .inTable('driver_consents')
        .onDelete('CASCADE');

      table.text('action').notNullable();

      const performedBy = table.uuid('performed_by');
      if (hasUsers) {
        performedBy
          .references('id')
          .inTable('users')
          .onDelete('SET NULL');
      }

      table.string('ip_address', 45);
      table.text('user_agent');
      table.jsonb('metadata');
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    });

    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_consent_audit_log_driver_consent_id ON consent_audit_log(driver_consent_id)'
    );
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_consent_audit_log_created_at ON consent_audit_log(created_at)'
    );
  }

  // ── 4) Seed consent templates ─────────────────────────────────────────
  const templateCount = await knex('consent_templates').count('id as cnt').first();
  if (Number(templateCount.cnt) === 0) {
    const PLACEHOLDER = '[CONSENT TEMPLATE - Legal text to be provided by compliance team. Version 1.0]';

    await knex('consent_templates').insert([
      {
        key: 'fcra_disclosure',
        title: 'FCRA Disclosure',
        body_text: PLACEHOLDER,
        version: 1,
        is_active: true,
        cfr_reference: 'FCRA §604',
      },
      {
        key: 'fcra_authorization',
        title: 'FCRA Background Check Authorization',
        body_text: PLACEHOLDER,
        version: 1,
        is_active: true,
        cfr_reference: 'FCRA §604',
      },
      {
        key: 'psp_consent',
        title: 'Pre-Employment Screening Program (PSP) Consent',
        body_text: PLACEHOLDER,
        version: 1,
        is_active: true,
        cfr_reference: 'FMCSA PSP',
      },
      {
        key: 'clearinghouse_full',
        title: 'FMCSA Clearinghouse Full Query Consent',
        body_text: PLACEHOLDER,
        version: 1,
        is_active: true,
        cfr_reference: '49 CFR §382.703',
      },
      {
        key: 'clearinghouse_limited',
        title: 'FMCSA Clearinghouse Limited Query Consent',
        body_text: PLACEHOLDER,
        version: 1,
        is_active: true,
        cfr_reference: '49 CFR §382.703',
      },
      {
        key: 'previous_employer_inquiry',
        title: 'Previous Employer Inquiry Authorization',
        body_text: PLACEHOLDER,
        version: 1,
        is_active: true,
        cfr_reference: '49 CFR §391.23',
      },
      {
        key: 'mvr_authorization',
        title: 'Motor Vehicle Record (MVR) Authorization',
        body_text: PLACEHOLDER,
        version: 1,
        is_active: true,
        cfr_reference: 'FCRA/State',
      },
      {
        key: 'pre_employment_drug_test',
        title: 'Pre-Employment Drug Testing Acknowledgment',
        body_text: PLACEHOLDER,
        version: 1,
        is_active: true,
        cfr_reference: '49 CFR §382.301',
      },
      {
        key: 'release_of_information',
        title: 'General Release of Information',
        body_text: PLACEHOLDER,
        version: 1,
        is_active: true,
        cfr_reference: '49 CFR §391.23',
      },
    ]);
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('consent_audit_log');
  await knex.schema.dropTableIfExists('driver_consents');
  await knex.schema.dropTableIfExists('consent_templates');
};
