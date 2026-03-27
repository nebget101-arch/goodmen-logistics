/**
 * FN-327: Add employer_investigation_tokens table and extend
 * employer_investigation_responses + driver_past_employers for the
 * public employer response form.
 *
 * New table:
 *   employer_investigation_tokens — secure share tokens for public employer response links
 *
 * Extended tables:
 *   employer_investigation_responses — structured response fields (employment, accidents, D&A, signature, PDF)
 *   driver_past_employers — share_token_id, inquiry_email_sent_to, inquiry_created_by
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasDrivers = await knex.schema.hasTable('drivers');
  const hasUsers = await knex.schema.hasTable('users');
  const hasPastEmployers = await knex.schema.hasTable('driver_past_employers');

  // 1) Create employer_investigation_tokens table
  const hasTokens = await knex.schema.hasTable('employer_investigation_tokens');
  if (!hasTokens) {
    await knex.schema.createTable('employer_investigation_tokens', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

      const pastEmployerId = table.uuid('past_employer_id').notNullable();
      if (hasPastEmployers) {
        pastEmployerId.references('id').inTable('driver_past_employers').onDelete('CASCADE');
      }

      const driverId = table.uuid('driver_id').notNullable();
      if (hasDrivers) {
        driverId.references('id').inTable('drivers').onDelete('CASCADE');
      }

      table.string('token_hash', 64).notNullable();
      table.timestamp('expires_at', { useTz: true }).notNullable();

      const createdBy = table.uuid('created_by');
      if (hasUsers) {
        createdBy.references('id').inTable('users');
      }

      table.text('status').notNullable().defaultTo('active'); // active, used, expired

      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

      table.index('token_hash', 'idx_investigation_tokens_hash');
      table.index('past_employer_id', 'idx_investigation_tokens_employer');
      table.index('driver_id', 'idx_investigation_tokens_driver');
    });
  }

  // 2) Extend employer_investigation_responses with structured response fields
  const hasResponses = await knex.schema.hasTable('employer_investigation_responses');
  if (hasResponses) {
    const hasAccidents = await knex.schema.hasColumn('employer_investigation_responses', 'accidents');
    if (!hasAccidents) {
      await knex.schema.alterTable('employer_investigation_responses', (table) => {
        // Employment verification fields
        table.text('employed_as');
        table.text('employment_from');
        table.text('employment_to');
        table.boolean('drove_cmv');
        table.jsonb('vehicle_types').defaultTo('[]');
        table.text('reason_for_leaving');

        // Accident history
        table.jsonb('accidents').defaultTo('[]');

        // Drug & alcohol history
        table.jsonb('drug_alcohol_history').defaultTo('{}');

        // General
        table.boolean('no_safety_history').defaultTo(false);
        table.text('other_remarks');

        // Completed by
        table.text('completed_by_name');
        table.text('completed_by_title');
        table.jsonb('signature_data').defaultTo('{}');

        // Generated PDF
        table.text('pdf_storage_key');
        table.text('pdf_file_name');
      });
    }
  }

  // 3) Extend driver_past_employers with token and email tracking fields
  if (hasPastEmployers) {
    const hasShareTokenId = await knex.schema.hasColumn('driver_past_employers', 'share_token_id');
    if (!hasShareTokenId) {
      await knex.schema.alterTable('driver_past_employers', (table) => {
        table.uuid('share_token_id');
        table.text('inquiry_email_sent_to');
        table.uuid('inquiry_created_by');
      });
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  // 3) Remove columns from driver_past_employers
  const hasPastEmployers = await knex.schema.hasTable('driver_past_employers');
  if (hasPastEmployers) {
    const hasShareTokenId = await knex.schema.hasColumn('driver_past_employers', 'share_token_id');
    if (hasShareTokenId) {
      await knex.schema.alterTable('driver_past_employers', (table) => {
        table.dropColumn('share_token_id');
        table.dropColumn('inquiry_email_sent_to');
        table.dropColumn('inquiry_created_by');
      });
    }
  }

  // 2) Remove columns from employer_investigation_responses
  const hasResponses = await knex.schema.hasTable('employer_investigation_responses');
  if (hasResponses) {
    const hasAccidents = await knex.schema.hasColumn('employer_investigation_responses', 'accidents');
    if (hasAccidents) {
      await knex.schema.alterTable('employer_investigation_responses', (table) => {
        table.dropColumn('employed_as');
        table.dropColumn('employment_from');
        table.dropColumn('employment_to');
        table.dropColumn('drove_cmv');
        table.dropColumn('vehicle_types');
        table.dropColumn('reason_for_leaving');
        table.dropColumn('accidents');
        table.dropColumn('drug_alcohol_history');
        table.dropColumn('no_safety_history');
        table.dropColumn('other_remarks');
        table.dropColumn('completed_by_name');
        table.dropColumn('completed_by_title');
        table.dropColumn('signature_data');
        table.dropColumn('pdf_storage_key');
        table.dropColumn('pdf_file_name');
      });
    }
  }

  // 1) Drop employer_investigation_tokens table
  await knex.schema.dropTableIfExists('employer_investigation_tokens');
};
