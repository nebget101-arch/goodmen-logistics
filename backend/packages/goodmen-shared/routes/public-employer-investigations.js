/**
 * Public employer investigation routes (no auth middleware).
 *
 * These endpoints are accessed by previous employers via a secure token link
 * to view and respond to employment verification inquiries.
 *
 * FN-331
 */
const express = require('express');
const router = express.Router();
const { query, getClient } = require('../internal/db');
const dtLogger = require('../utils/logger');
const { hashToken, tokensEqual } = require('../services/token-service');
const { buildResponsePdf } = require('../services/investigation-pdf-service');
const { createDriverDocument } = require('../services/driver-storage-service');
const { upsertRequirementStatus, computeAndUpdateDqfCompleteness } = require('../services/dqf-service');
const { sendEmail } = require('../services/notification-service');

// ---------------------------------------------------------------------------
// Rate limiter (mirrors public-onboarding.js pattern)
// ---------------------------------------------------------------------------
const recentRequests = new Map();
function rateLimited(req, res, next) {
  const key = `${req.ip}:${req.path}`;
  const now = Date.now();
  const last = recentRequests.get(key) || 0;
  if (now - last < 500) {
    return res.status(429).json({ message: 'Too many requests, slow down.' });
  }
  recentRequests.set(key, now);
  return next();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate a token from the URL param. Returns the token row and associated
 * data if valid, or { error, status } if not.
 */
async function validateToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 16) {
    return { error: 'Invalid token', status: 404 };
  }

  const tokenHash = hashToken(rawToken);

  const tokenRes = await query(
    `SELECT t.id, t.past_employer_id, t.driver_id, t.token_hash,
            t.expires_at, t.status, t.created_by
       FROM employer_investigation_tokens t
      WHERE t.token_hash = $1`,
    [tokenHash]
  );

  if (tokenRes.rows.length === 0) {
    return { error: 'Token not found', status: 404 };
  }

  const token = tokenRes.rows[0];

  // Timing-safe comparison
  if (!tokensEqual(token.token_hash, rawToken)) {
    return { error: 'Token not found', status: 404 };
  }

  if (token.status === 'used') {
    return { error: 'This investigation has already been completed', status: 410 };
  }

  if (token.status === 'expired' || new Date(token.expires_at) < new Date()) {
    return { error: 'This link has expired', status: 410 };
  }

  return { token };
}

/**
 * Load the past employer, driver, and OE data associated with a token.
 */
async function loadInvestigationContext(token) {
  // Load past employer
  const empRes = await query(
    `SELECT pe.id, pe.driver_id, pe.employer_name, pe.contact_name,
            pe.contact_phone, pe.contact_email, pe.contact_fax,
            pe.start_date, pe.end_date, pe.position_held,
            pe.investigation_status
       FROM driver_past_employers pe
      WHERE pe.id = $1`,
    [token.past_employer_id]
  );

  if (empRes.rows.length === 0) {
    return { error: 'Investigation record not found', status: 404 };
  }
  const employer = empRes.rows[0];

  // Load driver
  const driverRes = await query(
    `SELECT d.id, d.first_name, d.last_name,
            d.cdl_number, d.cdl_state, d.date_of_birth,
            d.operating_entity_id
       FROM drivers d
      WHERE d.id = $1`,
    [token.driver_id]
  );

  if (driverRes.rows.length === 0) {
    return { error: 'Driver record not found', status: 404 };
  }
  const driver = driverRes.rows[0];

  // Load operating entity
  const oeRes = await query(
    `SELECT oe.id, oe.name, oe.legal_name, oe.address_line1, oe.address_line2,
            oe.city, oe.state, oe.zip_code, oe.phone, oe.email,
            oe.dot_number
       FROM operating_entities oe
      WHERE oe.id = $1`,
    [driver.operating_entity_id]
  );

  const oe = oeRes.rows.length > 0 ? oeRes.rows[0] : {};

  return { employer, driver, oe };
}

