/**
 * FN-1497 — Repair `work_orders_status_check` constraint drift on dev.
 *
 * The original migration created `status` as a Knex `enu(...)` (CHECK + text)
 * with the legacy lowercase values: open / in_progress / completed / closed.
 * Dev DB drifted to a canonical-only constraint
 * (DRAFT, IN_PROGRESS, WAITING_PARTS, COMPLETED, CLOSED, CANCELED), which
 * blocks `services/work-orders.service.js` writes that go through
 * `normalizeStatus(payload.status, 'open')`.
 *
 * This migration widens the CHECK to accept the union of both vocabularies so
 * the service can write `'open'` today and the workflow refactor can write
 * `'DRAFT'` tomorrow.
 *
 * - Idempotent: drops/recreates the constraint with IF EXISTS / IF NOT EXISTS guards.
 * - Defensive: drops any orphan `work_orders%status%` postgres ENUM type and
 *   coerces `status` to plain text if found (dev currently has none — guarded
 *   for environments where the column was created as a native ENUM).
 * - Safe: aborts before re-adding the constraint if any existing row holds a
 *   value outside the new union, so rows are never silently stranded.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

const ALLOWED_VALUES = [
  // Legacy lowercase — what work-orders.service.js writes today via normalizeStatus
  'open',
  'in_progress',
  'completed',
  'closed',
  // Canonical uppercase — STATUS_TRANSITIONS workflow values
  'DRAFT',
  'IN_PROGRESS',
  'WAITING_PARTS',
  'COMPLETED',
  'CLOSED',
  'CANCELED'
];

const CANONICAL_ONLY = ['DRAFT', 'IN_PROGRESS', 'WAITING_PARTS', 'COMPLETED', 'CLOSED', 'CANCELED'];

function quotedList(values) {
  return values.map(v => `'${v}'`).join(', ');
}

exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('work_orders');
  if (!hasTable) return;

  // 1. Drop the existing CHECK constraint if present (no-op if already gone).
  await knex.raw('ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_status_check');

  // 2. Coerce native ENUM type to text if one exists.
  //    Knex `table.enu(...)` defaults to CHECK + text, but the column may have
  //    been created as a native enum in some environments — handle both.
  const enumTypeResult = await knex.raw(`
    SELECT t.typname
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname LIKE 'work_orders%status%'
    GROUP BY t.typname
  `);
  const enumTypeName = enumTypeResult?.rows?.[0]?.typname;

  const colTypeResult = await knex.raw(`
    SELECT data_type, udt_name
    FROM information_schema.columns
    WHERE table_name = 'work_orders' AND column_name = 'status'
  `);
  const udtName = colTypeResult?.rows?.[0]?.udt_name;

  if (udtName && udtName !== 'text' && udtName !== 'varchar') {
    await knex.raw('ALTER TABLE work_orders ALTER COLUMN status TYPE text USING status::text');
  }
  if (enumTypeName) {
    await knex.raw(`DROP TYPE IF EXISTS ${enumTypeName}`);
  }

  // 3. Backfill guard — abort loudly if any row would be stranded by the new constraint.
  const orphanResult = await knex.raw(
    `SELECT COUNT(*)::int AS cnt FROM work_orders WHERE status IS NOT NULL AND status NOT IN (${quotedList(ALLOWED_VALUES)})`
  );
  const orphanCount = orphanResult?.rows?.[0]?.cnt ?? 0;
  if (orphanCount > 0) {
    const sample = await knex.raw(
      `SELECT status, COUNT(*)::int AS cnt FROM work_orders WHERE status NOT IN (${quotedList(ALLOWED_VALUES)}) GROUP BY status`
    );
    const summary = (sample?.rows || []).map(r => `${r.status}=${r.cnt}`).join(', ');
    throw new Error(
      `[FN-1497] Aborting: ${orphanCount} work_orders row(s) have status values outside the new constraint set (${summary}). ` +
      `Resolve these rows before re-running this migration. Allowed values: ${ALLOWED_VALUES.join(', ')}.`
    );
  }

  // 4. Re-add the CHECK constraint with the union of legacy + canonical values.
  //    Guarded with NOT EXISTS so re-running on a fresh DB (where the new
  //    constraint already matches) is a no-op.
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_status_check'
      ) THEN
        ALTER TABLE work_orders
          ADD CONSTRAINT work_orders_status_check
          CHECK (status = ANY (ARRAY[${quotedList(ALLOWED_VALUES)}]::text[]));
      END IF;
    END $$;
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable('work_orders');
  if (!hasTable) return;

  await knex.raw('ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_status_check');

  // Restore the canonical-only constraint that was on dev before this migration.
  // Down still applies the backfill guard so we don't strand legacy rows on rollback.
  const orphanResult = await knex.raw(
    `SELECT COUNT(*)::int AS cnt FROM work_orders WHERE status IS NOT NULL AND status NOT IN (${quotedList(CANONICAL_ONLY)})`
  );
  const orphanCount = orphanResult?.rows?.[0]?.cnt ?? 0;
  if (orphanCount > 0) {
    throw new Error(
      `[FN-1497 down] Aborting: ${orphanCount} work_orders row(s) hold legacy status values that the canonical constraint would reject. ` +
      `Migrate these rows to canonical values (DRAFT/IN_PROGRESS/WAITING_PARTS/COMPLETED/CLOSED/CANCELED) before rolling back.`
    );
  }

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_status_check'
      ) THEN
        ALTER TABLE work_orders
          ADD CONSTRAINT work_orders_status_check
          CHECK (status = ANY (ARRAY[${quotedList(CANONICAL_ONLY)}]::text[]));
      END IF;
    END $$;
  `);
};
