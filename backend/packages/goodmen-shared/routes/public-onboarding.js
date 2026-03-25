const express = require('express');
const router = express.Router();
const { query, getClient } = require('../internal/db');
const { hashToken } = require('../services/token-service');
const dtLogger = require('../utils/logger');
const { createDriverDocument } = require('../services/driver-storage-service');
const {
  buildEmploymentApplicationPdf,
  buildMvrAuthorizationPdf
} = require('../services/driver-onboarding-pdf');
const employmentAppService = require('../services/employment-application.service');

function hasMeaningfulData(data) {
  if (!data || typeof data !== 'object') return false;
  return Object.values(data).some((v) => {
    if (Array.isArray(v)) return v.length > 0;
    return v !== null && v !== undefined && String(v).trim() !== '';
  });
}

function buildEmploymentPrefill({ driver, license, latestApp }) {
  const snapshot = latestApp?.applicant_snapshot || {};
  const firstName = snapshot.firstName || driver?.first_name || '';
  const middleName = snapshot.middleName || '';
  const lastName = snapshot.lastName || driver?.last_name || '';

  return {
    // Applicant info
    firstName,
    middleName,
    lastName,
    phone: snapshot.phone || driver?.phone || '',
    email: snapshot.email || driver?.email || '',
    dateOfBirth: snapshot.dateOfBirth || driver?.date_of_birth || '',
    ssnLast4: snapshot.ssn ? String(snapshot.ssn).slice(-4) : '',
    dateOfApplication: snapshot.applicationDate || latestApp?.application_date || driver?.application_date || '',
    positionAppliedFor: snapshot.positionAppliedFor || '',
    dateAvailable: snapshot.dateAvailableForWork || '',
    canWorkInUs: snapshot.legalRightToWorkInUS ?? null,

    // Address/residency (simple top-level fields for current UI)
    addressStreet: snapshot.addressStreet || '',
    addressCity: snapshot.addressCity || '',
    addressState: snapshot.addressState || '',
    addressZip: snapshot.addressZip || '',
    yearsAtAddress: snapshot.yearsAtAddress || '',

    // License
    licenseState: snapshot.licenseState || license?.cdl_state || driver?.cdl_state || '',
    licenseNumber: snapshot.licenseNumber || license?.cdl_number || driver?.cdl_number || '',
    licenseClass: snapshot.licenseClass || license?.cdl_class || driver?.cdl_class || '',
    licenseEndorsements: snapshot.licenseEndorsements || license?.endorsements || '',
    licenseExpiry: snapshot.licenseExpiry || license?.cdl_expiry || driver?.cdl_expiry || '',

    // Employment/signature legacy fields used by current packet UI
    drivingExperienceSummary: snapshot.drivingExperienceSummary || '',
    currentEmployerName: snapshot.currentEmployerName || '',
    currentEmployerPhone: snapshot.currentEmployerPhone || '',
    currentEmployerFrom: snapshot.currentEmployerFrom || '',
    currentEmployerTo: snapshot.currentEmployerTo || '',
    currentEmployerReasonForLeaving: snapshot.currentEmployerReasonForLeaving || '',
    previousEmployerName: snapshot.previousEmployerName || '',
    previousEmployerPhone: snapshot.previousEmployerPhone || '',
    previousEmployerFrom: snapshot.previousEmployerFrom || '',
    previousEmployerTo: snapshot.previousEmployerTo || '',
    previousEmployerReasonForLeaving: snapshot.previousEmployerReasonForLeaving || '',
    educationSummary: snapshot.educationSummary || '',
    otherQualifications: snapshot.otherQualifications || '',
    applicationSignatureName: snapshot.applicantPrintedName || [firstName, middleName, lastName].filter(Boolean).join(' '),
    applicationSignatureDate: snapshot.signatureDate || ''
  };
}

async function safeOptionalQuery(sql, params = [], fallbackRows = []) {
  try {
    return await query(sql, params);
  } catch (error) {
    // tolerate legacy schema drift for optional prefill sources
    if (error?.code === '42703' || error?.code === '42P01') {
      dtLogger.warn('public_onboarding_optional_query_fallback', {
        code: error.code,
        message: error.message
      });
      return { rows: fallbackRows };
    }
    throw error;
  }
}

