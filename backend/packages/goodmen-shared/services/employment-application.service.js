const db = require('../internal/db').knex;
const pdfService = require('./pdf.service');
const r2 = require('../storage/r2-storage');
const dtLogger = require('../utils/logger');
const { upsertRequirementStatus, computeAndUpdateDqfCompleteness, logStatusChange } = require('./dqf-service');

// The canonical DQF requirement key for employment application under Pre-Hire Documents
const EMPLOYMENT_APP_REQUIREMENT_KEY = 'employment_application';

function mapEmployerToDb(emp, applicationId) {
  return {
    application_id: applicationId,
    company_name: emp.employerName || emp.companyName || emp.company_name || null,
    phone: emp.phoneNumber || emp.phone || null,
    address: emp.address || null,
    street_address: emp.streetAddress || emp.street_address || null,
    city: emp.city || null,
    state: emp.state || null,
    zip_code: emp.zipCode || emp.zip_code || null,
    position_held: emp.positionHeld || emp.position_held || null,
    from_month_year: emp.fromDate || emp.fromMonthYear || emp.from_month_year || null,
    to_month_year: emp.toDate || emp.toMonthYear || emp.to_month_year || null,
    reason_for_leaving: emp.reasonForLeaving || emp.reason_for_leaving || null,
    salary: emp.salaryWage || emp.salary || null,
    contact_person: emp.contactPerson || emp.contact_person || null,
    employer_email: emp.employerEmail || emp.employer_email || null,
    is_current: emp.isCurrent || emp.is_current || false,
    was_cmv: emp.wasCMV || emp.was_cmv || false,
    subject_to_fmcsr: emp.subjectToFMCSR ?? emp.subject_to_fmcsr ?? null,
    safety_sensitive_dot_function: emp.safetySensitiveDOTFunction ?? emp.safety_sensitive_dot_function ?? null,
    gaps_explanation: emp.gapsExplanation || emp.gaps_explanation || null
  };
}

