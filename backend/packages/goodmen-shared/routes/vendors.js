'use strict';

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/logger');
const vendorsService = require('../services/vendors.service');

function requireRole(allowedRoles) {
	return (req, res, next) => {
		const userRole = req.user?.role || 'technician';
		if (!allowedRoles.includes(userRole)) {
			return res.status(403).json({
				error: `Insufficient permissions. Required role: ${allowedRoles.join(' or ')}`,
			});
		}
		next();
	};
}

const WRITE_ROLES = ['admin', 'parts_manager'];

/**
 * @openapi
 * /api/vendors/search:
 *   get:
 *     summary: Autocomplete search for vendors
 *     description: >-
 *       Case-insensitive prefix and fuzzy substring match against
 *       `normalized_name`. Default limit 10, max 50.
 *     tags:
 *       - Vendors
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Matching vendors
 */
router.get('/search', authMiddleware, async (req, res) => {
	try {
		const results = await vendorsService.search({ q: req.query.q, limit: req.query.limit });
		res.json({ success: true, data: results });
	} catch (error) {
		dtLogger.error('vendors_search_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/vendors:
 *   get:
 *     summary: List vendors
 *     tags:
 *       - Vendors
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of vendors
 */
router.get('/', authMiddleware, async (req, res) => {
	try {
		const rows = await vendorsService.list({ search: req.query.search, limit: req.query.limit });
		res.json({ success: true, data: rows });
	} catch (error) {
		dtLogger.error('vendors_list_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/vendors/{id}:
 *   get:
 *     summary: Get a vendor by ID
 *     tags:
 *       - Vendors
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Vendor details
 *       404:
 *         description: Not found
 */
router.get('/:id(\\d+)', authMiddleware, async (req, res) => {
	try {
		const row = await vendorsService.getById(req.params.id);
		res.json({ success: true, data: row });
	} catch (error) {
		dtLogger.error('vendor_get_failed', { id: req.params.id, error: error.message });
		res.status(404).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/vendors:
 *   post:
 *     summary: Create a vendor
 *     description: Creates a vendor if no row with the same normalized name exists; otherwise returns the existing row.
 *     tags:
 *       - Vendors
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               contact_email:
 *                 type: string
 *               contact_phone:
 *                 type: string
 *     responses:
 *       201:
 *         description: Created
 *       400:
 *         description: Validation error
 */
router.post('/', authMiddleware, requireRole(WRITE_ROLES), async (req, res) => {
	try {
		const row = await vendorsService.create({
			name: req.body?.name,
			contact_email: req.body?.contact_email,
			contact_phone: req.body?.contact_phone,
		});
		res.status(201).json({ success: true, data: row });
	} catch (error) {
		dtLogger.error('vendor_create_failed', { error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/vendors/{id}:
 *   patch:
 *     summary: Update a vendor
 *     tags:
 *       - Vendors
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               contact_email:
 *                 type: string
 *               contact_phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated
 *       400:
 *         description: Validation error
 */
router.patch('/:id(\\d+)', authMiddleware, requireRole(WRITE_ROLES), async (req, res) => {
	try {
		const row = await vendorsService.update(req.params.id, {
			name: req.body?.name,
			contact_email: req.body?.contact_email,
			contact_phone: req.body?.contact_phone,
		});
		res.json({ success: true, data: row });
	} catch (error) {
		dtLogger.error('vendor_update_failed', { id: req.params.id, error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/vendors/{id}:
 *   delete:
 *     summary: Delete a vendor
 *     description: >-
 *       Hard-deletes the master row. Parts referencing this vendor keep their
 *       `parts.preferred_vendor_name` text but have `vendor_id` set to NULL
 *       (FK is `ON DELETE SET NULL`).
 *     tags:
 *       - Vendors
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Deleted
 *       400:
 *         description: Validation error
 */
router.delete('/:id(\\d+)', authMiddleware, requireRole(WRITE_ROLES), async (req, res) => {
	try {
		const result = await vendorsService.remove(req.params.id);
		res.json({ success: true, data: result });
	} catch (error) {
		dtLogger.error('vendor_delete_failed', { id: req.params.id, error: error.message });
		res.status(400).json({ error: error.message });
	}
});

module.exports = router;