async function upsertEmploymentApplicationFromPacket(packet, data, submit = false, reqMeta = {}) {
  // FN-216: Build employers from currentEmployer + previousEmployers if structured employers array is empty
  let employers = data?.employers || [];
  if (!employers.length) {
    if (data?.currentEmployer && typeof data.currentEmployer === 'object') {
      employers.push({ ...data.currentEmployer, isCurrent: true, tier: 'detailed' });
    }
    if (Array.isArray(data?.previousEmployers)) {
      for (const pe of data.previousEmployers) {
        employers.push({ ...pe, isCurrent: false, tier: 'detailed' });
      }
    }
  }
  employers = employers.map((emp) => ({ ...emp, tier: emp.tier || 'detailed' }));

  // FN-216: Build residencies from current address + previousAddresses if structured residencies array is empty
  let residencies = data?.residencies || [];
  if (!residencies.length) {
    if (data?.addressStreet || data?.addressCity) {
      residencies.push({
        residencyType: 'current',
        street: data.addressStreet || '',
        city: data.addressCity || '',
        state: data.addressState || '',
        zip: data.addressZip || '',
        yearsAtAddress: data.yearsAtAddress || ''
      });
    }
    if (Array.isArray(data?.previousAddresses)) {
      for (const pa of data.previousAddresses) {
        residencies.push({
          residencyType: 'previous',
          street: pa.street || '',
          city: pa.city || '',
          state: pa.state || '',
          zip: pa.zip || '',
          yearsAtAddress: pa.yearsAtAddress || ''
        });
      }
    }
  }

  // FN-216: Build workAuthorization from new onboarding form fields
  const workAuthorization = data?.workAuthorization || {
    legallyAuthorizedToWork: data?.legallyAuthorizedToWork ?? null,
    convictedOfFelony: data?.convictedOfFelony ?? null,
    felonyDetails: data?.felonyDetails || null,
    unableToPerformFunctions: data?.unableToPerformFunctions ?? null,
    adaDetails: data?.adaDetails || null
  };

  // FN-216: Build drugAlcohol from new onboarding form fields
  const drugAlcohol = data?.drugAlcohol || {
    violatedSubstanceProhibitions: data?.violatedSubstanceProhibitions ?? null,
    failedRehabProgram: data?.failedRehabProgram ?? null,
    alcoholTestResult04OrHigher: data?.alcoholTestResult04OrHigher ?? null,
    positiveControlledSubstancesTest: data?.positiveControlledSubstancesTest ?? null,
    refusedRequiredTest: data?.refusedRequiredTest ?? null,
    otherDOTViolation: data?.otherDOTViolation ?? null
  };

  // FN-216: Build drivingExperience from individual equipment fields
  const drivingExperience = data?.drivingExperience || {
    straightTruck: data?.straightTruck || null,
    tractorSemiTrailer: data?.tractorSemiTrailer || null,
    tractorTwoTrailers: data?.tractorTwoTrailers || null,
    motorcoachSchoolBus: data?.motorcoachSchoolBus || null,
    motorcoachSchoolBusMore15: data?.motorcoachSchoolBusMore15 || null,
    otherEquipment: data?.otherEquipment || null,
    statesOperatedIn: data?.statesOperatedIn || null
  };

  // FN-216: Build audit trail from request metadata
  const auditTrail = {
    ipAddress: reqMeta.ipAddress || null,
    userAgent: reqMeta.userAgent || null,
    submittedAt: new Date().toISOString()
  };

  const payload = {
    applicationDate: data?.applicationDate || data?.dateOfApplication || null,
    applicantSnapshot: {
      firstName: data?.firstName || null,
      middleName: data?.middleName || null,
      lastName: data?.lastName || null,
      phone: data?.phone || null,
      email: data?.email || null,
      dateOfBirth: data?.dateOfBirth || null,
      ssn: data?.ssn || data?.ssnLast4 || null,
      applicationDate: data?.applicationDate || data?.dateOfApplication || null,
      positionAppliedFor: data?.positionAppliedFor || null,
      dateAvailableForWork: data?.dateAvailableForWork || data?.dateAvailable || null,
      legalRightToWorkInUS: data?.legalRightToWorkInUS ?? data?.canWorkInUs ?? null,
      deniedLicensePermitPrivilege: data?.deniedLicensePermitPrivilege ?? null,
      deniedLicenseExplanation: data?.deniedLicenseExplanation || null,
      suspendedOrRevokedLicensePermitPrivilege: data?.suspendedOrRevokedLicensePermitPrivilege ?? null,
      suspendedOrRevokedExplanation: data?.suspendedOrRevokedExplanation || null,
      otherQualifications: data?.otherQualifications || null,
      applicantPrintedName: data?.applicantPrintedName || data?.applicationSignatureName || null,
      applicantSignature: data?.applicantSignature || data?.applicationSignatureName || null,
      signatureDate: data?.signatureDate || data?.applicationSignatureDate || null,
      certificationAccepted: data?.certificationAccepted ?? null,
      // FN-215: preserve license class in snapshot for CDL validation
      licenseClass: data?.licenseClass || null,
      // FN-216: preserve new form fields in snapshot for PDF fallback reads
      addressStreet: data?.addressStreet || null,
      addressCity: data?.addressCity || null,
      addressState: data?.addressState || null,
      addressZip: data?.addressZip || null,
      yearsAtAddress: data?.yearsAtAddress || null,
      previousAddresses: data?.previousAddresses || null,
      currentEmployer: data?.currentEmployer || null,
      previousEmployers: data?.previousEmployers || null,
      legallyAuthorizedToWork: data?.legallyAuthorizedToWork ?? null,
      convictedOfFelony: data?.convictedOfFelony ?? null,
      felonyDetails: data?.felonyDetails || null,
      unableToPerformFunctions: data?.unableToPerformFunctions ?? null,
      adaDetails: data?.adaDetails || null,
      straightTruck: data?.straightTruck || null,
      tractorSemiTrailer: data?.tractorSemiTrailer || null,
      tractorTwoTrailers: data?.tractorTwoTrailers || null,
      motorcoachSchoolBus: data?.motorcoachSchoolBus || null,
      motorcoachSchoolBusMore15: data?.motorcoachSchoolBusMore15 || null,
      otherEquipment: data?.otherEquipment || null,
      statesOperatedIn: data?.statesOperatedIn || null,
      violatedSubstanceProhibitions: data?.violatedSubstanceProhibitions ?? null,
      failedRehabProgram: data?.failedRehabProgram ?? null,
      alcoholTestResult04OrHigher: data?.alcoholTestResult04OrHigher ?? null,
      positiveControlledSubstancesTest: data?.positiveControlledSubstancesTest ?? null,
      refusedRequiredTest: data?.refusedRequiredTest ?? null,
      otherDOTViolation: data?.otherDOTViolation ?? null,
      hasAccidents: data?.hasAccidents ?? null,
      hasViolations: data?.hasViolations ?? null,
      // FN-216: audit trail
      auditTrail
    },
    // FN-216: structured objects for employment-application.service
    workAuthorization,
    drugAlcohol,
    hasAccidents: data?.hasAccidents ?? null,
    hasViolations: data?.hasViolations ?? null,
    residencies,
    licenses: data?.licenses || [],
    drivingExperience,
    accidents: data?.accidents || [],
    violations: data?.violations || [],
    convictions: data?.convictions || [],
    employers,
    education: data?.education || [],
    // FN-215: disqualification and certification fields
    disqualifications: data?.disqualifications || [],
    has_been_disqualified: data?.has_been_disqualified ?? null,
    certification_text_version: data?.certification_text_version || null,
    signed_certification_at: data?.signed_certification_at || null
  };

  const apps = await employmentAppService.getByDriverId(packet.driver_id);

  // FN-216: For submission, handle resubmission by creating a new draft instead of reusing a submitted one
  let target;
  if (submit) {
    // If a draft exists, reuse it; otherwise create a new one (even if a submitted app exists)
    target = apps.find((a) => a.status === 'draft') || null;
    if (!target) {
      target = await employmentAppService.createDraft(packet.driver_id, payload, null, null);
    } else {
      await employmentAppService.updateDraft(target.id, payload, null, null);
    }
  } else {
    target = apps.find((a) => a.status === 'draft') || null;
    if (!target) {
      target = await employmentAppService.createDraft(packet.driver_id, payload, null, null);
    } else {
      await employmentAppService.updateDraft(target.id, payload, null, null);
    }
  }

  // FN-215: validate completeness before submission
  if (submit) {
    const fullApp = await employmentAppService.getById(target.id);
    const { valid, errors } = employmentAppService.validateCompleteness(fullApp);
    if (!valid) {
      dtLogger.warn('employment_application_completeness_check_failed', {
        applicationId: target.id,
        driverId: packet.driver_id,
        errors
      });
      // Proceed with submission anyway — validation is advisory for onboarding flow,
      // but log so compliance teams can follow up.
    }
    await employmentAppService.submitApplication(target.id, {}, null, null);
  }
}

