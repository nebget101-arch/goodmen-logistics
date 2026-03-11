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
  const now = new Date();
  const [row] = await db('employment_applications').insert({
    driver_id: driverId,
    tenant_id: context?.tenantId || null,
    operating_entity_id: context?.operatingEntityId || null,
    status: 'draft',
    application_date: payload.applicationDate || null,
    created_by: userId || null,
    updated_by: userId || null,
    applicant_snapshot: payload.applicantSnapshot || null
  }).returning('*');

  // save nested rows if provided
  if (payload.residencies && payload.residencies.length) {
    const rows = payload.residencies.map(r => ({ ...r, application_id: row.id }));
    await db('employment_application_residencies').insert(rows);
  }
  if (payload.licenses && payload.licenses.length) {
    const rows = payload.licenses.map(r => ({ ...r, application_id: row.id }));
    await db('employment_application_licenses').insert(rows);
  }
  if (payload.drivingExperience && payload.drivingExperience.length) {
    const rows = payload.drivingExperience.map(r => ({ ...r, application_id: row.id }));
    await db('employment_application_driving_experience').insert(rows);
  }
  if (payload.accidents && payload.accidents.length) {
    const rows = payload.accidents.map(r => ({ ...r, application_id: row.id }));
    await db('employment_application_accidents').insert(rows);
  }
  if (payload.convictions && payload.convictions.length) {
    const rows = payload.convictions.map(r => ({ ...r, application_id: row.id }));
    await db('employment_application_convictions').insert(rows);
  }
  if (payload.employers && payload.employers.length) {
    const rows = payload.employers.map(r => ({ ...r, application_id: row.id }));
    await db('employment_application_employers').insert(rows);
  }
  if (payload.education && payload.education.length) {
    const rows = payload.education.map(r => ({ ...r, application_id: row.id }));
    await db('employment_application_education').insert(rows);
  }

  return row;
}

async function updateDraft(applicationId, payload, userId, context = null) {
  return db.transaction(async trx => {
    const app = await trx('employment_applications').where({ id: applicationId }).first();
    if (!app) throw new Error('Application not found');

    await trx('employment_applications').where({ id: applicationId }).update({
      application_date: payload.applicationDate || app.application_date,
      updated_at: trx.fn.now(),
      updated_by: userId || app.updated_by,
      applicant_snapshot: payload.applicantSnapshot || app.applicant_snapshot
    });

    // replace child collections atomically
    const collections = [
      { key: 'residencies', table: 'employment_application_residencies' },
      { key: 'licenses', table: 'employment_application_licenses' },
      { key: 'drivingExperience', table: 'employment_application_driving_experience' },
      { key: 'accidents', table: 'employment_application_accidents' },
      { key: 'convictions', table: 'employment_application_convictions' },
      { key: 'employers', table: 'employment_application_employers' },
      { key: 'education', table: 'employment_application_education' }
    ];

    for (const c of collections) {
      if (Array.isArray(payload[c.key])) {
        await trx(c.table).where({ application_id: applicationId }).del();
        if (payload[c.key].length) {
          const rows = payload[c.key].map(r => ({ ...r, application_id: applicationId }));
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

  return { ...app, residencies, licenses, drivingExperience, accidents, convictions, employers, education, documents };
}

async function getByDriverId(driverId, context = null) {
  const rows = await db('employment_applications').where({ driver_id: driverId }).orderBy('created_at', 'desc').limit(10);
  return rows;
}

async function submitApplication(applicationId, payload, userId, context = null) {
  // Orchestration: validate, persist, set status, generate PDF, upload to R2, update records & DQF
  return db.transaction(async trx => {
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
      const patch = {};
      if (hasApplicationDate) patch.application_date = trx.fn.now();
      if (hasUpdatedAt) patch.updated_at = trx.fn.now();
      if (Object.keys(patch).length > 0) {
        await trx('drivers').where({ id: app.driver_id }).update(patch);
      }
    } catch (e) {
      dtLogger.warn('driver_update_failed', { applicationId, error: e?.message || String(e) });
    }

    const final = await trx('employment_applications').where({ id: applicationId }).first();
    return { application: final, document: doc, uploadResult };
  });
}

module.exports = {
  createDraft,
  updateDraft,
  getById,
  getByDriverId,
  submitApplication
};
