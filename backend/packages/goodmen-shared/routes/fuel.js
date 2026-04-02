'use strict';

/**
 * Fuel Import Module – Express router.
 * Mounted at /api/fuel in the logistics service.
 *
 * Endpoints:
 *   GET    /api/fuel/providers/templates
 *   GET    /api/fuel/cards
 *   POST   /api/fuel/cards
 *   PATCH  /api/fuel/cards/:id
 *   GET    /api/fuel/mapping-profiles
 *   POST   /api/fuel/mapping-profiles
 *   DELETE /api/fuel/mapping-profiles/:id
 *   POST   /api/fuel/import/preview
 *   POST   /api/fuel/import/ai-preprocess
 *   POST   /api/fuel/import/stage
 *   POST   /api/fuel/import/commit/:batchId
 *   GET    /api/fuel/import/batches
 *   GET    /api/fuel/import/batches/:id
 *   GET    /api/fuel/transactions
 *   GET    /api/fuel/transactions/:id
 *   PATCH  /api/fuel/transactions/:id
 *   DELETE /api/fuel/transactions/:id
 *   GET    /api/fuel/exceptions
 *   PATCH  /api/fuel/exceptions/:id/resolve
 *   POST   /api/fuel/exceptions/bulk-resolve
 *   POST   /api/fuel/reprocess-unmatched
 *   GET    /api/fuel/overview
 *   GET    /api/fuel/cards/:cardId/assignments
 *   POST   /api/fuel/cards/:cardId/assign-driver
 *   POST   /api/fuel/cards/:cardId/revoke-driver
 *   GET    /api/fuel/driver-assignments
 *   GET    /api/fuel/accounts/:accountId/cards
 *   POST   /api/fuel/accounts/:accountId/cards
 *   PATCH  /api/fuel/accounts/cards/:cardId
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const knex = require('../config/knex');
const dtLogger = require('../utils/logger');
const { uploadBuffer } = require('../storage/r2-storage');
const { getProviderTemplates, buildAutoMapping, parseFileBuffer } = require('../services/fuel-parser');
const {
  previewImport,
  stageBatch,
  commitBatch,
  resolveException,
  bulkResolveExceptions,
  reprocessUnmatched
} = require('../services/fuel-service');

// ─── File upload (memory storage – max 10 MB) ─────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['text/csv', 'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream', 'text/plain'];
    const ext = (file.originalname || '').split('.').pop().toLowerCase();
    if (allowed.includes(file.mimetype) || ['csv', 'xlsx', 'xls', 'txt'].includes(ext)) {
      return cb(null, true);
    }
    cb(new Error('Only CSV and XLSX files are accepted'));
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tenantId(req) {
  return req.context?.tenantId || req.user?.tenantId || null;
}

function operatingEntityId(req) {
  return req.context?.operatingEntityId || null;
}

function applyOperatingEntityFilter(query, req, column = 'operating_entity_id') {
  const oeId = operatingEntityId(req);
  if (oeId) query.where(column, oeId);
  return query;
}

function userId(req) {
  return req.user?.id || null;
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function requireTenant(req, res) {
  const tid = tenantId(req);
  if (!tid) { sendError(res, 401, 'Tenant context required'); return null; }
  return tid;
}

// ─── Provider templates ───────────────────────────────────────────────────────
/**
 * @openapi
 * /api/fuel/providers/templates:
 *   get:
 *     summary: List fuel provider templates
 *     description: Returns all available fuel provider templates with their column mappings and metadata.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of provider template objects
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 */
router.get('/providers/templates', (_req, res) => {
  res.json(getProviderTemplates());
});

// ─── Fuel Card Accounts ───────────────────────────────────────────────────────
/**
 * @openapi
 * /api/fuel/cards:
 *   get:
 *     summary: List fuel card accounts
 *     description: Returns all fuel card accounts for the tenant, including a card_count for each account.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of fuel card account objects with card_count
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Failed to fetch fuel card accounts
 */
router.get('/cards', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;

    const cardCountSub = knex('fuel_cards')
      .where('fuel_cards.fuel_card_account_id', knex.raw('fuel_card_accounts.id'))
      .count('* as cnt')
      .as('card_count');

    const rows = await applyOperatingEntityFilter(
      knex('fuel_card_accounts')
        .where({ 'fuel_card_accounts.tenant_id': tid })
        .select('fuel_card_accounts.*', cardCountSub),
      req,
      'fuel_card_accounts.operating_entity_id'
    )
      .orderBy('fuel_card_accounts.created_at', 'desc');

    // Coerce card_count from string to integer
    for (const row of rows) {
      row.card_count = parseInt(row.card_count, 10) || 0;
    }

    res.json(rows);
  } catch (err) {
    dtLogger.error('fuel_cards_list_error', err);
    sendError(res, 500, 'Failed to fetch fuel card accounts');
  }
});

/**
 * @openapi
 * /api/fuel/cards:
 *   post:
 *     summary: Create a fuel card account
 *     description: Creates a new fuel card account for the tenant.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - provider_name
 *               - display_name
 *             properties:
 *               provider_name:
 *                 type: string
 *               display_name:
 *                 type: string
 *               account_number_masked:
 *                 type: string
 *               import_method:
 *                 type: string
 *                 default: manual_upload
 *               default_matching_rules:
 *                 type: object
 *               status:
 *                 type: string
 *                 default: active
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Created fuel card account
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: provider_name and display_name are required
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Failed to create fuel card account
 */
router.post('/cards', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const { provider_name, display_name, account_number_masked, import_method, default_matching_rules, status, notes } = req.body;
    if (!provider_name || !display_name) return sendError(res, 400, 'provider_name and display_name are required');

    const [row] = await knex('fuel_card_accounts').insert({
      tenant_id: tid,
      operating_entity_id: operatingEntityId(req),
      provider_name,
      display_name,
      account_number_masked: account_number_masked || null,
      import_method: import_method || 'manual_upload',
      default_matching_rules: default_matching_rules ? JSON.stringify(default_matching_rules) : null,
      status: status || 'active',
      notes: notes || null,
      created_by: userId(req)
    }).returning('*');

    res.status(201).json(row);
  } catch (err) {
    dtLogger.error('fuel_card_create_error', err);
    sendError(res, 500, 'Failed to create fuel card account');
  }
});