async function loadPacketWithToken(packetId, token, forUpdate = false) {
  if (!packetId || !token) {
    return { error: 'packetId and token are required' };
  }

  const tokenHash = hashToken(token);
  const selectSql = forUpdate
    ? 'SELECT * FROM driver_onboarding_packets WHERE id = $1 FOR UPDATE'
    : 'SELECT * FROM driver_onboarding_packets WHERE id = $1';
  const res = await query(selectSql, [packetId]);
  if (res.rows.length === 0) {
    return { error: 'Packet not found', status: 404 };
  }
  const packet = res.rows[0];

  const now = new Date();
  if (packet.status === 'revoked' || packet.status === 'expired') {
    return { error: 'Packet is no longer active', status: 410 };
  }
  if (new Date(packet.expires_at) <= now) {
    return { error: 'Packet has expired', status: 410 };
  }
  if (packet.token_hash !== tokenHash) {
    return { error: 'Invalid token', status: 403 };
  }

  return { packet };
}

async function maybeGenerateOnboardingPdfs(packetId) {
  // Check if we already have PDFs for this packet
  const existingDocsRes = await query(
    `SELECT doc_type
     FROM driver_documents
     WHERE packet_id = $1
       AND doc_type IN ('employment_application_pdf', 'mvr_authorization_pdf')`,
    [packetId]
  );
  const existingTypes = new Set(existingDocsRes.rows.map((r) => r.doc_type));

  // Load packet, driver, sections, and most recent esignatures
  const packetRes = await query(
    'SELECT * FROM driver_onboarding_packets WHERE id = $1',
    [packetId]
  );
  if (packetRes.rows.length === 0) return;
  const packet = packetRes.rows[0];

  const sectionsRes = await query(
    `SELECT section_key, status, data
     FROM driver_onboarding_sections
     WHERE packet_id = $1`,
    [packetId]
  );

  const sections = {};
  sectionsRes.rows.forEach((row) => {
    sections[row.section_key] = row;
  });

  const driverRes = await query(
    'SELECT id, first_name, last_name, email, phone, cdl_number, cdl_state FROM drivers WHERE id = $1',
    [packet.driver_id]
  );
  const driver = driverRes.rows[0];
  if (!driver) return;

  // FN-216: Look up operating entity for PDF header
  let operatingEntity = null;
  try {
    const oeId = packet.operating_entity_id || driver.operating_entity_id || null;
    if (oeId) {
      const oeRes = await query(
        'SELECT id, name, address, phone, email FROM operating_entities WHERE id = $1',
        [oeId]
      );
      operatingEntity = oeRes.rows[0] || null;
    }
  } catch (oeErr) {
    // Tolerate missing operating_entities table
    dtLogger.warn('operating_entity_lookup_fallback', { error: oeErr?.message });
  }

  const esignRes = await query(
    `SELECT section_key, signer_name, signed_at
     FROM driver_esignatures
     WHERE packet_id = $1
     ORDER BY created_at DESC`,
    [packetId]
  );
  const esignatures = {};
  esignRes.rows.forEach((row) => {
    if (!esignatures[row.section_key]) {
      esignatures[row.section_key] = row;
    }
  });

  // Employment application PDF
  if (
    sections.employment_application &&
    sections.employment_application.status === 'completed' &&
    !existingTypes.has('employment_application_pdf')
  ) {
    const applicationData = sections.employment_application.data || {};
    const signature = esignatures.employment_application || null;
    const buffer = await buildEmploymentApplicationPdf({
      driver,
      application: applicationData,
      signature,
      operatingEntity
    });
    // FN-216: use "{FirstName} {LastName} - Employment Application.pdf" filename
    const firstName = (driver.first_name || '').trim();
    const lastName = (driver.last_name || '').trim();
    const pdfFileName = firstName || lastName
      ? `${firstName} ${lastName} - Employment Application.pdf`.trim()
      : 'Employment Application.pdf';
    await createDriverDocument({
      driverId: driver.id,
      packetId: packet.id,
      docType: 'employment_application_pdf',
      fileName: pdfFileName,
      mimeType: 'application/pdf',
      bytes: buffer
    });
    dtLogger.info('driver_employment_application_pdf_created', { packetId, driverId: driver.id });
  }

  // MVR authorization PDF
  if (
    sections.mvr_authorization &&
    sections.mvr_authorization.status === 'completed' &&
    !existingTypes.has('mvr_authorization_pdf')
  ) {
    const mvrData = sections.mvr_authorization.data || {};
    const signature = esignatures.mvr_authorization || null;
    const buffer = await buildMvrAuthorizationPdf({
      driver,
      mvr: mvrData,
      signature
    });
    await createDriverDocument({
      driverId: driver.id,
      packetId: packet.id,
      docType: 'mvr_authorization_pdf',
      fileName: `mvr_authorization_${driver.last_name || 'driver'}.pdf`,
      mimeType: 'application/pdf',
      bytes: buffer
    });
    dtLogger.info('driver_mvr_authorization_pdf_created', { packetId, driverId: driver.id });
  }
}

