const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { query, getClient } = require('../internal/db');
const { hashToken } = require('../services/token-service');
const dtLogger = require('../utils/logger');
const { createDriverDocument } = require('../services/driver-storage-service');
const { uploadBuffer } = require('../storage/r2-storage');
const { buildMvrAuthorizationPdf } = require('../services/driver-onboarding-pdf');
const { generateEmploymentApplicationPdf } = require('../services/pdf.service');
// FN-269: pdf-lib for image-to-PDF conversion before R2 storage
const { PDFDocument } = require('pdf-lib');
const employmentAppService = require('../services/employment-application.service');
// FN-235: DQF integration for employment application submission
const { upsertRequirementStatus, computeAndUpdateDqfCompleteness } = require('../services/dqf-service');
// FN-270: Packet submission confirmation email
const { sendPacketSubmissionConfirmation } = require('../services/onboarding-email-service');

// FN-250: Multer config for onboarding document uploads (memory storage for R2)
const onboardingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/heic',
      'image/heif'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error('Only PDF and image files (JPEG, PNG, GIF, WebP) are allowed'));
  }
});

// FN-250: Allowed onboarding document types
const ALLOWED_ONBOARDING_DOC_TYPES = new Set([
  'cdl_front',
  'cdl_back',
  'medical_certificate',
  'social_security_card',
  'other_certification'
]);

// FN-269: Map onboarding doc types to DQF requirement keys for auto-completion
// Each doc type can trigger multiple DQF requirement completions
const DOC_TYPE_TO_DQF_REQUIREMENTS = {
  cdl_front: ['driver_license_front_on_file'],
  cdl_back: ['driver_license_back_on_file'],
  medical_certificate: ['medical_card_front_on_file', 'medical_card_received']
};

/**
 * FN-269: Convert an image buffer to PDF using pdf-lib.
 * Supports JPEG and PNG. Returns the original buffer for unsupported types (HEIC, etc.)
 */
