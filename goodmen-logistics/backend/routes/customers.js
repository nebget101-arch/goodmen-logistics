const express = require('express');
const axios = require('axios');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/dynatrace-logger');
const customersService = require('../services/customers.service');

function requireRole(allowedRoles) {
  return (req, res, next) => {
    const role = req.user?.role || 'technician';
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

// FMCSA lookup
router.get('/fmcsainfo/:dot', authMiddleware, async (req, res) => {
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

// POST /api/customers
router.post('/', authMiddleware, requireRole(['admin', 'service_advisor', 'accounting']), async (req, res) => {
  try {
    const { customer, errors } = await customersService.createCustomer(req.body, req.user?.id);
    if (errors) return res.status(400).json({ error: 'Validation failed', details: errors });
    res.status(201).json({ success: true, data: customer });
  } catch (error) {
    dtLogger.error('customer_create_failed', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/customers
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { search, type, status, locationId, page, pageSize, dot, paymentTerms } = req.query;
    const result = await customersService.listCustomers({ search, type, status, locationId, page, pageSize, dot, paymentTerms });
    res.json({ success: true, ...result });
  } catch (error) {
    dtLogger.error('customers_list_failed', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/customers/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const data = await customersService.getCustomerById(req.params.id);
    if (!data) return res.status(404).json({ error: 'Customer not found' });
    res.json({ success: true, ...data });
  } catch (error) {
    dtLogger.error('customer_get_failed', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/customers/:id
router.put('/:id', authMiddleware, requireRole(['admin', 'service_advisor', 'accounting']), async (req, res) => {
  try {
    const { customer, errors, error } = await customersService.updateCustomer(req.params.id, req.body, req.user?.id);
    if (errors) return res.status(400).json({ error: 'Validation failed', details: errors });
    if (error) return res.status(404).json({ error });
    res.json({ success: true, data: customer });
  } catch (err) {
    dtLogger.error('customer_update_failed', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/customers/:id/status
router.patch('/:id/status', authMiddleware, requireRole(['admin', 'service_advisor', 'accounting']), async (req, res) => {
  try {
    const { status } = req.body;
    const { customer, error } = await customersService.setCustomerStatus(req.params.id, status, req.user?.id);
    if (error) return res.status(400).json({ error });
    res.json({ success: true, data: customer });
  } catch (err) {
    dtLogger.error('customer_status_failed', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/customers/:id (soft delete)
router.delete('/:id', authMiddleware, requireRole(['admin']), async (req, res) => {
  try {
    const { customer, error } = await customersService.softDeleteCustomer(req.params.id, req.user?.id);
    if (error) return res.status(404).json({ error });
    res.json({ success: true, data: customer });
  } catch (err) {
    dtLogger.error('customer_delete_failed', err);
    res.status(500).json({ error: err.message });
  }
});

// Notes
router.post('/:id/notes', authMiddleware, requireRole(['admin', 'service_advisor', 'accounting']), async (req, res) => {
  try {
    const { note, error } = await customersService.addNote(req.params.id, req.body, req.user?.id);
    if (error) return res.status(400).json({ error });
    res.status(201).json({ success: true, data: note });
  } catch (err) {
    dtLogger.error('customer_note_create_failed', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/notes', authMiddleware, async (req, res) => {
  try {
    const notes = await customersService.getNotes(req.params.id);
    res.json({ success: true, data: notes });
  } catch (err) {
    dtLogger.error('customer_notes_get_failed', err);
    res.status(500).json({ error: err.message });
  }
});

// Pricing
router.get('/:id/pricing', authMiddleware, async (req, res) => {
  try {
    const data = await customersService.getCustomerById(req.params.id);
    if (!data) return res.status(404).json({ error: 'Customer not found' });
    res.json({ success: true, data: { pricingRule: data.pricingRule, effectivePricing: data.effectivePricing } });
  } catch (err) {
    dtLogger.error('customer_pricing_get_failed', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/pricing', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
  try {
    const pricing = await customersService.upsertPricingRules(req.params.id, req.body, req.user?.id);
    res.json({ success: true, data: pricing });
  } catch (err) {
    dtLogger.error('customer_pricing_update_failed', err);
    res.status(500).json({ error: err.message });
  }
});

// History
router.get('/:id/work-orders', authMiddleware, async (req, res) => {
  try {
    const { status, from, to, page, pageSize } = req.query;
    const result = await customersService.getCustomerWorkOrders(req.params.id, { status, from, to, page, pageSize });
    res.json({ success: true, ...result });
  } catch (err) {
    dtLogger.error('customer_work_orders_failed', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/service-history', authMiddleware, async (req, res) => {
  try {
    const { from, to, page, pageSize } = req.query;
    const result = await customersService.getCustomerServiceHistory(req.params.id, { from, to, page, pageSize });
    res.json({ success: true, ...result });
  } catch (err) {
    dtLogger.error('customer_service_history_failed', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
