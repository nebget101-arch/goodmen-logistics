/**
 * FN-202: Extend employment application schema for 10-year CDL history
 * and disqualification fields.
 *
 * Changes:
 * - Add `tier` column to employment_application_employers
 * - Create employment_application_disqualifications table
 * - Add disqualification + certification columns to employment_applications
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  // 1) Add `tier` to employment_application_employers
  const hasEmployers = await knex.schema.hasTable('employment_application_employers');
  if (hasEmployers) {
    const hasTier = await knex.schema.hasColumn('employment_application_employers', 'tier');
    if (!hasTier) {
      await knex.schema.alterTable('employment_application_employers', (table) => {
        table.text('tier').nullable().defaultTo('detailed');
      });
    }
  }

  // 2) Create employment_application_disqualifications table
  const hasDisqualifications = await knex.schema.hasTable('employment_application_disqualifications');
  if (!hasDisqualifications) {
    await knex.schema.createTable('employment_application_disqualifications', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table
        .uuid('application_id')
        .notNullable()
        .references('id')
        .inTable('employment_applications')
        .onDelete('CASCADE');
      table.text('type').notNullable();
      table.string('state', 2).nullable();
      table.date('date').nullable();
      table.text('reason').nullable();
      table.boolean('reinstated').defaultTo(false);
      table.date('reinstatement_date').nullable();
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

      table.index('application_id');
    });
  }

  // 3) Add columns to employment_applications
  const hasApplications = await knex.schema.hasTable('employment_applications');
  if (hasApplications) {
    const hasDisqualified = await knex.schema.hasColumn('employment_applications', 'has_been_disqualified');
    const hasCertVersion = await knex.schema.hasColumn('employment_applications', 'certification_text_version');
    const hasSignedCert = await knex.schema.hasColumn('employment_applications', 'signed_certification_at');

    if (!hasDisqualified || !hasCertVersion || !hasSignedCert) {
      await knex.schema.alterTable('employment_applications', (table) => {
        if (!hasDisqualified) {
          table.boolean('has_been_disqualified').defaultTo(false);
        }
        if (!hasCertVersion) {
          table.string('certification_text_version', 50).nullable();
        }
        if (!hasSignedCert) {
          table.timestamp('signed_certification_at', { useTz: true }).nullable();
        }
      });
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  // Drop the new disqualifications table
  await knex.schema.dropTableIfExists('employment_application_disqualifications');

  // Remove added columns from employment_applications
  const hasApplications = await knex.schema.hasTable('employment_applications');
  if (hasApplications) {
    await knex.schema.alterTable('employment_applications', (table) => {
      table.dropColumn('has_been_disqualified');
      table.dropColumn('certification_text_version');
      table.dropColumn('signed_certification_at');
    });
  }

  // Remove tier from employment_application_employers
  const hasEmployers = await knex.schema.hasTable('employment_application_employers');
  if (hasEmployers) {
    await knex.schema.alterTable('employment_application_employers', (table) => {
      table.dropColumn('tier');
    });
  }
};