async function createDraft(driverId, payload, userId, context = null) {
  // Build applicant snapshot including new fields (work auth, drug/alcohol, driving exp)
  const applicantSnapshot = {
    ...(payload.applicantSnapshot || {}),
    workAuthorization: payload.workAuthorization || null,
    drugAlcohol: payload.drugAlcohol || null,
    drivingExperience: payload.drivingExperience || null,
    hasAccidents: payload.hasAccidents || null,
    hasViolations: payload.hasViolations || null
  };

  // Build the insert payload — include FN-215 columns when provided (nullable for backward compat)
  const insertData = {
    driver_id: driverId,
    tenant_id: context?.tenantId || null,
    operating_entity_id: context?.operatingEntityId || null,
    status: 'draft',
    application_date: payload.applicationDate || null,
    created_by: userId || null,
    updated_by: userId || null,
    applicant_snapshot: JSON.stringify(applicantSnapshot)
  };

  // FN-215: disqualification and certification columns
  if (payload.has_been_disqualified != null) {
    insertData.has_been_disqualified = payload.has_been_disqualified;
  }
  if (payload.certification_text_version != null) {
    insertData.certification_text_version = payload.certification_text_version;
  }
  if (payload.signed_certification_at != null) {
    insertData.signed_certification_at = payload.signed_certification_at;
  }

  const [row] = await db('employment_applications').insert(insertData).returning('*');

  // save nested rows if provided
  if (payload.residencies && payload.residencies.length) {
    const rows = payload.residencies.map((r) => ({
      application_id: row.id,
      residency_type: r.residencyType || r.residency_type || null,
      street: r.street || null,
      city: r.city || null,
      state: r.state || null,
      zip_code: r.zip || r.zipCode || r.zip_code || null,
      years_at_address: r.yearsAtAddress || r.years_at_address || null
    }));
    await db('employment_application_residencies').insert(rows);
  }
  if (payload.licenses && payload.licenses.length) {
    const rows = payload.licenses.map((r) => ({
      application_id: row.id,
      state: r.state || null,
      license_number: r.licenseNumber || r.license_number || null,
      license_class_or_type: r.type || r.licenseClassOrType || r.license_class_or_type || null,
      endorsements: r.endorsements || null,
      expiration_date: r.expirationDate || r.expiration_date || null
    }));
    await db('employment_application_licenses').insert(rows);
  }
  if (payload.drivingExperience && payload.drivingExperience.length) {
    const rows = payload.drivingExperience.map((r) => ({ ...r, application_id: row.id }));
    await db('employment_application_driving_experience').insert(rows);
  }
  if (payload.employers && payload.employers.length) {
    // FN-215: employers now support a `tier` field ('detailed' | 'summary')
    const rows = payload.employers.map((r) => mapEmployerToDb(r, row.id));
    await db('employment_application_employers').insert(rows);
  }
  if (payload.accidents && payload.accidents.length) {
    const rows = payload.accidents.map((r) => ({
      application_id: row.id,
      date: r.date || null,
      nature_of_accident: r.natureOfAccident || r.nature_of_accident || null,
      fatalities_count: r.fatalities || r.fatalities_count || 0,
      injuries_count: r.injuries || r.injuries_count || 0,
      chemical_spill: r.hazardousMaterialSpill || r.chemical_spill || false,
      hazardous_material_spill: r.hazardousMaterialSpill || r.hazardous_material_spill || false
    }));
    await db('employment_application_accidents').insert(rows);
  }
  if (payload.violations && payload.violations.length) {
    try {
      const rows = payload.violations.map((r) => ({
        application_id: row.id,
        location: r.location || null,
        date: r.date || null,
        charge: r.charge || null,
        penalty: r.penalty || null
      }));
      await db('employment_application_violations').insert(rows);
    } catch (e) {
      dtLogger.warn('violations_insert_failed', { error: e?.message });
    }
  }
  if (payload.convictions && payload.convictions.length) {
    const rows = payload.convictions.map((r) => ({
      application_id: row.id,
      date_convicted: r.dateConvicted || r.date_convicted || null,
      violation: r.violation || null,
      state_of_violation: r.stateOfViolation || r.state_of_violation || null,
      penalty: r.penalty || null
    }));
    await db('employment_application_convictions').insert(rows);
  }
  if (payload.education && payload.education.length) {
    const rows = payload.education.map((r) => ({
      application_id: row.id,
      school_type: r.schoolType || r.school_type || null,
      school_name_and_location: r.schoolNameAndLocation || r.school_name_and_location || null,
      course_of_study: r.courseOfStudy || r.course_of_study || null,
      years_completed: r.yearsCompleted || r.years_completed || null,
      graduated: r.graduated || null,
      details: r.details || null
    }));
    await db('employment_application_education').insert(rows);
  }
  // FN-215: insert disqualifications if provided
  if (payload.disqualifications && payload.disqualifications.length) {
    const rows = payload.disqualifications.map((r) => ({ ...r, application_id: row.id }));
    await db('employment_application_disqualifications').insert(rows);
  }

  return row;
}

