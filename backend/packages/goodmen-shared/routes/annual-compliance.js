const express = require('express');
const router = express.Router();
const auth = require('./auth-middleware');
const { query } = require('../internal/db');
const dtLogger = require('../utils/logger');
const {
  generateAllAnnualItems,
  completeItem,
  getDriverCompliance,
  getOverdueItems,
  getUpcomingItems,
  getDashboardSummary,
  getMedicalCertExpiryReport
} = require('../services/annual-compliance-service');

// All routes require admin or safety role
router.use(auth(['admin', 'safety']));

/**
 * @openapi
 * /api/annual-compliance/dashboard:
 *   get:
 *     summary: Get annual compliance dashboard summary
 *     description: Retrieves a summary of annual compliance status across all drivers. Per 49 CFR 391.25 — Annual inquiry and review of driving record.
 *     tags:
 *       - Compliance
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard summary object
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Tenant context required
 *       500:
 *         description: Server error
 */
// ---------------------------------------------------------------------------
// GET /api/annual-compliance/dashboard
// ---------------------------------------------------------------------------
router.get('/dashboard', async (req, res) => {
  const start = Date.now();
  try {
    const tenantId = req.context?.tenantId;
    if (!tenantId) {
      return res.status(403).json({ message: 'Tenant context required' });
    }

    const summary = await getDashboardSummary(query, tenantId);

    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', '/api/annual-compliance/dashboard', 200, duration);
    return res.json(summary);
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('annual_compliance_dashboard_failed', error);
    dtLogger.trackRequest('GET', '/api/annual-compliance/dashboard', 500, duration);
    return res.status(500).json({ message: 'Failed to load compliance dashboard' });
  }
});

/**
 * @openapi
 * /api/annual-compliance/overdue:
 *   get:
 *     summary: List overdue annual compliance items
 *     description: Retrieves compliance items that are past their due date. Per 49 CFR 391.25 — Annual inquiry and review of driving record.
 *     tags:
 *       - Compliance
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of overdue compliance items
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Tenant context required
 *       500:
 *         description: Server error
 */
// ---------------------------------------------------------------------------
// GET /api/annual-compliance/overdue
// ---------------------------------------------------------------------------
router.get('/overdue', async (req, res) => {
  const start = Date.now();
  try {
    const tenantId = req.context?.tenantId;
    if (!tenantId) {
      return res.status(403).json({ message: 'Tenant context required' });
    }

    let items = await getOverdueItems(query, tenantId);

    // Apply operating entity scoping if present
    if (req.context?.operatingEntityId) {
      items = items.filter((i) => i.operating_entity_id === req.context.operatingEntityId);
    }

    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', '/api/annual-compliance/overdue', 200, duration, { count: items.length });
    return res.json(items);
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('annual_compliance_overdue_failed', error);
    dtLogger.trackRequest('GET', '/api/annual-compliance/overdue', 500, duration);
    return res.status(500).json({ message: 'Failed to load overdue items' });
  }
});

/**
 * @openapi
 * /api/annual-compliance/upcoming:
 *   get:
 *     summary: List upcoming annual compliance items
 *     description: Retrieves compliance items due within the specified number of days. Per 49 CFR 391.25 — Annual inquiry and review of driving record.
 *     tags:
 *       - Compliance
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 30
 *         description: Number of days to look ahead (defaults to 30)
 *     responses:
 *       200:
 *         description: Array of upcoming compliance items
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Tenant context required
 *       500:
 *         description: Server error
 */
// ---------------------------------------------------------------------------
// GET /api/annual-compliance/upcoming?days=30
// ---------------------------------------------------------------------------
router.get('/upcoming', async (req, res) => {
  const start = Date.now();
  try {
    const tenantId = req.context?.tenantId;
    if (!tenantId) {
      return res.status(403).json({ message: 'Tenant context required' });
    }

    const days = parseInt(req.query.days, 10) || 30;
    let items = await getUpcomingItems(query, tenantId, days);

    if (req.context?.operatingEntityId) {
      items = items.filter((i) => i.operating_entity_id === req.context.operatingEntityId);
    }

    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', '/api/annual-compliance/upcoming', 200, duration, { count: items.length });
    return res.json(items);
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('annual_compliance_upcoming_failed', error);
    dtLogger.trackRequest('GET', '/api/annual-compliance/upcoming', 500, duration);
    return res.status(500).json({ message: 'Failed to load upcoming items' });
  }
});

