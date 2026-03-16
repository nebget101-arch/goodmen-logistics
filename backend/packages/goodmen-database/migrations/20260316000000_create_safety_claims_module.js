/**
 * Safety Claims & Accidents Module – schema migration.
 *
 * Tables:
 *   safety_incidents
 *   safety_incident_parties
 *   safety_incident_witnesses
 *   safety_incident_notes
 *   safety_incident_documents
 *   safety_incident_tasks
 *   safety_incident_audit_log
 *   safety_claims
 *
 * All tables are additive – existing data is never touched.
 */
exports.up = async function (knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  // ─── 1. safety_incidents ──────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('safety_incidents'))) {
    await knex.schema.createTable('safety_incidents', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('operating_entity_id').nullable();

      // Identifiers
      t.text('incident_number').notNullable(); // INC-2026-0001
      t.text('status').notNullable().defaultTo('open');
      // open | under_review | pending_close | closed

      // Classification
      t.text('incident_type').notNullable().defaultTo('other');
      // collision | cargo_damage | injury | property_damage | spill | near_miss | other
      t.text('severity').nullable();
      // critical | major | minor | near_miss
      t.text('preventability').nullable();
      // preventable | non_preventable | undetermined
      t.boolean('dot_recordable').notNullable().defaultTo(false);
      t.boolean('hazmat_involved').notNullable().defaultTo(false);
      t.boolean('litigation_risk').notNullable().defaultTo(false);

      // Date / Location
      t.timestamp('incident_date', { useTz: true }).notNullable();
      t.text('location_address').nullable();
      t.text('location_city').nullable();
      t.text('location_state').nullable();
      t.text('location_zip').nullable();
      t.decimal('location_lat', 10, 7).nullable();
      t.decimal('location_lng', 10, 7).nullable();

      // Conditions
      t.text('weather_condition').nullable();
      t.text('road_condition').nullable();
      t.text('light_condition').nullable();

      // Narrative
      t.text('narrative').nullable();
      t.text('internal_summary').nullable();

      // Linked entities
      t.uuid('driver_id').nullable();
      t.uuid('co_driver_id').nullable();
      t.uuid('vehicle_id').nullable();
      t.uuid('trailer_id').nullable();
      t.uuid('dispatcher_id').nullable();
      t.uuid('load_id').nullable();

      // Police / citations
      t.text('police_report_number').nullable();
      t.text('police_department').nullable();
      t.text('citation_info').nullable();

      // Injury / cargo
      t.text('injury_description').nullable();
      t.text('cargo_damage_description').nullable();
      t.decimal('estimated_loss_amount', 15, 2).nullable().defaultTo(0);

      // Investigation
      t.text('root_cause').nullable();
      t.text('corrective_action').nullable();

      // Close
      t.timestamp('close_date', { useTz: true }).nullable();
      t.uuid('closed_by').nullable();

      // Audit
      t.uuid('created_by').nullable();
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_safety_incidents_tenant ON safety_incidents(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_safety_incidents_oe ON safety_incidents(operating_entity_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_safety_incidents_status ON safety_incidents(status)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_safety_incidents_date ON safety_incidents(incident_date DESC)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_safety_incidents_driver ON safety_incidents(driver_id)');
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS uq_safety_incidents_number_tenant ON safety_incidents(tenant_id, incident_number)');
  }

  // ─── 2. safety_incident_parties ────────────────────────────────────────────
  if (!(await knex.schema.hasTable('safety_incident_parties'))) {
    await knex.schema.createTable('safety_incident_parties', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('incident_id').notNullable().references('id').inTable('safety_incidents').onDelete('CASCADE');
      t.text('party_type').notNullable().defaultTo('other');
      // driver | owner | passenger | pedestrian | other
      t.text('name').nullable();
      t.text('address').nullable();
      t.text('city').nullable();
      t.text('state').nullable();
      t.text('zip').nullable();
      t.text('phone').nullable();
      t.text('email').nullable();
      t.text('insurance_carrier').nullable();
      t.text('policy_number').nullable();

      // Optional repair linkage
      t.uuid('work_order_id').nullable();
      t.text('claim_number').nullable();
      t.text('vehicle_year').nullable();
      t.text('vehicle_make').nullable();
      t.text('vehicle_model').nullable();
      t.text('vehicle_plate').nullable();
      t.text('injury_description').nullable();
      t.text('property_damage_description').nullable();
      t.text('notes').nullable();
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_safety_parties_incident ON safety_incident_parties(incident_id)');
  }

  // ─── 3. safety_incident_witnesses ──────────────────────────────────────────
  if (!(await knex.schema.hasTable('safety_incident_witnesses'))) {
    await knex.schema.createTable('safety_incident_witnesses', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('incident_id').notNullable().references('id').inTable('safety_incidents').onDelete('CASCADE');
      t.text('name').nullable();
      t.text('address').nullable();
      t.text('phone').nullable();
      t.text('email').nullable();
      t.text('statement').nullable();
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_safety_witnesses_incident ON safety_incident_witnesses(incident_id)');
  }

  // ─── 4. safety_incident_notes ──────────────────────────────────────────────
  if (!(await knex.schema.hasTable('safety_incident_notes'))) {
    await knex.schema.createTable('safety_incident_notes', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('incident_id').notNullable().references('id').inTable('safety_incidents').onDelete('CASCADE');
      t.uuid('author_id').nullable();
      t.text('note_type').notNullable().defaultTo('general');
      // general | investigation | legal | insurance
      t.text('content').notNullable();
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_safety_notes_incident ON safety_incident_notes(incident_id)');
  }

  // ─── 5. safety_incident_documents ──────────────────────────────────────────
  if (!(await knex.schema.hasTable('safety_incident_documents'))) {
    await knex.schema.createTable('safety_incident_documents', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('incident_id').notNullable().references('id').inTable('safety_incidents').onDelete('CASCADE');
      t.uuid('claim_id').nullable(); // optionally linked to a claim
      t.text('document_type').notNullable().defaultTo('other');
      // photo | dashcam | police_report | driver_statement | witness_statement |
      // repair_estimate | repair_invoice | insurance_correspondence | settlement_release | other
      t.text('file_name').notNullable();
      t.text('storage_key').notNullable();
      t.bigInteger('file_size').nullable();
      t.text('mime_type').nullable();
      t.uuid('uploaded_by').nullable();
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_safety_docs_incident ON safety_incident_documents(incident_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_safety_docs_claim ON safety_incident_documents(claim_id)');
  }

  // ─── 6. safety_incident_tasks ──────────────────────────────────────────────
  if (!(await knex.schema.hasTable('safety_incident_tasks'))) {
    await knex.schema.createTable('safety_incident_tasks', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('incident_id').notNullable().references('id').inTable('safety_incidents').onDelete('CASCADE');
      t.uuid('claim_id').nullable();
      t.text('title').notNullable();
      t.text('description').nullable();
      t.date('due_date').nullable();
      t.uuid('assigned_to').nullable();
      t.text('status').notNullable().defaultTo('open');
      // open | in_progress | completed | overdue
      t.timestamp('completed_at', { useTz: true }).nullable();
      t.uuid('completed_by').nullable();
      t.uuid('created_by').nullable();
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_safety_tasks_incident ON safety_incident_tasks(incident_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_safety_tasks_due ON safety_incident_tasks(due_date)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_safety_tasks_assigned ON safety_incident_tasks(assigned_to)');
  }

  // ─── 7. safety_incident_audit_log ──────────────────────────────────────────
  if (!(await knex.schema.hasTable('safety_incident_audit_log'))) {
    await knex.schema.createTable('safety_incident_audit_log', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('incident_id').notNullable().references('id').inTable('safety_incidents').onDelete('CASCADE');
      t.uuid('claim_id').nullable();
      t.uuid('actor_id').nullable();
      t.text('actor_name').nullable();
      t.text('action').notNullable(); // created | updated | status_changed | note_added | doc_uploaded | claim_linked
      t.text('field_name').nullable();
      t.text('old_value').nullable();
      t.text('new_value').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_safety_audit_incident ON safety_incident_audit_log(incident_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_safety_audit_created ON safety_incident_audit_log(created_at DESC)');
  }

  // ─── 8. safety_claims ──────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('safety_claims'))) {
    await knex.schema.createTable('safety_claims', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('incident_id').notNullable().references('id').inTable('safety_incidents').onDelete('CASCADE');
      t.uuid('tenant_id').notNullable();
      t.uuid('operating_entity_id').nullable();

      // Identifiers
      t.text('internal_claim_number').nullable();
      t.text('external_claim_number').nullable();

      // Classification
      t.text('claim_type').notNullable().defaultTo('auto_liability');
      // auto_liability | cargo | general_liability | workers_comp | property
      t.text('status').notNullable().defaultTo('open');
      // open | submitted | under_investigation | settled | closed | denied | litigated

      // Insurance
      t.text('insurance_carrier').nullable();
      t.text('adjuster_name').nullable();
      t.text('adjuster_email').nullable();
      t.text('adjuster_phone').nullable();
      t.text('policy_number').nullable();

      // Optional repair linkage
      t.uuid('work_order_id').nullable();

      // Financials
      t.decimal('deductible_amount', 15, 2).nullable().defaultTo(0);
      t.decimal('reserve_amount', 15, 2).nullable().defaultTo(0);
      t.decimal('paid_amount', 15, 2).nullable().defaultTo(0);
      t.decimal('recovery_amount', 15, 2).nullable().defaultTo(0);
      t.decimal('settlement_amount', 15, 2).nullable().defaultTo(0);
      t.decimal('net_loss_amount', 15, 2).nullable().defaultTo(0);

      // Flags
      t.boolean('coverage_verified').notNullable().defaultTo(false);
      t.boolean('liability_accepted').notNullable().defaultTo(false);
      t.boolean('litigation_flag').notNullable().defaultTo(false);
      t.text('attorney_assigned').nullable();

      // Dates
      t.date('opened_date').nullable();
      t.date('submitted_date').nullable();
      t.date('closed_date').nullable();
      t.date('next_followup_date').nullable();
      t.date('last_contacted_date').nullable();

      t.text('notes').nullable();
      t.uuid('created_by').nullable();
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_safety_claims_incident ON safety_claims(incident_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_safety_claims_tenant ON safety_claims(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_safety_claims_status ON safety_claims(status)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_safety_claims_followup ON safety_claims(next_followup_date)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_safety_claims_work_order ON safety_claims(work_order_id)');
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('safety_incident_audit_log');
  await knex.schema.dropTableIfExists('safety_incident_tasks');
  await knex.schema.dropTableIfExists('safety_incident_documents');
  await knex.schema.dropTableIfExists('safety_incident_notes');
  await knex.schema.dropTableIfExists('safety_incident_witnesses');
  await knex.schema.dropTableIfExists('safety_incident_parties');
  await knex.schema.dropTableIfExists('safety_claims');
  await knex.schema.dropTableIfExists('safety_incidents');
};
