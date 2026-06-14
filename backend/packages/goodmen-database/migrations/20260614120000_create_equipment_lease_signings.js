'use strict';

/**
 * Equipment / Motor-Carrier Lease Agreement linkage (FN-1800 / story FN-1789).
 *
 * Thin adapter join that ties a generic e-signature request (FN-1796 schema,
 * FN-1797 engine) to the equipment subject it was sent for — a fleet vehicle
 * (`vehicles.ownership_type='leased'`) or an equipment-owner / lessor payee
 * (settlements). Keeps the signing engine document-type-agnostic: the engine
 * owns `signature_requests`; this table owns the equipment-domain linkage.
 *
 *   equipment_lease_signings — one row per (subject → signature_request)
 *
 * Stores the request id + a denormalized copy of the signed-PDF R2 key so the
 * equipment record can show "sent / viewed / signed" status and offer the
 * signed PDF without re-deriving the link from the request side.
 *
 * Additive and backward-compatible — guarded by hasTable, and the FK to
 * signature_requests is only attached when that table exists.
 */
exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  const hasUsers = await knex.schema.hasTable('users');
  const hasSignatureRequests = await knex.schema.hasTable('signature_requests');

  if (!(await knex.schema.hasTable('equipment_lease_signings'))) {
    await knex.schema.createTable('equipment_lease_signings', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable(); // company scope
      t.uuid('operating_entity_id').nullable(); // MC / entity scope

      // What the lease was sent for: a fleet vehicle or an equipment-owner payee.
      t.text('subject_type').notNullable(); // vehicle | equipment_owner
      t.uuid('subject_id').notNullable();

      const requestId = t.uuid('signature_request_id').notNullable();
      if (hasSignatureRequests) {
        requestId.references('id').inTable('signature_requests').onDelete('CASCADE');
      }

      t.text('document_type').notNullable().defaultTo('lease_agreement');
      t.text('signed_pdf_storage_key').nullable(); // denormalized from the request once signed

      const createdBy = t.uuid('created_by').nullable();
      if (hasUsers) {
        createdBy.references('id').inTable('users').onDelete('SET NULL');
      }

      t.timestamps(true, true);

      // One linkage per signature request — a request belongs to exactly one subject.
      t.unique(['signature_request_id'], { indexName: 'uq_equipment_lease_signings_request' });
    });

    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_equipment_lease_signings_subject ON equipment_lease_signings(tenant_id, subject_type, subject_id)'
    );
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_equipment_lease_signings_tenant ON equipment_lease_signings(tenant_id)'
    );
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('equipment_lease_signings');
};
