const { query } = require('../internal/db');

// Keys that belong to "annual" category (including clearinghouse moved from other)
const ANNUAL_DUE_DATE_KEYS = [
  'annual_mvr_inquiry',
  'annual_driving_record_review',
  'annual_clearinghouse_limited_query',
  'annual_clearinghouse_query' // DB alias
];

/**
 * Compute the due date and urgency for a time-sensitive DQF requirement.
 * @param {string} category - 'within_30_days' or 'annual'
 * @param {string} requirementKey
 * @param {Date|string|null} hireDate
 * @returns {{ due_date: string|null, urgency: 'green'|'yellow'|'red'|null }}
 */
function computeDueDateAndUrgency(category, requirementKey, hireDate) {
  if (!hireDate) return { due_date: null, urgency: null };

  const now = new Date();
  const hire = new Date(hireDate);

  if (category === 'within_30_days') {
    const dueDate = new Date(hire);
    dueDate.setDate(dueDate.getDate() + 30);
    const daysRemaining = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));

    let urgency;
    if (daysRemaining < 0) {
      urgency = 'red';
    } else if (daysRemaining <= 15) {
      urgency = 'yellow';
    } else {
      urgency = 'green';
    }

    return { due_date: dueDate.toISOString().split('T')[0], urgency };
  }

  if (category === 'annual' && ANNUAL_DUE_DATE_KEYS.includes(requirementKey)) {
    // Find the next anniversary of hire date
    let anniversaryYear = now.getFullYear();
    const anniversaryThisYear = new Date(anniversaryYear, hire.getMonth(), hire.getDate());
    if (anniversaryThisYear <= now) {
      anniversaryYear += 1;
    }
    const nextAnniversary = new Date(anniversaryYear, hire.getMonth(), hire.getDate());

    const msRemaining = nextAnniversary - now;
    const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));

    let urgency;
    if (daysRemaining < 0) {
      urgency = 'red';
    } else if (daysRemaining <= 30) {
      urgency = 'yellow';
    } else {
      urgency = 'green';
    }

    return { due_date: nextAnniversary.toISOString().split('T')[0], urgency };
  }

  return { due_date: null, urgency: null };
}

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

  // Fetch the driver's hire_date for time-based category logic
  const driverRes = await query(
    'SELECT hire_date FROM drivers WHERE id = $1',
    [driverId]
  );
  const hireDate = driverRes.rows.length > 0 ? driverRes.rows[0].hire_date : null;

  const res = await query(
    `
    SELECT r.key,
           r.weight,
           r.category,
           r.exclude_from_dqf,
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

  const now = new Date();
  let totalWeight = 0;
  let completedWeight = 0;
  const counted = [];
  const skipped = [];

  // FN-366: Keys that are no longer displayed on the frontend DQF checklist
  // but were not marked exclude_from_dqf in migrations. Exclude them here
  // so backend completeness matches what the user sees.
  const BACKEND_EXTRA_EXCLUDES = new Set([
    'medical_card_back_on_file',   // FN-269: medical card is one page; frontend removed this
  ]);

  res.rows.forEach((row) => {
    // Skip requirements explicitly excluded from DQF
    if (row.exclude_from_dqf) { skipped.push({ key: row.key, reason: 'exclude_from_dqf' }); return; }

    // FN-319: Exclude "other" category entirely from completeness
    if (row.category === 'other') { skipped.push({ key: row.key, reason: 'other_category' }); return; }

    // FN-366: Exclude keys removed from frontend display
    if (BACKEND_EXTRA_EXCLUDES.has(row.key)) { skipped.push({ key: row.key, reason: 'frontend_removed' }); return; }

    const w = Number(row.weight) || 0;

    // "annual" category: only include in calculation if
    // hire_date anniversary is within 2 months (i.e. hire_date + 10 months has passed)
    if (row.category === 'annual' && hireDate) {
      const hire = new Date(hireDate);
      let anniversaryYear = now.getFullYear();
      const anniversaryThisYear = new Date(anniversaryYear, hire.getMonth(), hire.getDate());
      if (anniversaryThisYear < now) {
        anniversaryYear += 1;
      }
      const nextAnniversary = new Date(anniversaryYear, hire.getMonth(), hire.getDate());
      const twoMonthsBefore = new Date(nextAnniversary);
      twoMonthsBefore.setMonth(twoMonthsBefore.getMonth() - 2);

      if (now < twoMonthsBefore) { skipped.push({ key: row.key, reason: 'annual_not_due' }); return; }
    } else if (row.category === 'annual' && !hireDate) {
      skipped.push({ key: row.key, reason: 'annual_no_hire_date' });
      return;
    }

    // "within_30_days" category: only include in calculation
    // if hire_date + 30 days has passed
    if (row.category === 'within_30_days' && hireDate) {
      const hire = new Date(hireDate);
      const thirtyDaysAfterHire = new Date(hire);
      thirtyDaysAfterHire.setDate(thirtyDaysAfterHire.getDate() + 30);
      if (now < thirtyDaysAfterHire) { skipped.push({ key: row.key, reason: 'within_30_not_due' }); return; }
    } else if (row.category === 'within_30_days' && !hireDate) {
      skipped.push({ key: row.key, reason: 'within_30_no_hire_date' });
      return;
    }

    totalWeight += w;
    if (row.status === 'complete') {
      completedWeight += w;
    }
    counted.push({ key: row.key, category: row.category, weight: w, status: row.status });
  });

  const completeness = totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0;

  await query('UPDATE drivers SET dqf_completeness = $1 WHERE id = $2', [
    completeness,
    driverId
  ]);

  return { completeness, totalWeight, completedWeight, counted, skipped };
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

/**
 * Compute warning items for a driver's DQF checklist.
 * Warning items are requirements approaching their deadline but not yet overdue:
 *   - within_30_days: warn if hire_date + 30 days has NOT yet passed
 *   - annual: warn if within 2 months of the hire anniversary
 *
 * @param {string} driverId
 * @returns {Promise<Array<{key: string, label: string, category: string, reason: string}>>}
 */
async function computeWarningItems(driverId) {
  if (!driverId) throw new Error('driverId is required');

  const driverRes = await query(
    'SELECT hire_date FROM drivers WHERE id = $1',
    [driverId]
  );
  const hireDate = driverRes.rows.length > 0 ? driverRes.rows[0].hire_date : null;

  if (!hireDate) return [];

  const reqRes = await query(
    `
    SELECT r.key,
           r.label,
           r.category,
           r.exclude_from_dqf,
           COALESCE(s.status, 'missing') AS status
    FROM dqf_requirements r
    LEFT JOIN dqf_driver_status s
      ON s.requirement_key = r.key
     AND s.driver_id = $1
    `,
    [driverId]
  );

  const now = new Date();
  const hire = new Date(hireDate);
  const warnings = [];

  reqRes.rows.forEach((row) => {
    if (row.exclude_from_dqf) return;
    if (row.status === 'complete') return;

    // within_30_days: warn if 30-day deadline hasn't passed yet
    if (row.category === 'within_30_days') {
      const thirtyDaysAfterHire = new Date(hire);
      thirtyDaysAfterHire.setDate(thirtyDaysAfterHire.getDate() + 30);
      if (now < thirtyDaysAfterHire) {
        warnings.push({
          key: row.key,
          label: row.label,
          category: row.category,
          reason: 'Due within 30 days of hire',
          deadline: thirtyDaysAfterHire.toISOString()
        });
      }
    }

    // annual: warn if within 2 months of hire anniversary
    if (row.category === 'annual') {
      let anniversaryYear = now.getFullYear();
      const anniversaryThisYear = new Date(anniversaryYear, hire.getMonth(), hire.getDate());
      if (anniversaryThisYear < now) {
        anniversaryYear += 1;
      }
      const nextAnniversary = new Date(anniversaryYear, hire.getMonth(), hire.getDate());
      const twoMonthsBefore = new Date(nextAnniversary);
      twoMonthsBefore.setMonth(twoMonthsBefore.getMonth() - 2);

      if (now >= twoMonthsBefore && now < nextAnniversary) {
        warnings.push({
          key: row.key,
          label: row.label,
          category: row.category,
          reason: 'Due by hire anniversary',
          deadline: nextAnniversary.toISOString()
        });
      }
    }
  });

  return warnings;
}

module.exports = {
  upsertRequirementStatus,
  computeAndUpdateDqfCompleteness,
  logStatusChange,
  computeWarningItems,
  computeDueDateAndUrgency,
  ANNUAL_DUE_DATE_KEYS
};

