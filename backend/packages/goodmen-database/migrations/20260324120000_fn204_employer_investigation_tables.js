/**
 * FN-204: Extend driver_past_employers for previous employer investigation
 * workflow and create supporting tables.
 *
 * Changes:
 * - Add investigation columns to driver_past_employers
 * - Create employer_investigation_responses table
 * - Create driver_investigation_history_file table
 * - Add investigation_file_status and investigation_deadline to drivers
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasDrivers = await knex.schema.hasTable('drivers');
  const hasUsers = await knex.schema.hasTable('users');

  // 1) Extend driver_past_employers with investigation columns
  const hasPastEmployers = await knex.schema.hasTable('driver_past_employers');
  if (hasPastEmployers) {
    const hasIsDotRegulated = await knex.schema.hasColumn('driver_past_employers', 'is_dot_regulated');
    if (!hasIsDotRegulated) {
      await knex.schema.alterTable('driver_past_employers', (table) => {
        table.boolean('is_dot_regulated').defaultTo(false);
        table.text('contact_email');
        table.text('contact_fax');
        table.text('position_held');
        table.text('investigation_status').defaultTo('not_started');
        table.date('deadline_date');
        table.timestamp('inquiry_sent_at', { useTz: true });
        table.timestamp('follow_up_sent_at', { useTz: true });
        table.timestamp('response_received_at', { useTz: true });
        table.jsonb('good_faith_efforts').defaultTo('[]');
      });
    }
  }

  // 2) Create employer_investigation_responses table
  const hasResponses = await knex.schema.hasTable('employer_investigation_responses');
  if (!hasResponses) {
    await knex.schema.createTable('employer_investigation_responses', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      const pastEmployerId = table.uuid('past_employer_id').notNullable();
      if (hasPastEmployers) {
        pastEmployerId.references('id').inTable('driver_past_employers').onDelete('CASCADE');
      }
      table.text('response_type').notNullable(); // e.g. 'complete', 'partial', 'refused'
      table.jsonb('response_data').defaultTo('{}');
      table.text('received_via'); // e.g. 'fax', 'email', 'mail', 'phone'
      table.uuid('document_id'); // optional reference to a stored document
      const documentedBy = table.uuid('documented_by');
      if (hasUsers) {
        documentedBy.references('id').inTable('users');
      }
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

      table.index('past_employer_id');
    });
  }

  // 3) Create driver_investigation_history_file table
  const hasHistoryFile = await knex.schema.hasTable('driver_investigation_history_file');
  if (!hasHistoryFile) {
    await knex.schema.createTable('driver_investigation_history_file', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      const driverId = table.uuid('driver_id').notNullable();
      if (hasDrivers) {
        driverId.references('id').inTable('drivers').onDelete('CASCADE');
      }
      table.uuid('past_employer_id'); // nullable — not all entries relate to a specific employer
      table.text('entry_type').notNullable(); // 'investigation_initiated', 'employer_inquiry', 'employer_response', 'good_faith_documentation', 'investigation_completed'
      table.text('description');
      table.jsonb('metadata').defaultTo('{}');
      const createdBy = table.uuid('created_by');
      if (hasUsers) {
        createdBy.references('id').inTable('users');
      }
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

      table.index('driver_id');
      table.index('past_employer_id');
      table.index('created_at');
    });
  }

  // 4) Add investigation columns to drivers table
  if (hasDrivers) {
    const hasFileStatus = await knex.schema.hasColumn('drivers', 'investigation_file_status');
    if (!hasFileStatus) {
      await knex.schema.alterTable('drivers', (table) => {
        table.text('investigation_file_status').defaultTo('not_started');
        table.date('investigation_deadline');
      });
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  // Drop new tables
  await knex.schema.dropTableIfExists('driver_investigation_history_file');
  await knex.schema.dropTableIfExists('employer_investigation_responses');

  // Remove added columns from drivers
  const hasDrivers = await knex.schema.hasTable('drivers');
  if (hasDrivers) {
    const hasFileStatus = await knex.schema.hasColumn('drivers', 'investigation_file_status');
    if (hasFileStatus) {
      await knex.schema.alterTable('drivers', (table) => {
        table.dropColumn('investigation_file_status');
        table.dropColumn('investigation_deadline');
      });
    }
  }

  // Remove added columns from driver_past_employers
  const hasPastEmployers = await knex.schema.hasTable('driver_past_employers');
  if (hasPastEmployers) {
    const hasIsDotRegulated = await knex.schema.hasColumn('driver_past_employers', 'is_dot_regulated');
    if (hasIsDotRegulated) {
      await knex.schema.alterTable('driver_past_employers', (table) => {
        table.dropColumn('is_dot_regulated');
        table.dropColumn('contact_email');
        table.dropColumn('contact_fax');
        table.dropColumn('position_held');
        table.dropColumn('investigation_status');
        table.dropColumn('deadline_date');
        table.dropColumn('inquiry_sent_at');
        table.dropColumn('follow_up_sent_at');
        table.dropColumn('response_received_at');
        table.dropColumn('good_faith_efforts');
      });
    }
  }
};
