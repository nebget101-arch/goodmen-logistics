/**
 * Employer Investigation Service
 *
 * Manages the previous employer investigation workflow for DOT compliance.
 * Tracks inquiry/follow-up/response lifecycle per past employer and maintains
 * a running investigation history file per driver.
 */
const { query, getClient } = require('../internal/db');
const { upsertRequirementStatus, computeAndUpdateDqfCompleteness } = require('./dqf-service');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Add an entry to the driver_investigation_history_file.
 */
async function addHistoryEntry(client, { driverId, pastEmployerId, entryType, description, metadata, createdBy }) {
  await client.query(
    `INSERT INTO driver_investigation_history_file
       (driver_id, past_employer_id, entry_type, description, metadata, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      driverId,
      pastEmployerId || null,
      entryType,
      description || null,
      JSON.stringify(metadata || {}),
      createdBy || null
    ]
  );
}

/**
 * Append an object to the good_faith_efforts JSONB array on a past employer row.
 */
async function appendGoodFaithEffort(client, pastEmployerId, effort) {
  await client.query(
    `UPDATE driver_past_employers
        SET good_faith_efforts = COALESCE(good_faith_efforts, '[]'::jsonb) || $1::jsonb,
            updated_at = NOW()
      WHERE id = $2`,
    [JSON.stringify(effort), pastEmployerId]
  );
}

/**
 * Check if all DOT-regulated past employers for a driver have a terminal
 * status (response_received, no_response_documented, or complete).
 * If so, mark the driver's investigation file as complete and update DQF.
 */
async function checkAndCompleteInvestigation(client, driverId) {
  const res = await client.query(
    `SELECT id, investigation_status
       FROM driver_past_employers
      WHERE driver_id = $1 AND is_dot_regulated = true`,
    [driverId]
  );

  if (res.rows.length === 0) {
    return false;
  }

  const terminalStatuses = new Set(['response_received', 'no_response_documented', 'complete']);
  const allComplete = res.rows.every((row) => terminalStatuses.has(row.investigation_status));

  if (allComplete) {
    await client.query(
      `UPDATE drivers
          SET investigation_file_status = 'complete'
        WHERE id = $1`,
      [driverId]
    );

    // Mark each employer as complete
    await client.query(
      `UPDATE driver_past_employers
          SET investigation_status = 'complete', updated_at = NOW()
        WHERE driver_id = $1 AND is_dot_regulated = true AND investigation_status != 'complete'`,
      [driverId]
    );

    // Update DQF requirement
    await upsertRequirementStatus(driverId, 'employment_verification_submitted', 'complete', null);
    await computeAndUpdateDqfCompleteness(driverId);

    await addHistoryEntry(client, {
      driverId,
      pastEmployerId: null,
      entryType: 'investigation_completed',
      description: 'All employer investigations completed',
      metadata: { employerCount: res.rows.length }
    });

    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initiate the investigation process for a driver.
 * Calculates the deadline (hire_date + 30 days), updates the driver record,
 * and sets all DOT-regulated past employers to not_started.
 */
async function initiateInvestigation(driverId, userId) {
  if (!driverId) throw new Error('driverId is required');

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Fetch driver hire date
    const driverRes = await client.query(
      `SELECT id, hire_date, first_name, last_name
         FROM drivers WHERE id = $1`,
      [driverId]
    );
    if (driverRes.rows.length === 0) {
      throw new Error('Driver not found');
    }

    const driver = driverRes.rows[0];
    const hireDate = driver.hire_date;
    if (!hireDate) {
      throw new Error('Driver hire_date is required to initiate investigation');
    }

    // Deadline = hire_date + 30 days
    const deadline = new Date(hireDate);
    deadline.setDate(deadline.getDate() + 30);
    const deadlineStr = deadline.toISOString().split('T')[0];

    // Update driver investigation status
    await client.query(
      `UPDATE drivers
          SET investigation_file_status = 'in_progress',
              investigation_deadline = $1
        WHERE id = $2`,
      [deadlineStr, driverId]
    );

    // Fetch DOT-regulated past employers and set them to not_started
    const employersRes = await client.query(
      `SELECT id, employer_name
         FROM driver_past_employers
        WHERE driver_id = $1 AND is_dot_regulated = true`,
      [driverId]
    );

    for (const emp of employersRes.rows) {
      await client.query(
        `UPDATE driver_past_employers
            SET investigation_status = 'not_started',
                deadline_date = $1,
                updated_at = NOW()
          WHERE id = $2`,
        [deadlineStr, emp.id]
      );
    }

    // Update DQF requirement to in_progress
    await upsertRequirementStatus(driverId, 'employment_verification_submitted', 'in_progress', null);

    // Add history entry
    await addHistoryEntry(client, {
      driverId,
      pastEmployerId: null,
      entryType: 'investigation_initiated',
      description: `Investigation initiated for ${driver.first_name} ${driver.last_name}`,
      metadata: {
        deadline: deadlineStr,
        employerCount: employersRes.rows.length,
        employers: employersRes.rows.map((e) => ({ id: e.id, name: e.employer_name }))
      },
      createdBy: userId
    });

    await client.query('COMMIT');

    return {
      driverId,
      investigationFileStatus: 'in_progress',
      deadline: deadlineStr,
      employers: employersRes.rows.map((e) => ({
        id: e.id,
        employerName: e.employer_name,
        investigationStatus: 'not_started'
      }))
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Record that an inquiry was sent to a past employer.
 */
async function sendInquiry(pastEmployerId, userId) {
  if (!pastEmployerId) throw new Error('pastEmployerId is required');

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Fetch employer to get driver_id
    const empRes = await client.query(
      `SELECT id, driver_id, employer_name FROM driver_past_employers WHERE id = $1`,
      [pastEmployerId]
    );
    if (empRes.rows.length === 0) {
      throw new Error('Past employer not found');
    }
    const emp = empRes.rows[0];

    await client.query(
      `UPDATE driver_past_employers
          SET investigation_status = 'inquiry_sent',
              inquiry_sent_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [pastEmployerId]
    );

    await appendGoodFaithEffort(client, pastEmployerId, {
      action: 'inquiry_sent',
      date: new Date().toISOString(),
      by: userId
    });

    await addHistoryEntry(client, {
      driverId: emp.driver_id,
      pastEmployerId,
      entryType: 'employer_inquiry',
      description: `Inquiry sent to ${emp.employer_name}`,
      metadata: { action: 'inquiry_sent' },
      createdBy: userId
    });

    await client.query('COMMIT');

    return { pastEmployerId, investigationStatus: 'inquiry_sent' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Record that a follow-up was sent to a past employer.
 */
async function sendFollowUp(pastEmployerId, userId) {
  if (!pastEmployerId) throw new Error('pastEmployerId is required');

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const empRes = await client.query(
      `SELECT id, driver_id, employer_name FROM driver_past_employers WHERE id = $1`,
      [pastEmployerId]
    );
    if (empRes.rows.length === 0) {
      throw new Error('Past employer not found');
    }
    const emp = empRes.rows[0];

    await client.query(
      `UPDATE driver_past_employers
          SET investigation_status = 'follow_up_sent',
              follow_up_sent_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [pastEmployerId]
    );

    await appendGoodFaithEffort(client, pastEmployerId, {
      action: 'follow_up_sent',
      date: new Date().toISOString(),
      by: userId
    });

    await addHistoryEntry(client, {
      driverId: emp.driver_id,
      pastEmployerId,
      entryType: 'employer_inquiry',
      description: `Follow-up sent to ${emp.employer_name}`,
      metadata: { action: 'follow_up_sent' },
      createdBy: userId
    });

    await client.query('COMMIT');

    return { pastEmployerId, investigationStatus: 'follow_up_sent' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Record a response from a past employer.
 */
async function recordResponse(pastEmployerId, { responseType, responseData, receivedVia, documentId, documentedBy }) {
  if (!pastEmployerId) throw new Error('pastEmployerId is required');
  if (!responseType) throw new Error('responseType is required');

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const empRes = await client.query(
      `SELECT id, driver_id, employer_name FROM driver_past_employers WHERE id = $1`,
      [pastEmployerId]
    );
    if (empRes.rows.length === 0) {
      throw new Error('Past employer not found');
    }
    const emp = empRes.rows[0];

    await client.query(
      `UPDATE driver_past_employers
          SET investigation_status = 'response_received',
              response_received_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [pastEmployerId]
    );

    // Insert response record
    await client.query(
      `INSERT INTO employer_investigation_responses
         (past_employer_id, response_type, response_data, received_via, document_id, documented_by)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6)`,
      [
        pastEmployerId,
        responseType,
        JSON.stringify(responseData || {}),
        receivedVia || null,
        documentId || null,
        documentedBy || null
      ]
    );

    await addHistoryEntry(client, {
      driverId: emp.driver_id,
      pastEmployerId,
      entryType: 'employer_response',
      description: `Response received from ${emp.employer_name} (${responseType})`,
      metadata: { responseType, receivedVia },
      createdBy: documentedBy
    });

    // Check if investigation is now complete
    await checkAndCompleteInvestigation(client, emp.driver_id);

    await client.query('COMMIT');

    return { pastEmployerId, investigationStatus: 'response_received', responseType };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Document that a past employer did not respond despite good-faith efforts.
 */
async function documentNoResponse(pastEmployerId, userId, notes) {
  if (!pastEmployerId) throw new Error('pastEmployerId is required');

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const empRes = await client.query(
      `SELECT id, driver_id, employer_name FROM driver_past_employers WHERE id = $1`,
      [pastEmployerId]
    );
    if (empRes.rows.length === 0) {
      throw new Error('Past employer not found');
    }
    const emp = empRes.rows[0];

    await client.query(
      `UPDATE driver_past_employers
          SET investigation_status = 'no_response_documented',
              updated_at = NOW()
        WHERE id = $1`,
      [pastEmployerId]
    );

    await appendGoodFaithEffort(client, pastEmployerId, {
      action: 'no_response_documented',
      date: new Date().toISOString(),
      by: userId,
      notes: notes || null
    });

    await addHistoryEntry(client, {
      driverId: emp.driver_id,
      pastEmployerId,
      entryType: 'good_faith_documentation',
      description: `No response documented for ${emp.employer_name}`,
      metadata: { notes: notes || null },
      createdBy: userId
    });

    // Check if investigation is now complete
    await checkAndCompleteInvestigation(client, emp.driver_id);

    await client.query('COMMIT');

    return { pastEmployerId, investigationStatus: 'no_response_documented' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get investigation status overview for a driver.
 */
async function getInvestigationStatus(driverId) {
  if (!driverId) throw new Error('driverId is required');

  // Fetch driver-level investigation fields
  const driverRes = await query(
    `SELECT id, first_name, last_name, hire_date,
            investigation_file_status, investigation_deadline
       FROM drivers WHERE id = $1`,
    [driverId]
  );
  if (driverRes.rows.length === 0) {
    return null;
  }
  const driver = driverRes.rows[0];

  // Fetch all DOT-regulated past employers with investigation data
  let employersRes = await query(
    `SELECT pe.id, pe.employer_name, pe.contact_name, pe.contact_phone,
            pe.contact_email, pe.contact_fax, pe.start_date, pe.end_date,
            pe.position_held, pe.is_dot_regulated,
            pe.investigation_status, pe.deadline_date,
            pe.inquiry_sent_at, pe.follow_up_sent_at, pe.response_received_at,
            pe.good_faith_efforts
       FROM driver_past_employers pe
      WHERE pe.driver_id = $1
      ORDER BY pe.end_date DESC NULLS LAST`,
    [driverId]
  );

  // FN-224: Fallback — if driver_past_employers is empty, auto-sync from
  // employment_application_employers (for drivers who submitted before FN-222)
  if (employersRes.rows.length === 0) {
    try {
      const appRes = await query(
        `SELECT eae.*
           FROM employment_application_employers eae
           JOIN employment_applications ea ON ea.id = eae.application_id
          WHERE ea.driver_id = $1
          ORDER BY eae.id`,
        [driverId]
      );

      if (appRes.rows.length > 0) {
        // Auto-sync: insert into driver_past_employers
        const parseMonthYear = (val) => {
          if (!val) return null;
          const str = String(val).trim().toLowerCase();
          if (str === 'present' || str === 'current') return null;
          const parts = str.split('/');
          if (parts.length === 2) {
            const [mm, yyyy] = parts;
            const m = parseInt(mm, 10);
            const y = parseInt(yyyy, 10);
            if (m >= 1 && m <= 12 && y >= 1900) return `${y}-${String(m).padStart(2, '0')}-01`;
          }
          return null;
        };

        for (const emp of appRes.rows) {
          await query(
            `INSERT INTO driver_past_employers (
              driver_id, employer_name, contact_name, contact_phone, contact_email,
              position_held, start_date, end_date, reason_for_leaving,
              is_dot_regulated, investigation_status
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              driverId,
              emp.company_name || 'Unknown',
              emp.contact_person || null,
              emp.phone || null,
              emp.employer_email || null,
              emp.position_held || null,
              parseMonthYear(emp.from_month_year),
              parseMonthYear(emp.to_month_year),
              emp.reason_for_leaving || null,
              emp.was_cmv || false,
              'not_started'
            ]
          );
        }

        // Re-fetch the newly synced employers
        employersRes = await query(
          `SELECT pe.id, pe.employer_name, pe.contact_name, pe.contact_phone,
                  pe.contact_email, pe.contact_fax, pe.start_date, pe.end_date,
                  pe.position_held, pe.is_dot_regulated,
                  pe.investigation_status, pe.deadline_date,
                  pe.inquiry_sent_at, pe.follow_up_sent_at, pe.response_received_at,
                  pe.good_faith_efforts
             FROM driver_past_employers pe
            WHERE pe.driver_id = $1
            ORDER BY pe.end_date DESC NULLS LAST`,
          [driverId]
        );
      }
    } catch (fallbackErr) {
      // Log but don't fail — the main query already returned empty
      console.error('FN-224: Employer sync fallback failed:', fallbackErr?.message || fallbackErr);
    }
  }

  // Fetch any responses for those employers
  const employerIds = employersRes.rows.map((e) => e.id);
  let responses = [];
  if (employerIds.length > 0) {
    const responsesRes = await query(
      `SELECT r.id, r.past_employer_id, r.response_type, r.response_data,
              r.received_via, r.document_id, r.documented_by, r.created_at
         FROM employer_investigation_responses r
        WHERE r.past_employer_id = ANY($1::uuid[])
        ORDER BY r.created_at DESC`,
      [employerIds]
    );
    responses = responsesRes.rows;
  }

  // Build response map
  const responsesByEmployer = {};
  for (const r of responses) {
    if (!responsesByEmployer[r.past_employer_id]) {
      responsesByEmployer[r.past_employer_id] = [];
    }
    responsesByEmployer[r.past_employer_id].push(r);
  }

  const terminalStatuses = new Set(['response_received', 'no_response_documented', 'complete']);
  const completedCount = employersRes.rows.filter((e) => terminalStatuses.has(e.investigation_status)).length;
  const totalCount = employersRes.rows.length;
  const completionPercentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return {
    driver: {
      id: driver.id,
      firstName: driver.first_name,
      lastName: driver.last_name,
      hireDate: driver.hire_date,
      investigationFileStatus: driver.investigation_file_status,
      investigationDeadline: driver.investigation_deadline
    },
    summary: {
      totalEmployers: totalCount,
      completedEmployers: completedCount,
      completionPercentage
    },
    employers: employersRes.rows.map((e) => ({
      id: e.id,
      employerName: e.employer_name,
      contactName: e.contact_name,
      contactPhone: e.contact_phone,
      contactEmail: e.contact_email,
      contactFax: e.contact_fax,
      startDate: e.start_date,
      endDate: e.end_date,
      positionHeld: e.position_held,
      investigationStatus: e.investigation_status,
      deadlineDate: e.deadline_date,
      inquirySentAt: e.inquiry_sent_at,
      followUpSentAt: e.follow_up_sent_at,
      responseReceivedAt: e.response_received_at,
      goodFaithEfforts: e.good_faith_efforts,
      responses: responsesByEmployer[e.id] || []
    }))
  };
}

/**
 * Get all overdue investigations for a tenant.
 */
async function getOverdueInvestigations(tenantId) {
  if (!tenantId) throw new Error('tenantId is required');

  const res = await query(
    `SELECT d.id AS driver_id, d.first_name, d.last_name, d.hire_date,
            d.investigation_file_status, d.investigation_deadline,
            d.operating_entity_id
       FROM drivers d
      WHERE d.tenant_id = $1
        AND d.investigation_deadline < NOW()
        AND d.investigation_file_status != 'complete'
        AND d.investigation_file_status != 'not_started'
      ORDER BY d.investigation_deadline ASC`,
    [tenantId]
  );

  // For each overdue driver, fetch employer breakdown
  const results = [];
  for (const driver of res.rows) {
    const empsRes = await query(
      `SELECT id, employer_name, investigation_status, inquiry_sent_at,
              follow_up_sent_at, response_received_at
         FROM driver_past_employers
        WHERE driver_id = $1 AND is_dot_regulated = true
        ORDER BY employer_name`,
      [driver.driver_id]
    );

    results.push({
      driverId: driver.driver_id,
      firstName: driver.first_name,
      lastName: driver.last_name,
      hireDate: driver.hire_date,
      investigationFileStatus: driver.investigation_file_status,
      investigationDeadline: driver.investigation_deadline,
      operatingEntityId: driver.operating_entity_id,
      employers: empsRes.rows.map((e) => ({
        id: e.id,
        employerName: e.employer_name,
        investigationStatus: e.investigation_status,
        inquirySentAt: e.inquiry_sent_at,
        followUpSentAt: e.follow_up_sent_at,
        responseReceivedAt: e.response_received_at
      }))
    });
  }

  return results;
}

/**
 * Get the full investigation history file for a driver.
 */
async function getHistoryFile(driverId) {
  if (!driverId) throw new Error('driverId is required');

  const res = await query(
    `SELECT h.id, h.driver_id, h.past_employer_id, h.entry_type,
            h.description, h.metadata, h.created_by, h.created_at,
            pe.employer_name AS past_employer_name
       FROM driver_investigation_history_file h
       LEFT JOIN driver_past_employers pe ON pe.id = h.past_employer_id
      WHERE h.driver_id = $1
      ORDER BY h.created_at ASC`,
    [driverId]
  );

  return res.rows.map((row) => ({
    id: row.id,
    driverId: row.driver_id,
    pastEmployerId: row.past_employer_id,
    pastEmployerName: row.past_employer_name,
    entryType: row.entry_type,
    description: row.description,
    metadata: row.metadata,
    createdBy: row.created_by,
    createdAt: row.created_at
  }));
}

module.exports = {
  initiateInvestigation,
  sendInquiry,
  sendFollowUp,
  recordResponse,
  documentNoResponse,
  getInvestigationStatus,
  getOverdueInvestigations,
  getHistoryFile
};
