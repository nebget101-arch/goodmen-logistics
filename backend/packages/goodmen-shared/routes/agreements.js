'use strict';

/**
 * FN-1793 (story FN-1787): Agreement template routes.
 *
 * Tenant-scoped, auth-gated CRUD for AI-assisted agreement templates:
 *   POST   /api/agreements/templates/upload-url   → signed R2 upload URL
 *   POST   /api/agreements/templates              → create template (direct
 *                                                   multipart upload OR a
 *                                                   reference to an already
 *                                                   signed-uploaded object),
 *                                                   then run AI field detection
 *   GET    /api/agreements/templates              → list tenant templates
 *   GET    /api/agreements/templates/:id          → template + ordered field map
 *   PATCH  /api/agreements/templates/:id/fields   → edit roles/labels +
 *                                                   geometry (page/bbox), add
 *                                                   user-drawn boxes, delete
 *                                                   fields, finalize (ready)
 *
 * Mounted in logistics-service behind authMiddleware + tenantContextMiddleware,
 * so req.context.tenantId is populated. Source bytes live in R2; the field map
 * lives in Postgres (FN-1792 schema).
 */

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const router = express.Router();

const dtLogger = require('../utils/logger');
const { uploadBuffer, getSignedUploadUrl, getObjectStream } = require('../storage/r2-storage');
const {
  createTemplate,
  detectAndPersistFields,
  getTemplateWithFields,
  getTemplateSource,
  listTemplates,
  updateTemplateFields
} = require('../services/agreement-service');
const {
  createSignatureRequest,
  getRequestById
} = require('../services/signature-service');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function tenantId(req) {
  return req.context?.tenantId || req.user?.tenantId || req.user?.tenant_id || null;
}

function operatingEntityId(req) {
  return req.context?.operatingEntityId || null;
}

function requireTenant(req, res) {
  const tid = tenantId(req);
  if (!tid) {
    res.status(401).json({ error: 'Tenant context required' });
    return null;
  }
  return tid;
}

function sanitizeFileName(name) {
  return String(name || 'agreement.pdf').trim().replace(/[^a-zA-Z0-9_.-]/g, '_') || 'agreement.pdf';
}

function buildStorageKey(tid, fileName) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = crypto.randomBytes(6).toString('hex');
  return `agreements/${tid}/${stamp}-${suffix}-${sanitizeFileName(fileName)}`;
}

/**
 * @openapi
 * /api/agreements/templates/upload-url:
 *   post:
 *     summary: Get a signed R2 upload URL for an agreement source document
 *     tags: [Agreements]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fileName: { type: string }
 *               contentType: { type: string }
 *     responses:
 *       200: { description: Signed upload URL + object key }
 *       401: { description: Tenant context required }
 */
router.post('/templates/upload-url', async (req, res) => {
  const tid = requireTenant(req, res);
  if (!tid) return undefined;

  try {
    const fileName = sanitizeFileName(req.body?.fileName);
    const contentType = req.body?.contentType || 'application/pdf';
    const key = buildStorageKey(tid, fileName);
    const signed = await getSignedUploadUrl({ key, contentType });
    return res.json({ ...signed, fileName, contentType });
  } catch (err) {
    dtLogger.error('agreements_upload_url_failed', err);
    return res.status(500).json({ error: 'Failed to create upload URL' });
  }
});

/**
 * @openapi
 * /api/agreements/templates:
 *   post:
 *     summary: Create an agreement template and run AI field detection
 *     description: >
 *       Accepts either a direct multipart file upload (field `file`) or a JSON
 *       body referencing an object previously uploaded via the signed URL
 *       (`storageKey`). Persists the template, invokes the AI detect-fields
 *       handler, and stores the validated field map.
 *     tags: [Agreements]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Created template with detected field map }
 *       400: { description: Missing file or storageKey }
 *       401: { description: Tenant context required }
 */