async function updateDraft(applicationId, payload, userId, context = null) {
  return db.transaction(async (trx) => {
    const app = await trx('employment_applications').where({ id: applicationId }).first();
    if (!app) throw new Error('Application not found');

    // Build applicant snapshot including new fields
    const applicantSnapshot = {
      ...(payload.applicantSnapshot || app.applicant_snapshot || {}),
      workAuthorization: payload.workAuthorization || (app.applicant_snapshot || {}).workAuthorization || null,
      drugAlcohol: payload.drugAlcohol || (app.applicant_snapshot || {}).drugAlcohol || null,
      drivingExperience: payload.drivingExperience || (app.applicant_snapshot || {}).drivingExperience || null,
      hasAccidents: payload.hasAccidents || (app.applicant_snapshot || {}).hasAccidents || null,
      hasViolations: payload.hasViolations || (app.applicant_snapshot || {}).hasViolations || null
    };

    const patch = {
      application_date: payload.applicationDate || app.application_date,
      updated_at: trx.fn.now(),
      updated_by: userId || app.updated_by,
      applicant_snapshot: JSON.stringify(applicantSnapshot)
    };

    // FN-215: new columns — only overwrite when explicitly provided
    if (payload.has_been_disqualified != null) {
      patch.has_been_disqualified = payload.has_been_disqualified;
    }
    if (payload.certification_text_version != null) {
      patch.certification_text_version = payload.certification_text_version;
    }
    if (payload.signed_certification_at != null) {
      patch.signed_certification_at = payload.signed_certification_at;
    }

    await trx('employment_applications').where({ id: applicationId }).update(patch);

    // replace child collections atomically (FN-215: employers now carry `tier`, disqualifications added)
    const collections = [
      { key: 'residencies', table: 'employment_application_residencies' },
      { key: 'licenses', table: 'employment_application_licenses' },
      { key: 'accidents', table: 'employment_application_accidents' },
      { key: 'convictions', table: 'employment_application_convictions' },
      { key: 'employers', table: 'employment_application_employers' },
      { key: 'education', table: 'employment_application_education' },
      { key: 'disqualifications', table: 'employment_application_disqualifications' }
    ];

    for (const c of collections) {
      if (Array.isArray(payload[c.key])) {
        await trx(c.table).where({ application_id: applicationId }).del();
        if (payload[c.key].length) {
          let rows;
          if (c.key === 'employers') {
            rows = payload[c.key].map((r) => mapEmployerToDb(r, applicationId));
          } else if (c.key === 'residencies') {
            rows = payload[c.key].map((r) => ({
              application_id: applicationId,
              residency_type: r.residencyType || r.residency_type || null,
              street: r.street || null,
              city: r.city || null,
              state: r.state || null,
              zip_code: r.zip || r.zipCode || r.zip_code || null,
              years_at_address: r.yearsAtAddress || r.years_at_address || null
            }));
          } else if (c.key === 'licenses') {
            rows = payload[c.key].map((r) => ({
              application_id: applicationId,
              state: r.state || null,
              license_number: r.licenseNumber || r.license_number || null,
              license_class_or_type: r.type || r.licenseClassOrType || r.license_class_or_type || null,
              endorsements: r.endorsements || null,
              expiration_date: r.expirationDate || r.expiration_date || null
            }));
          } else if (c.key === 'accidents') {
            rows = payload[c.key].map((r) => ({
              application_id: applicationId,
              date: r.date || null,
              nature_of_accident: r.natureOfAccident || r.nature_of_accident || null,
              fatalities_count: r.fatalities || r.fatalities_count || 0,
              injuries_count: r.injuries || r.injuries_count || 0,
              chemical_spill: r.hazardousMaterialSpill || r.chemical_spill || false,
              hazardous_material_spill: r.hazardousMaterialSpill || r.hazardous_material_spill || false
            }));
          } else {
            rows = payload[c.key].map((r) => ({ ...r, application_id: applicationId }));
          }
          await trx(c.table).insert(rows);
        }
      }
    }

    // Handle violations separately (new table)
    if (Array.isArray(payload.violations)) {
      try {
        if (await trx.schema.hasTable('employment_application_violations')) {
          await trx('employment_application_violations').where({ application_id: applicationId }).del();
          if (payload.violations.length) {
            const rows = payload.violations.map((r) => ({
              application_id: applicationId,
              location: r.location || null,
              date: r.date || null,
              charge: r.charge || null,
              penalty: r.penalty || null
            }));
            await trx('employment_application_violations').insert(rows);
          }
        }
      } catch (e) {
        dtLogger.warn('violations_update_failed', { error: e?.message });
      }
    }

    const updated = await trx('employment_applications').where({ id: applicationId }).first();
    return updated;
  });
}

