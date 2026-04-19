'use strict';

/**
 * FN-782 — Email-to-Load: allow 'test_pending' on inbound_emails.processing_status.
 *
 * The self-diagnostic test endpoint inserts a placeholder row before the
 * downstream webhook round-trips. When the webhook later reconciles, it flips
 * the row to success/rejected. The existing CHECK constraint only allowed
 * pending|success|failed|rejected, which would block the placeholder insert.
 */

const OLD_STATUSES = ['pending', 'success', 'failed', 'rejected'];
const NEW_STATUSES = ['pending', 'success', 'failed', 'rejected', 'test_pending'];
const CONSTRAINT = 'inbound_emails_processing_status_check';

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('inbound_emails');
  if (!hasTable) return;

  await knex.raw(`ALTER TABLE inbound_emails DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
  await knex.raw(
    `ALTER TABLE inbound_emails
       ADD CONSTRAINT ${CONSTRAINT}
       CHECK (processing_status IN (${NEW_STATUSES.map((s) => `'${s}'`).join(', ')}))`
  );
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('inbound_emails');
  if (!hasTable) return;

  await knex.raw(`ALTER TABLE inbound_emails DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
  await knex.raw(
    `ALTER TABLE inbound_emails
       ADD CONSTRAINT ${CONSTRAINT}
       CHECK (processing_status IN (${OLD_STATUSES.map((s) => `'${s}'`).join(', ')}))`
  );
};