router.post('/templates', upload.single('file'), async (req, res) => {
  const tid = requireTenant(req, res);
  if (!tid) return undefined;

  try {
    const name = req.body?.name;
    let storageKey;
    let fileName;
    let contentType;

    if (req.file) {
      // Direct upload path — push bytes to R2 now.
      fileName = sanitizeFileName(req.file.originalname);
      contentType = req.file.mimetype || 'application/pdf';
      const stored = await uploadBuffer({
        buffer: req.file.buffer,
        contentType,
        prefix: `agreements/${tid}`,
        fileName
      });
      storageKey = stored.key;
    } else if (req.body?.storageKey) {
      // Signed-upload path — the object already exists in R2.
      storageKey = String(req.body.storageKey);
      fileName = sanitizeFileName(req.body.fileName || storageKey.split('/').pop());
      contentType = req.body.contentType || 'application/pdf';
    } else {
      return res.status(400).json({ error: 'A file upload or storageKey is required' });
    }

    const template = await createTemplate({
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      name,
      storageKey,
      fileName,
      createdBy: req.user?.id || null
    });

    // Run detection synchronously so the FE receives the field map to review.
    await detectAndPersistFields({ template });

    const full = await getTemplateWithFields({ templateId: template.id, tenantId: tid });
    return res.status(201).json(full);
  } catch (err) {
    dtLogger.error('agreements_create_template_failed', err);
    return res.status(500).json({ error: 'Failed to create agreement template' });
  }
});

/**
 * @openapi
 * /api/agreements/templates:
 *   get:
 *     summary: List agreement templates for the tenant
 *     tags: [Agreements]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Array of templates (no field maps) }
 */
router.get('/templates', async (req, res) => {
  const tid = requireTenant(req, res);
  if (!tid) return undefined;

  try {
    const templates = await listTemplates({ tenantId: tid });
    return res.json(templates);
  } catch (err) {
    dtLogger.error('agreements_list_templates_failed', err);
    return res.status(500).json({ error: 'Failed to list agreement templates' });
  }
});

/**
 * @openapi
 * /api/agreements/templates/{id}:
 *   get:
 *     summary: Get a template with its ordered field map + signed source URL
 *     tags: [Agreements]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Template + fields + sourceDownloadUrl }
 *       404: { description: Not found }
 */
router.get('/templates/:id', async (req, res) => {
  const tid = requireTenant(req, res);
  if (!tid) return undefined;

  try {
    const template = await getTemplateWithFields({ templateId: req.params.id, tenantId: tid });
    if (!template) return res.status(404).json({ error: 'Agreement template not found' });
    return res.json(template);
  } catch (err) {
    dtLogger.error('agreements_get_template_failed', err);
    return res.status(500).json({ error: 'Failed to load agreement template' });
  }
});

/**
 * @openapi
 * /api/agreements/templates/{id}/source:
 *   get:
 *     summary: Stream the template's source document through the auth-gated API
 *     description: >
 *       Proxies the source PDF/image bytes from R2 same-origin so the field
 *       placement editor (FN-1807) can render it with pdf.js without hitting the
 *       R2 presigned URL directly — that cross-origin fetch was blocked by the
 *       bucket's missing CORS policy (FN-1839). Tenant-scoped: a tenant can only
 *       fetch the source of its own template.
 *     tags: [Agreements]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: The source document bytes (application/pdf by default) }
 *       401: { description: Tenant context required }
 *       404: { description: Template or source not found }
 */
router.get('/templates/:id/source', async (req, res) => {
  const tid = requireTenant(req, res);
  if (!tid) return undefined;

  try {
    const source = await getTemplateSource({ templateId: req.params.id, tenantId: tid });
    if (!source || !source.storageKey) {
      return res.status(404).json({ error: 'Agreement source document not found' });
    }

    const object = await getObjectStream(source.storageKey);
    res.setHeader('Content-Type', object.contentType || 'application/pdf');
    if (object.contentLength != null) {
      res.setHeader('Content-Length', String(object.contentLength));
    }
    res.setHeader('Content-Disposition', 'inline');
    // Source bytes are tenant-private; don't let shared caches retain them.
    res.setHeader('Cache-Control', 'private, no-store');

    object.body.on('error', (streamErr) => {
      dtLogger.error('agreements_stream_source_failed', streamErr);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Failed to stream agreement source' });
      } else {
        res.destroy(streamErr);
      }
    });

    return object.body.pipe(res);
  } catch (err) {
    dtLogger.error('agreements_get_source_failed', err);
    return res.status(500).json({ error: 'Failed to load agreement source' });
  }
});