/**
 * @openapi
 * /api/fuel/cards/{id}:
 *   patch:
 *     summary: Update a fuel card account
 *     description: Partially updates a fuel card account. Only the provided fields are changed.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Fuel card account ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               display_name:
 *                 type: string
 *               account_number_masked:
 *                 type: string
 *               import_method:
 *                 type: string
 *               default_matching_rules:
 *                 type: object
 *               status:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated fuel card account
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Fuel card account not found
 *       500:
 *         description: Failed to update fuel card account
 */
router.patch('/cards/:id', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const allowed = ['display_name', 'account_number_masked', 'import_method', 'default_matching_rules', 'status', 'notes'];
    const patch = {};
    for (const f of allowed) {
      if (req.body[f] !== undefined) patch[f] = req.body[f];
    }
    patch.updated_at = new Date();

    const [row] = await knex('fuel_card_accounts')
      .modify((qb) => {
        qb.where({ id: req.params.id, tenant_id: tid });
        applyOperatingEntityFilter(qb, req);
      })
      .update(patch)
      .returning('*');
    if (!row) return sendError(res, 404, 'Fuel card account not found');
    res.json(row);
  } catch (err) {
    dtLogger.error('fuel_card_patch_error', err);
    sendError(res, 500, 'Failed to update fuel card account');
  }
});

// ─── Fuel Card ↔ Driver Assignments ──────────────────────────────────────────

/**
 * @openapi
 * /api/fuel/cards/{cardId}/assignments:
 *   get:
 *     summary: List fuel card assignments
 *     description: Returns all driver assignments (active and revoked) for a specific fuel card account.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cardId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Fuel card account ID
 *     responses:
 *       200:
 *         description: Array of assignment objects with driver_name
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Failed to fetch card assignments
 */
router.get('/cards/:cardId/assignments', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const { cardId } = req.params;

    const rows = await knex('fuel_card_driver_assignments as a')
      .leftJoin('drivers as d', 'd.id', 'a.driver_id')
      .where({ 'a.tenant_id': tid, 'a.fuel_card_account_id': cardId })
      .select(
        'a.*',
        knex.raw("COALESCE(d.first_name || ' ' || d.last_name, NULL) AS driver_name")
      )
      .orderBy('a.assigned_date', 'desc');

    res.json(rows);
  } catch (err) {
    dtLogger.error('fuel_card_assignments_list_error', err);
    sendError(res, 500, 'Failed to fetch card assignments');
  }
});

/**
 * @openapi
 * /api/fuel/cards/{cardId}/assign-driver:
 *   post:
 *     summary: Assign a driver to a fuel card
 *     description: Assigns a driver to a fuel card account. Automatically revokes any existing active assignment on the card before creating the new one.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cardId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Fuel card account ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - driverId
 *             properties:
 *               driverId:
 *                 type: string
 *                 format: uuid
 *               cardNumberLast4:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Created driver assignment
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: driverId is required
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Fuel card account or driver not found
 *       500:
 *         description: Failed to assign driver to card
 */
router.post('/cards/:cardId/assign-driver', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const { cardId } = req.params;
    const { driverId, cardNumberLast4, notes } = req.body;

    if (!driverId) return sendError(res, 400, 'driverId is required');

    // Verify the card exists and belongs to this tenant
    const card = await knex('fuel_card_accounts')
      .where({ id: cardId, tenant_id: tid })
      .first('id');
    if (!card) return sendError(res, 404, 'Fuel card account not found');

    // Verify the driver exists and belongs to this tenant
    const driver = await knex('drivers')
      .where({ id: driverId, tenant_id: tid })
      .first('id');
    if (!driver) return sendError(res, 404, 'Driver not found');

    const uid = userId(req);

    // Auto-revoke any existing active assignment for this card
    await knex('fuel_card_driver_assignments')
      .where({ fuel_card_account_id: cardId, tenant_id: tid, status: 'active' })
      .update({
        status: 'revoked',
        revoked_date: new Date(),
        revoked_by: uid,
        updated_at: new Date()
      });

    // Create new active assignment
    const [row] = await knex('fuel_card_driver_assignments').insert({
      tenant_id: tid,
      fuel_card_account_id: cardId,
      driver_id: driverId,
      card_number_last4: cardNumberLast4 || null,
      status: 'active',
      assigned_date: new Date(),
      assigned_by: uid,
      notes: notes || null
    }).returning('*');

    res.status(201).json(row);
  } catch (err) {
    dtLogger.error('fuel_card_assign_driver_error', err);
    sendError(res, 500, 'Failed to assign driver to card');
  }
});

/**
 * @openapi
 * /api/fuel/cards/{cardId}/revoke-driver:
 *   post:
 *     summary: Revoke active driver assignment
 *     description: Revokes the currently active driver assignment for a fuel card account.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cardId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Fuel card account ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Revoked assignment record
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: No active assignment found for this card
 *       500:
 *         description: Failed to revoke card assignment
 */
router.post('/cards/:cardId/revoke-driver', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const { cardId } = req.params;
    const { notes } = req.body;

    const active = await knex('fuel_card_driver_assignments')
      .where({ fuel_card_account_id: cardId, tenant_id: tid, status: 'active' })
      .first();

    if (!active) return sendError(res, 404, 'No active assignment found for this card');

    const [row] = await knex('fuel_card_driver_assignments')
      .where({ id: active.id })
      .update({
        status: 'revoked',
        revoked_date: new Date(),
        revoked_by: userId(req),
        notes: notes || active.notes,
        updated_at: new Date()
      })
      .returning('*');

    res.json(row);
  } catch (err) {
    dtLogger.error('fuel_card_revoke_driver_error', err);
    sendError(res, 500, 'Failed to revoke card assignment');
  }
});

