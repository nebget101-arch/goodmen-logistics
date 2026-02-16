const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/dynatrace-logger');
const partsService = require('../services/parts.service');
const db = require('../config/knex');

/**
 * Permission helpers
 */
function requireRole(allowedRoles) {
	return (req, res, next) => {
		const userRole = req.user?.role || 'technician';
		if (!allowedRoles.includes(userRole)) {
			return res.status(403).json({ error: `Insufficient permissions. Required role: ${allowedRoles.join(' or ')}` });
		}
		next();
	};
}

/**
 * GET /api/parts
 * Get all active parts with optional filters
 */
router.get('/', authMiddleware, async (req, res) => {
	try {
		const filters = {
			category: req.query.category,
			manufacturer: req.query.manufacturer,
			search: req.query.search
		};

		const parts = await partsService.getParts(filters);

		res.json({
			success: true,
			data: parts
		});
	} catch (error) {
		dtLogger.error('parts_get_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * GET /api/parts/categories
 * Get list of distinct categories
 */
router.get('/categories', authMiddleware, async (req, res) => {
	try {
		const categories = await partsService.getCategories();

		res.json({
			success: true,
			data: categories
		});
	} catch (error) {
		dtLogger.error('categories_get_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * GET /api/parts/manufacturers
 * Get list of distinct manufacturers
 */
router.get('/manufacturers', authMiddleware, async (req, res) => {
	try {
		const manufacturers = await partsService.getManufacturers();

		res.json({
			success: true,
			data: manufacturers
		});
	} catch (error) {
		dtLogger.error('manufacturers_get_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * GET /api/parts/:id
 * Get a single part by ID
 */
router.get('/:id', authMiddleware, async (req, res) => {
	try {
		const part = await partsService.getPartById(req.params.id);

		res.json({
			success: true,
			data: part
		});
	} catch (error) {
		dtLogger.error('part_get_failed', { id: req.params.id, error: error.message });
		res.status(404).json({ error: error.message });
	}
});

/**
 * POST /api/parts
 * Create a new part
 * Requires: Admin or Parts Manager role
 */
router.post('/', authMiddleware, requireRole(['admin', 'parts_manager']), async (req, res) => {
	try {
		const partData = req.body;

		const part = await partsService.createPart(partData);

		res.status(201).json({
			success: true,
			data: part,
			message: `Part ${part.sku} created successfully`
		});
	} catch (error) {
		dtLogger.error('part_creation_failed', { error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * PUT /api/parts/:id
 * Update an existing part
 * Requires: Admin or Parts Manager role
 */
router.put('/:id', authMiddleware, requireRole(['admin', 'parts_manager']), async (req, res) => {
	try {
		const part = await partsService.updatePart(req.params.id, req.body);

		res.json({
			success: true,
			data: part,
			message: 'Part updated successfully'
		});
	} catch (error) {
		dtLogger.error('part_update_failed', { id: req.params.id, error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * PATCH /api/parts/:id/deactivate
 * Deactivate a part (soft delete)
 * Requires: Admin or Parts Manager role
 */
router.patch('/:id/deactivate', authMiddleware, requireRole(['admin', 'parts_manager']), async (req, res) => {
	try {
		const part = await partsService.deactivatePart(req.params.id);

		res.json({
			success: true,
			data: part,
			message: 'Part deactivated successfully'
		});
	} catch (error) {
		dtLogger.error('part_deactivation_failed', { id: req.params.id, error: error.message });
		res.status(400).json({ error: error.message });
	}
});

module.exports = router;