/**
 * @openapi
 * /api/annual-compliance/medical-expiry:
 *   get:
 *     summary: Get medical certificate expiry report
 *     description: Retrieves a report of driver medical certificate expiration dates. Per 49 CFR 391.27 — Annual review of driving record.
 *     tags:
 *       - Compliance
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of medical certificate expiry records
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Tenant context required
 *       500:
 *         description: Server error
 */
// ---------------------------------------------------------------------------
// GET /api/annual-compliance/medical-expiry
// ---------------------------------------------------------------------------
router.get('/medical-expiry', async (req, res) => {
  const start = Date.now();
  try {
    const tenantId = req.context?.tenantId;
    if (!tenantId) {
      return res.status(403).json({ message: 'Tenant context required' });
    }

    let report = await getMedicalCertExpiryReport(query, tenantId);

    if (req.context?.operatingEntityId) {
      report = report.filter((r) => r.operating_entity_id === req.context.operatingEntityId);
    }

    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', '/api/annual-compliance/medical-expiry', 200, duration, { count: report.length });
    return res.json(report);
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('annual_compliance_medical_expiry_failed', error);
    dtLogger.trackRequest('GET', '/api/annual-compliance/medical-expiry', 500, duration);
    return res.status(500).json({ message: 'Failed to load medical cert expiry report' });
  }
});

/**
 * @openapi
 * /api/annual-compliance/driver/{driverId}:
 *   get:
 *     summary: Get compliance items for a driver
 *     description: Retrieves annual compliance items for a specific driver, optionally filtered by year. Per 49 CFR 391.25 — Annual inquiry and review of driving record.
 *     tags:
 *       - Compliance
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *         description: The driver ID
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *         description: Filter by compliance year (e.g. 2026)
 *     responses:
 *       200:
 *         description: Array of compliance items for the driver
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Driver not found
 *       500:
 *         description: Server error
 */
// ---------------------------------------------------------------------------
// GET /api/annual-compliance/driver/:driverId?year=2026
// ---------------------------------------------------------------------------
router.get('/driver/:driverId', async (req, res) => {
  const start = Date.now();
  try {
    const { driverId } = req.params;
    const year = req.query.year ? parseInt(req.query.year, 10) : null;

    // Validate driver belongs to tenant and OE
    const driverRes = await query(
      'SELECT id, operating_entity_id FROM drivers WHERE id = $1',
      [driverId]
    );
    if (driverRes.rows.length === 0) {
      return res.status(404).json({ message: 'Driver not found' });
    }
    if (req.context?.operatingEntityId && driverRes.rows[0].operating_entity_id !== req.context.operatingEntityId) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    const items = await getDriverCompliance(query, driverId, year);

    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', `/api/annual-compliance/driver/${driverId}`, 200, duration, { count: items.length });
    return res.json(items);
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('annual_compliance_driver_failed', error, { driverId: req.params.driverId });
    dtLogger.trackRequest('GET', `/api/annual-compliance/driver/${req.params.driverId}`, 500, duration);
    return res.status(500).json({ message: 'Failed to load driver compliance items' });
  }
});

/**
 * @openapi
 * /api/annual-compliance/{id}/complete:
 *   post:
 *     summary: Complete a compliance item
 *     description: Marks an annual compliance item as completed with reviewer details and determination. Per 49 CFR 391.25 — Annual inquiry and review of driving record.
 *     tags:
 *       - Compliance
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The compliance item ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reviewerName
 *             properties:
 *               reviewerName:
 *                 type: string
 *                 description: Name of the person completing the review
 *               reviewNotes:
 *                 type: string
 *                 description: Notes from the review
 *               determination:
 *                 type: string
 *                 description: Review determination result
 *               evidenceDocumentId:
 *                 type: string
 *                 description: ID of the supporting evidence document
 *     responses:
 *       200:
 *         description: Compliance item completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 item:
 *                   type: object
 *       400:
 *         description: reviewerName is required
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Compliance item not found
 *       500:
 *         description: Server error
 */