/**
 * @openapi
 * /api/fuel/driver-assignments:
 *   get:
 *     summary: List card assignments for a driver
 *     description: Returns all fuel card assignments for a specific driver, including card account details.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: driver_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Driver ID to look up assignments for
 *     responses:
 *       200:
 *         description: Array of assignment objects with card account details
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       400:
 *         description: driver_id query param is required
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Failed to fetch driver assignments
 */
router.get('/driver-assignments', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const { driver_id } = req.query;

    if (!driver_id) return sendError(res, 400, 'driver_id query param is required');

    const rows = await knex('fuel_card_driver_assignments as a')
      .leftJoin('fuel_card_accounts as c', 'c.id', 'a.fuel_card_account_id')
      .where({ 'a.tenant_id': tid, 'a.driver_id': driver_id })
      .select(
        'a.*',
        'c.display_name as card_display_name',
        'c.provider_name as card_provider_name',
        'c.account_number_masked as card_account_number_masked'
      )
      .orderBy('a.assigned_date', 'desc');

    res.json(rows);
  } catch (err) {
    dtLogger.error('fuel_driver_assignments_list_error', err);
    sendError(res, 500, 'Failed to fetch driver assignments');
  }
});

// ─── Fuel Cards (under Account) ──────────────────────────────────────────────

/**
 * @openapi
 * /api/fuel/accounts/{accountId}/cards:
 *   get:
 *     summary: List cards for an account
 *     description: Returns all individual fuel cards belonging to a specific fuel card account.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: accountId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Fuel card account ID
 *     responses:
 *       200:
 *         description: Array of fuel card objects
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Fuel card account not found
 *       500:
 *         description: Failed to fetch cards for account
 */
router.get('/accounts/:accountId/cards', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const { accountId } = req.params;

    // Verify account belongs to tenant
    const account = await knex('fuel_card_accounts')
      .where({ id: accountId, tenant_id: tid })
      .first('id');
    if (!account) return sendError(res, 404, 'Fuel card account not found');

    const rows = await knex('fuel_cards')
      .where({ fuel_card_account_id: accountId, tenant_id: tid })
      .orderBy('created_at', 'desc');

    res.json(rows);
  } catch (err) {
    dtLogger.error('fuel_account_cards_list_error', err);
    sendError(res, 500, 'Failed to fetch cards for account');
  }
});

/**
 * @openapi
 * /api/fuel/accounts/{accountId}/cards:
 *   post:
 *     summary: Create a card under an account
 *     description: Creates a new individual fuel card under a fuel card account.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: accountId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Fuel card account ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - card_number_masked
 *             properties:
 *               card_number_masked:
 *                 type: string
 *               card_number_last4:
 *                 type: string
 *               status:
 *                 type: string
 *                 default: active
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Created fuel card
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: card_number_masked is required
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Fuel card account not found
 *       409:
 *         description: A card with this number already exists for this tenant
 *       500:
 *         description: Failed to create fuel card
 */
router.post('/accounts/:accountId/cards', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const { accountId } = req.params;
    const { card_number_masked, card_number_last4, status, notes } = req.body;

    if (!card_number_masked) return sendError(res, 400, 'card_number_masked is required');

    // Verify account belongs to tenant
    const account = await knex('fuel_card_accounts')
      .where({ id: accountId, tenant_id: tid })
      .first('id');
    if (!account) return sendError(res, 404, 'Fuel card account not found');

    const [row] = await knex('fuel_cards').insert({
      tenant_id: tid,
      fuel_card_account_id: accountId,
      card_number_masked,
      card_number_last4: card_number_last4 || null,
      status: status || 'active',
      notes: notes || null,
    }).returning('*');

    res.status(201).json(row);
  } catch (err) {
    // Handle unique constraint violation (duplicate card number per tenant)
    if (err.code === '23505' && err.constraint === 'uq_fc_tenant_card_number') {
      return sendError(res, 409, 'A card with this number already exists for this tenant');
    }
    dtLogger.error('fuel_account_card_create_error', err);
    sendError(res, 500, 'Failed to create fuel card');
  }
});

/**
 * @openapi
 * /api/fuel/accounts/cards/{cardId}:
 *   patch:
 *     summary: Update a fuel card
 *     description: Partially updates an individual fuel card's fields (status, notes, card_number_last4).
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cardId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Fuel card ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               card_number_last4:
 *                 type: string
 *               status:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated fuel card
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: No valid fields to update
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Fuel card not found
 *       500:
 *         description: Failed to update fuel card
 */
router.patch('/accounts/cards/:cardId', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const allowed = ['card_number_last4', 'status', 'notes'];
    const patch = {};
    for (const f of allowed) {
      if (req.body[f] !== undefined) patch[f] = req.body[f];
    }
    if (Object.keys(patch).length === 0) return sendError(res, 400, 'No valid fields to update');
    patch.updated_at = new Date();

    const [row] = await knex('fuel_cards')
      .where({ id: req.params.cardId, tenant_id: tid })
      .update(patch)
      .returning('*');
    if (!row) return sendError(res, 404, 'Fuel card not found');
    res.json(row);
  } catch (err) {
    dtLogger.error('fuel_card_patch_error', err);
    sendError(res, 500, 'Failed to update fuel card');
  }
});

// ─── Mapping Profiles ─────────────────────────────────────────────────────────
/**
 * @openapi
 * /api/fuel/mapping-profiles:
 *   get:
 *     summary: List mapping profiles
 *     description: Returns all fuel import mapping profiles for the tenant.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of mapping profile objects
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Failed to fetch mapping profiles
 */
router.get('/mapping-profiles', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const rows = await knex('fuel_import_mapping_profiles')
      .where({ tenant_id: tid })
      .orderBy('created_at', 'desc');
    res.json(rows);
  } catch (err) {
    dtLogger.error('fuel_mapping_list_error', err);
    sendError(res, 500, 'Failed to fetch mapping profiles');
  }
});

/**
 * @openapi
 * /api/fuel/mapping-profiles:
 *   post:
 *     summary: Create a mapping profile
 *     description: Creates a new fuel import mapping profile. If is_default is true, any previous default for the same provider is unset.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - profile_name
 *               - column_map
 *             properties:
 *               profile_name:
 *                 type: string
 *               provider_name:
 *                 type: string
 *               column_map:
 *                 type: object
 *                 description: Column name to field mapping
 *               is_default:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Created mapping profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: profile_name and column_map are required
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Failed to create mapping profile
 */
