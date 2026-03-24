/**
 * FN-205: Create annual_compliance_items table for tracking annual
 * driver compliance requirements (MVR, driving record review,
 * clearinghouse query, medical cert renewal).
 *
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('annual_compliance_items');
  if (hasTable) return;

  await knex.schema.createTable('annual_compliance_items', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .uuid('driver_id')
      .notNullable()
      .references('id')
      .inTable('drivers')
      .onDelete('CASCADE');
    table.uuid('tenant_id').notNullable();
    table
      .text('compliance_type')
      .notNullable()
      .checkIn([
        'mvr_inquiry',
        'driving_record_review',
        'clearinghouse_limited_query',
        'medical_cert_renewal'
      ]);
    table.integer('compliance_year').notNullable();
    table.date('due_date').notNullable();
    table
      .text('status')
      .notNullable()
      .defaultTo('pending')
      .checkIn(['pending', 'completed', 'overdue']);
    table.timestamp('completed_at').nullable();
    table.uuid('completed_by').nullable();
    table.text('reviewer_name').nullable();
    table.text('review_notes').nullable();
    table.text('determination').nullable();
    table.uuid('evidence_document_id').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.unique(['driver_id', 'compliance_type', 'compliance_year']);
    table.index(['tenant_id']);
    table.index(['status']);
    table.index(['due_date']);
  });
};

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('annual_compliance_items');
};