async function safeMaybeGenerateOnboardingPdfs(packetId) {
  try {
    await maybeGenerateOnboardingPdfs(packetId);
  } catch (error) {
    // Template assets may not exist in some deployments. Do not fail onboarding submission.
    if (error?.code === 'ENOENT') {
      dtLogger.warn('onboarding_pdf_template_missing_skip', {
        packetId,
        message: error.message
      });
      return;
    }
    throw error;
  }
}

// Basic rate limit placeholder (per-process, very simple)
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

// GET /public/onboarding/:packetId?token=...
router.get('/:packetId', rateLimited, async (req, res) => {
  const start = Date.now();
  try {
    const { packetId } = req.params;
    const { token } = req.query;
    const { packet, error, status } = await loadPacketWithToken(packetId, token);
    if (error) {
      return res.status(status || 400).json({ message: error });
    }

    let sectionsRes;
    try {
      sectionsRes = await query(
        `SELECT section_key, status, completed_at, data
         FROM driver_onboarding_sections
         WHERE packet_id = $1
         ORDER BY section_key`,
        [packetId]
      );
    } catch (err) {
      if (err?.code === '42703') {
        // older schema without data column
        sectionsRes = await query(
          `SELECT section_key, status, completed_at
           FROM driver_onboarding_sections
           WHERE packet_id = $1
           ORDER BY section_key`,
          [packetId]
        );
        sectionsRes.rows = (sectionsRes.rows || []).map((r) => ({ ...r, data: null }));
      } else {
        throw err;
      }
    }

    const driverRes = await query(
      `SELECT id, first_name, last_name, email, phone, cdl_number, cdl_state, cdl_class, cdl_expiry
       FROM drivers WHERE id = $1`,
      [packet.driver_id]
    );

    const licenseRes = await safeOptionalQuery(
      `SELECT *
       FROM driver_licenses
       WHERE driver_id = $1
       LIMIT 1`,
      [packet.driver_id]
    );

    const latestAppRes = await safeOptionalQuery(
      `SELECT *
       FROM employment_applications
       WHERE driver_id = $1
       LIMIT 1`,
      [packet.driver_id]
    );

    const driver = driverRes.rows[0] || null;
    const license = licenseRes.rows[0] || null;
    const latestApp = latestAppRes.rows[0] || null;
    const employmentPrefill = buildEmploymentPrefill({ driver, license, latestApp });

    const sections = (sectionsRes.rows || []).map((s) => {
      if (s.section_key !== 'employment_application') return s;
      if (hasMeaningfulData(s.data)) return s;
      return { ...s, data: employmentPrefill };
    });

    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', `/public/onboarding/${packetId}`, 200, duration);

    return res.json({
      packet: {
        id: packet.id,
        status: packet.status,
        expiresAt: packet.expires_at,
        driverId: packet.driver_id
      },
      driver,
      sections
    });
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('public_onboarding_get_failed', error, { params: req.params });
    dtLogger.trackRequest('GET', `/public/onboarding/${req.params.packetId}`, 500, duration);
    // eslint-disable-next-line no-console
    console.error('Error in public onboarding GET:', error);
    return res.status(500).json({ message: 'Failed to load onboarding packet' });
  }
});

