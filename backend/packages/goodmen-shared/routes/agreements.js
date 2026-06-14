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
 *   PATCH  /api/agreements/templates/:id/fields   → edit roles/labels/defaults,
 *                                                   finalize (status=ready)
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
const { uploadBuffer, getSignedUploadUrl } = require('../storage/r2-storage');
const {
  createTemplate,
  detectAndPersistFields,
  getTemplateWithFields,
  listTemplates,
  updateTemplateFields
} = require('../services/agreement-service');

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
 * /api/agreements/templates/{id}/fields:
 *   patch:
 *     summary: Update field role assignments / labels / defaults, finalize template
 *     description: >
 *       Body `{ fields: [{ id, role, label, valueDefault }], finalize }`. Only
 *       role (internal↔signer), label and valueDefault are mutable. When
 *       `finalize` is true the template status advances to `ready`.
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
    const finalize = req.body?.finalize === true || String(req.body?.finalize) === 'true';

    const template = await updateTemplateFields({
      templateId: req.params.id,
      tenantId: tid,
      updates,
      finalize
    });
    if (!template) return res.status(404).json({ error: 'Agreement template not found' });
    return res.json(template);
  } catch (err) {
    dtLogger.error('agreements_update_fields_failed', err);
    return res.status(500).json({ error: 'Failed to update agreement template' });
  }
});

module.exports = router;