router.post('/mapping-profiles', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const { profile_name, provider_name, column_map, is_default } = req.body;
    if (!profile_name || !column_map) return sendError(res, 400, 'profile_name and column_map are required');

    if (is_default) {
      // Un-set previous defaults for this provider
      await knex('fuel_import_mapping_profiles')
        .where({ tenant_id: tid, provider_name: provider_name || null, is_default: true })
        .update({ is_default: false });
    }

    const [row] = await knex('fuel_import_mapping_profiles').insert({
      tenant_id: tid,
      profile_name,
      provider_name: provider_name || null,
      column_map: JSON.stringify(column_map),
      is_default: !!is_default,
      created_by: userId(req)
    }).returning('*');

    res.status(201).json(row);
  } catch (err) {
    dtLogger.error('fuel_mapping_create_error', err);
    sendError(res, 500, 'Failed to create mapping profile');
  }
});

/**
 * @openapi
 * /api/fuel/mapping-profiles/{id}:
 *   delete:
 *     summary: Delete a mapping profile
 *     description: Deletes a fuel import mapping profile by ID.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Mapping profile ID
 *     responses:
 *       200:
 *         description: Deletion confirmation
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deleted:
 *                   type: boolean
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Mapping profile not found
 *       500:
 *         description: Failed to delete mapping profile
 */
router.delete('/mapping-profiles/:id', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const deleted = await knex('fuel_import_mapping_profiles')
      .where({ id: req.params.id, tenant_id: tid })
      .del();
    if (!deleted) return sendError(res, 404, 'Mapping profile not found');
    res.json({ deleted: true });
  } catch (err) {
    dtLogger.error('fuel_mapping_delete_error', err);
    sendError(res, 500, 'Failed to delete mapping profile');
  }
});

// ─── Import – Preview (no persist) ───────────────────────────────────────────
/**
 * @openapi
 * /api/fuel/import/preview:
 *   post:
 *     summary: Preview a fuel import file
 *     description: Parses an uploaded CSV/XLSX file and returns a preview of the data without persisting anything.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: CSV or XLSX file (max 10 MB)
 *               provider_key:
 *                 type: string
 *                 default: generic
 *     responses:
 *       200:
 *         description: Preview result with parsed rows and column headers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: No file uploaded or preview failed
 *       401:
 *         description: Tenant context required
 */
router.post('/import/preview', upload.single('file'), async (req, res) => {
  try {
    requireTenant(req, res);
    if (!req.file) return sendError(res, 400, 'No file uploaded');
    const providerKey = req.body.provider_key || 'generic';
    const result = await previewImport({
      buffer: req.file.buffer,
      fileName: req.file.originalname,
      providerKey
    });
    res.json(result);
  } catch (err) {
    dtLogger.error('fuel_import_preview_error', err);
    sendError(res, 400, err.message || 'Preview failed');
  }
});

// ─── Import – AI Preprocess (FN-406) ─────────────────────────────────────────
/**
 * @openapi
 * /api/fuel/import/ai-preprocess:
 *   post:
 *     summary: AI-assisted fuel import preprocessing
 *     description: Parses an uploaded file's headers and sample rows, then sends them to the AI service for column mapping inference, product type detection, and row split proposals.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: CSV or XLSX file (max 10 MB)
 *               provider_key:
 *                 type: string
 *                 default: generic
 *               provider_name:
 *                 type: string
 *     responses:
 *       200:
 *         description: AI preprocessing result with inferred column mappings and product types
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: No file uploaded or could not parse headers
 *       401:
 *         description: Tenant context required
 *       502:
 *         description: AI service unreachable or preprocessing failed
 *       504:
 *         description: AI service timeout
 */