async function getById(applicationId, context = null) {
  const app = await db('employment_applications').where({ id: applicationId }).first();
  if (!app) return null;
  const residencies = await db('employment_application_residencies').where({ application_id: applicationId }).orderBy('id');
  const licenses = await db('employment_application_licenses').where({ application_id: applicationId }).orderBy('id');
  const drivingExperience = await db('employment_application_driving_experience').where({ application_id: applicationId }).orderBy('id');
  const accidents = await db('employment_application_accidents').where({ application_id: applicationId }).orderBy('id');
  const convictions = await db('employment_application_convictions').where({ application_id: applicationId }).orderBy('id');
  const employers = await db('employment_application_employers').where({ application_id: applicationId }).orderBy('id');
  const education = await db('employment_application_education').where({ application_id: applicationId }).orderBy('id');
  const documents = await db('employment_application_documents').where({ application_id: applicationId }).orderBy('uploaded_at');

  // Fetch violations — tolerate missing table for pre-migration schemas
  let violations = [];
  try {
    if (await db.schema.hasTable('employment_application_violations')) {
      violations = await db('employment_application_violations').where({ application_id: applicationId }).orderBy('id');
    }
  } catch { /* table may not exist yet */ }

  // FN-215: fetch disqualifications — tolerate missing table for pre-migration schemas
  let disqualifications = [];
  try {
    disqualifications = await db('employment_application_disqualifications')
      .where({ application_id: applicationId })
      .orderBy('id');
  } catch (e) {
    dtLogger.warn('disqualifications_fetch_skipped', { applicationId, error: e?.message || String(e) });
  }

  return { ...app, residencies, licenses, drivingExperience, accidents, convictions, employers, education, documents, violations, disqualifications };
}

async function getByDriverId(driverId, context = null) {
  const rows = await db('employment_applications').where({ driver_id: driverId }).orderBy('created_at', 'desc').limit(10);
  return rows;
}