// ---------------------------------------------------------------------------
// GET /:tokenId — Load investigation info for the public form
// ---------------------------------------------------------------------------
router.get('/:tokenId', rateLimited, async (req, res) => {
  const start = Date.now();
  try {
    const { tokenId } = req.params;
    const { token, error, status } = await validateToken(tokenId);
    if (error) {
      const duration = Date.now() - start;
      dtLogger.trackRequest('GET', '/public/employer-investigations/:tokenId', status, duration);
      return res.status(status).json({ message: error });
    }

    const ctx = await loadInvestigationContext(token);
    if (ctx.error) {
      const duration = Date.now() - start;
      dtLogger.trackRequest('GET', '/public/employer-investigations/:tokenId', ctx.status, duration);
      return res.status(ctx.status).json({ message: ctx.error });
    }

    const { driver, oe, employer } = ctx;
    const driverName = [driver.first_name, driver.last_name].filter(Boolean).join(' ');

    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', '/public/employer-investigations/:tokenId', 200, duration);

    return res.json({
      driverName,
      oeName: oe.name || oe.legal_name || '',
      oeAddress: [oe.address_line1, oe.address_line2, oe.city, oe.state, oe.zip_code].filter(Boolean).join(', '),
      oeDotNumber: oe.dot_number || '',
      employerName: employer.employer_name || '',
      employerContactName: employer.contact_name || ''
    });
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('public_employer_investigation_get_failed', error);
    dtLogger.trackRequest('GET', '/public/employer-investigations/:tokenId', 500, duration);
    return res.status(500).json({ message: 'Failed to load investigation' });
  }
});

