'use strict';

/**
 * FN-1800 (story FN-1789): Equipment / Motor-Carrier Lease Agreement adapter.
 *
 * Thin linkage endpoints that tie a generic e-signature request to the
 * equipment subject (a fleet vehicle or an equipment-owner / lessor payee) it
 * was sent for. All signing logic is delegated to the generic engine via
 * equipment-lease-signing-service → signature-service (FN-1797); these routes
 * add no signing logic of their own.
 *
 *   POST /api/agreements/equipment-lease/requests
 *     → start a lease signing for a subject (document_type = lease_agreement),
 *       reusing the engine's createSignatureRequest, then record the linkage.
 *   GET  /api/agreements/equipment-lease/requests?subjectType=&subjectId=
 *     → list the subject's lease signings with live status + signed-PDF URL.
 *
 * Mounted in logistics-service ahead of the generic /api/agreements router
 * (which owns POST /:templateId/requests) so the more specific equipment-lease
 * path matches first. Behind authMiddleware + tenantContextMiddleware, so
 * req.context.tenantId is populated.
 */

const express = require('express');
const router = express.Router();

const dtLogger = require('../utils/logger');
const {
  createEquipmentLeaseSigning,
  listEquipmentLeaseSignings
} = require('../services/equipment-lease-signing-service');

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

/**
 * @openapi
 * /api/agreements/equipment-lease/requests:
 *   post:
 *     summary: Start an Equipment/Motor-Carrier Lease Agreement signing for a subject
 *     description: >
 *       Delegates to the generic agreement engine to create + send a signature
 *       request from a finalized `lease_agreement` template, then links it to the
 *       equipment subject (a fleet vehicle or an equipment-owner / lessor payee).
 *       Body `{ subjectType: 'vehicle'|'equipment_owner', subjectId, templateId,
 *       fieldValues?, signer: { name, email, phone, role }, expiresInDays? }`.
 *     tags: [Agreements]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: "{ requestId, signerLink, status, link }" }
 *       400: { description: Invalid subject / template / signer }
 *       401: { description: Tenant context required }
 *       404: { description: Template not found }
 */
router.post('/requests', async (req, res) => {
  const tid = requireTenant(req, res);
  if (!tid) return undefined;

  try {
    const result = await createEquipmentLeaseSigning({
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      subjectType: req.body?.subjectType,
      subjectId: req.body?.subjectId,
      templateId: req.body?.templateId,
      fieldValues: req.body?.fieldValues || {},
      signer: req.body?.signer || {},
      expiresInDays: req.body?.expiresInDays,
      baseUrl: process.env.PUBLIC_APP_URL || undefined,
      createdBy: req.user?.id || null
    });
    return res.status(201).json(result);
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    if (err.code === 'TEMPLATE_NOT_FOUND') {
      return res.status(404).json({ error: 'Agreement template not found' });
    }
    dtLogger.error('equipment_lease_create_signing_failed', err);
    return res.status(500).json({ error: 'Failed to start equipment lease signing' });
  }
});

/**
 * @openapi
 * /api/agreements/equipment-lease/requests:
 *   get:
 *     summary: List lease signings for a vehicle / equipment-owner subject
 *     description: >
 *       Returns the subject's lease signings (newest first), each with the live
 *       request status (sent / viewed / signed) and a signed-PDF download URL
 *       once signed.
 *     tags: [Agreements]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: subjectType
 *         required: true
 *         schema: { type: string, enum: [vehicle, equipment_owner] }
 *       - in: query
 *         name: subjectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Array of lease signings with status + signedPdfUrl }
 *       400: { description: Missing subjectType / subjectId }
 *       401: { description: Tenant context required }
 */
router.get('/requests', async (req, res) => {
  const tid = requireTenant(req, res);
  if (!tid) return undefined;

  try {
    const signings = await listEquipmentLeaseSignings({
      tenantId: tid,
      subjectType: req.query?.subjectType,
      subjectId: req.query?.subjectId
    });
    return res.json({ data: signings });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    dtLogger.error('equipment_lease_list_signings_failed', err);
    return res.status(500).json({ error: 'Failed to load equipment lease signings' });
  }
});

module.exports = router;