// POST /public/onboarding/:packetId/sections/:sectionKey?token=...
router.post('/:packetId/sections/:sectionKey', rateLimited, async (req, res) => {
  const start = Date.now();
  const client = await getClient();
  try {
    const { packetId, sectionKey } = req.params;
    const { token } = req.query;
    const { data, status } = req.body || {};

    const allowedKeys = ['employment_application', 'mvr_authorization', 'uploads'];
    if (!allowedKeys.includes(sectionKey)) {
      return res.status(400).json({ message: 'Invalid section key' });
    }

    if (!data || typeof data !== 'object') {
      return res.status(400).json({ message: 'data payload is required' });
    }

    const { packet, error, status: errStatus } = await loadPacketWithToken(packetId, token, true);
    if (error) {
      return res.status(errStatus || 400).json({ message: error });
    }

    const newStatus = status && typeof status === 'string' ? status : 'in_progress';
    const isCompleted = newStatus === 'completed';

    await client.query(
      `
      INSERT INTO driver_onboarding_sections (packet_id, section_key, status, completed_at, data)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (packet_id, section_key) DO UPDATE SET
        status = EXCLUDED.status,
        completed_at = CASE
          WHEN EXCLUDED.status = 'completed' THEN NOW()
          ELSE driver_onboarding_sections.completed_at
        END,
        data = EXCLUDED.data,
        updated_at = NOW()
      `,
      [
        packet.id,
        sectionKey,
        newStatus,
        isCompleted ? new Date().toISOString() : null,
        JSON.stringify(data)
      ]
    );

    // When section is completed with signature fields, record e-signature so PDFs can be generated
    if (isCompleted && ['employment_application', 'mvr_authorization'].includes(sectionKey)) {
      let signerName = null;
      let signatureValue = null;
      let signedAt = new Date();
      if (sectionKey === 'employment_application' && data.applicationSignatureName) {
        signerName = data.applicationSignatureName;
        signatureValue = signerName;
        if (data.applicationSignatureDate) {
          try {
            signedAt = new Date(data.applicationSignatureDate);
          } catch (_) { /* keep default */ }
        }
      } else if (sectionKey === 'mvr_authorization' && data.mvrSignatureName) {
        signerName = data.mvrSignatureName;
        signatureValue = signerName;
        if (data.mvrSignatureDate) {
          try {
            signedAt = new Date(data.mvrSignatureDate);
          } catch (_) { /* keep default */ }
        }
      }
      if (signerName && signatureValue) {
        const signatureHash = hashToken(`${signerName}|${signatureValue}|${signedAt.toISOString()}`);
        await client.query(
          `
          INSERT INTO driver_esignatures (
            packet_id,
            section_key,
            signer_name,
            signature_type,
            signature_value,
            signed_at,
            ip_address,
            user_agent,
            consent_text_version,
            signature_hash
          )
          VALUES ($1, $2, $3, 'typed_name', $4, $5, $6, $7, 'v1', $8)
          `,
          [
            packet.id,
            sectionKey,
            signerName,
            signatureValue,
            signedAt.toISOString(),
            req.ip || '',
            req.headers['user-agent'] || '',
            signatureHash
          ]
        );
        await safeMaybeGenerateOnboardingPdfs(packet.id);
      }

      if (sectionKey === 'employment_application') {
        // mirror into normalized employment application tables and perform final submission orchestration
        try {
          await upsertEmploymentApplicationFromPacket(packet, data, true, {
            ipAddress: req.ip || '',
            userAgent: req.headers['user-agent'] || ''
          });
        } catch (syncError) {
          // Do not fail onboarding section save if normalized employment tables are not yet fully migrated.
          dtLogger.warn('employment_application_sync_failed_nonblocking', {
            packetId: packet.id,
            sectionKey,
            error: syncError?.message || String(syncError)
          });
        }
      }
    } else if (sectionKey === 'employment_application') {
      // keep draft in normalized employment application storage
      try {
        await upsertEmploymentApplicationFromPacket(packet, data, false, {
          ipAddress: req.ip || '',
          userAgent: req.headers['user-agent'] || ''
        });
      } catch (syncError) {
        // Non-blocking for legacy schemas.
        dtLogger.warn('employment_application_draft_sync_failed_nonblocking', {
          packetId: packet.id,
          sectionKey,
          error: syncError?.message || String(syncError)
        });
      }
    }

    const duration = Date.now() - start;
    dtLogger.trackRequest(
      'POST',
      `/public/onboarding/${packetId}/sections/${sectionKey}`,
      200,
      duration
    );

    return res.json({
      packetId,
      sectionKey,
      status: newStatus
    });
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('public_onboarding_section_failed', error, { params: req.params });
    dtLogger.trackRequest(
      'POST',
      `/public/onboarding/${req.params.packetId}/sections/${req.params.sectionKey}`,
      500,
      duration
    );
    // eslint-disable-next-line no-console
    console.error('Error in public onboarding section POST:', error);
    return res.status(500).json({ message: 'Failed to save onboarding section' });
  } finally {
    client.release();
  }
});