/**
 * @openapi
 * /api/agreements/templates/{id}/fields:
 *   patch:
 *     summary: Edit field roles/labels + geometry, add/delete field boxes, finalize
 *     description: >
 *       Body `{ fields, adds, deletes, finalize }`.
 *       `fields`: `[{ id, role?, label?, page?, bbox? }]` edits to existing
 *       fields — role (internal↔signer), label, and the placement geometry
 *       `page` + `bbox` (FN-1808 visual editor). `adds`:
 *       `[{ fieldType, page, bbox, label?, role?, fieldKey? }]` user-drawn
 *       boxes (persisted with `confidence: null`). `deletes`: `[fieldId]` (or
 *       `[{ id }]`) fields to remove. `bbox` is `[x, y, w, h]` in top-left PDF
 *       points (see docs/design/agreements-bbox-coordinates.md); page/bbox are
 *       validated against the template's `page_count`. When `finalize` is true
 *       the template status advances to `ready`.
 *     tags: [Agreements]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Updated template + field map }
 *       404: { description: Not found }
 */
router.patch('/templates/:id/fields', async (req, res) => {
  const tid = requireTenant(req, res);
  if (!tid) return undefined;

  try {
    const updates = Array.isArray(req.body?.fields) ? req.body.fields : [];
    const adds = Array.isArray(req.body?.adds) ? req.body.adds : [];
    const deletes = Array.isArray(req.body?.deletes) ? req.body.deletes : [];
    const finalize = req.body?.finalize === true || String(req.body?.finalize) === 'true';

    const template = await updateTemplateFields({
      templateId: req.params.id,
      tenantId: tid,
      updates,
      adds,
      deletes,
      finalize
    });
    if (!template) return res.status(404).json({ error: 'Agreement template not found' });
    return res.json(template);
  } catch (err) {
    dtLogger.error('agreements_update_fields_failed', err);
    return res.status(500).json({ error: 'Failed to update agreement template' });
  }
});

/**
 * @openapi
 * /api/agreements/{templateId}/requests:
 *   post:
 *     summary: Create + send a signature request for a finalized template
 *     description: >
 *       Fills the `internal`-assigned fields, mints a secure tokenized signing
 *       link, sends it to the signer via SMS/email, and moves the request to
 *       `sent`. Body `{ fieldValues: { fieldKey: value }, signer: { name,
 *       email, phone, role }, expiresInDays? }`.
 *     tags: [Agreements]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: templateId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       201: { description: "{ requestId, signerLink, status, send }" }
 *       400: { description: Missing signer contact }
 *       401: { description: Tenant context required }
 *       404: { description: Template not found }
 */
router.post('/:templateId/requests', async (req, res) => {
  const tid = requireTenant(req, res);
  if (!tid) return undefined;

  const signer = req.body?.signer || {};
  if (!signer.email && !signer.phone) {
    return res.status(400).json({ error: 'A signer email or phone is required to send the link' });
  }

  try {
    const result = await createSignatureRequest({
      templateId: req.params.templateId,
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      fieldValues: req.body?.fieldValues || {},
      signer,
      expiresInDays: req.body?.expiresInDays,
      baseUrl: process.env.PUBLIC_APP_URL || undefined,
      createdBy: req.user?.id || null
    });
    return res.status(201).json(result);
  } catch (err) {
    if (err.code === 'TEMPLATE_NOT_FOUND') {
      return res.status(404).json({ error: 'Agreement template not found' });
    }
    dtLogger.error('agreements_create_request_failed', err);
    return res.status(500).json({ error: 'Failed to create signature request' });
  }
});

/**
 * @openapi
 * /api/agreements/requests/{id}:
 *   get:
 *     summary: Get a signature request's status + signed-PDF download URL
 *     tags: [Agreements]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Request status, fields, and signedPdfUrl when signed }
 *       404: { description: Not found }
 */
router.get('/requests/:id', async (req, res) => {
  const tid = requireTenant(req, res);
  if (!tid) return undefined;

  try {
    const request = await getRequestById({ id: req.params.id, tenantId: tid });
    if (!request) return res.status(404).json({ error: 'Signature request not found' });
    return res.json(request);
  } catch (err) {
    dtLogger.error('agreements_get_request_failed', err);
    return res.status(500).json({ error: 'Failed to load signature request' });
  }
});

module.exports = router;
