'use strict';

/**
 * FN-1803 (story FN-1790) — link a lease-to-own agreement to the generic
 * e-sign engine's `signature_requests` (FN-1788).
 *
 * When a lease agreement is sent for signature we create a signature request via
 * `signature-service` and record its id here. The signature-completion hook then
 * resolves the lease agreement back from this column to set `signed_at`, persist
 * the signed-PDF key, and advance `pending_signature -> active`.
 *
 * Additive and backward-compatible: guarded by hasColumn, and the FK to
 * `signature_requests` is only attached when that table exists.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('lease_agreements'))) return;
  if (await knex.schema.hasColumn('lease_agreements', 'signature_request_id')) return;

  const hasSignatureRequests = await knex.schema.hasTable('signature_requests');

  await knex.schema.alterTable('lease_agreements', (t) => {
    const col = t.uuid('signature_request_id').nullable();
    if (hasSignatureRequests) {
      col.references('id').inTable('signature_requests').onDelete('SET NULL');
    }
  });

  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_lease_agreements_signature_request ON lease_agreements(signature_request_id)'
  );
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasColumn('lease_agreements', 'signature_request_id'))) return;
  await knex.raw('DROP INDEX IF EXISTS idx_lease_agreements_signature_request');
  await knex.schema.alterTable('lease_agreements', (t) => {
    t.dropColumn('signature_request_id');
  });
};
