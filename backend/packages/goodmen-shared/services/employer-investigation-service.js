/**
 * Employer Investigation Service
 *
 * Manages the previous employer investigation workflow for DOT compliance.
 * Tracks inquiry/follow-up/response lifecycle per past employer and maintains
 * a running investigation history file per driver.
 */
const { query, getClient } = require('../internal/db');
const { upsertRequirementStatus, computeAndUpdateDqfCompleteness } = require('./dqf-service');
const { generateToken, hashToken } = require('./token-service');
const { buildRequestPdf } = require('./investigation-pdf-service');
const { sendEmail } = require('./notification-service');
const dtLogger = require('../utils/logger');

const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || 'https://fleetneuron.ai';
const TOKEN_EXPIRY_DAYS = 30;

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

/**
 * Load driver and OE data for PDF generation and email.
 */
async function loadDriverAndOe(client, driverId) {
  const driverRes = await client.query(
    `SELECT d.id, d.first_name, d.last_name, d.middle_name,
            d.cdl_number, d.cdl_state, d.date_of_birth,
            d.operating_entity_id
       FROM drivers d WHERE d.id = $1`,
    [driverId]
  );
  if (driverRes.rows.length === 0) return { driver: null, oe: null };
  const driver = driverRes.rows[0];

  const oeRes = await client.query(
    `SELECT oe.id, oe.name, oe.legal_name, oe.address_line1, oe.address_line2,
            oe.city, oe.state, oe.zip_code, oe.phone, oe.email,
            oe.dot_number, oe.usdot_number
       FROM operating_entities oe WHERE oe.id = $1`,
    [driver.operating_entity_id]
  );
  const oe = oeRes.rows.length > 0 ? oeRes.rows[0] : {};

  return { driver, oe };
}

/**
 * Create a secure token for a past employer, store it, and return the raw token
 * and the public response URL.
 */
async function createInvestigationToken(client, pastEmployerId, driverId, userId) {
  const rawToken = generateToken();
  const tokenHashVal = hashToken(rawToken);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + TOKEN_EXPIRY_DAYS);

  const tokenRes = await client.query(
    `INSERT INTO employer_investigation_tokens
       (past_employer_id, driver_id, token_hash, expires_at, created_by, status)
     VALUES ($1, $2, $3, $4, $5, 'active')
     RETURNING id`,
    [pastEmployerId, driverId, tokenHashVal, expiresAt.toISOString(), userId || null]
  );

  // Link the token to the past employer record
  await client.query(
    `UPDATE driver_past_employers
        SET share_token_id = $1, inquiry_created_by = $2, updated_at = NOW()
      WHERE id = $3`,
    [tokenRes.rows[0].id, userId || null, pastEmployerId]
  );

  const publicUrl = `${FRONTEND_BASE_URL}/employer-response/${rawToken}`;
  return { rawToken, tokenId: tokenRes.rows[0].id, publicUrl };
}

/**
 * Build and send the inquiry email to a past employer's contact.
 * Returns { sent, error? }.
 */
