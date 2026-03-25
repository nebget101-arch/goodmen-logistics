const { query } = require('../internal/db');

async function upsertRequirementStatus(driverId, requirementKey, status, evidenceDocumentId, completionDate) {
  if (!driverId || !requirementKey) {
    throw new Error('driverId and requirementKey are required');
  }

  const finalStatus = status || 'missing';

  // FN-229: When evidence_document_id is explicitly provided, REPLACE the old one
  // (don't COALESCE — re-submissions must update the document link)
  await query(
    `INSERT INTO dqf_driver_status (driver_id, requirement_key, status, evidence_document_id, completion_date, last_updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (driver_id, requirement_key) DO UPDATE SET
       status = EXCLUDED.status,
       evidence_document_id = CASE
         WHEN EXCLUDED.evidence_document_id IS NOT NULL THEN EXCLUDED.evidence_document_id
         ELSE dqf_driver_status.evidence_document_id
       END,
       completion_date = COALESCE(EXCLUDED.completion_date, dqf_driver_status.completion_date),
       last_updated_at = NOW()`,
    [driverId, requirementKey, finalStatus, evidenceDocumentId || null, completionDate || null]
  );
}

async function computeAndUpdateDqfCompleteness(driverId) {
  if (!driverId) throw new Error('driverId is required');

  const res = await query(
    `
    SELECT r.key,
           r.weight,
           COALESCE(s.status, 'missing') AS status
    FROM dqf_requirements r
    LEFT JOIN dqf_driver_status s
      ON s.requirement_key = r.key
     AND s.driver_id = $1
    `,
    [driverId]
  );

  if (res.rows.length === 0) {
    await query('UPDATE drivers SET dqf_completeness = 0 WHERE id = $1', [driverId]);
    return 0;
  }

  let totalWeight = 0;
  let completedWeight = 0;

  res.rows.forEach((row) => {
    const w = Number(row.weight) || 0;
    totalWeight += w;
    if (row.status === 'complete') {
      completedWeight += w;
    }
  });

  const completeness = totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0;

  await query('UPDATE drivers SET dqf_completeness = $1 WHERE id = $2', [
    completeness,
    driverId
  ]);

  return completeness;
}

async function logStatusChange(driverId, requirementKey, oldStatus, newStatus, changedByUserId, note) {
  if (!driverId || !requirementKey || !newStatus) {
    throw new Error('driverId, requirementKey, and newStatus are required');
  }

  await query(
    `INSERT INTO dqf_status_changes (driver_id, requirement_key, old_status, new_status, changed_by_user_id, note)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [driverId, requirementKey, oldStatus || 'missing', newStatus, changedByUserId || null, note || null]
  );
}

module.exports = {
  upsertRequirementStatus,
  computeAndUpdateDqfCompleteness,
  logStatusChange
};