// ---------------------------------------------------------------------------
// POST /:tokenId/respond — Submit employer investigation response
// ---------------------------------------------------------------------------
router.post('/:tokenId/respond', rateLimited, express.json(), async (req, res) => {
  const start = Date.now();
  const client = await getClient();

  try {
    const { tokenId } = req.params;
    const { token, error, status } = await validateToken(tokenId);
    if (error) {
      client.release();
      const duration = Date.now() - start;
      dtLogger.trackRequest('POST', '/public/employer-investigations/:tokenId/respond', status, duration);
      return res.status(status).json({ message: error });
    }

    const ctx = await loadInvestigationContext(token);
    if (ctx.error) {
      client.release();
      const duration = Date.now() - start;
      dtLogger.trackRequest('POST', '/public/employer-investigations/:tokenId/respond', ctx.status, duration);
      return res.status(ctx.status).json({ message: ctx.error });
    }

    const { driver, oe, employer } = ctx;
    const raw = req.body || {};

    // Normalize: frontend sends nested camelCase, backend expects flat snake_case.
    // Support both formats for forward compatibility.
    const cert = raw.certification || {};
    const emp = raw.employmentVerification || {};
    const acc = raw.accidentHistory || {};
    const da = raw.drugAlcoholHistory || {};
    const body = {
      completed_by_name: raw.completed_by_name || cert.completedByName || null,
      completed_by_title: raw.completed_by_title || cert.completedByTitle || null,
      other_remarks: raw.other_remarks || cert.otherRemarks || null,
      employed_as: raw.employed_as || emp.employedAs || null,
      employment_from: raw.employment_from || emp.employmentFrom || null,
      employment_to: raw.employment_to || emp.employmentTo || null,
      drove_cmv: raw.drove_cmv != null ? raw.drove_cmv : (emp.droveCmv != null ? emp.droveCmv : null),
      vehicle_types: raw.vehicle_types || emp.vehicleTypes || [],
      reason_for_leaving: raw.reason_for_leaving || emp.reasonForLeaving || null,
      no_safety_history: raw.no_safety_history || raw.noSafetyHistory || false,
      accidents: raw.accidents || acc.accidents || [],
      drug_alcohol_history: raw.drug_alcohol_history || da || {},
      signature_data: raw.signature_data || cert.signatureData || {},
      _raw: raw // preserve original for response_data column
    };

    // Validate required fields
    if (!body.completed_by_name) {
      client.release();
      return res.status(400).json({ message: 'completed_by_name is required' });
    }

    await client.query('BEGIN');

    // 1) Insert response into employer_investigation_responses
    const responseRes = await client.query(
      `INSERT INTO employer_investigation_responses (
        past_employer_id,
        response_type,
        response_data,
        received_via,
        documented_by,
        employed_as,
        employment_from,
        employment_to,
        drove_cmv,
        vehicle_types,
        reason_for_leaving,
        accidents,
        drug_alcohol_history,
        no_safety_history,
        other_remarks,
        completed_by_name,
        completed_by_title,
        signature_data
      ) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13::jsonb, $14, $15, $16, $17, $18::jsonb)
      RETURNING id`,
      [
        token.past_employer_id,
        'online_form',
        JSON.stringify(body._raw),
        'online_portal',
        null, // no authenticated user
        body.employed_as,
        body.employment_from,
        body.employment_to,
        body.drove_cmv,
        JSON.stringify(body.vehicle_types),
        body.reason_for_leaving,
        JSON.stringify(body.accidents),
        JSON.stringify(body.drug_alcohol_history),
        body.no_safety_history,
        body.other_remarks,
        body.completed_by_name,
        body.completed_by_title,
        JSON.stringify(body.signature_data)
      ]
    );
    const responseId = responseRes.rows[0].id;

    // 2) Generate response PDF
    const driverData = {
      first_name: driver.first_name,
      last_name: driver.last_name,
      cdl_number: driver.cdl_number,
      cdl_state: driver.cdl_state,
      date_of_birth: driver.date_of_birth
    };

    const employerData = {
      company_name: employer.employer_name,
      contact_name: employer.contact_name,
      contact_phone: employer.contact_phone,
      contact_email: employer.contact_email,
      start_date: employer.start_date,
      end_date: employer.end_date
    };

    const oeData = {
      name: oe.name,
      legal_name: oe.legal_name,
      address_line1: oe.address_line1,
      address_line2: oe.address_line2,
      city: oe.city,
      state: oe.state,
      zip_code: oe.zip_code,
      phone: oe.phone,
      email: oe.email,
      dot_number: oe.dot_number || ''
    };

    // Build response_data for the PDF (map body fields to the PDF service format)
    const responseDataForPdf = {
      responder_name: body.completed_by_name,
      responder_title: body.completed_by_title || '',
      response_date: new Date().toISOString().slice(0, 10),
      received_via: 'Online Portal',
      subject_to_dot_testing: body.drug_alcohol_history?.subject_to_dot_testing,
      safety_sensitive_function: body.drug_alcohol_history?.safety_sensitive_function,
      has_accidents: Array.isArray(body.accidents) && body.accidents.length > 0,
      accidents: body.accidents || [],
      pre_employment_test_conducted: body.drug_alcohol_history?.pre_employment_test_conducted,
      pre_employment_test_result: body.drug_alcohol_history?.pre_employment_test_result,
      alcohol_test_violation: body.drug_alcohol_history?.alcohol_test_violation,
      positive_drug_test: body.drug_alcohol_history?.positive_drug_test,
      refusal_to_test: body.drug_alcohol_history?.refusal_to_test,
      other_dot_violation: body.drug_alcohol_history?.other_dot_violation,
      dot_violation_details: body.drug_alcohol_history?.dot_violation_details,
      completed_return_to_duty: body.drug_alcohol_history?.completed_return_to_duty,
      reason_for_leaving: body.reason_for_leaving,
      eligible_for_rehire: body.eligible_for_rehire,
      separation_details: body.separation_details,
      additional_notes: body.other_remarks,
      signature_date: body.signature_data?.date || new Date().toISOString().slice(0, 10),
      responder_phone: body.responder_phone,
      responder_email: body.responder_email
    };

    const pdfBuffer = await buildResponsePdf(responseDataForPdf, driverData, employerData, oeData);

    // 3) Store PDF as a driver_documents record
    const driverName = [driver.first_name, driver.last_name].filter(Boolean).join('_');
    const empName = (employer.employer_name || 'employer').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
    const fileName = `investigation_response_${empName}_${driverName}_${Date.now()}.pdf`;

    // We must commit the transaction before using createDriverDocument (which uses its own query)
    // so instead, do a manual insert within the transaction
    const docRes = await client.query(
      `INSERT INTO driver_documents (
        driver_id, doc_type, file_name, mime_type, size_bytes, storage_mode
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id`,
      [
        driver.id,
        'employment_verification_response',
        fileName,
        'application/pdf',
        Buffer.byteLength(pdfBuffer),
        'db'
      ]
    );
    const documentId = docRes.rows[0].id;

    // Store the PDF blob in document_blobs
    await client.query(
      `INSERT INTO document_blobs (document_id, data) VALUES ($1, $2)`,
      [documentId, pdfBuffer]
    );

    // Update the response record with PDF info
    await client.query(
      `UPDATE employer_investigation_responses
          SET document_id = $1, pdf_file_name = $2
        WHERE id = $3`,
      [documentId, fileName, responseId]
    );

    // 4) Update past employer status to response_received
    await client.query(
      `UPDATE driver_past_employers
          SET investigation_status = 'response_received',
              response_received_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [token.past_employer_id]
    );

    // 5) Add history entry
    await client.query(
      `INSERT INTO driver_investigation_history_file
         (driver_id, past_employer_id, entry_type, description, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        driver.id,
        token.past_employer_id,
        'employer_response',
        `Online response received from ${employer.employer_name} (completed by ${body.completed_by_name})`,
        JSON.stringify({
          responseType: 'online_form',
          receivedVia: 'online_portal',
          responseId,
          documentId,
          completedBy: body.completed_by_name
        })
      ]
    );

    // 6) Mark token as used
    await client.query(
      `UPDATE employer_investigation_tokens SET status = 'used' WHERE id = $1`,
      [token.id]
    );

    await client.query('COMMIT');

    // 7) Update DQF (outside transaction -- these use their own queries)
    try {
      await upsertRequirementStatus(driver.id, 'employment_verification_received', 'complete', documentId);
      await computeAndUpdateDqfCompleteness(driver.id);
    } catch (dqfErr) {
      dtLogger.error('public_employer_investigation_dqf_update_failed', dqfErr, { driverId: driver.id });
      // Non-fatal: the response is already stored
    }

    // 8) Send notification email to the user who created the inquiry (fire-and-forget)
    if (token.created_by) {
      const driverFullName = [driver.first_name, driver.last_name].filter(Boolean).join(' ');
      sendNotificationEmail(token.created_by, employer.employer_name, driverFullName).catch((err) => {
        dtLogger.error('public_employer_investigation_notification_failed', err);
      });
    }

    const duration = Date.now() - start;
    dtLogger.trackRequest('POST', '/public/employer-investigations/:tokenId/respond', 200, duration, {
      driverId: driver.id,
      pastEmployerId: token.past_employer_id,
      documentId
    });

    return res.json({ success: true, documentId });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    const duration = Date.now() - start;
    dtLogger.error('public_employer_investigation_respond_failed', error);
    dtLogger.trackRequest('POST', '/public/employer-investigations/:tokenId/respond', 500, duration);
    return res.status(500).json({ message: 'Failed to submit response' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Fire-and-forget notification to the user who sent the inquiry
// ---------------------------------------------------------------------------
async function sendNotificationEmail(userId, employerName, driverName) {
  const userRes = await query(
    `SELECT email, first_name, last_name FROM users WHERE id = $1`,
    [userId]
  );
  if (userRes.rows.length === 0) return;

  const user = userRes.rows[0];
  if (!user.email) return;

  const userName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Team Member';

  await sendEmail({
    to: user.email,
    subject: `Employer Investigation Response Received -- ${driverName}`,
    html: `
      <p>Hello ${userName},</p>
      <p>A previous employer has responded to your employment verification inquiry:</p>
      <ul>
        <li><strong>Driver:</strong> ${driverName}</li>
        <li><strong>Employer:</strong> ${employerName}</li>
      </ul>
      <p>The response has been recorded and the investigation PDF has been saved to the driver's file.
      Please log in to FleetNeuron to review the full response.</p>
      <p>-- FleetNeuron AI</p>
    `
  });
}

module.exports = router;