// ---------------------------------------------------------------------------
// POST /api/annual-compliance/:id/complete
// ---------------------------------------------------------------------------
router.post('/:id/complete', async (req, res) => {
  const start = Date.now();
  try {
    const { id } = req.params;
    const { reviewerName, reviewNotes, determination, evidenceDocumentId } = req.body;

    if (!reviewerName) {
      return res.status(400).json({ message: 'reviewerName is required' });
    }

    // Verify item exists and belongs to this tenant
    const itemRes = await query(
      'SELECT id, tenant_id, driver_id FROM annual_compliance_items WHERE id = $1',
      [id]
    );
    if (itemRes.rows.length === 0) {
      return res.status(404).json({ message: 'Compliance item not found' });
    }
    if (req.context?.tenantId && itemRes.rows[0].tenant_id !== req.context.tenantId) {
      return res.status(404).json({ message: 'Compliance item not found' });
    }

    // Validate OE access through the driver
    const driverRes = await query(
      'SELECT operating_entity_id FROM drivers WHERE id = $1',
      [itemRes.rows[0].driver_id]
    );
    if (req.context?.operatingEntityId && driverRes.rows[0]?.operating_entity_id !== req.context.operatingEntityId) {
      return res.status(404).json({ message: 'Compliance item not found' });
    }

    const userId = req.user?.id || null;
    const completed = await completeItem(query, id, userId, {
      reviewerName,
      reviewNotes,
      determination,
      evidenceDocumentId
    });

    if (!completed) {
      return res.status(404).json({ message: 'Compliance item not found' });
    }

    const duration = Date.now() - start;
    dtLogger.trackRequest('POST', `/api/annual-compliance/${id}/complete`, 200, duration);
    return res.json({ message: 'Compliance item completed', item: completed });
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('annual_compliance_complete_failed', error, { itemId: req.params.id });
    dtLogger.trackRequest('POST', `/api/annual-compliance/${req.params.id}/complete`, 500, duration);
    return res.status(500).json({ message: 'Failed to complete compliance item' });
  }
});

/**
 * @openapi
 * /api/annual-compliance/generate/{year}:
 *   post:
 *     summary: Generate annual compliance items for a year
 *     description: Bulk-generates annual compliance items for all drivers in the tenant for the specified year. Admin only. Per 49 CFR 391.25 — Annual inquiry and review of driving record.
 *     tags:
 *       - Compliance
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: year
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 2020
 *           maximum: 2099
 *         description: The compliance year to generate items for
 *     responses:
 *       200:
 *         description: Generation summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       400:
 *         description: Invalid year (must be between 2020 and 2099)
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Tenant context required or insufficient role
 *       500:
 *         description: Server error
 */
// ---------------------------------------------------------------------------
// POST /api/annual-compliance/generate/:year  (admin only)
// ---------------------------------------------------------------------------
router.post('/generate/:year', auth(['admin']), async (req, res) => {
  const start = Date.now();
  try {
    const tenantId = req.context?.tenantId;
    if (!tenantId) {
      return res.status(403).json({ message: 'Tenant context required' });
    }

    const year = parseInt(req.params.year, 10);
    if (!year || year < 2020 || year > 2099) {
      return res.status(400).json({ message: 'Invalid year. Must be between 2020 and 2099.' });
    }

    const summary = await generateAllAnnualItems(query, tenantId, year);

    const duration = Date.now() - start;
    dtLogger.trackRequest('POST', `/api/annual-compliance/generate/${year}`, 200, duration, summary);
    return res.json({ message: 'Annual compliance items generated', ...summary });
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('annual_compliance_generate_failed', error, { year: req.params.year });
    dtLogger.trackRequest('POST', `/api/annual-compliance/generate/${req.params.year}`, 500, duration);
    return res.status(500).json({ message: 'Failed to generate annual compliance items' });
  }
});

module.exports = router;
