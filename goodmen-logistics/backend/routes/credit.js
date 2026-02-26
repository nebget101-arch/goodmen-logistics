const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const creditService = require('../services/credit.service');
const dtLogger = require('../utils/dynatrace-logger');

function requireRole(allowedRoles) {
  return (req, res, next) => {
    const role = (req.user?.role || 'technician').toString().trim().toLowerCase();
    const allowed = allowedRoles.map(r => r.toString().trim().toLowerCase());
    if (!allowed.includes(role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

/**
 * Get customer credit balance
 */
router.get('/:customerId/balance', authMiddleware, async (req, res) => {
  try {
    const balance = await creditService.getCustomerCreditBalance(req.params.customerId);
    res.json({ success: true, data: balance });
  } catch (error) {
    dtLogger.error('credit_balance_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * Check if customer can use credit for invoice
 */
router.post('/:customerId/check', authMiddleware, async (req, res) => {
  try {
    const result = await creditService.canUseCredit(req.params.customerId, req.body.amount);
    res.json({ success: true, data: result });
  } catch (error) {
    dtLogger.error('credit_check_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * Apply invoice to credit
 */
router.post('/:customerId/apply-invoice', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
  try {
    const { invoiceId, amount } = req.body;
    if (!invoiceId || amount === undefined) {
      return res.status(400).json({ error: 'invoiceId and amount are required' });
    }
    const balance = await creditService.applyInvoiceToCredit(
      req.params.customerId,
      invoiceId,
      amount,
      req.user?.id
    );
    res.json({ success: true, data: balance });
  } catch (error) {
    dtLogger.error('credit_apply_invoice_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * Apply payment to credit
 */
router.post('/:customerId/apply-payment', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
  try {
    const { invoiceId, amount, method } = req.body;
    if (!invoiceId || amount === undefined) {
      return res.status(400).json({ error: 'invoiceId and amount are required' });
    }
    const balance = await creditService.applyPaymentToCredit(
      req.params.customerId,
      invoiceId,
      amount,
      method || 'UNKNOWN',
      req.user?.id
    );
    res.json({ success: true, data: balance });
  } catch (error) {
    dtLogger.error('credit_apply_payment_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * Update credit limit
 */
router.put('/:customerId/limit', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
  try {
    const { limit } = req.body;
    if (limit === undefined) {
      return res.status(400).json({ error: 'limit is required' });
    }
    const balance = await creditService.updateCreditLimit(
      req.params.customerId,
      limit,
      req.user?.id
    );
    res.json({ success: true, data: balance });
  } catch (error) {
    dtLogger.error('credit_update_limit_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * Get credit transaction history
 */
router.get('/:customerId/transactions', authMiddleware, async (req, res) => {
  try {
    const result = await creditService.getCreditTransactionHistory(req.params.customerId, req.query);
    res.json({ success: true, ...result });
  } catch (error) {
    dtLogger.error('credit_transactions_failed', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
