/**
 * Add INVOICED to invoices.status enum.
 */
exports.up = async function(knex) {
  const statusEnumResult = await knex.raw(`
    SELECT t.typname
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname LIKE 'invoices%status%'
    GROUP BY t.typname
  `);
  const statusEnum = statusEnumResult?.rows?.[0]?.typname;
  if (!statusEnum) return;

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = '${statusEnum}' AND e.enumlabel = 'INVOICED'
      ) THEN
        EXECUTE 'ALTER TYPE ${statusEnum} ADD VALUE ''INVOICED''';
      END IF;
    END $$;
  `);
};

exports.down = async function(knex) {
  // No-op: removing enum values is unsafe.
};