async function submitApplication(applicationId, payload, userId, context = null) {
  // Orchestration: validate, persist, set status, generate PDF, upload to R2, update records & DQF
  return db.transaction(async (trx) => {
    const app = await trx('employment_applications').where({ id: applicationId }).forUpdate().first();
    if (!app) throw new Error('Application not found');

    // FN-216: Allow resubmission — if already submitted, reset status so a new PDF is generated.
    // The old PDF stays in document history.
    if (app.status && app.status !== 'draft') {
      dtLogger.info('employment_application_resubmission', {
        applicationId,
        previousStatus: app.status,
        driverId: app.driver_id
      });
    }

    // persist final snapshot
    await trx('employment_applications').where({ id: applicationId }).update({
      status: 'submitted_pending_document',
      submitted_at: trx.fn.now(),
      updated_at: trx.fn.now(),
      updated_by: userId || app.updated_by
    });

    const fullApp = await getById(applicationId);

    // FN-216: Build PDF context with operating entity
    const pdfContext = {};
    if (context?.operatingEntity) {
      pdfContext.operatingEntity = context.operatingEntity;
    }
    // Pass audit trail from applicant_snapshot if available
    const snapshot = fullApp.applicant_snapshot || {};
    if (snapshot.auditTrail) {
      pdfContext.auditTrail = snapshot.auditTrail;
    }

    // Generate PDF (pdfService returns Buffer)
    let pdfBuf;
    try {
      pdfBuf = await pdfService.generateEmploymentApplicationPdf(fullApp, pdfContext);
    } catch (e) {
      dtLogger.error('pdf_generation_failed', { applicationId, error: e?.message || String(e) });
      throw new Error('PDF generation failed');
    }

    // FN-216: Use driver name in filename: "{FirstName} {LastName} - Employment Application.pdf"
    const driverFirstName = (snapshot.firstName || '').trim();
    const driverLastName = (snapshot.lastName || '').trim();
    let driverFileName;
    if (driverFirstName || driverLastName) {
      driverFileName = `${driverFirstName} ${driverLastName} - Employment Application.pdf`.trim();
    } else {
      // Fallback: try querying the drivers table
      try {
        const driverRow = await trx('drivers').where({ id: app.driver_id }).select('first_name', 'last_name').first();
        if (driverRow && (driverRow.first_name || driverRow.last_name)) {
          driverFileName = `${(driverRow.first_name || '').trim()} ${(driverRow.last_name || '').trim()} - Employment Application.pdf`.trim();
        }
      } catch (_) { /* fallback below */ }
      if (!driverFileName) {
        driverFileName = `Employment Application - ${app.driver_id}.pdf`;
      }
    }

    // Upload to storage (R2)
    let uploadResult;
    try {
      const res = await r2.uploadBuffer({ buffer: pdfBuf, fileName: driverFileName, contentType: 'application/pdf' });
      uploadResult = { objectKey: res.key, bucketName: process.env.R2_BUCKET, fileName: driverFileName, contentType: 'application/pdf', fileSize: pdfBuf.length };
    } catch (e) {
      dtLogger.error('r2_upload_failed', { applicationId, error: e?.message || String(e) });
      throw new Error('Document upload failed');
    }

    // persist document metadata
    const [doc] = await trx('employment_application_documents').insert({
      application_id: applicationId,
      document_type: 'Employment Application',
      bucket_name: uploadResult.bucketName || null,
      object_key: uploadResult.objectKey || null,
      file_name: uploadResult.fileName || null,
      content_type: uploadResult.contentType || null,
      file_size: uploadResult.fileSize || null,
      uploaded_at: trx.fn.now()
    }).returning('*');

    // also persist a driver_documents record so DQF document list can surface this file
    let dqfDriverDocument = null;
    try {
      if (await trx.schema.hasTable('driver_document_blobs') && await trx.schema.hasTable('driver_documents')) {
        const [blob] = await trx('driver_document_blobs').insert({ bytes: pdfBuf }).returning('*');
        const [drvDoc] = await trx('driver_documents').insert({
          driver_id: app.driver_id,
          packet_id: null,
          doc_type: 'employment_application_pdf',
          file_name: uploadResult.fileName || driverFileName,
          mime_type: 'application/pdf',
          size_bytes: uploadResult.fileSize || pdfBuf.length,
          storage_mode: 'r2',
          storage_key: uploadResult.objectKey || null,
          blob_id: blob.id
        }).returning('*');
        dqfDriverDocument = drvDoc;
      }
    } catch (e) {
      dtLogger.warn('dqf_driver_document_create_failed', { applicationId, error: e?.message || String(e) });
    }

    // update application with pdf metadata and status
    await trx('employment_applications').where({ id: applicationId }).update({
      status: 'submitted_completed',
      pdf_storage_key: uploadResult.objectKey || null,
      pdf_file_name: uploadResult.fileName || null,
      pdf_content_type: uploadResult.contentType || 'application/pdf',
      pdf_file_size: uploadResult.fileSize || null,
      pdf_uploaded_at: trx.fn.now(),
      r2_bucket_name: uploadResult.bucketName || null,
      updated_at: trx.fn.now()
    });

    // Link to DQF Pre-Hire Documents: mark employment_application requirement as complete
    try {
      await upsertRequirementStatus(
        app.driver_id,
        EMPLOYMENT_APP_REQUIREMENT_KEY,
        'complete',
        dqfDriverDocument?.id || null
      );

      // Log the status change for audit trail
      await logStatusChange(
        app.driver_id,
        EMPLOYMENT_APP_REQUIREMENT_KEY,
        'missing',
        'complete',
        userId || null,
        `Employment application submitted. PDF: ${uploadResult.fileName || 'generated'}`
      );

      // Recompute overall DQF completeness percentage
      await computeAndUpdateDqfCompleteness(app.driver_id);

      dtLogger.info('dqf_employment_application_marked_complete', {
        applicationId,
        driverId: app.driver_id,
        evidenceDocumentId: dqfDriverDocument?.id || null,
        fileName: uploadResult.fileName
      });
    } catch (e) {
      dtLogger.warn('dqf_update_failed', { applicationId, error: e?.message || String(e) });
    }

    // Update driver application date
    try {
      const hasApplicationDate = await trx.schema.hasColumn('drivers', 'application_date');
      const hasUpdatedAt = await trx.schema.hasColumn('drivers', 'updated_at');
      const driverPatch = {};
      if (hasApplicationDate) driverPatch.application_date = trx.fn.now();
      if (hasUpdatedAt) driverPatch.updated_at = trx.fn.now();
      if (Object.keys(driverPatch).length > 0) {
        await trx('drivers').where({ id: app.driver_id }).update(driverPatch);
      }
    } catch (e) {
      dtLogger.warn('driver_update_failed', { applicationId, error: e?.message || String(e) });
    }

    // FN-222: Sync employers from the application to driver_past_employers
    // so they appear in the employer investigations tracker.
    try {
      if (await trx.schema.hasTable('driver_past_employers')) {
        const appEmployers = await trx('employment_application_employers')
          .where({ application_id: applicationId });

        if (appEmployers.length > 0) {
          // Clear existing past employers for this driver (fresh sync on each submission)
          await trx('driver_past_employers').where({ driver_id: app.driver_id }).del();

          for (const emp of appEmployers) {
            // Parse MM/YYYY dates to ISO dates for start_date / end_date
            const parseMonthYear = (val) => {
              if (!val) return null;
              const str = String(val).trim().toLowerCase();
              if (str === 'present' || str === 'current') return null;
              const parts = str.split('/');
              if (parts.length === 2) {
                const [mm, yyyy] = parts;
                const m = parseInt(mm, 10);
                const y = parseInt(yyyy, 10);
                if (m >= 1 && m <= 12 && y >= 1900) {
                  return `${y}-${String(m).padStart(2, '0')}-01`;
                }
              }
              return null;
            };

            await trx('driver_past_employers').insert({
              driver_id: app.driver_id,
              employer_name: emp.company_name || 'Unknown',
              contact_name: emp.contact_person || null,
              contact_phone: emp.phone || null,
              contact_email: emp.employer_email || null,
              position_held: emp.position_held || null,
              start_date: parseMonthYear(emp.from_month_year),
              end_date: parseMonthYear(emp.to_month_year),
              reason_for_leaving: emp.reason_for_leaving || null,
              is_dot_regulated: emp.was_cmv || false,
              subject_to_drug_alcohol_testing: emp.safety_sensitive_dot_function || false,
              investigation_status: 'not_started'
            });
          }

          dtLogger.info('employer_sync_complete', {
            applicationId,
            driverId: app.driver_id,
            employerCount: appEmployers.length
          });
        }
      }
    } catch (e) {
      dtLogger.warn('employer_sync_failed', { applicationId, error: e?.message || String(e) });
    }

    const final = await trx('employment_applications').where({ id: applicationId }).first();
    return { application: final, document: doc, uploadResult };
  });
}