async function convertImageToPdf(buffer, mimetype) {
  try {
    const pdfDoc = await PDFDocument.create();
    let image;

    if (mimetype === 'image/jpeg') {
      image = await pdfDoc.embedJpg(buffer);
    } else if (mimetype === 'image/png') {
      image = await pdfDoc.embedPng(buffer);
    } else {
      // HEIC, GIF, WebP — pdf-lib can't embed these; store as-is
      return { buffer, mimetype, converted: false };
    }

    // Create a page sized to the image (max 8.5x11 inches = 612x792 points)
    const { width: imgW, height: imgH } = image.scale(1);
    const maxW = 612;
    const maxH = 792;
    const scale = Math.min(maxW / imgW, maxH / imgH, 1);
    const pageW = imgW * scale;
    const pageH = imgH * scale;

    const page = pdfDoc.addPage([pageW, pageH]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: pageW,
      height: pageH
    });

    const pdfBytes = await pdfDoc.save();
    return { buffer: Buffer.from(pdfBytes), mimetype: 'application/pdf', converted: true };
  } catch (convErr) {
    // If conversion fails, fall back to storing original
    dtLogger.warn('image_to_pdf_conversion_failed', { mimetype, error: convErr?.message });
    return { buffer, mimetype, converted: false };
  }
}

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
  // FN-235: Also check for 'employment_application_signed' doc type
  const existingDocsRes = await query(
    `SELECT doc_type
     FROM driver_documents
     WHERE packet_id = $1
       AND doc_type IN ('employment_application_pdf', 'employment_application_signed', 'mvr_authorization_pdf')`,
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
        'SELECT id, name, legal_name, address_line1, address_line2, city, state, zip_code, phone, email FROM operating_entities WHERE id = $1',
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
  // FN-235: Use 'employment_application_signed' docType for pre-hire documents visibility
  if (
    sections.employment_application &&
    sections.employment_application.status === 'completed' &&
    !existingTypes.has('employment_application_signed') &&
    !existingTypes.has('employment_application_pdf')
  ) {
    const applicationData = sections.employment_application.data || {};
    // Build fullApp format for the professional PDF generator
    const fullApp = {
      id: packet.id,
      applicant_snapshot: applicationData,
      employers: applicationData.employers || [],
      residencies: applicationData.residencies || [],
      licenses: applicationData.licenses || [],
      accidents: applicationData.accidents || [],
      violations: applicationData.violations || [],
      convictions: applicationData.convictions || [],
      signed_certification_at: applicationData.signatureDate || applicationData.submittedAt
    };
    const pdfContext = {};
    if (operatingEntity) {
      pdfContext.operatingEntity = {
        name: operatingEntity.name || operatingEntity.legal_name || '',
        address: [operatingEntity.address_line1, operatingEntity.address_line2, operatingEntity.city, operatingEntity.state, operatingEntity.zip_code].filter(Boolean).join(', '),
        phone: operatingEntity.phone || '',
        email: operatingEntity.email || ''
      };
    }
    if (applicationData.auditTrail) pdfContext.auditTrail = applicationData.auditTrail;

    const buffer = await generateEmploymentApplicationPdf(fullApp, pdfContext);
    // FN-216: use "{FirstName} {LastName} - Employment Application.pdf" filename
    const firstName = (driver.first_name || '').trim();
    const lastName = (driver.last_name || '').trim();
    const dateStr = new Date().toISOString().slice(0, 10);
    const pdfFileName = firstName || lastName
      ? `employment_application_${firstName}_${lastName}_${dateStr}.pdf`.replace(/\s+/g, '_')
      : `employment_application_${driver.id}_${dateStr}.pdf`;
    const empDoc = await createDriverDocument({
      driverId: driver.id,
      packetId: packet.id,
      docType: 'employment_application_signed',
      fileName: pdfFileName,
      mimeType: 'application/pdf',
      bytes: buffer,
      folder: 'employment-application'
    });
    dtLogger.info('driver_employment_application_pdf_created', { packetId, driverId: driver.id, documentId: empDoc.id });

    // FN-235: Mark DQF requirement 'employment_application_submitted' complete with evidence
    try {
      await upsertRequirementStatus(driver.id, 'employment_application_submitted', 'complete', empDoc.id);
      await computeAndUpdateDqfCompleteness(driver.id);
    } catch (dqfErr) {
      // Non-blocking: DQF update failure should not break PDF generation
      dtLogger.warn('employment_app_dqf_update_failed', {
        driverId: driver.id,
        error: dqfErr?.message || String(dqfErr)
      });
    }
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
      bytes: buffer,
      folder: 'consents'
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

/**
 * @openapi
 * /public/onboarding/{packetId}:
 *   get:
 *     summary: Load onboarding packet
 *     description: Loads a driver onboarding packet including sections, driver info, and employment application prefill data. Per 49 CFR 391.21 — Application for employment.
 *     tags:
 *       - Onboarding (Public)
 *     security: []
 *     parameters:
 *       - in: path
 *         name: packetId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Onboarding packet ID
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Packet access token
 *     responses:
 *       200:
 *         description: Onboarding packet with sections and driver data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 packet:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     status:
 *                       type: string
 *                     expiresAt:
 *                       type: string
 *                       format: date-time
 *                     driverId:
 *                       type: integer
 *                 driver:
 *                   type: object
 *                   nullable: true
 *                 sections:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       section_key:
 *                         type: string
 *                       status:
 *                         type: string
 *                       data:
 *                         type: object
 *                         nullable: true
 *       400:
 *         description: Missing packetId or token
 *       403:
 *         description: Invalid token
 *       404:
 *         description: Packet not found
 *       410:
 *         description: Packet expired or revoked
 *       429:
 *         description: Rate limited
 *       500:
 *         description: Server error
 */
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

/**
 * @openapi
 * /public/onboarding/{packetId}/sections/{sectionKey}:
 *   post:
 *     summary: Save or complete an onboarding section
 *     description: Saves section data (draft or completed). On completion, records e-signatures and generates PDFs. Also syncs to normalized employment application tables. Per 49 CFR 391.21 — Application for employment.
 *     tags:
 *       - Onboarding (Public)
 *     security: []
 *     parameters:
 *       - in: path
 *         name: packetId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Onboarding packet ID
 *       - in: path
 *         name: sectionKey
 *         required: true
 *         schema:
 *           type: string
 *           enum: [employment_application, mvr_authorization, uploads]
 *         description: Section key
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Packet access token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - data
 *             properties:
 *               data:
 *                 type: object
 *                 description: Section data payload
 *               status:
 *                 type: string
 *                 description: Section status (defaults to in_progress; set to completed to finalize)
 *     responses:
 *       200:
 *         description: Section saved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 packetId:
 *                   type: string
 *                 sectionKey:
 *                   type: string
 *                 status:
 *                   type: string
 *       400:
 *         description: Invalid section key or missing data payload
 *       403:
 *         description: Invalid token
 *       404:
 *         description: Packet not found
 *       410:
 *         description: Packet expired or revoked
 *       429:
 *         description: Rate limited
 *       500:
 *         description: Server error
 */
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

/**
 * @openapi
 * /public/onboarding/{packetId}/esignatures:
 *   post:
 *     summary: Capture an e-signature
 *     description: Records a typed-name e-signature for a section (employment application or MVR authorization). Generates PDFs if sections are completed. Per 49 CFR 391.21 — Application for employment.
 *     tags:
 *       - Onboarding (Public)
 *     security: []
 *     parameters:
 *       - in: path
 *         name: packetId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Onboarding packet ID
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Packet access token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - signerName
 *               - signatureValue
 *             properties:
 *               sectionKey:
 *                 type: string
 *                 enum: [employment_application, mvr_authorization]
 *                 description: Section key (defaults to employment_application)
 *               signerName:
 *                 type: string
 *               signatureValue:
 *                 type: string
 *               signatureType:
 *                 type: string
 *                 default: typed_name
 *               consentTextVersion:
 *                 type: string
 *                 default: v1
 *     responses:
 *       200:
 *         description: E-signature captured
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 packetId:
 *                   type: string
 *                 sectionKey:
 *                   type: string
 *                 signedAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Missing signerName or signatureValue
 *       403:
 *         description: Invalid token
 *       404:
 *         description: Packet not found
 *       410:
 *         description: Packet expired or revoked
 *       429:
 *         description: Rate limited
 *       500:
 *         description: Server error
 */
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

/**
 * @openapi
 * /public/onboarding/{packetId}/upload-document:
 *   post:
 *     summary: Upload a driver document during onboarding
 *     description: Uploads a driver document (CDL front/back, medical certificate, etc.) to R2 storage. Images are auto-converted to PDF. Auto-marks DQF requirements on upload. Per 49 CFR 391.21 — Application for employment.
 *     tags:
 *       - Onboarding (Public)
 *     security: []
 *     parameters:
 *       - in: path
 *         name: packetId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Onboarding packet ID
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Packet access token
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *               - docType
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Document file (PDF or image, max 10 MB)
 *               docType:
 *                 type: string
 *                 enum: [cdl_front, cdl_back, medical_certificate, social_security_card, other_certification]
 *                 description: Document type
 *     responses:
 *       201:
 *         description: Document uploaded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 documentId:
 *                   type: integer
 *                 fileName:
 *                   type: string
 *                 docType:
 *                   type: string
 *       400:
 *         description: No file uploaded, invalid docType, or file too large
 *       403:
 *         description: Invalid token
 *       404:
 *         description: Packet not found
 *       410:
 *         description: Packet expired or revoked
 *       429:
 *         description: Rate limited
 *       500:
 *         description: Server error
 */
// FN-250: POST /public/onboarding/:packetId/upload-document?token=...
// Upload a driver document (CDL, medical cert, etc.) during onboarding
router.post(
  '/:packetId/upload-document',
  rateLimited,
  onboardingUpload.single('file'),
  async (req, res) => {
    const start = Date.now();
    try {
      const { packetId } = req.params;
      const { token } = req.query;
      const docType = req.body.docType || req.body.documentType;

      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }
      if (!docType || !ALLOWED_ONBOARDING_DOC_TYPES.has(docType)) {
        return res.status(400).json({
          message: `Invalid docType. Allowed values: ${[...ALLOWED_ONBOARDING_DOC_TYPES].join(', ')}`
        });
      }

      const { packet, error, status } = await loadPacketWithToken(packetId, token);
      if (error) {
        return res.status(status || 400).json({ message: error });
      }

      const driverId = packet.driver_id;

      // FN-269: Convert images to PDF before R2 storage
      let uploadBuffer_ = req.file.buffer;
      let uploadMime = req.file.mimetype;
      let uploadFileName = req.file.originalname || `onboarding-${docType}`;

      if (req.file.mimetype.startsWith('image/')) {
        const converted = await convertImageToPdf(req.file.buffer, req.file.mimetype);
        uploadBuffer_ = converted.buffer;
        uploadMime = converted.mimetype;
        if (converted.converted) {
          // Replace extension with .pdf
          uploadFileName = uploadFileName.replace(/\.[^.]+$/, '.pdf');
          dtLogger.info('image_converted_to_pdf', { driverId, docType, originalMime: req.file.mimetype });
        }
      }

      // Upload to R2
      const fileExt = path.extname(uploadFileName).toLowerCase() || '.pdf';
      const safeName = uploadFileName
        ? uploadFileName.replace(/[^a-zA-Z0-9_.-]/g, '_')
        : `onboarding-${docType}${fileExt}`;
      const { key: storageKey } = await uploadBuffer({
        buffer: uploadBuffer_,
        contentType: uploadMime,
        prefix: `drivers/${driverId}/onboarding-documents`,
        fileName: safeName
      });

      // Store in driver_documents with prefixed doc_type for onboarding namespace
      const onboardingDocType = `onboarding_${docType}`;
      const result = await query(
        `INSERT INTO driver_documents (
          driver_id,
          packet_id,
          doc_type,
          file_name,
          mime_type,
          size_bytes,
          storage_mode,
          storage_key
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'r2', $7)
        RETURNING id, doc_type, file_name, mime_type, created_at`,
        [
          driverId,
          packet.id,
          onboardingDocType,
          uploadFileName,
          uploadMime,
          Buffer.byteLength(uploadBuffer_),
          storageKey
        ]
      );

      const doc = result.rows[0];

      // FN-269: Auto-mark DQF requirements if applicable
      const dqfKeys = DOC_TYPE_TO_DQF_REQUIREMENTS[docType] || [];
      if (dqfKeys.length > 0) {
        try {
          for (const dqfKey of dqfKeys) {
            await upsertRequirementStatus(driverId, dqfKey, 'complete', doc.id);
          }

          // FN-269: CDL upload → check if BOTH front and back are now uploaded
          if (docType === 'cdl_front' || docType === 'cdl_back') {
            const cdlDocs = await query(
              `SELECT doc_type FROM driver_documents
               WHERE driver_id = $1 AND packet_id = $2
                 AND doc_type IN ('onboarding_cdl_front', 'onboarding_cdl_back')
                 AND deleted_at IS NULL`,
              [driverId, packet.id]
            );
            const cdlTypes = new Set(cdlDocs.rows.map(r => r.doc_type));
            if (cdlTypes.has('onboarding_cdl_front') && cdlTypes.has('onboarding_cdl_back')) {
              await upsertRequirementStatus(driverId, 'cdl_on_file', 'complete', doc.id);
            }
          }

          await computeAndUpdateDqfCompleteness(driverId);
        } catch (dqfErr) {
          // Non-blocking: DQF auto-mark should not fail the upload
          dtLogger.warn('onboarding_doc_dqf_auto_mark_failed', {
            driverId,
            docType,
            dqfKeys,
            error: dqfErr?.message || String(dqfErr)
          });
        }
      }

      const duration = Date.now() - start;
      dtLogger.trackRequest('POST', `/public/onboarding/${packetId}/upload-document`, 201, duration, {
        driverId,
        docType: onboardingDocType
      });

      return res.status(201).json({
        success: true,
        documentId: doc.id,
        fileName: doc.file_name,
        docType: onboardingDocType
      });
    } catch (error) {
      // Handle multer file-size / filter errors
      if (error?.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'File size exceeds 10 MB limit' });
      }
      if (error?.message?.includes('Only PDF and image files')) {
        return res.status(400).json({ message: error.message });
      }
      const duration = Date.now() - start;
      dtLogger.error('public_onboarding_upload_document_failed', error, { params: req.params });
      dtLogger.trackRequest('POST', `/public/onboarding/${req.params.packetId}/upload-document`, 500, duration);
      console.error('Error in public onboarding upload-document:', error);
      return res.status(500).json({ message: 'Failed to upload document' });
    }
  }
);

