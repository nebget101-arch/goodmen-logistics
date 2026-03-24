/**
 * FN-204: Previous employer investigation & Driver Investigation History File tables.
 *
 * Changes:
 * - Adds investigation-related columns to driver_past_employers
 * - Creates employer_investigation_responses table
 * - Creates driver_investigation_history_file table
 * - Adds investigation_file_status and investigation_deadline to drivers
 */

exports.up = async function up(knex) {
  const hasDrivers = await knex.schema.hasTable('drivers');
  const hasUsers = await knex.schema.hasTable('users');
  const hasPastEmployers = await knex.schema.hasTable('driver_past_employers');
  const hasDriverDocuments = await knex.schema.hasTable('driver_documents');

  // 1) Add investigation columns to driver_past_employers
  if (hasPastEmployers) {
    const hasIsDotRegulated = await knex.schema.hasColumn('driver_past_employers', 'is_dot_regulated');
    if (!hasIsDotRegulated) {
      await knex.schema.alterTable('driver_past_employers', (table) => {
        table.boolean('is_dot_regulated').defaultTo(false);
        table.boolean('subject_to_drug_alcohol_testing').defaultTo(false);
        table.text('investigation_status').defaultTo('not_started');
        table.timestamp('inquiry_sent_at', { useTz: true });
        table.timestamp('follow_up_sent_at', { useTz: true });
        table.timestamp('response_received_at', { useTz: true });
        table.jsonb('good_faith_efforts');
        table.date('deadline_date');
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

      const driverId = table.uuid('driver_id').notNullable();
      if (hasDrivers) {
        driverId.references('id').inTable('drivers').onDelete('CASCADE');
      }

      table.text('response_type').notNullable();
      table.jsonb('response_data');
      table.text('received_via');
      table.timestamp('received_at', { useTz: true }).defaultTo(knex.fn.now());

      const documentedBy = table.uuid('documented_by');
      if (hasUsers) {
        documentedBy.references('id').inTable('users').onDelete('SET NULL');
      }

      const documentId = table.uuid('document_id');
      if (hasDriverDocuments) {
        documentId.references('id').inTable('driver_documents').onDelete('SET NULL');
      }

      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

      table.index(['past_employer_id']);
      table.index(['driver_id']);
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

      table.text('entry_type').notNullable();

      const relatedEmployerId = table.uuid('related_employer_id');
      if (hasPastEmployers) {
        relatedEmployerId.references('id').inTable('driver_past_employers').onDelete('SET NULL');
      }

      table.text('summary').notNullable();

      const documentId = table.uuid('document_id');
      if (hasDriverDocuments) {
        documentId.references('id').inTable('driver_documents').onDelete('SET NULL');
      }

      const createdBy = table.uuid('created_by');
      if (hasUsers) {
        createdBy.references('id').inTable('users').onDelete('SET NULL');
      }

      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

      table.index(['driver_id']);
      table.index(['entry_type']);
      table.index(['created_at']);
    });
  }

  // 4) Add investigation columns to drivers
  if (hasDrivers) {
    const hasFileStatus = await knex.schema.hasColumn('drivers', 'investigation_file_status');
    if (!hasFileStatus) {
      await knex.schema.alterTable('drivers', (table) => {
        table.text('investigation_file_status').defaultTo('incomplete');
        table.date('investigation_deadline');
      });
    }
  }
};

exports.down = async function down(knex) {
  // 1) Remove columns from drivers
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

  // 2) Drop new tables (order matters for FK dependencies)
  await knex.schema.dropTableIfExists('driver_investigation_history_file');
  await knex.schema.dropTableIfExists('employer_investigation_responses');

  // 3) Remove added columns from driver_past_employers
  const hasPastEmployers = await knex.schema.hasTable('driver_past_employers');
  if (hasPastEmployers) {
    const hasIsDotRegulated = await knex.schema.hasColumn('driver_past_employers', 'is_dot_regulated');
    if (hasIsDotRegulated) {
      await knex.schema.alterTable('driver_past_employers', (table) => {
        table.dropColumn('is_dot_regulated');
        table.dropColumn('subject_to_drug_alcohol_testing');
        table.dropColumn('investigation_status');
        table.dropColumn('inquiry_sent_at');
        table.dropColumn('follow_up_sent_at');
        table.dropColumn('response_received_at');
        table.dropColumn('good_faith_efforts');
        table.dropColumn('deadline_date');
      });
    }
  }
};
