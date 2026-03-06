'use strict';

/**
 * Add PROOF_OF_DELIVERY and ROADSIDE_MAINTENANCE_RECEIPT to load_attachments.type
 * so drivers can upload POD and roadside maintenance receipts.
 * Runs without a transaction because ALTER TYPE ... ADD VALUE cannot run inside a transaction.
 */
exports.config = { transaction: false };

exports.up = async function (knex) {
  const r = await knex.raw(`
    SELECT udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'load_attachments'
      AND column_name = 'type'
    LIMIT 1
  `);
  const udtName = r?.rows?.[0]?.udt_name;
  if (!udtName) return;

  // Native PostgreSQL enum (custom type)
  if (udtName !== 'varchar') {
    const quoted = knex.client.config.client === 'pg' ? `"${udtName}"` : udtName;
    await knex.raw(`ALTER TYPE ${quoted} ADD VALUE 'PROOF_OF_DELIVERY'`).catch(() => {});
    await knex.raw(`ALTER TYPE ${quoted} ADD VALUE 'ROADSIDE_MAINTENANCE_RECEIPT'`).catch(() => {});
    return;
  }

  // Column is varchar with CHECK constraint
  await knex.raw(
    `ALTER TABLE load_attachments DROP CONSTRAINT IF EXISTS load_attachments_type_check`
  );
  await knex.raw(`
    ALTER TABLE load_attachments
    ADD CONSTRAINT load_attachments_type_check
    CHECK (type IN (
      'RATE_CONFIRMATION','BOL','LUMPER','OTHER','CONFIRMATION',
      'PROOF_OF_DELIVERY','ROADSIDE_MAINTENANCE_RECEIPT'
    ))
  `);
};

exports.down = async function (knex) {
  // Removing enum values in PostgreSQL is not straightforward; we leave the enum as-is.
  // If you used CHECK constraint, you could restore the old constraint here.
};