/**
 * FN-215: Validate that an employment application meets FMCSA completeness rules.
 *
 * Rules:
 *  - At least 3 years of 'detailed' employer history (or a gap explanation).
 *  - If the applicant holds or is applying for a CDL, 10 years of total history
 *    is required (3 detailed + 7 summary).
 *  - The disqualification section must be answered (has_been_disqualified is not null).
 *
 * @param {object} application - A full application object (as returned by getById).
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateCompleteness(application) {
  const errors = [];
  const employers = application.employers || [];

  // Separate employers by tier
  const detailed = employers.filter((e) => !e.tier || e.tier === 'detailed');
  const summary = employers.filter((e) => e.tier === 'summary');

  // Calculate total years covered by each tier
  const calcYears = (list) => {
    let totalMonths = 0;
    for (const emp of list) {
      if (emp.start_date && emp.end_date) {
        const start = new Date(emp.start_date);
        const end = new Date(emp.end_date);
        if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
          totalMonths += (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
        }
      }
    }
    return totalMonths / 12;
  };

  const detailedYears = calcYears(detailed);
  const summaryYears = calcYears(summary);

  // Check: at least 3 years of detailed employers
  if (detailedYears < 3 && detailed.length === 0) {
    errors.push('At least 3 years of detailed employment history is required.');
  } else if (detailedYears < 3) {
    errors.push(
      `Detailed employment history covers approximately ${detailedYears.toFixed(1)} years; at least 3 years required.`
    );
  }

  // Check: CDL applicants need 10 years total (3 detailed + 7 summary)
  const snapshot = application.applicant_snapshot || {};
  const licenses = application.licenses || [];
  const isCdl = snapshot.licenseClass
    || licenses.some((l) => l.license_class && /^[ABC]$/i.test(l.license_class));

  if (isCdl) {
    const totalYears = detailedYears + summaryYears;
    if (totalYears < 10) {
      errors.push(
        `CDL applicants require 10 years of employment history (3 detailed + 7 summary). Current total: approximately ${totalYears.toFixed(1)} years.`
      );
    }
  }

  // Check: disqualification section must be answered
  if (application.has_been_disqualified == null) {
    errors.push('Disqualification section must be answered (has_been_disqualified is required).');
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  createDraft,
  updateDraft,
  getById,
  getByDriverId,
  submitApplication,
  validateCompleteness
};
