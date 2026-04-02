const express = require('express');
const axios = require('axios');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const { loadUserRbac, requirePermission } = require('../middleware/rbac-middleware');
const dtLogger = require('../utils/logger');
const customersService = require('../services/customers.service');

const rbac = [authMiddleware, loadUserRbac];

/**
 * @openapi
 * /api/shop-clients/fmcsainfo/{dot}:
 *   get:
 *     summary: Look up carrier by DOT number
 *     description: Queries the FMCSA public API and returns normalised carrier contact details for the given DOT number.
 *     tags:
 *       - Shop Clients
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: dot
 *         required: true
 *         schema:
 *           type: string
 *         description: USDOT number of the carrier
 *     responses:
 *       200:
 *         description: Carrier info returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 name:
 *                   type: string
 *                 dot_number:
 *                   type: string
 *                 address:
 *                   type: string
 *                 city:
 *                   type: string
 *                 state:
 *                   type: string
 *                 zip:
 *                   type: string
 *                 phone:
 *                   type: string
 *                 email:
 *                   type: string
 *       404:
 *         description: Company not found
 *       500:
 *         description: Failed to fetch FMCSA info
 */
router.get('/fmcsainfo/:dot', ...rbac, requirePermission('shop_clients.read'), async (req, res) => {
  try {
    const url = `https://mobile.fmcsa.dot.gov/qc/services/carriers/${req.params.dot}?webKey=94c7ff4bde4f4531bec510f7d3c4100d99f02350`;
    const response = await axios.get(url);
    const carrier = response.data?.content?.carrier;
    if (!carrier) return res.status(404).json({ error: 'Company not found' });
    res.json({
      name: carrier.legalName || carrier.dbaName || '',
      dot_number: carrier.dotNumber || '',
      address: carrier.phyStreet || '',
      city: carrier.phyCity || '',
      state: carrier.phyState || '',
      zip: carrier.phyZipcode || '',
      phone: '',
      email: ''
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch FMCSA info' });
  }
});

/**
 * @openapi
 * /api/shop-clients:
 *   post:
 *     summary: Create a shop client
 *     description: Creates a new shop client (customer) record. Validates input via the customers service.
 *     tags:
 *       - Shop Clients
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               company_name:
 *                 type: string
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               customer_type:
 *                 type: string
 *                 enum: [FLEET, WALK_IN, INTERNAL, WARRANTY]
 *               dot_number:
 *                 type: string
 *               address:
 *                 type: string
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *               zip:
 *                 type: string
 *               payment_terms:
 *                 type: string
 *               credit_limit:
 *                 type: number
 *               tax_exempt:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Shop client created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       400:
 *         description: Validation failed
 *       500:
 *         description: Server error
 */
router.post('/', ...rbac, requirePermission('shop_clients.write'), async (req, res) => {
  try {
    const { customer, errors } = await customersService.createCustomer(req.body, req.user?.id);
    if (errors) return res.status(400).json({ error: 'Validation failed', details: errors });
    res.status(201).json({ success: true, data: customer });
  } catch (error) {
    dtLogger.error('shop_client_create_failed', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/shop-clients:
 *   get:
 *     summary: List shop clients
 *     description: Returns a paginated list of shop clients with optional search, type, status, location, DOT, and payment terms filters.
 *     tags:
 *       - Shop Clients
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Free-text search across name, email, company
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Customer type filter (FLEET, WALK_IN, INTERNAL, WARRANTY)
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Status filter (ACTIVE, INACTIVE)
 *       - in: query
 *         name: locationId
 *         schema:
 *           type: string
 *         description: Default location UUID filter
 *       - in: query
 *         name: dot
 *         schema:
 *           type: string
 *         description: DOT number filter
 *       - in: query
 *         name: paymentTerms
 *         schema:
 *           type: string
 *         description: Payment terms filter
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *         description: Items per page
 *     responses:
 *       200:
 *         description: Paginated shop client list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                 total:
 *                   type: integer
 *       500:
 *         description: Server error
 */
router.get('/', ...rbac, requirePermission('shop_clients.read'), async (req, res) => {
  try {
    const { search, type, status, locationId, page, pageSize, dot, paymentTerms } = req.query;
    const result = await customersService.listCustomers({ search, type, status, locationId, page, pageSize, dot, paymentTerms });
    res.json({ success: true, ...result });
  } catch (error) {
    dtLogger.error('customers_list_failed', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/shop-clients/{id}:
 *   get:
 *     summary: Get a shop client by ID
 *     description: Returns full details of a single shop client including pricing rules and effective pricing.
 *     tags:
 *       - Shop Clients
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Shop client UUID
 *     responses:
 *       200:
 *         description: Shop client details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       404:
 *         description: Shop client not found
 *       500:
 *         description: Server error
 */
router.get('/:id', ...rbac, requirePermission('shop_clients.read'), async (req, res) => {
  try {
    const data = await customersService.getCustomerById(req.params.id);
    if (!data) return res.status(404).json({ error: 'Shop client not found' });
    res.json({ success: true, ...data });
  } catch (error) {
    dtLogger.error('shop_client_get_failed', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/shop-clients/{id}:
 *   put:
 *     summary: Update a shop client
 *     description: Updates an existing shop client record. Validates input via the customers service.
 *     tags:
 *       - Shop Clients
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Shop client UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               company_name:
 *                 type: string
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               customer_type:
 *                 type: string
 *               dot_number:
 *                 type: string
 *               address:
 *                 type: string
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *               zip:
 *                 type: string
 *               payment_terms:
 *                 type: string
 *               credit_limit:
 *                 type: number
 *               tax_exempt:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Shop client updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       400:
 *         description: Validation failed
 *       404:
 *         description: Shop client not found
 *       500:
 *         description: Server error
 */
router.put('/:id', ...rbac, requirePermission('shop_clients.write'), async (req, res) => {
  try {
    const { customer, errors, error } = await customersService.updateCustomer(req.params.id, req.body, req.user?.id);
    if (errors) return res.status(400).json({ error: 'Validation failed', details: errors });
    if (error) return res.status(404).json({ error });
    res.json({ success: true, data: customer });
  } catch (err) {
    dtLogger.error('shop_client_update_failed', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/shop-clients/{id}/status:
 *   patch:
 *     summary: Update shop client status
 *     description: Sets the status of a shop client (e.g. ACTIVE, INACTIVE).
 *     tags:
 *       - Shop Clients
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Shop client UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [ACTIVE, INACTIVE]
 *     responses:
 *       200:
 *         description: Status updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       400:
 *         description: Invalid status or client error
 *       500:
 *         description: Server error
 */
router.patch('/:id/status', ...rbac, requirePermission('shop_clients.write'), async (req, res) => {
  try {
    const { status } = req.body;
    const { customer, error } = await customersService.setCustomerStatus(req.params.id, status, req.user?.id);
    if (error) return res.status(400).json({ error });
    res.json({ success: true, data: customer });
  } catch (err) {
    dtLogger.error('shop_client_status_failed', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/shop-clients/{id}:
 *   delete:
 *     summary: Soft-delete a shop client
 *     description: Marks a shop client as deleted (soft delete). The record is retained but hidden from normal queries.
 *     tags:
 *       - Shop Clients
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Shop client UUID
 *     responses:
 *       200:
 *         description: Shop client soft-deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       404:
 *         description: Shop client not found
 *       500:
 *         description: Server error
 */
router.delete('/:id', ...rbac, requirePermission('shop_clients.write'), async (req, res) => {
  try {
    const { customer, error } = await customersService.softDeleteCustomer(req.params.id, req.user?.id);
    if (error) return res.status(404).json({ error });
    res.json({ success: true, data: customer });
  } catch (err) {
    dtLogger.error('shop_client_delete_failed', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/shop-clients/{id}/notes:
 *   post:
 *     summary: Add a note to a shop client
 *     description: Creates a new note attached to the specified shop client.
 *     tags:
 *       - Shop Clients
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Shop client UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               text:
 *                 type: string
 *                 description: Note content
 *     responses:
 *       201:
 *         description: Note created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       400:
 *         description: Invalid note data
 *       500:
 *         description: Server error
 */
router.post('/:id/notes', ...rbac, requirePermission('shop_clients.write'), async (req, res) => {
  try {
    const { note, error } = await customersService.addNote(req.params.id, req.body, req.user?.id);
    if (error) return res.status(400).json({ error });
    res.status(201).json({ success: true, data: note });
  } catch (err) {
    dtLogger.error('shop_client_note_create_failed', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/shop-clients/{id}/notes:
 *   get:
 *     summary: Get notes for a shop client
 *     description: Returns all notes associated with the specified shop client.
 *     tags:
 *       - Shop Clients
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Shop client UUID
 *     responses:
 *       200:
 *         description: Notes list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Server error
 */
router.get('/:id/notes', ...rbac, requirePermission('shop_clients.read'), async (req, res) => {
  try {
    const notes = await customersService.getNotes(req.params.id);
    res.json({ success: true, data: notes });
  } catch (err) {
    dtLogger.error('shop_client_notes_get_failed', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/shop-clients/{id}/pricing:
 *   get:
 *     summary: Get pricing rules for a shop client
 *     description: Returns the pricing rule and effective pricing for the specified shop client.
 *     tags:
 *       - Shop Clients
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Shop client UUID
 *     responses:
 *       200:
 *         description: Pricing data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     pricingRule:
 *                       type: object
 *                     effectivePricing:
 *                       type: object
 *       404:
 *         description: Shop client not found
 *       500:
 *         description: Server error
 */
router.get('/:id/pricing', ...rbac, requirePermission('shop_clients.read'), async (req, res) => {
  try {
    const data = await customersService.getCustomerById(req.params.id);
    if (!data) return res.status(404).json({ error: 'Shop client not found' });
    res.json({ success: true, data: { pricingRule: data.pricingRule, effectivePricing: data.effectivePricing } });
  } catch (err) {
    dtLogger.error('shop_client_pricing_get_failed', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/shop-clients/{id}/pricing:
 *   put:
 *     summary: Upsert pricing rules for a shop client
 *     description: Creates or updates the pricing rules for the specified shop client.
 *     tags:
 *       - Shop Clients
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Shop client UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Pricing rule configuration
 *     responses:
 *       200:
 *         description: Pricing rules saved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       500:
 *         description: Server error
 */
router.put('/:id/pricing', ...rbac, requirePermission('shop_clients.write'), async (req, res) => {
  try {
    const pricing = await customersService.upsertPricingRules(req.params.id, req.body, req.user?.id);
    res.json({ success: true, data: pricing });
  } catch (err) {
    dtLogger.error('shop_client_pricing_update_failed', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/shop-clients/{id}/work-orders:
 *   get:
 *     summary: Get work orders for a shop client
 *     description: Returns a paginated list of work orders associated with the specified shop client, with optional status and date range filters.
 *     tags:
 *       - Shop Clients
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Shop client UUID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Work order status filter
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date filter (inclusive)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         description: End date filter (inclusive)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Paginated work order list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                 total:
 *                   type: integer
 *       500:
 *         description: Server error
 */
router.get('/:id/work-orders', ...rbac, requirePermission('shop_clients.read'), async (req, res) => {
  try {
    const { status, from, to, page, pageSize } = req.query;
    const result = await customersService.getCustomerWorkOrders(req.params.id, { status, from, to, page, pageSize });
    res.json({ success: true, ...result });
  } catch (err) {
    dtLogger.error('shop_client_work_orders_failed', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/shop-clients/{id}/service-history:
 *   get:
 *     summary: Get service history for a shop client
 *     description: Returns a paginated service history for the specified shop client, with optional date range filters.
 *     tags:
 *       - Shop Clients
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Shop client UUID
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date filter (inclusive)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         description: End date filter (inclusive)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Paginated service history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                 total:
 *                   type: integer
 *       500:
 *         description: Server error
 */
router.get('/:id/service-history', ...rbac, requirePermission('shop_clients.read'), async (req, res) => {
  try {
    const { from, to, page, pageSize } = req.query;
    const result = await customersService.getCustomerServiceHistory(req.params.id, { from, to, page, pageSize });
    res.json({ success: true, ...result });
  } catch (err) {
    dtLogger.error('shop_client_service_history_failed', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/shop-clients/{id}/vehicles:
 *   get:
 *     summary: Get vehicles for a shop client
 *     description: Returns a paginated list of vehicles associated with the specified shop client.
 *     tags:
 *       - Shop Clients
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Shop client UUID
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Paginated vehicle list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                 total:
 *                   type: integer
 *       500:
 *         description: Server error
 */
router.get('/:id/vehicles', ...rbac, requirePermission('shop_clients.read'), async (req, res) => {
  try {
    const { page, pageSize } = req.query;
    const result = await customersService.getCustomerVehicles(req.params.id, { page, pageSize });
    res.json({ success: true, ...result });
  } catch (err) {
    dtLogger.error('shop_client_vehicles_failed', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
