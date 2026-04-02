const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const creditService = require('../services/credit.service');
const dtLogger = require('../utils/logger');

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
 * @openapi
 * /api/credit/{customerId}/balance:
 *   get:
 *     summary: Get customer credit balance
 *     description: Returns the current credit balance, limit, and available credit for a customer.
 *     tags:
 *       - Credit
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Credit balance details
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
 *         description: Bad request
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
 * @openapi
 * /api/credit/{customerId}/check:
 *   post:
 *     summary: Check if customer can use credit for an invoice
 *     description: Validates whether the customer has sufficient credit balance to cover the specified amount.
 *     tags:
 *       - Credit
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *             properties:
 *               amount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Credit check result
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
 *         description: Bad request
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
 * @openapi
 * /api/credit/{customerId}/apply-invoice:
 *   post:
 *     summary: Apply an invoice charge to customer credit
 *     description: Deducts the specified amount from the customer's credit balance for a given invoice. Requires admin or accounting role.
 *     tags:
 *       - Credit
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - invoiceId
 *               - amount
 *             properties:
 *               invoiceId:
 *                 type: string
 *                 format: uuid
 *               amount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Updated credit balance
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
 *         description: Missing required fields or bad request
 *       403:
 *         description: Forbidden — insufficient role
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
 * @openapi
 * /api/credit/{customerId}/apply-payment:
 *   post:
 *     summary: Apply a payment to customer credit
 *     description: Records a payment against the customer's credit balance for a given invoice. Requires admin or accounting role.
 *     tags:
 *       - Credit
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - invoiceId
 *               - amount
 *             properties:
 *               invoiceId:
 *                 type: string
 *                 format: uuid
 *               amount:
 *                 type: number
 *               method:
 *                 type: string
 *                 description: Payment method (defaults to UNKNOWN)
 *     responses:
 *       200:
 *         description: Updated credit balance
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
 *         description: Missing required fields or bad request
 *       403:
 *         description: Forbidden — insufficient role
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
 * @openapi
 * /api/credit/{customerId}/limit:
 *   put:
 *     summary: Update customer credit limit
 *     description: Sets a new credit limit for the customer. Requires admin or accounting role.
 *     tags:
 *       - Credit
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - limit
 *             properties:
 *               limit:
 *                 type: number
 *     responses:
 *       200:
 *         description: Updated credit balance
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
 *         description: Missing limit or bad request
 *       403:
 *         description: Forbidden — insufficient role
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
 * @openapi
 * /api/credit/{customerId}/transactions:
 *   get:
 *     summary: Get credit transaction history
 *     description: Returns the paginated history of credit transactions (charges, payments, adjustments) for a customer.
 *     tags:
 *       - Credit
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Transaction history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       500:
 *         description: Server error
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
