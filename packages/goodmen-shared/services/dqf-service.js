const { query } = require('../internal/db');

async function upsertRequirementStatus(driverId, requirementKey, status, evidenceDocumentId) {
  if (!driverId || !requirementKey) {
    throw new Error('driverId and requirementKey are required');
  }

  const finalStatus = status || 'missing';

  await query(
    `INSERT INTO dqf_driver_status (driver_id, requirement_key, status, evidence_document_id, last_updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (driver_id, requirement_key) DO UPDATE SET
       status = EXCLUDED.status,
       evidence_document_id = COALESCE(EXCLUDED.evidence_document_id, dqf_driver_status.evidence_document_id),
       last_updated_at = NOW()`,
    [driverId, requirementKey, finalStatus, evidenceDocumentId || null]
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

module.exports = {
  upsertRequirementStatus,
  computeAndUpdateDqfCompleteness
};