router.post('/import/ai-preprocess', upload.single('file'), async (req, res) => {
  try {
    requireTenant(req, res);
    if (!req.file) return sendError(res, 400, 'No file uploaded');

    const providerKey = req.body.provider_key || 'generic';
    const providerName = req.body.provider_name || providerKey;

    // Parse file to get headers + all rows
    const { headers, rows } = parseFileBuffer(req.file.buffer, req.file.originalname);
    if (!headers || headers.length === 0) {
      return sendError(res, 400, 'Could not parse headers from file');
    }

    // Build sample rows as objects (header → value)
    const sampleRows = rows.slice(0, 20).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    });

    // Call AI service with timeout
    const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:4100';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    let response;
    try {
      response = await fetch(`${aiServiceUrl}/api/ai/fuel/preprocess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headers,
          sampleRows,
          totalRows: rows.length,
          providerName,
        }),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      if (fetchErr.name === 'AbortError') {
        dtLogger.error('fuel_ai_preprocess_timeout', { aiServiceUrl });
        return sendError(res, 504, 'AI service timeout');
      }
      // Connection refused, DNS failure, etc.
      dtLogger.error('fuel_ai_preprocess_unreachable', {
        aiServiceUrl,
        error: fetchErr.message,
      });
      return sendError(res, 502, 'AI service unreachable');
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      dtLogger.error('fuel_ai_preprocess_error', {
        status: response.status,
        body: errorBody,
      });
      return sendError(res, response.status === 400 ? 400 : 502,
        errorBody.error || 'AI preprocessing failed');
    }

    const aiResult = await response.json();
    res.json(aiResult);
  } catch (err) {
    dtLogger.error('fuel_ai_preprocess_error', err);
    sendError(res, 500, err.message || 'AI preprocessing failed');
  }
});

// ─── Import – Stage (validate & persist batch rows) ──────────────────────────
/**
 * @openapi
 * /api/fuel/import/stage:
 *   post:
 *     summary: Stage a fuel import batch
 *     description: Validates and stages an uploaded fuel file as a batch. Rows are persisted in a staging table but not yet committed as transactions. Optionally uploads the file to R2 storage.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *               - provider_name
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: CSV or XLSX file (max 10 MB)
 *               provider_name:
 *                 type: string
 *               card_account_id:
 *                 type: string
 *                 format: uuid
 *               column_map:
 *                 type: string
 *                 description: JSON string of column-to-field mapping
 *     responses:
 *       200:
 *         description: Staging result with batch ID and row counts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: No file uploaded or provider_name is required
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Stage failed
 */
router.post('/import/stage', upload.single('file'), async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    if (!req.file) return sendError(res, 400, 'No file uploaded');

    const { provider_name, card_account_id, column_map } = req.body;
    if (!provider_name) return sendError(res, 400, 'provider_name is required');

    let parsedMap;
    try {
      parsedMap = typeof column_map === 'string' ? JSON.parse(column_map) : column_map;
    } catch {
      // Fall back to auto-mapping if JSON is broken
      const { headers } = parseFileBuffer(req.file.buffer, req.file.originalname);
      parsedMap = buildAutoMapping(headers, 'generic');
    }

    if (!parsedMap || Object.keys(parsedMap).length === 0) {
      const { headers } = parseFileBuffer(req.file.buffer, req.file.originalname);
      parsedMap = buildAutoMapping(headers, 'generic');
    }

    // Optionally upload file to R2
    let fileStorageKey = null;
    try {
      const uploaded = await uploadBuffer({
        buffer: req.file.buffer,
        contentType: req.file.mimetype || 'text/csv',
        prefix: `fuel-imports/${tid}`,
        fileName: req.file.originalname
      });
      fileStorageKey = uploaded.key;
    } catch (uploadErr) {
      dtLogger.warn('fuel_file_upload_skipped', { reason: uploadErr.message });
    }

    const result = await stageBatch({
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      cardAccountId: card_account_id || null,
      providerName: provider_name,
      fileName: req.file.originalname,
      fileStorageKey,
      buffer: req.file.buffer,
      columnMap: parsedMap,
      importedByUserId: userId(req)
    });

    res.json(result);
  } catch (err) {
    dtLogger.error('fuel_import_stage_error', err);
    sendError(res, err.status || 500, err.message || 'Stage failed');
  }
});

// ─── Import – Commit (insert fuel_transactions) ───────────────────────────────
/**
 * @openapi
 * /api/fuel/import/commit/{batchId}:
 *   post:
 *     summary: Commit a staged import batch
 *     description: Commits a previously staged import batch, inserting the staged rows as fuel_transactions.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: batchId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Import batch ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               import_warnings:
 *                 type: boolean
 *                 description: If true, import rows with warnings
 *     responses:
 *       200:
 *         description: Commit result with success/failed row counts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Commit failed
 */
router.post('/import/commit/:batchId', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const { import_warnings } = req.body;
    const result = await commitBatch({
      batchId: req.params.batchId,
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      importedByUserId: userId(req),
      importWarnings: !!import_warnings
    });
    res.json(result);
  } catch (err) {
    dtLogger.error('fuel_import_commit_error', err);
    sendError(res, err.status || 500, err.message || 'Commit failed');
  }
});

// ─── Import Batches ───────────────────────────────────────────────────────────
/**
 * @openapi
 * /api/fuel/import/batches:
 *   get:
 *     summary: List import batches
 *     description: Returns a paginated list of fuel import batches for the tenant.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of batches to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of batches to skip
 *     responses:
 *       200:
 *         description: Paginated batch list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 rows:
 *                   type: array
 *                   items:
 *                     type: object
 *                 total:
 *                   type: integer
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Failed to fetch import batches
 */
router.get('/import/batches', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const { limit = 50, offset = 0 } = req.query;
    const rows = await applyOperatingEntityFilter(
      knex('fuel_import_batches').where({ tenant_id: tid }),
      req
    )
      .orderBy('started_at', 'desc')
      .limit(Number(limit))
      .offset(Number(offset));
    const [{ total }] = await applyOperatingEntityFilter(
      knex('fuel_import_batches').where({ tenant_id: tid }),
      req
    ).count('* as total');
    res.json({ rows, total: Number(total) });
  } catch (err) {
    dtLogger.error('fuel_batches_list_error', err);
    sendError(res, 500, 'Failed to fetch import batches');
  }
});

/**
 * @openapi
 * /api/fuel/import/batches/{id}:
 *   get:
 *     summary: Get import batch detail
 *     description: Returns a single import batch with all its staged rows. Optionally filter rows by resolution_status.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Import batch ID
 *       - in: query
 *         name: resolution_status
 *         schema:
 *           type: string
 *         description: Filter batch rows by resolution status (e.g. skipped)
 *     responses:
 *       200:
 *         description: Batch object with its rows
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 batch:
 *                   type: object
 *                 rows:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Batch not found
 *       500:
 *         description: Failed to fetch batch detail
 */
router.get('/import/batches/:id', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const batch = await applyOperatingEntityFilter(
      knex('fuel_import_batches').where({ id: req.params.id, tenant_id: tid }),
      req
    ).first();
    if (!batch) return sendError(res, 404, 'Batch not found');

    let batchRowsQuery = knex('fuel_import_batch_rows')
      .where({ batch_id: batch.id })
      .orderBy('row_number', 'asc');

    // Optional filter by resolution_status (e.g., ?resolution_status=skipped)
    if (req.query.resolution_status) {
      batchRowsQuery = batchRowsQuery.where('resolution_status', req.query.resolution_status);
    }

    const batchRows = await batchRowsQuery;

    res.json({ batch, rows: batchRows });
  } catch (err) {
    dtLogger.error('fuel_batch_detail_error', err);
    sendError(res, 500, 'Failed to fetch batch detail');
  }
});

// ─── Fuel Transactions ────────────────────────────────────────────────────────
/**
 * @openapi
 * /api/fuel/transactions:
 *   get:
 *     summary: List fuel transactions
 *     description: Returns a paginated, filterable list of fuel transactions with joined truck and driver display names.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: date_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter transactions on or after this date
 *       - in: query
 *         name: date_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter transactions on or before this date
 *       - in: query
 *         name: provider
 *         schema:
 *           type: string
 *         description: Filter by provider name (case-insensitive)
 *       - in: query
 *         name: truck_id
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: driver_id
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: matched_status
 *         schema:
 *           type: string
 *       - in: query
 *         name: settlement_link_status
 *         schema:
 *           type: string
 *       - in: query
 *         name: batch_id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by source import batch
 *       - in: query
 *         name: product_type
 *         schema:
 *           type: string
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated transaction list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 rows:
 *                   type: array
 *                   items:
 *                     type: object
 *                 total:
 *                   type: integer
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Failed to fetch transactions
 */
router.get('/transactions', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const {
      limit = 50, offset = 0,
      date_from, date_to,
      provider, truck_id, driver_id,
      matched_status, settlement_link_status,
      batch_id, product_type, category
    } = req.query;

    let q = knex('fuel_transactions as ft')
      .leftJoin('vehicles as v', 'v.id', 'ft.truck_id')
      .leftJoin('drivers as d', 'd.id', 'ft.driver_id')
      .where('ft.tenant_id', tid)
      .select(
        'ft.*',
        knex.raw("COALESCE(v.unit_number, ft.unit_number_raw) AS truck_display"),
        knex.raw("COALESCE(d.first_name || ' ' || d.last_name, ft.driver_name_raw) AS driver_display")
      )
      .orderBy('ft.transaction_date', 'desc');

    applyOperatingEntityFilter(q, req, 'ft.operating_entity_id');

    if (date_from) q = q.where('ft.transaction_date', '>=', date_from);
    if (date_to) q = q.where('ft.transaction_date', '<=', date_to);
    if (provider) q = q.whereRaw('LOWER(ft.provider_name) = LOWER(?)', [provider]);
    if (truck_id) q = q.where('ft.truck_id', truck_id);
    if (driver_id) q = q.where('ft.driver_id', driver_id);
    if (matched_status) q = q.where('ft.matched_status', matched_status);
    if (settlement_link_status) q = q.where('ft.settlement_link_status', settlement_link_status);
    if (batch_id) q = q.where('ft.source_batch_id', batch_id);
    if (product_type) q = q.where('ft.product_type', product_type);
    if (category) q = q.where('ft.category', category);

    const total = await applyOperatingEntityFilter(
      knex('fuel_transactions').where('tenant_id', tid),
      req
    )
      .modify((qb) => {
        if (date_from) qb.where('transaction_date', '>=', date_from);
        if (date_to) qb.where('transaction_date', '<=', date_to);
        if (provider) qb.whereRaw('LOWER(provider_name) = LOWER(?)', [provider]);
        if (truck_id) qb.where('truck_id', truck_id);
        if (driver_id) qb.where('driver_id', driver_id);
        if (matched_status) qb.where('matched_status', matched_status);
        if (batch_id) qb.where('source_batch_id', batch_id);
        if (product_type) qb.where('product_type', product_type);
        if (category) qb.where('category', category);
      })
      .count('* as n').then(([r]) => Number(r.n));

    const rows = await q.limit(Number(limit)).offset(Number(offset));
    res.json({ rows, total });
  } catch (err) {
    dtLogger.error('fuel_transactions_list_error', err);
    sendError(res, 500, 'Failed to fetch transactions');
  }
});

/**
 * @openapi
 * /api/fuel/transactions/{id}:
 *   get:
 *     summary: Get a fuel transaction
 *     description: Returns a single fuel transaction with its associated exceptions.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Fuel transaction ID
 *     responses:
 *       200:
 *         description: Transaction object with exceptions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 transaction:
 *                   type: object
 *                 exceptions:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Transaction not found
 *       500:
 *         description: Failed to fetch transaction
 */
router.get('/transactions/:id', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const txn = await applyOperatingEntityFilter(
      knex('fuel_transactions').where({ id: req.params.id, tenant_id: tid }),
      req
    ).first();
    if (!txn) return sendError(res, 404, 'Transaction not found');

    const exceptions = await knex('fuel_transaction_exceptions').where({ fuel_transaction_id: txn.id });
    res.json({ transaction: txn, exceptions });
  } catch (err) {
    dtLogger.error('fuel_transaction_detail_error', err);
    sendError(res, 500, 'Failed to fetch transaction');
  }
});

/**
 * @openapi
 * /api/fuel/transactions/{id}:
 *   patch:
 *     summary: Update a fuel transaction
 *     description: Partially updates a fuel transaction. Only the provided fields are changed.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Fuel transaction ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               truck_id:
 *                 type: string
 *                 format: uuid
 *               driver_id:
 *                 type: string
 *                 format: uuid
 *               load_id:
 *                 type: string
 *                 format: uuid
 *               settlement_id:
 *                 type: string
 *                 format: uuid
 *               settlement_link_status:
 *                 type: string
 *               matched_status:
 *                 type: string
 *               notes:
 *                 type: string
 *               vendor_name:
 *                 type: string
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated transaction
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Transaction not found
 *       500:
 *         description: Failed to update transaction
 */
router.patch('/transactions/:id', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const allowed = ['truck_id', 'driver_id', 'load_id', 'settlement_id', 'settlement_link_status',
      'matched_status', 'notes', 'vendor_name', 'city', 'state'];
    const patch = {};
    for (const f of allowed) {
      if (req.body[f] !== undefined) patch[f] = req.body[f];
    }
    patch.updated_at = new Date();

    const [row] = await knex('fuel_transactions')
      .modify((qb) => {
        qb.where({ id: req.params.id, tenant_id: tid });
        applyOperatingEntityFilter(qb, req);
      })
      .update(patch)
      .returning('*');
    if (!row) return sendError(res, 404, 'Transaction not found');
    res.json(row);
  } catch (err) {
    dtLogger.error('fuel_transaction_patch_error', err);
    sendError(res, 500, 'Failed to update transaction');
  }
});

/**
 * @openapi
 * /api/fuel/transactions:
 *   post:
 *     summary: Create a manual fuel transaction
 *     description: Manually creates a single fuel transaction (not via import).
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transaction_date
 *               - provider_name
 *               - gallons
 *               - amount
 *             properties:
 *               transaction_date:
 *                 type: string
 *                 format: date
 *               provider_name:
 *                 type: string
 *               gallons:
 *                 type: number
 *               amount:
 *                 type: number
 *               external_transaction_id:
 *                 type: string
 *               posted_date:
 *                 type: string
 *                 format: date
 *               truck_id:
 *                 type: string
 *                 format: uuid
 *               driver_id:
 *                 type: string
 *                 format: uuid
 *               unit_number_raw:
 *                 type: string
 *               driver_name_raw:
 *                 type: string
 *               card_number_masked:
 *                 type: string
 *               vendor_name:
 *                 type: string
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *               price_per_gallon:
 *                 type: number
 *               product_type:
 *                 type: string
 *               odometer:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Created fuel transaction
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Required fields missing
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Failed to create transaction
 */
// Manual transaction creation
router.post('/transactions', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const required = ['transaction_date', 'provider_name', 'gallons', 'amount'];
    for (const f of required) {
      if (!req.body[f] && req.body[f] !== 0) return sendError(res, 400, `${f} is required`);
    }

    const [row] = await knex('fuel_transactions').insert({
      tenant_id: tid,
      operating_entity_id: operatingEntityId(req),
      provider_name: req.body.provider_name,
      external_transaction_id: req.body.external_transaction_id || null,
      transaction_date: req.body.transaction_date,
      posted_date: req.body.posted_date || null,
      truck_id: req.body.truck_id || null,
      driver_id: req.body.driver_id || null,
      unit_number_raw: req.body.unit_number_raw || null,
      driver_name_raw: req.body.driver_name_raw || null,
      card_number_masked: req.body.card_number_masked || null,
      vendor_name: req.body.vendor_name || null,
      city: req.body.city || null,
      state: req.body.state || null,
      gallons: parseFloat(req.body.gallons) || 0,
      amount: parseFloat(req.body.amount) || 0,
      price_per_gallon: req.body.price_per_gallon ? parseFloat(req.body.price_per_gallon) : null,
      product_type: req.body.product_type || null,
      odometer: req.body.odometer ? parseInt(req.body.odometer, 10) : null,
      matched_status: req.body.truck_id ? 'manual' : 'unmatched',
      validation_status: 'valid',
      settlement_link_status: 'none',
      is_manual: true,
      created_by: userId(req)
    }).returning('*');

    res.status(201).json(row);
  } catch (err) {
    dtLogger.error('fuel_transaction_create_error', err);
    sendError(res, 500, 'Failed to create transaction');
  }
});

/**
 * @openapi
 * /api/fuel/transactions/{id}:
 *   delete:
 *     summary: Delete a fuel transaction
 *     description: Deletes a single fuel transaction by ID.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Fuel transaction ID
 *     responses:
 *       200:
 *         description: Deletion confirmation
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deleted:
 *                   type: boolean
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Transaction not found
 *       500:
 *         description: Failed to delete transaction
 */
router.delete('/transactions/:id', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const deleted = await applyOperatingEntityFilter(
      knex('fuel_transactions').where({ id: req.params.id, tenant_id: tid }),
      req
    ).del();
    if (!deleted) return sendError(res, 404, 'Transaction not found');
    res.json({ deleted: true });
  } catch (err) {
    dtLogger.error('fuel_transaction_delete_error', err);
    sendError(res, 500, 'Failed to delete transaction');
  }
});

// ─── Exceptions ───────────────────────────────────────────────────────────────
/**
 * @openapi
 * /api/fuel/exceptions:
 *   get:
 *     summary: List fuel transaction exceptions
 *     description: Returns a paginated list of fuel transaction exceptions with joined transaction details. Filterable by status and exception_type.
 *     tags:
 *       - Fuel
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by resolution_status (e.g. open, resolved)
 *       - in: query
 *         name: exception_type
 *         schema:
 *           type: string
 *         description: Filter by exception type
 *     responses:
 *       200:
 *         description: Paginated exception list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 rows:
 *                   type: array
 *                   items:
 *                     type: object
 *                 total:
 *                   type: integer
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Failed to fetch exceptions
 */
router.get('/exceptions', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const { limit = 50, offset = 0, status, exception_type } = req.query;

    let q = knex('fuel_transaction_exceptions as e')
      .join('fuel_transactions as ft', 'ft.id', 'e.fuel_transaction_id')
      .where('e.tenant_id', tid)
      .select('e.*',
        'ft.transaction_date', 'ft.provider_name', 'ft.vendor_name',
        'ft.unit_number_raw', 'ft.driver_name_raw', 'ft.card_number_masked',
        'ft.gallons', 'ft.amount', 'ft.city', 'ft.state'
      )
      .orderBy('e.created_at', 'desc');

    applyOperatingEntityFilter(q, req, 'ft.operating_entity_id');

    if (status) q = q.where('e.resolution_status', status);
    if (exception_type) q = q.where('e.exception_type', exception_type);

    const rows = await q.limit(Number(limit)).offset(Number(offset));
    const [{ total }] = await knex('fuel_transaction_exceptions as e')
      .join('fuel_transactions as ft', 'ft.id', 'e.fuel_transaction_id')
      .where('e.tenant_id', tid)
      .modify((qb) => {
        applyOperatingEntityFilter(qb, req, 'ft.operating_entity_id');
      })
      .modify((qb) => { if (status) qb.where('resolution_status', status); })
      .modify((qb) => { if (exception_type) qb.where('exception_type', exception_type); })
      .count('* as total');

    res.json({ rows, total: Number(total) });
  } catch (err) {
    dtLogger.error('fuel_exceptions_list_error', err);
    sendError(res, 500, 'Failed to fetch exceptions');
  }
});

router.patch('/exceptions/:id/resolve', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const { truck_id, driver_id, resolution_notes, ignore } = req.body;
    const result = await resolveException({
      exceptionId: req.params.id,
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      resolvedBy: userId(req),
      truckId: truck_id || null,
      driverId: driver_id || null,
      resolutionNotes: resolution_notes || null,
      ignore: !!ignore
    });
    res.json(result);
  } catch (err) {
    dtLogger.error('fuel_exception_resolve_error', err);
    sendError(res, err.status || 500, err.message || 'Resolve failed');
  }
});

router.post('/exceptions/bulk-resolve', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const { exception_ids, action, resolution_notes } = req.body;
    if (!Array.isArray(exception_ids) || !action) return sendError(res, 400, 'exception_ids (array) and action are required');
    const result = await bulkResolveExceptions({
      exceptionIds: exception_ids,
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      resolvedBy: userId(req),
      action,
      resolutionNotes: resolution_notes || null
    });
    res.json(result);
  } catch (err) {
    dtLogger.error('fuel_bulk_resolve_error', err);
    sendError(res, 500, 'Bulk resolve failed');
  }
});

// ─── Reprocess unmatched ──────────────────────────────────────────────────────
router.post('/reprocess-unmatched', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const result = await reprocessUnmatched(tid, operatingEntityId(req));
    res.json(result);
  } catch (err) {
    dtLogger.error('fuel_reprocess_error', err);
    sendError(res, 500, 'Reprocess failed');
  }
});

// ─── Overview / dashboard widgets ─────────────────────────────────────────────
router.get('/overview', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;

    const now = new Date();
    const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
    const monthAgo = new Date(now); monthAgo.setDate(now.getDate() - 30);

    const [weekStats] = await knex('fuel_transactions')
      .where({ tenant_id: tid })
      .modify((qb) => applyOperatingEntityFilter(qb, req))
      .where('transaction_date', '>=', weekAgo.toISOString().slice(0, 10))
      .select(
        knex.raw('COALESCE(SUM(amount), 0) as total_amount'),
        knex.raw('COALESCE(SUM(gallons), 0) as total_gallons'),
        knex.raw('COUNT(*) as count')
      );

    const [monthStats] = await knex('fuel_transactions')
      .where({ tenant_id: tid })
      .modify((qb) => applyOperatingEntityFilter(qb, req))
      .where('transaction_date', '>=', monthAgo.toISOString().slice(0, 10))
      .select(
        knex.raw('COALESCE(SUM(amount), 0) as total_amount'),
        knex.raw('COALESCE(SUM(gallons), 0) as total_gallons'),
        knex.raw('COUNT(*) as count')
      );

    const totalGallons = parseFloat(monthStats.total_gallons) || 0;
    const totalAmount = parseFloat(monthStats.total_amount) || 0;
    const avgPpg = totalGallons > 0 ? totalAmount / totalGallons : 0;

    const topVendors = await knex('fuel_transactions')
      .where({ tenant_id: tid })
      .modify((qb) => applyOperatingEntityFilter(qb, req))
      .where('transaction_date', '>=', monthAgo.toISOString().slice(0, 10))
      .whereNotNull('vendor_name')
      .groupBy('vendor_name')
      .select('vendor_name')
      .sum('amount as total')
      .count('* as count')
      .orderBy('total', 'desc')
      .limit(5);

    const byState = await knex('fuel_transactions')
      .where({ tenant_id: tid })
      .modify((qb) => applyOperatingEntityFilter(qb, req))
      .where('transaction_date', '>=', monthAgo.toISOString().slice(0, 10))
      .whereNotNull('state')
      .groupBy('state')
      .select('state')
      .sum('gallons as gallons')
      .sum('amount as amount')
      .orderBy('gallons', 'desc')
      .limit(10);

    const [unmatchedCount] = await knex('fuel_transactions')
      .where({ tenant_id: tid, matched_status: 'unmatched' })
      .modify((qb) => applyOperatingEntityFilter(qb, req))
      .count('* as count');

    const [exceptionsOpen] = await knex('fuel_transaction_exceptions as e')
      .join('fuel_transactions as ft', 'ft.id', 'e.fuel_transaction_id')
      .where({ 'e.tenant_id': tid, 'e.resolution_status': 'open' })
      .modify((qb) => applyOperatingEntityFilter(qb, req, 'ft.operating_entity_id'))
      .count('* as count');

    // Product type breakdown (30 days)
    const byProductType = await knex('fuel_transactions')
      .where({ tenant_id: tid })
      .modify((qb) => applyOperatingEntityFilter(qb, req))
      .where('transaction_date', '>=', monthAgo.toISOString().slice(0, 10))
      .groupByRaw('COALESCE(product_type, \'diesel\')')
      .select(knex.raw('COALESCE(product_type, \'diesel\') as product_type'))
      .sum('gallons as gallons')
      .sum('amount as amount')
      .count('* as count')
      .orderBy('amount', 'desc');

    const lastBatch = await knex('fuel_import_batches')
      .where({ tenant_id: tid })
      .modify((qb) => applyOperatingEntityFilter(qb, req))
      .orderBy('started_at', 'desc')
      .first(['id', 'import_status', 'source_file_name', 'started_at', 'total_rows', 'success_rows', 'failed_rows']);

    res.json({
      week: {
        totalAmount: parseFloat(weekStats.total_amount) || 0,
        totalGallons: parseFloat(weekStats.total_gallons) || 0,
        count: Number(weekStats.count) || 0
      },
      month: {
        totalAmount,
        totalGallons,
        avgPpg: parseFloat(avgPpg.toFixed(4)),
        count: Number(monthStats.count) || 0
      },
      topVendors: topVendors.map((v) => ({ name: v.vendor_name, total: parseFloat(v.total), count: Number(v.count) })),
      byState: byState.map((s) => ({ state: s.state, gallons: parseFloat(s.gallons), amount: parseFloat(s.amount) })),
      byProductType: byProductType.map((p) => ({ productType: p.product_type, gallons: parseFloat(p.gallons), amount: parseFloat(p.amount), count: Number(p.count) })),
      unmatchedTransactions: Number(unmatchedCount.count) || 0,
      openExceptions: Number(exceptionsOpen.count) || 0,
      lastBatch: lastBatch || null
    });
  } catch (err) {
    dtLogger.error('fuel_overview_error', err);
    sendError(res, 500, 'Failed to fetch fuel overview');
  }
});

module.exports = router;
