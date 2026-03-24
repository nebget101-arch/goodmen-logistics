/**
 * Extend employment application schema with new fields for:
 * - Work authorization & criminal background (stored in applicant_snapshot JSONB)
 * - Traffic violations table
 * - Drug & alcohol info (stored in applicant_snapshot JSONB)
 * - Employer table: additional columns for structured address, contact person
 */
exports.up = function(knex) {
  return knex.schema
    // Add contact_person, street_address, city, state, zip_code to employers
    .alterTable('employment_application_employers', function(t) {
      t.string('street_address').nullable();
      t.string('city').nullable();
      t.string('state').nullable();
      t.string('zip_code').nullable();
      t.string('contact_person').nullable();
      t.boolean('is_current').nullable().defaultTo(false);
      t.boolean('was_cmv').nullable().defaultTo(false);
    })
    // Add hazardous_material_spill to accidents (rename from chemical_spill for clarity)
    .alterTable('employment_application_accidents', function(t) {
      t.boolean('hazardous_material_spill').nullable();
    })
    // Create traffic violations table
    .createTable('employment_application_violations', function(t) {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('application_id').notNullable().references('id').inTable('employment_applications').onDelete('CASCADE');
      t.string('location').nullable();
      t.date('date').nullable();
      t.string('charge').nullable();
      t.string('penalty').nullable();
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('employment_application_violations')
    .alterTable('employment_application_accidents', function(t) {
      t.dropColumn('hazardous_material_spill');
    })
    .alterTable('employment_application_employers', function(t) {
      t.dropColumn('street_address');
      t.dropColumn('city');
      t.dropColumn('state');
      t.dropColumn('zip_code');
      t.dropColumn('contact_person');
      t.dropColumn('is_current');
      t.dropColumn('was_cmv');
    });
};
