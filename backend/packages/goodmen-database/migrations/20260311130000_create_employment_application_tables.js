exports.up = function(knex) {
  return knex.schema
    .createTable('employment_applications', function(t) {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('driver_id').notNullable().index();
      t.uuid('tenant_id').nullable().index();
      t.uuid('operating_entity_id').nullable().index();
      t.string('status').notNullable().defaultTo('draft');
      t.date('application_date').nullable();
      t.timestamp('submitted_at').nullable();
      t.timestamp('signed_at').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());
      t.uuid('created_by').nullable();
      t.uuid('updated_by').nullable();
      t.string('source').nullable();
      t.string('source_template').nullable();
      t.string('pdf_storage_key').nullable();
      t.string('pdf_file_name').nullable();
      t.string('pdf_content_type').nullable();
      t.bigInteger('pdf_file_size').nullable();
      t.timestamp('pdf_uploaded_at').nullable();
      t.string('r2_bucket_name').nullable();
      t.jsonb('applicant_snapshot').nullable();
    })
    .createTable('employment_application_residencies', function(t) {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('application_id').notNullable().references('id').inTable('employment_applications').onDelete('CASCADE');
      t.string('residency_type').nullable();
      t.string('street').nullable();
      t.string('city').nullable();
      t.string('state').nullable();
      t.string('zip_code').nullable();
      t.string('years_at_address').nullable();
    })
    .createTable('employment_application_licenses', function(t) {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('application_id').notNullable().references('id').inTable('employment_applications').onDelete('CASCADE');
      t.string('state').nullable();
      t.string('license_number').nullable();
      t.string('license_class_or_type').nullable();
      t.string('endorsements').nullable();
      t.date('expiration_date').nullable();
    })
    .createTable('employment_application_driving_experience', function(t) {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('application_id').notNullable().references('id').inTable('employment_applications').onDelete('CASCADE');
      t.string('class_of_equipment').nullable();
      t.string('type_of_equipment').nullable();
      t.date('date_from').nullable();
      t.date('date_to').nullable();
      t.string('approximate_miles_total').nullable();
    })
    .createTable('employment_application_accidents', function(t) {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('application_id').notNullable().references('id').inTable('employment_applications').onDelete('CASCADE');
      t.date('date').nullable();
      t.text('nature_of_accident').nullable();
      t.integer('fatalities_count').nullable();
      t.integer('injuries_count').nullable();
      t.boolean('chemical_spill').nullable();
    })
    .createTable('employment_application_convictions', function(t) {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('application_id').notNullable().references('id').inTable('employment_applications').onDelete('CASCADE');
      t.string('date_convicted').nullable();
      t.string('violation').nullable();
      t.string('state_of_violation').nullable();
      t.string('penalty').nullable();
    })
    .createTable('employment_application_employers', function(t) {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('application_id').notNullable().references('id').inTable('employment_applications').onDelete('CASCADE');
      t.string('company_name').nullable();
      t.string('phone').nullable();
      t.string('address').nullable();
      t.string('position_held').nullable();
      t.string('from_month_year').nullable();
      t.string('to_month_year').nullable();
      t.string('reason_for_leaving').nullable();
      t.string('salary').nullable();
      t.boolean('subject_to_fmcsr').nullable();
      t.boolean('safety_sensitive_dot_function').nullable();
      t.text('gaps_explanation').nullable();
    })
    .createTable('employment_application_education', function(t) {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('application_id').notNullable().references('id').inTable('employment_applications').onDelete('CASCADE');
      t.string('school_type').nullable();
      t.string('school_name_and_location').nullable();
      t.string('course_of_study').nullable();
      t.string('years_completed').nullable();
      t.string('graduated').nullable();
      t.text('details').nullable();
    })
    .createTable('employment_application_documents', function(t) {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('application_id').notNullable().references('id').inTable('employment_applications').onDelete('CASCADE');
      t.string('document_type').nullable();
      t.string('bucket_name').nullable();
      t.string('object_key').nullable();
      t.string('file_name').nullable();
      t.string('content_type').nullable();
      t.bigInteger('file_size').nullable();
      t.timestamp('uploaded_at').nullable();
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('employment_application_documents')
    .dropTableIfExists('employment_application_education')
    .dropTableIfExists('employment_application_employers')
    .dropTableIfExists('employment_application_convictions')
    .dropTableIfExists('employment_application_accidents')
    .dropTableIfExists('employment_application_driving_experience')
    .dropTableIfExists('employment_application_licenses')
    .dropTableIfExists('employment_application_residencies')
    .dropTableIfExists('employment_applications');
};
