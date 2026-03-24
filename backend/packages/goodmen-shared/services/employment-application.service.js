const db = require('../internal/db').knex;
const pdfService = require('./pdf.service');
const r2 = require('../storage/r2-storage');
const dtLogger = require('../utils/logger');

async function resolveEmploymentRequirementKeys(trx) {
  const keys = [];
  if (!(await trx.schema.hasTable('dqf_requirements'))) return keys;

  const preferred = [
    'application_for_employment',
    'employment_application_completed',
    'employment_application_signed',
    'employment_application',
    'application'
  ];

  const preferredRows = await trx('dqf_requirements')
    .select('key')
    .whereIn('key', preferred);

  preferredRows.forEach((r) => keys.push(r.key));

  if (keys.length === 0) {
    const labelRows = await trx('dqf_requirements')
      .select('key', 'label')
      .whereRaw('LOWER(label) LIKE ?', ['%application%employment%'])
      .limit(2);
    labelRows.forEach((r) => keys.push(r.key));
  }

  return [...new Set(keys)];
}

async function createDraft(driverId, payload, userId, context = null) {
  // Build the insert payload — include new FN-215 columns when provided (nullable for backward compat)
  const insertData = {
    driver_id: driverId,
    tenant_id: context?.tenantId || null,
    operating_entity_id: context?.operatingEntityId || null,
    status: 'draft',
    application_date: payload.applicationDate || null,
    created_by: userId || null,
    updated_by: userId || null,
    applicant_snapshot: payload.applicantSnapshot || null
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
    const rows = payload.residencies.map((r) => ({ ...r, application_id: row.id }));
    await db('employment_application_residencies').insert(rows);
  }
  if (payload.licenses && payload.licenses.length) {
    const rows = payload.licenses.map((r) => ({ ...r, application_id: row.id }));
    await db('employment_application_licenses').insert(rows);
  }
  if (payload.drivingExperience && payload.drivingExperience.length) {
    const rows = payload.drivingExperience.map((r) => ({ ...r, application_id: row.id }));
    await db('employment_application_driving_experience').insert(rows);
  }
  if (payload.accidents && payload.accidents.length) {
    const rows = payload.accidents.map((r) => ({ ...r, application_id: row.id }));
    await db('employment_application_accidents').insert(rows);
  }
  if (payload.convictions && payload.convictions.length) {
    const rows = payload.convictions.map((r) => ({ ...r, application_id: row.id }));
    await db('employment_application_convictions').insert(rows);
  }
  if (payload.employers && payload.employers.length) {
    // FN-215: employers now support a `tier` field ('detailed' | 'summary'); defaults to 'detailed' at DB level
    const rows = payload.employers.map((r) => ({ ...r, application_id: row.id }));
    await db('employment_application_employers').insert(rows);
  }
  if (payload.education && payload.education.length) {
    const rows = payload.education.map((r) => ({ ...r, application_id: row.id }));
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

    const patch = {
      application_date: payload.applicationDate || app.application_date,
      updated_at: trx.fn.now(),
      updated_by: userId || app.updated_by,
      applicant_snapshot: payload.applicantSnapshot || app.applicant_snapshot
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
      { key: 'drivingExperience', table: 'employment_application_driving_experience' },
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
          const rows = payload[c.key].map((r) => ({ ...r, application_id: applicationId }));
          await trx(c.table).insert(rows);
        }
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

  // FN-215: fetch disqualifications — tolerate missing table for pre-migration schemas
  let disqualifications = [];
  try {
    disqualifications = await db('employment_application_disqualifications')
      .where({ application_id: applicationId })
      .orderBy('id');
  } catch (e) {
    dtLogger.warn('disqualifications_fetch_skipped', { applicationId, error: e?.message || String(e) });
  }

  return { ...app, residencies, licenses, drivingExperience, accidents, convictions, employers, education, documents, disqualifications };
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
    if (app.status && app.status !== 'draft') throw new Error('Application already submitted or in processing');

    // persist final snapshot
    await trx('employment_applications').where({ id: applicationId }).update({
      status: 'submitted_pending_document',
      submitted_at: trx.fn.now(),
      updated_at: trx.fn.now(),
      updated_by: userId || app.updated_by
    });

    const fullApp = await getById(applicationId);

    // Generate PDF (pdfService returns Buffer)
    let pdfBuf;
    try {
      pdfBuf = await pdfService.generateEmploymentApplicationPdf(fullApp);
    } catch (e) {
      dtLogger.error('pdf_generation_failed', { applicationId, error: e?.message || String(e) });
      throw new Error('PDF generation failed');
    }

    // Upload to storage (R2)
    let uploadResult;
    try {
      const fileName = `driver-employment-application-${app.driver_id}-${Date.now()}.pdf`;
      const res = await r2.uploadBuffer({ buffer: pdfBuf, fileName, contentType: 'application/pdf' });
      uploadResult = { objectKey: res.key, bucketName: process.env.R2_BUCKET, fileName, contentType: 'application/pdf', fileSize: pdfBuf.length };
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
          file_name: uploadResult.fileName || `driver-employment-application-${app.driver_id}.pdf`,
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

    // Link to DQF checklist/status: upsert against existing dqf_driver_status model if present
    try {
      if (await trx.schema.hasTable('dqf_driver_status')) {
        const requirementKeys = await resolveEmploymentRequirementKeys(trx);
        for (const requirementKey of requirementKeys) {
          // eslint-disable-next-line no-await-in-loop
          await trx.raw(
            `
              INSERT INTO dqf_driver_status (
                driver_id,
                requirement_key,
                status,
                evidence_document_id,
                last_updated_at
              )
              VALUES (?, ?, ?, ?, NOW())
              ON CONFLICT (driver_id, requirement_key)
              DO UPDATE SET
                status = EXCLUDED.status,
                evidence_document_id = EXCLUDED.evidence_document_id,
                last_updated_at = NOW()
            `,
            [
              app.driver_id,
              requirementKey,
              'complete',
              dqfDriverDocument?.id || null
            ]
          );
        }
      }
    } catch (e) {
      dtLogger.warn('dqf_update_failed', { applicationId, error: e?.message || String(e) });
      // do not fail the transaction for DQF update; it can be retried
    }

    // Update driver application date (only if columns exist in current schema)
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