/**
 * @openapi
 * /public/onboarding/{packetId}/documents:
 *   get:
 *     summary: List onboarding documents for a packet
 *     description: Returns all uploaded onboarding documents for this packet's driver, with the onboarding_ prefix stripped from document types. Per 49 CFR 391.21 — Application for employment.
 *     tags:
 *       - Onboarding (Public)
 *     security: []
 *     parameters:
 *       - in: path
 *         name: packetId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Onboarding packet ID
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Packet access token
 *     responses:
 *       200:
 *         description: List of onboarding documents
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 documents:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       document_type:
 *                         type: string
 *                       file_name:
 *                         type: string
 *                       uploaded_at:
 *                         type: string
 *                         format: date-time
 *       400:
 *         description: Missing required parameters
 *       403:
 *         description: Invalid token
 *       404:
 *         description: Packet not found
 *       410:
 *         description: Packet expired or revoked
 *       429:
 *         description: Rate limited
 *       500:
 *         description: Server error
 */
// FN-250: GET /public/onboarding/:packetId/documents?token=...
// List all onboarding documents for this packet's driver
router.get('/:packetId/documents', rateLimited, async (req, res) => {
  const start = Date.now();
  try {
    const { packetId } = req.params;
    const { token } = req.query;

    const { packet, error, status } = await loadPacketWithToken(packetId, token);
    if (error) {
      return res.status(status || 400).json({ message: error });
    }

    const docs = await query(
      `SELECT id, doc_type, file_name, mime_type, created_at
       FROM driver_documents
       WHERE driver_id = $1
         AND packet_id = $2
         AND doc_type LIKE 'onboarding_%'
         AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [packet.driver_id, packet.id]
    );

    // FN-269: Map DB column names to frontend expected format
    // Strip 'onboarding_' prefix so frontend can match by document type key
    const documents = docs.rows.map(row => ({
      id: row.id,
      document_type: row.doc_type.replace(/^onboarding_/, ''),
      file_name: row.file_name,
      uploaded_at: row.created_at
    }));

    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', `/public/onboarding/${packetId}/documents`, 200, duration, {
      driverId: packet.driver_id,
      count: documents.length
    });

    return res.json({ documents });
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('public_onboarding_list_documents_failed', error, { params: req.params });
    dtLogger.trackRequest('GET', `/public/onboarding/${req.params.packetId}/documents`, 500, duration);
    console.error('Error in public onboarding list documents:', error);
    return res.status(500).json({ message: 'Failed to list documents' });
  }
});

/**
 * @openapi
 * /public/onboarding/{packetId}/license:
 *   get:
 *     summary: Get driver license prefill data
 *     description: Returns most recent license data (ssnLast4, dateOfBirth, licenseNumber, licenseState) for pre-populating the employment application. Per 49 CFR 391.21 — Application for employment.
 *     tags:
 *       - Onboarding (Public)
 *     security: []
 *     parameters:
 *       - in: path
 *         name: packetId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Onboarding packet ID
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Packet access token
 *     responses:
 *       200:
 *         description: License prefill data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ssnLast4:
 *                   type: string
 *                   nullable: true
 *                 dateOfBirth:
 *                   type: string
 *                   format: date
 *                   nullable: true
 *                 licenseNumber:
 *                   type: string
 *                   nullable: true
 *                 licenseState:
 *                   type: string
 *                   nullable: true
 *       400:
 *         description: Missing required parameters
 *       403:
 *         description: Invalid token
 *       404:
 *         description: Packet not found
 *       410:
 *         description: Packet expired or revoked
 *       429:
 *         description: Rate limited
 *       500:
 *         description: Server error
 */
// FN-528: GET /public/onboarding/:packetId/license?token=...
// Returns most recent license data (ssnLast4, dateOfBirth, licenseNumber, licenseState)
// for pre-populating the employment application license history section.
router.get('/:packetId/license', rateLimited, async (req, res) => {
  const start = Date.now();
  try {
    const { packetId } = req.params;
    const { token } = req.query;

    const { packet, error, status } = await loadPacketWithToken(packetId, token);
    if (error) {
      return res.status(status || 400).json({ message: error });
    }

    const driverRes = await safeOptionalQuery(
      `SELECT id, cdl_number, cdl_state, cdl_class, cdl_expiry, date_of_birth
       FROM drivers WHERE id = $1`,
      [packet.driver_id]
    );

    const licenseRes = await safeOptionalQuery(
      `SELECT cdl_number, cdl_state, cdl_class, cdl_expiry, endorsements
       FROM driver_licenses
       WHERE driver_id = $1
       ORDER BY created_at DESC NULLS LAST
       LIMIT 1`,
      [packet.driver_id]
    );

    const latestAppRes = await safeOptionalQuery(
      `SELECT applicant_snapshot
       FROM employment_applications
       WHERE driver_id = $1
       ORDER BY created_at DESC NULLS LAST
       LIMIT 1`,
      [packet.driver_id]
    );

    const driver = driverRes.rows[0] || null;
    const license = licenseRes.rows[0] || null;
    const latestApp = latestAppRes.rows[0] || null;

    const prefill = buildEmploymentPrefill({ driver, license, latestApp });

    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', `/public/onboarding/${packetId}/license`, 200, duration, {
      driverId: packet.driver_id
    });

    return res.json({
      ssnLast4: prefill.ssnLast4 || null,
      dateOfBirth: prefill.dateOfBirth || null,
      licenseNumber: prefill.licenseNumber || null,
      licenseState: prefill.licenseState || null
    });
  } catch (err) {
    const duration = Date.now() - start;
    dtLogger.error('public_driver_license_prefill_failed', err, { params: req.params });
    dtLogger.trackRequest('GET', `/public/onboarding/${req.params.packetId}/license`, 500, duration);
    console.error('Error in public onboarding license prefill:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * @openapi
 * /public/onboarding/{packetId}/documents/{documentId}:
 *   delete:
 *     summary: Delete an onboarding document
 *     description: Soft-deletes an onboarding document uploaded during the onboarding process. Per 49 CFR 391.21 — Application for employment.
 *     tags:
 *       - Onboarding (Public)
 *     security: []
 *     parameters:
 *       - in: path
 *         name: packetId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Onboarding packet ID
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Document ID to delete
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Packet access token
 *     responses:
 *       200:
 *         description: Document deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       400:
 *         description: Missing required parameters
 *       403:
 *         description: Invalid token
 *       404:
 *         description: Document or packet not found
 *       410:
 *         description: Packet expired or revoked
 *       429:
 *         description: Rate limited
 *       500:
 *         description: Server error
 */
// FN-250: DELETE /public/onboarding/:packetId/documents/:documentId?token=...
// Soft-delete an onboarding document
router.delete('/:packetId/documents/:documentId', rateLimited, async (req, res) => {
  const start = Date.now();
  try {
    const { packetId, documentId } = req.params;
    const { token } = req.query;

    const { packet, error, status } = await loadPacketWithToken(packetId, token);
    if (error) {
      return res.status(status || 400).json({ message: error });
    }

    // Verify document belongs to this packet's driver and is an onboarding doc
    const docRes = await query(
      `SELECT id, doc_type
       FROM driver_documents
       WHERE id = $1
         AND driver_id = $2
         AND packet_id = $3
         AND doc_type LIKE 'onboarding_%'
         AND deleted_at IS NULL`,
      [documentId, packet.driver_id, packet.id]
    );

    if (docRes.rows.length === 0) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Soft delete
    await query(
      'UPDATE driver_documents SET deleted_at = NOW() WHERE id = $1',
      [documentId]
    );

    const duration = Date.now() - start;
    dtLogger.trackRequest('DELETE', `/public/onboarding/${packetId}/documents/${documentId}`, 200, duration, {
      driverId: packet.driver_id,
      documentId
    });

    return res.json({ success: true, message: 'Document deleted' });
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('public_onboarding_delete_document_failed', error, { params: req.params });
    dtLogger.trackRequest(
      'DELETE',
      `/public/onboarding/${req.params.packetId}/documents/${req.params.documentId}`,
      500,
      duration
    );
    console.error('Error in public onboarding delete document:', error);
    return res.status(500).json({ message: 'Failed to delete document' });
  }
});

/**
 * @openapi
 * /public/onboarding/{packetId}/finalize:
 *   post:
 *     summary: Finalize and submit onboarding packet
 *     description: Validates all required sections are completed, marks the packet as submitted, populates driver record from application data, and sends confirmation email. Per 49 CFR 391.21 — Application for employment.
 *     tags:
 *       - Onboarding (Public)
 *     security: []
 *     parameters:
 *       - in: path
 *         name: packetId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Onboarding packet ID
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Packet access token
 *     responses:
 *       200:
 *         description: Packet submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       400:
 *         description: Missing required parameters
 *       403:
 *         description: Invalid token
 *       404:
 *         description: Packet not found
 *       409:
 *         description: Packet already submitted
 *       410:
 *         description: Packet expired or revoked
 *       422:
 *         description: Required sections incomplete
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 incompleteSections:
 *                   type: array
 *                   items:
 *                     type: string
 *       429:
 *         description: Rate limited
 *       500:
 *         description: Server error
 */
// FN-270: POST /public/onboarding/:packetId/finalize?token=...
// Marks the packet as submitted and sends a confirmation email to the driver.
router.post('/:packetId/finalize', rateLimited, async (req, res) => {
  const start = Date.now();
  try {
    const { packetId } = req.params;
    const { token } = req.query;

    const { packet, error, status } = await loadPacketWithToken(packetId, token, true);
    if (error) {
      return res.status(status || 400).json({ message: error });
    }

    // Reject if already submitted
    if (packet.status === 'submitted') {
      return res.status(409).json({ message: 'Packet has already been submitted.' });
    }

    // Load sections to validate required ones are completed
    let sectionsRes;
    try {
      sectionsRes = await query(
        'SELECT section_key, status FROM driver_onboarding_sections WHERE packet_id = $1',
        [packetId]
      );
    } catch (sErr) {
      dtLogger.warn('finalize_sections_query_fallback', { error: sErr?.message });
      sectionsRes = { rows: [] };
    }

    const sectionMap = {};
    (sectionsRes.rows || []).forEach((s) => {
      sectionMap[s.section_key] = s.status;
    });

    // Validate required sections — check actual completion, not just section status rows
    const incompleteSections = [];

    // 1. Employment application: check section status
    if (sectionMap['employment_application'] !== 'completed') {
      incompleteSections.push('employment_application');
    }

    // 2. Consent forms: check if all onboarding consents are signed
    // Only check the 8 consent keys shown in the driver onboarding flow
    if (sectionMap['consent_forms'] !== 'completed') {
      try {
        const ONBOARDING_CONSENT_KEYS = [
          'fcra_disclosure', 'fcra_authorization',
          'release_of_information', 'drug_alcohol_release',
          'mvr_disclosure', 'mvr_authorization', 'mvr_release_of_liability',
          'psp_consent'
        ];
        const consentsRes = await query(
          `SELECT dc.consent_key
           FROM driver_consents dc
           WHERE dc.packet_id = $1
             AND dc.status = 'signed'
             AND dc.consent_key = ANY($2)`,
          [packetId, ONBOARDING_CONSENT_KEYS]
        );
        const signedKeys = new Set(consentsRes.rows.map(r => r.consent_key));
        const unsignedKeys = ONBOARDING_CONSENT_KEYS.filter(k => !signedKeys.has(k));
        const allConsentsSigned = unsignedKeys.length === 0;
        dtLogger.info('finalize_consent_check', {
          packetId,
          required: ONBOARDING_CONSENT_KEYS.length,
          signed: signedKeys.size,
          allSigned: allConsentsSigned,
          unsignedKeys
        });
        if (!allConsentsSigned) {
          incompleteSections.push('consent_forms');
        }
      } catch (cErr) {
        dtLogger.warn('finalize_consent_check_fallback', { error: cErr?.message });
        incompleteSections.push('consent_forms');
      }
    }

    // 3. Document uploads: check if required docs exist
    if (sectionMap['document_uploads'] !== 'completed') {
      try {
        const docsRes = await query(
          `SELECT doc_type FROM driver_documents
           WHERE driver_id = $1 AND doc_type IN (
             'onboarding_cdl_front', 'onboarding_cdl_back', 'onboarding_medical_certificate',
             'cdl_front', 'cdl_back', 'medical_certificate'
           )`,
          [packet.driver_id]
        );
        const uploadedTypes = new Set(docsRes.rows.map(r => r.doc_type));
        const hasRequiredDocs =
          (uploadedTypes.has('onboarding_cdl_front') || uploadedTypes.has('cdl_front')) &&
          (uploadedTypes.has('onboarding_cdl_back') || uploadedTypes.has('cdl_back')) &&
          (uploadedTypes.has('onboarding_medical_certificate') || uploadedTypes.has('medical_certificate'));
        if (!hasRequiredDocs) {
          incompleteSections.push('document_uploads');
        }
      } catch (dErr) {
        dtLogger.warn('finalize_docs_check_fallback', { error: dErr?.message });
        incompleteSections.push('document_uploads');
      }
    }

    if (incompleteSections.length > 0) {
      return res.status(422).json({
        message: 'All required sections must be completed before submission.',
        incompleteSections
      });
    }

    // Update packet status to submitted
    await query(
      `UPDATE driver_onboarding_packets SET status = 'submitted' WHERE id = $1`,
      [packetId]
    );

    // FN-291: If driver status is 'pending', populate driver fields from application data
    try {
      const driverStatusRes = await query(
        'SELECT id, status FROM drivers WHERE id = $1',
        [packet.driver_id]
      );
      const driverRow = driverStatusRes.rows[0];
      if (driverRow && driverRow.status === 'pending') {
        // Load employment_application section data
        const appDataRes = await query(
          `SELECT data FROM driver_onboarding_sections
           WHERE packet_id = $1 AND section_key = 'employment_application'`,
          [packetId]
        );
        const appData = appDataRes.rows[0]?.data || {};

        // Build update fields from application data
        const updates = [];
        const values = [];
        let paramIdx = 1;

        // Always transition from pending to applicant
        updates.push(`status = 'applicant'`);

        if (appData.phone) { updates.push(`phone = $${paramIdx}`); values.push(appData.phone); paramIdx++; }
        if (appData.dateOfBirth) { updates.push(`date_of_birth = $${paramIdx}`); values.push(appData.dateOfBirth); paramIdx++; }
        if (appData.streetAddress) { updates.push(`street_address = $${paramIdx}`); values.push(appData.streetAddress); paramIdx++; }
        if (appData.city) { updates.push(`city = $${paramIdx}`); values.push(appData.city); paramIdx++; }
        if (appData.state) { updates.push(`state = $${paramIdx}`); values.push(appData.state); paramIdx++; }
        if (appData.zipCode) { updates.push(`zip_code = $${paramIdx}`); values.push(appData.zipCode); paramIdx++; }
        if (appData.cdlNumber) { updates.push(`cdl_number = $${paramIdx}`); values.push(appData.cdlNumber); paramIdx++; }
        if (appData.cdlState) { updates.push(`cdl_state = $${paramIdx}`); values.push(appData.cdlState.toUpperCase()); paramIdx++; }
        if (appData.cdlClass) { updates.push(`cdl_class = $${paramIdx}`); values.push(appData.cdlClass); paramIdx++; }
        if (appData.cdlExpiry) { updates.push(`cdl_expiry = $${paramIdx}`); values.push(appData.cdlExpiry); paramIdx++; }

        updates.push(`updated_at = NOW()`);
        values.push(packet.driver_id);

        await query(
          `UPDATE drivers SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
          values
        );

        dtLogger.info('pending_driver_populated_from_application', {
          packetId, driverId: packet.driver_id,
          fieldsUpdated: updates.length - 2 // exclude status and updated_at
        });
      }
    } catch (populateErr) {
      dtLogger.warn('finalize_populate_pending_driver_failed', {
        packetId, driverId: packet.driver_id,
        error: populateErr?.message
      });
    }

    // Trigger PDF generation for any remaining documents (non-blocking)
    try {
      await maybeGenerateOnboardingPdfs(packetId);
    } catch (pdfErr) {
      dtLogger.warn('finalize_pdf_generation_failed', {
        packetId,
        error: pdfErr?.message
      });
    }

    // Load driver and operating entity for the confirmation email
    const driverRes = await query(
      'SELECT id, first_name, last_name, email, phone FROM drivers WHERE id = $1',
      [packet.driver_id]
    );
    const driver = driverRes.rows[0] || null;

    let operatingEntity = null;
    try {
      const oeId = packet.operating_entity_id || driver?.operating_entity_id || null;
      if (oeId) {
        const oeRes = await query(
          'SELECT id, name, legal_name, address_line1, address_line2, city, state, zip_code, phone, email FROM operating_entities WHERE id = $1',
          [oeId]
        );
        operatingEntity = oeRes.rows[0] || null;
      }
    } catch (oeErr) {
      dtLogger.warn('finalize_operating_entity_lookup_fallback', { error: oeErr?.message });
    }

    // Send confirmation email (fire-and-forget, never blocks response)
    if (driver?.email) {
      sendPacketSubmissionConfirmation({
        driverEmail: driver.email,
        driverFirstName: driver.first_name,
        driverLastName: driver.last_name,
        operatingEntity,
        completedSections: sectionMap
      }).catch((emailErr) => {
        dtLogger.error('finalize_confirmation_email_error', {
          packetId,
          driverId: driver?.id,
          error: emailErr?.message || String(emailErr)
        });
      });
    }

    const duration = Date.now() - start;
    dtLogger.trackRequest('POST', `/public/onboarding/${packetId}/finalize`, 200, duration, {
      driverId: packet.driver_id
    });
    dtLogger.info('onboarding_packet_finalized', { packetId, driverId: packet.driver_id });

    return res.json({
      success: true,
      message: 'Onboarding packet submitted successfully.',
      emailSent: !!driver?.email
    });
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('public_onboarding_finalize_failed', error, { params: req.params });
    dtLogger.trackRequest('POST', `/public/onboarding/${req.params.packetId}/finalize`, 500, duration);
    console.error('Error in public onboarding finalize:', error);
    return res.status(500).json({ message: 'Failed to submit onboarding packet.' });
  }
});

module.exports = router;