async function sendInquiryEmail(contactEmail, { driverName, oeName, publicUrl, pdfBuffer, isFollowUp }) {
  if (!contactEmail) {
    return { sent: false, error: 'No contact email on file' };
  }

  const prefix = isFollowUp ? 'FOLLOW-UP: ' : '';
  const subject = `${prefix}Previous Employment Verification Request -- ${driverName} -- ${oeName}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #0f4a6b;">${prefix}Previous Employment Verification Request</h2>
      <p>Dear Former Employer,</p>
      <p>Pursuant to 49 CFR &sect;391.23(d)(2) and &sect;40.25, <strong>${oeName}</strong> is required to
      investigate the safety performance history of all prospective drivers. We are requesting information
      regarding <strong>${driverName}</strong>, who has applied for a driver position with our company.</p>
      <p>Please complete the investigation by clicking the button below:</p>
      <p style="text-align: center; margin: 24px 0;">
        <a href="${publicUrl}"
           style="display: inline-block; background-color: #0f4a6b; color: #ffffff;
                  padding: 14px 28px; text-decoration: none; border-radius: 6px;
                  font-weight: bold; font-size: 16px;">
          Complete Investigation
        </a>
      </p>
      <p style="color: #666; font-size: 13px;">
        If the button does not work, copy and paste this link into your browser:<br>
        <a href="${publicUrl}">${publicUrl}</a>
      </p>
      <p style="color: #666; font-size: 13px;">
        This link will expire in ${TOKEN_EXPIRY_DAYS} days. Federal regulations require previous employers
        to respond to these inquiries within 30 days of receipt.
      </p>
      <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;">
      <p style="color: #999; font-size: 11px;">&mdash; FleetNeuron AI</p>
    </div>
  `;

  // Build SendGrid message with optional PDF attachment
  const msgOptions = { to: contactEmail, subject, html };

  // Note: sendEmail in notification-service uses sgMail.send which supports attachments
  // but our sendEmail wrapper doesn't pass them through. We send just the link for now.
  return sendEmail(msgOptions);
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
 * FN-331: Now generates a request PDF, creates a secure token, and emails
 * the employer's contact with a link to the public response form.
 */
async function sendInquiry(pastEmployerId, userId) {
  if (!pastEmployerId) throw new Error('pastEmployerId is required');

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Fetch employer record (with contact info)
    const empRes = await client.query(
      `SELECT id, driver_id, employer_name, contact_name, contact_phone,
              contact_email, contact_fax,
              start_date, end_date, position_held
         FROM driver_past_employers WHERE id = $1`,
      [pastEmployerId]
    );
    if (empRes.rows.length === 0) {
      throw new Error('Past employer not found');
    }
    const emp = empRes.rows[0];

    // Load driver + OE for PDF generation
    const { driver, oe } = await loadDriverAndOe(client, emp.driver_id);
    if (!driver) throw new Error('Driver not found');

    // Create secure token and public URL
    const { publicUrl, tokenId } = await createInvestigationToken(
      client, pastEmployerId, emp.driver_id, userId
    );

    // Generate request PDF
    const driverName = [driver.first_name, driver.middle_name, driver.last_name].filter(Boolean).join(' ');
    let pdfBuffer = null;
    try {
      pdfBuffer = await buildRequestPdf(
        driver,
        { company_name: emp.employer_name, contact_name: emp.contact_name, contact_phone: emp.contact_phone,
          contact_email: emp.contact_email, contact_fax: emp.contact_fax,
          start_date: emp.start_date, end_date: emp.end_date },
        oe,
        publicUrl
      );
    } catch (pdfErr) {
      dtLogger.error('send_inquiry_pdf_generation_failed', pdfErr, { pastEmployerId });
      // Non-fatal: continue without PDF
    }

    // Update employer status and inquiry timestamp
    await client.query(
      `UPDATE driver_past_employers
          SET investigation_status = 'inquiry_sent',
              inquiry_sent_at = NOW(),
              inquiry_email_sent_to = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [emp.contact_email || null, pastEmployerId]
    );

    await appendGoodFaithEffort(client, pastEmployerId, {
      action: 'inquiry_sent',
      date: new Date().toISOString(),
      by: userId,
      emailSentTo: emp.contact_email || null,
      tokenId
    });

    await addHistoryEntry(client, {
      driverId: emp.driver_id,
      pastEmployerId,
      entryType: 'employer_inquiry',
      description: `Inquiry sent to ${emp.employer_name}${emp.contact_email ? ` (${emp.contact_email})` : ''}`,
      metadata: { action: 'inquiry_sent', emailSentTo: emp.contact_email || null, tokenId },
      createdBy: userId
    });

    await client.query('COMMIT');

    // Send email to employer contact (fire-and-forget, outside transaction)
    let emailResult = { sent: false, error: 'No contact email' };
    if (emp.contact_email) {
      sendInquiryEmail(emp.contact_email, {
        driverName,
        oeName: oe.name || oe.legal_name || '',
        publicUrl,
        pdfBuffer,
        isFollowUp: false
      }).then((result) => {
        if (!result.sent) {
          dtLogger.warn('send_inquiry_email_failed', { pastEmployerId, error: result.error });
        }
      }).catch((err) => {
        dtLogger.error('send_inquiry_email_error', err, { pastEmployerId });
      });
      emailResult = { sent: true }; // optimistic -- actual send is async
    }

    return { pastEmployerId, investigationStatus: 'inquiry_sent', emailResult };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Record that a follow-up was sent to a past employer.
 * FN-331: Generates a new token if the previous one expired, and emails
 * the employer with a "FOLLOW-UP:" prefix.
 */
async function sendFollowUp(pastEmployerId, userId) {
  if (!pastEmployerId) throw new Error('pastEmployerId is required');

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const empRes = await client.query(
      `SELECT id, driver_id, employer_name, contact_name, contact_phone,
              contact_email, contact_fax,
              start_date, end_date, share_token_id
         FROM driver_past_employers WHERE id = $1`,
      [pastEmployerId]
    );
    if (empRes.rows.length === 0) {
      throw new Error('Past employer not found');
    }
    const emp = empRes.rows[0];

    // Load driver + OE for PDF / email
    const { driver, oe } = await loadDriverAndOe(client, emp.driver_id);
    if (!driver) throw new Error('Driver not found');

    // Check if the existing token is still active; if expired or used, create a new one
    let publicUrl;
    let tokenId;
    let needsNewToken = true;

    if (emp.share_token_id) {
      const existingToken = await client.query(
        `SELECT id, expires_at, status FROM employer_investigation_tokens WHERE id = $1`,
        [emp.share_token_id]
      );
      if (existingToken.rows.length > 0) {
        const tok = existingToken.rows[0];
        if (tok.status === 'active' && new Date(tok.expires_at) > new Date()) {
          needsNewToken = false;
          // We don't have the raw token anymore, so we must create a new one anyway
          // to include in the email. Expire the old one.
          await client.query(
            `UPDATE employer_investigation_tokens SET status = 'expired' WHERE id = $1`,
            [tok.id]
          );
        }
      }
    }

    // Always create a new token for the follow-up email
    const tokenResult = await createInvestigationToken(client, pastEmployerId, emp.driver_id, userId);
    publicUrl = tokenResult.publicUrl;
    tokenId = tokenResult.tokenId;

    // Generate request PDF with the new link
    const driverName = [driver.first_name, driver.middle_name, driver.last_name].filter(Boolean).join(' ');
    let pdfBuffer = null;
    try {
      pdfBuffer = await buildRequestPdf(
        driver,
        { company_name: emp.employer_name, contact_name: emp.contact_name, contact_phone: emp.contact_phone,
          contact_email: emp.contact_email, contact_fax: emp.contact_fax,
          start_date: emp.start_date, end_date: emp.end_date },
        oe,
        publicUrl
      );
    } catch (pdfErr) {
      dtLogger.error('send_follow_up_pdf_generation_failed', pdfErr, { pastEmployerId });
    }

    await client.query(
      `UPDATE driver_past_employers
          SET investigation_status = 'follow_up_sent',
              follow_up_sent_at = NOW(),
              inquiry_email_sent_to = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [emp.contact_email || null, pastEmployerId]
    );

    await appendGoodFaithEffort(client, pastEmployerId, {
      action: 'follow_up_sent',
      date: new Date().toISOString(),
      by: userId,
      emailSentTo: emp.contact_email || null,
      tokenId
    });

    await addHistoryEntry(client, {
      driverId: emp.driver_id,
      pastEmployerId,
      entryType: 'employer_inquiry',
      description: `Follow-up sent to ${emp.employer_name}${emp.contact_email ? ` (${emp.contact_email})` : ''}`,
      metadata: { action: 'follow_up_sent', emailSentTo: emp.contact_email || null, tokenId },
      createdBy: userId
    });

    await client.query('COMMIT');

    // Send follow-up email (fire-and-forget)
    let emailResult = { sent: false, error: 'No contact email' };
    if (emp.contact_email) {
      sendInquiryEmail(emp.contact_email, {
        driverName,
        oeName: oe.name || oe.legal_name || '',
        publicUrl,
        pdfBuffer,
        isFollowUp: true
      }).then((result) => {
        if (!result.sent) {
          dtLogger.warn('send_follow_up_email_failed', { pastEmployerId, error: result.error });
        }
      }).catch((err) => {
        dtLogger.error('send_follow_up_email_error', err, { pastEmployerId });
      });
      emailResult = { sent: true };
    }

    return { pastEmployerId, investigationStatus: 'follow_up_sent', emailResult };
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
