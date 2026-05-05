'use strict';

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/logger');
const manufacturersService = require('../services/manufacturers.service');

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
 * /api/manufacturers/search:
 *   get:
 *     summary: Autocomplete search for manufacturers
 *     description: >-
 *       Case-insensitive prefix and fuzzy substring match against
 *       `normalized_name`. Returns rows ordered by similarity (prefix matches
 *       score 1.0; substring matches scaled by length ratio). Default limit 10,
 *       max 50.
 *     tags:
 *       - Manufacturers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search term
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Matching manufacturers
 */
router.get('/search', authMiddleware, async (req, res) => {
	try {
		const results = await manufacturersService.search({
			q: req.query.q,
			limit: req.query.limit,
		});
		res.json({ success: true, data: results });
	} catch (error) {
		dtLogger.error('manufacturers_search_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/manufacturers:
 *   get:
 *     summary: List manufacturers
 *     tags:
 *       - Manufacturers
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
 *         description: List of manufacturers
 */
router.get('/', authMiddleware, async (req, res) => {
	try {
		const rows = await manufacturersService.list({
			search: req.query.search,
			limit: req.query.limit,
		});
		res.json({ success: true, data: rows });
	} catch (error) {
		dtLogger.error('manufacturers_list_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/manufacturers/{id}:
 *   get:
 *     summary: Get a manufacturer by ID
 *     tags:
 *       - Manufacturers
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
 *         description: Manufacturer details
 *       404:
 *         description: Not found
 */
router.get('/:id(\\d+)', authMiddleware, async (req, res) => {
	try {
		const row = await manufacturersService.getById(req.params.id);
		res.json({ success: true, data: row });
	} catch (error) {
		dtLogger.error('manufacturer_get_failed', { id: req.params.id, error: error.message });
		res.status(404).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/manufacturers:
 *   post:
 *     summary: Create a manufacturer
 *     description: Creates a manufacturer if no row with the same normalized name exists; otherwise returns the existing row.
 *     tags:
 *       - Manufacturers
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
 *     responses:
 *       201:
 *         description: Created
 *       400:
 *         description: Validation error
 */
router.post('/', authMiddleware, requireRole(WRITE_ROLES), async (req, res) => {
	try {
		const row = await manufacturersService.create({ name: req.body?.name });
		res.status(201).json({ success: true, data: row });
	} catch (error) {
		dtLogger.error('manufacturer_create_failed', { error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/manufacturers/{id}:
 *   patch:
 *     summary: Update a manufacturer
 *     tags:
 *       - Manufacturers
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
 *     responses:
 *       200:
 *         description: Updated
 *       400:
 *         description: Validation error
 */
router.patch('/:id(\\d+)', authMiddleware, requireRole(WRITE_ROLES), async (req, res) => {
	try {
		const row = await manufacturersService.update(req.params.id, { name: req.body?.name });
		res.json({ success: true, data: row });
	} catch (error) {
		dtLogger.error('manufacturer_update_failed', { id: req.params.id, error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/manufacturers/{id}:
 *   delete:
 *     summary: Delete a manufacturer
 *     description: >-
 *       Hard-deletes the master row. Parts referencing this manufacturer keep
 *       their `parts.manufacturer` text but have `manufacturer_id` set to NULL
 *       (FK is `ON DELETE SET NULL`).
 *     tags:
 *       - Manufacturers
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
		const result = await manufacturersService.remove(req.params.id);
		res.json({ success: true, data: result });
	} catch (error) {
		dtLogger.error('manufacturer_delete_failed', { id: req.params.id, error: error.message });
		res.status(400).json({ error: error.message });
	}
});

module.exports = router;
