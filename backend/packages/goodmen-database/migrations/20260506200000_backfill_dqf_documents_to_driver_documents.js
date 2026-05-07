/**
 * FN-1462: Backfill rows from legacy `dqf_documents` into canonical
 * `driver_documents`, preserving UUIDs.
 *
 * Context (parent FN-1460): the DQF document upload flow historically wrote
 * to `dqf_documents`, but `dqf_driver_status.evidence_document_id` FKs to
 * `driver_documents`. Every UI upload therefore failed with an FK violation
 * when the requirement-status row was updated. The backend fix (FN-1461)
 * re-points new uploads at `driver_documents`; this migration moves the
 * already-uploaded legacy rows over so customer files don't orphan.
 *
 * Column mapping (legacy -> canonical):
 *   id              -> id              (preserved UUID; FK target)
 *   driver_id       -> driver_id
 *   document_type   -> doc_type
 *   file_name       -> file_name
 *   file_path       -> storage_key
 *   file_size       -> size_bytes      (NULL legacy rows -> 0; canonical NOT NULL)
 *   mime_type       -> mime_type       (NULL legacy rows -> 'application/octet-stream')
 *   uploaded_by     -> (dropped; canonical schema has no equivalent column)
 *   created_at      -> created_at
 *   updated_at      -> (dropped; canonical schema has no equivalent column)
 *   (none)          -> packet_id       NULL (no legacy source)
 *   (none)          -> blob_id         NULL (legacy stored at storage_key, not in driver_document_blobs)
 *   (none)          -> storage_mode    'legacy_dqf' sentinel; download path treats storage_key as legacy file path/key
 *   drivers.tenant_id -> tenant_id     derived via JOIN (matches 20260316220000 backfill rule)
 *   (none)          -> deleted_at      NULL (column default)
 *
 * Idempotent: ON CONFLICT (id) DO NOTHING. Safe to re-run; tolerates
 * dqf_documents being empty on fresh dev DBs (no-op).
 *
 * NOTE: `dqf_documents` is intentionally NOT dropped here. The plan is to
 * leave it as a read-only legacy shim for one release cycle, then drop in a
 * follow-up ticket once FN-1461 is verified in prod.
 *
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasDqf = await knex.schema.hasTable('dqf_documents');
  const hasCanonical = await knex.schema.hasTable('driver_documents');
  if (!hasDqf || !hasCanonical) {
    // Fresh DB or partial schema; nothing to backfill.
    return;
  }

  const beforeRow = await knex('dqf_documents').count({ c: '*' }).first();
  const sourceCount = Number(beforeRow ? beforeRow.c : 0);
  if (sourceCount === 0) {
    // No legacy rows to copy.
    // eslint-disable-next-line no-console
    console.log(
      '[migration 20260506200000] dqf_documents is empty; backfill is a no-op'
    );
    return;
  }

  // Pre-existing rows already in canonical with the same UUID are kept.
  const conflictRow = await knex.raw(`
    SELECT COUNT(*)::int AS c
    FROM dqf_documents q
    WHERE EXISTS (SELECT 1 FROM driver_documents d WHERE d.id = q.id)
  `);
  const skippedConflicts = Number(conflictRow.rows[0].c);

  await knex.raw(`
    INSERT INTO driver_documents (
      id,
      driver_id,
      packet_id,
      doc_type,
      file_name,
      mime_type,
      size_bytes,
      storage_mode,
      storage_key,
      blob_id,
      tenant_id,
      created_at
    )
    SELECT
      q.id,
      q.driver_id,
      NULL,
      q.document_type,
      q.file_name,
      COALESCE(q.mime_type, 'application/octet-stream'),
      COALESCE(q.file_size, 0),
      'legacy_dqf',
      q.file_path,
      NULL,
      d.tenant_id,
      COALESCE(q.created_at, NOW())
    FROM dqf_documents q
    LEFT JOIN drivers d ON d.id = q.driver_id
    ON CONFLICT (id) DO NOTHING
  `);

  const afterRow = await knex.raw(`
    SELECT COUNT(*)::int AS c
    FROM driver_documents d
    WHERE EXISTS (SELECT 1 FROM dqf_documents q WHERE q.id = d.id)
  `);
  const present = Number(afterRow.rows[0].c);
  const inserted = present - skippedConflicts;

  // eslint-disable-next-line no-console
  console.log(
    `[migration 20260506200000] backfilled ${inserted} rows from dqf_documents to driver_documents (skipped ${skippedConflicts} conflicts; ${sourceCount} source rows total)`
  );
};

/**
 * Intentionally a no-op.
 *
 * The backfilled rows become FK targets for `dqf_driver_status.evidence_document_id`
 * once the backend (FN-1461) is deployed. Removing them on rollback would orphan
 * those FKs and silently re-introduce the original bug. If a true rollback is
 * needed, do it with a separate, explicit data-migration ticket that reasons
 * about the FK consequences.
 *
 * @returns { Promise<void> }
 */
exports.down = async function down() {
  // No-op: see header comment.
};