// POST /public/onboarding/:packetId/esignatures?token=...
router.post('/:packetId/esignatures', rateLimited, async (req, res) => {
  const start = Date.now();
  const client = await getClient();
  try {
    const { packetId } = req.params;
    const { token } = req.query;
    const {
      sectionKey,
      signerName,
      signatureValue,
      signatureType = 'typed_name',
      consentTextVersion = 'v1'
    } = req.body || {};

    if (!signerName || !signatureValue) {
      return res.status(400).json({ message: 'signerName and signatureValue are required' });
    }

    const allowedKeys = ['employment_application', 'mvr_authorization'];
    const finalSectionKey = allowedKeys.includes(sectionKey) ? sectionKey : 'employment_application';

    const { packet, error, status } = await loadPacketWithToken(packetId, token, true);
    if (error) {
      return res.status(status || 400).json({ message: error });
    }

    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'] || '';
    const signedAt = new Date();
    const signatureHash = hashToken(`${signerName}|${signatureValue}|${signedAt.toISOString()}`);

    await client.query(
      `
      INSERT INTO driver_esignatures (
        packet_id,
        section_key,
        signer_name,
        signature_type,
        signature_value,
        signed_at,
        ip_address,
        user_agent,
        consent_text_version,
        signature_hash
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        packet.id,
        finalSectionKey,
        signerName,
        signatureType,
        signatureValue,
        signedAt.toISOString(),
        ipAddress,
        userAgent,
        consentTextVersion,
        signatureHash
      ]
    );

    // Generate PDFs if sections are completed and PDFs not yet created
    await safeMaybeGenerateOnboardingPdfs(packet.id);

    const duration = Date.now() - start;
    dtLogger.trackRequest(
      'POST',
      `/public/onboarding/${packetId}/esignatures`,
      200,
      duration
    );

    return res.json({
      packetId,
      sectionKey: finalSectionKey,
      signedAt
    });
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('public_onboarding_esign_failed', error, { params: req.params });
    dtLogger.trackRequest(
      'POST',
      `/public/onboarding/${req.params.packetId}/esignatures`,
      500,
      duration
    );
    // eslint-disable-next-line no-console
    console.error('Error in public onboarding esign POST:', error);
    return res.status(500).json({ message: 'Failed to capture e-signature' });
  } finally {
    client.release();
  }
});

module.exports = router;

