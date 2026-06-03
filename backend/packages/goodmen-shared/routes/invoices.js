const express = require('express');
const router = express.Router();
const multer = require('multer');
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/logger');
const db = require('../internal/db').knex;
const invoicesService = require('../services/invoices.service');
const { buildInvoicePdf } = require('../utils/invoice-pdf');
const { uploadBuffer, getSignedDownloadUrl } = require('../storage/r2-storage');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireRole(allowedRoles) {
  return (req, res, next) => {
    const role = (req.user?.role || 'technician').toString().trim().toLowerCase();
    const allowed = allowedRoles.map((r) => r.toString().trim().toLowerCase());
    if (!allowed.includes(role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

/**
 * Manager-only roles: allowed to post, void, and refund on invoices.
 * shop_clerk is intentionally excluded — they may only work on draft invoices.
 * Backward-compat: admin and accounting retain full access.
 */
const INVOICE_MANAGER_ROLES = [
  'admin', 'super_admin',
  'shop_manager',
  'carrier_accountant', 'company_accountant', 'accounting',
];

/**
 * Blocks the request unless the user's role is in INVOICE_MANAGER_ROLES.
 * Used to protect invoice finalization endpoints (post, void, refund).
 */
function requireInvoiceManagerRole() {
  return requireRole(INVOICE_MANAGER_ROLES);
}

const upload = multer({ storage: multer.memoryStorage() });

router.param('id', (req, res, next, id) => {
  if (!UUID_RE.test(String(id || ''))) {
    return res.status(400).json({ error: 'Invalid invoice id' });
  }
  next();
});

/**
 * @openapi
 * /api/invoices/from-work-order/{workOrderId}:
 *   post:
 *     summary: Create invoice from work order
 *     description: >
 *       Generates a draft invoice from a completed work order. Line items are
 *       populated from the work order's parts and labor entries.
 *       Allowed roles: admin, accounting, service_advisor, shop_manager, service_writer, shop_clerk.
 *     tags:
 *       - Invoices
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workOrderId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Work order UUID to generate the invoice from
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               due_date:
 *                 type: string
 *                 format: date
 *                 description: Invoice due date override
 *               notes:
 *                 type: string
 *                 description: Additional notes for the invoice
 *               terms:
 *                 type: string
 *                 description: Payment terms override
 *     responses:
 *       201:
 *         description: Invoice created in draft status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   description: The new invoice object
 *       400:
 *         description: Work order not found, not completed, or already invoiced
 *       401:
 *         description: Unauthorized - missing or invalid token
 *       403:
 *         description: Forbidden - insufficient role
 */
router.post('/from-work-order/:workOrderId', authMiddleware, requireRole(['admin', 'accounting', 'service_advisor', 'shop_manager', 'service_writer', 'shop_clerk']), async (req, res) => {
  try {
    const invoice = await invoicesService.createInvoiceFromWorkOrder(req.params.workOrderId, req.body || {}, req.user?.id, req.context || null);
    res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    dtLogger.error('invoice_from_work_order_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/invoices:
 *   post:
 *     summary: Create a manual invoice
 *     description: >
 *       Creates a new invoice in draft status without an associated work order.
 *       Allowed roles: admin, accounting, shop_manager, service_writer, service_advisor, shop_clerk.
 *     tags:
 *       - Invoices
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - customer_id
 *             properties:
 *               customer_id:
 *                 type: string
 *                 format: uuid
 *                 description: Customer UUID
 *               due_date:
 *                 type: string
 *                 format: date
 *               notes:
 *                 type: string
 *               terms:
 *                 type: string
 *               po_number:
 *                 type: string
 *               line_items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     description:
 *                       type: string
 *                     quantity:
 *                       type: number
 *                     unit_price:
 *                       type: number
 *                     line_type:
 *                       type: string
 *                       enum: [part, labor, fee, discount]
 *     responses:
 *       201:
 *         description: Invoice created in draft status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   description: The new invoice object
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized - missing or invalid token
 *       403:
 *         description: Forbidden - insufficient role
 */
router.post('/', authMiddleware, requireRole(['admin', 'accounting', 'shop_manager', 'service_writer', 'service_advisor', 'shop_clerk']), async (req, res) => {
  try {
    const invoice = await invoicesService.createManualInvoice(req.body || {}, req.user?.id, req.context || null);
    res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    dtLogger.error('invoice_create_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/invoices:
 *   get:
 *     summary: List invoices
 *     description: >
 *       Returns a paginated list of invoices filtered by the caller's tenant context.
 *       Supports query parameters for filtering by status, customer, date range, etc.
 *       Requires authentication.
 *     tags:
 *       - Invoices
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, posted, partially_paid, paid, void]
 *         description: Filter by invoice status
 *       - in: query
 *         name: customer_id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by customer UUID
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 25
 *         description: Items per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by invoice number or customer name
 *     responses:
 *       200:
 *         description: Paginated list of invoices
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
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 *       401:
 *         description: Unauthorized - missing or invalid token
 *       500:
 *         description: Server error
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await invoicesService.listInvoices(req.query || {}, req.context || null);
    res.json({ success: true, ...result });
  } catch (error) {
    dtLogger.error('invoice_list_failed', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/invoices/{id}:
 *   get:
 *     summary: Get invoice by ID
 *     description: >
 *       Returns full invoice details including customer, location, work order,
 *       vehicle, line items, and payments. Requires authentication.
 *     tags:
 *       - Invoices
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice UUID
 *     responses:
 *       200:
 *         description: Invoice details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 invoice:
 *                   type: object
 *                 customer:
 *                   type: object
 *                 location:
 *                   type: object
 *                 workOrder:
 *                   type: object
 *                 vehicle:
 *                   type: object
 *                 lineItems:
 *                   type: array
 *                   items:
 *                     type: object
 *                 payments:
 *                   type: array
 *                   items:
 *                     type: object
 *       404:
 *         description: Invoice not found
 *       401:
 *         description: Unauthorized - missing or invalid token
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const data = await invoicesService.getInvoiceById(req.params.id, req.context || null);
    if (!data) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ success: true, ...data });
  } catch (error) {
    dtLogger.error('invoice_get_failed', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/invoices/{id}:
 *   put:
 *     summary: Update an invoice draft
 *     description: >
 *       Updates fields on a draft invoice. Only draft invoices may be edited.
 *       Posting/voiding is enforced separately via PATCH /:id/status.
 *       Allowed roles: admin, accounting, shop_manager, service_writer, service_advisor, shop_clerk.
 *     tags:
 *       - Invoices
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               customer_id:
 *                 type: string
 *                 format: uuid
 *               due_date:
 *                 type: string
 *                 format: date
 *               notes:
 *                 type: string
 *               terms:
 *                 type: string
 *               po_number:
 *                 type: string
 *     responses:
 *       200:
 *         description: Invoice draft updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   description: Updated invoice object
 *       400:
 *         description: Validation error or invoice is not in draft status
 *       401:
 *         description: Unauthorized - missing or invalid token
 *       403:
 *         description: Forbidden - insufficient role
 */
router.put('/:id', authMiddleware, requireRole(['admin', 'accounting', 'shop_manager', 'service_writer', 'service_advisor', 'shop_clerk']), async (req, res) => {
  try {
    const invoice = await invoicesService.updateInvoiceDraft(req.params.id, req.body || {}, req.user?.id, req.context || null);
    res.json({ success: true, data: invoice });
  } catch (error) {
    dtLogger.error('invoice_update_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/invoices/{id}/status:
 *   patch:
 *     summary: Change invoice status
 *     description: >
 *       Transitions the invoice between lifecycle states.
 *       Valid states: draft, posted, partially_paid, paid, void.
 *       Transitions to "posted" or "void" require a manager role (admin, super_admin,
 *       shop_manager, carrier_accountant, company_accountant, accounting).
 *       Other transitions (e.g. partially_paid to paid) are allowed for any shop role
 *       including shop_clerk.
 *     tags:
 *       - Invoices
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice UUID
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
 *                 enum: [draft, posted, partially_paid, paid, void]
 *                 description: Target invoice status
 *               reason:
 *                 type: string
 *                 description: Reason for status change (required for void)
 *     responses:
 *       200:
 *         description: Invoice status updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   description: Updated invoice object
 *       400:
 *         description: Invalid status transition
 *       401:
 *         description: Unauthorized - missing or invalid token
 *       403:
 *         description: Forbidden - manager role required for post/void transitions
 */
router.patch('/:id/status', authMiddleware,
  requireRole(['admin', 'accounting', 'service_advisor', 'shop_manager', 'service_writer', 'shop_clerk']),
  // Finalize guard: blocks shop_clerk from posting or voiding
  (req, res, next) => {
    const targetStatus = (req.body?.status || '').toString().trim().toLowerCase();
    const FINALIZE_STATUSES = ['posted', 'void'];
    if (!FINALIZE_STATUSES.includes(targetStatus)) return next();
    const role = (req.user?.role || '').toString().trim().toLowerCase();
    if (INVOICE_MANAGER_ROLES.map(r => r.toLowerCase()).includes(role)) return next();
    return res.status(403).json({
      error: 'Forbidden: only managers may post or void invoices',
      targetStatus,
      requiredRoles: INVOICE_MANAGER_ROLES,
    });
  },
  async (req, res) => {
  try {
    const invoice = await invoicesService.setInvoiceStatus(req.params.id, req.body?.status, req.body?.reason, req.user?.id, req.context || null);
    res.json({ success: true, data: invoice });
  } catch (error) {
    dtLogger.error('invoice_status_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/invoices/{id}/line-items:
 *   post:
 *     summary: Add a line item to an invoice
 *     description: >
 *       Adds a new line item (part, labor, fee, or discount) to the invoice.
 *       Allowed roles: admin, accounting, shop_manager, service_writer, service_advisor, shop_clerk.
 *     tags:
 *       - Invoices
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - description
 *               - quantity
 *               - unit_price
 *             properties:
 *               description:
 *                 type: string
 *               quantity:
 *                 type: number
 *               unit_price:
 *                 type: number
 *               tax_rate:
 *                 type: number
 *               line_type:
 *                 type: string
 *                 enum: [part, labor, fee, discount]
 *     responses:
 *       201:
 *         description: Line item created
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
 *         description: Validation error
 *       401:
 *         description: Unauthorized - missing or invalid token
 *       403:
 *         description: Forbidden - insufficient role
 */
router.post('/:id/line-items', authMiddleware, requireRole(['admin', 'accounting', 'shop_manager', 'service_writer', 'service_advisor', 'shop_clerk']), async (req, res) => {
  try {
    const item = await invoicesService.addLineItem(req.params.id, req.body || {}, req.context || null);
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    dtLogger.error('invoice_line_add_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/invoices/{id}/line-items/{lineItemId}:
 *   put:
 *     summary: Update a line item
 *     description: >
 *       Updates an existing line item on the invoice.
 *       Allowed roles: admin, accounting, shop_manager, service_writer, service_advisor, shop_clerk.
 *     tags:
 *       - Invoices
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice UUID
 *       - in: path
 *         name: lineItemId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Line item UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               description:
 *                 type: string
 *               quantity:
 *                 type: number
 *               unit_price:
 *                 type: number
 *               tax_rate:
 *                 type: number
 *               line_type:
 *                 type: string
 *                 enum: [part, labor, fee, discount]
 *     responses:
 *       200:
 *         description: Line item updated
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
 *         description: Validation error
 *       401:
 *         description: Unauthorized - missing or invalid token
 *       403:
 *         description: Forbidden - insufficient role
 */
router.put('/:id/line-items/:lineItemId', authMiddleware, requireRole(['admin', 'accounting', 'shop_manager', 'service_writer', 'service_advisor', 'shop_clerk']), async (req, res) => {
  try {
    const item = await invoicesService.updateLineItem(req.params.id, req.params.lineItemId, req.body || {}, req.context || null);
    res.json({ success: true, data: item });
  } catch (error) {
    dtLogger.error('invoice_line_update_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/invoices/{id}/line-items/{lineItemId}:
 *   delete:
 *     summary: Delete a line item
 *     description: >
 *       Removes a line item from the invoice. Manager-only: requires admin, super_admin,
 *       shop_manager, carrier_accountant, company_accountant, or accounting role.
 *       shop_clerk is explicitly blocked.
 *     tags:
 *       - Invoices
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice UUID
 *       - in: path
 *         name: lineItemId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Line item UUID
 *     responses:
 *       200:
 *         description: Line item deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       400:
 *         description: Invalid request or line item not found
 *       401:
 *         description: Unauthorized - missing or invalid token
 *       403:
 *         description: Forbidden - manager role required
 */
router.delete('/:id/line-items/:lineItemId', authMiddleware, requireInvoiceManagerRole(), async (req, res) => {
  try {
    await invoicesService.deleteLineItem(req.params.id, req.params.lineItemId, req.context || null);
    res.json({ success: true });
  } catch (error) {
    dtLogger.error('invoice_line_delete_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/invoices/{id}/payments:
 *   post:
 *     summary: Add a payment to an invoice
 *     description: >
 *       Records a payment against the invoice. The invoice status may transition
 *       to partially_paid or paid automatically depending on the remaining balance.
 *       Allowed roles: admin, accounting, shop_manager, service_writer, service_advisor, shop_clerk.
 *     tags:
 *       - Invoices
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - payment_method
 *             properties:
 *               amount:
 *                 type: number
 *                 description: Payment amount
 *               payment_method:
 *                 type: string
 *                 description: Payment method (e.g. cash, check, card)
 *               payment_date:
 *                 type: string
 *                 format: date-time
 *                 description: Date of payment (defaults to now)
 *               reference_number:
 *                 type: string
 *                 description: Check number or transaction reference
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Payment recorded and invoice updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   description: Updated invoice object
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized - missing or invalid token
 *       403:
 *         description: Forbidden - insufficient role
 */
router.post('/:id/payments', authMiddleware, requireRole(['admin', 'accounting', 'shop_manager', 'service_writer', 'service_advisor', 'shop_clerk']), async (req, res) => {
  try {
    const invoice = await invoicesService.addPayment(req.params.id, req.body || {}, req.user?.id, req.context || null);
    res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    dtLogger.error('invoice_payment_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/invoices/{id}/payments:
 *   get:
 *     summary: List payments for an invoice
 *     description: Returns all payments recorded against the invoice, ordered by payment date descending. Requires authentication.
 *     tags:
 *       - Invoices
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice UUID
 *     responses:
 *       200:
 *         description: Array of payment records
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
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       invoice_id:
 *                         type: string
 *                         format: uuid
 *                       amount:
 *                         type: number
 *                       payment_method:
 *                         type: string
 *                       payment_date:
 *                         type: string
 *                         format: date-time
 *       404:
 *         description: Invoice not found
 *       401:
 *         description: Unauthorized - missing or invalid token
 */
router.get('/:id/payments', authMiddleware, async (req, res) => {
  try {
    const invoice = await db('invoices')
      .where({ id: req.params.id })
      .modify((qb) => {
        if (req.context?.tenantId) qb.andWhere('tenant_id', req.context.tenantId);
        if (req.context?.operatingEntityId) qb.andWhere('operating_entity_id', req.context.operatingEntityId);
      })
      .first();
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const payments = await db('invoice_payments').where({ invoice_id: req.params.id }).orderBy('payment_date', 'desc');
    res.json({ success: true, data: payments });
  } catch (error) {
    dtLogger.error('invoice_payments_get_failed', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/invoices/{id}/payments/{paymentId}:
 *   delete:
 *     summary: Delete payment / refund
 *     description: >
 *       Deletes a payment record from the invoice (refund action). Manager-only: requires
 *       admin, super_admin, shop_manager, carrier_accountant, company_accountant, or accounting role.
 *       shop_clerk is explicitly blocked.
 *     tags:
 *       - Invoices
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice UUID
 *       - in: path
 *         name: paymentId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Payment UUID
 *     responses:
 *       200:
 *         description: Payment deleted and invoice totals recalculated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   description: Updated invoice object
 *       400:
 *         description: Invalid request or payment not found
 *       401:
 *         description: Unauthorized - missing or invalid token
 *       403:
 *         description: Forbidden - manager role required
 */
router.delete('/:id/payments/:paymentId', authMiddleware, requireInvoiceManagerRole(), async (req, res) => {
  try {
    const invoice = await invoicesService.deletePayment(req.params.id, req.params.paymentId, req.context || null);
    res.json({ success: true, data: invoice });
  } catch (error) {
    dtLogger.error('invoice_payment_delete_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/invoices/{id}/pdf:
 *   post:
 *     summary: Generate invoice PDF
 *     description: >
 *       Generates a PDF for the invoice, uploads it to cloud storage, and returns a signed download URL.
 *       Allowed roles: admin, accounting, service_advisor.
 *     tags:
 *       - Invoices
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice UUID
 *     responses:
 *       200:
 *         description: PDF generated and stored successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   description: Invoice document record
 *                 downloadUrl:
 *                   type: string
 *                   format: uri
 *       404:
 *         description: Invoice not found
 *       401:
 *         description: Unauthorized - missing or invalid token
 *       403:
 *         description: Forbidden - insufficient role
 *       500:
 *         description: PDF generation or upload failed
 */
router.post('/:id/pdf', authMiddleware, requireRole(['admin', 'accounting', 'service_advisor']), async (req, res) => {
  try {
    const data = await invoicesService.getInvoiceById(req.params.id, req.context || null);
    if (!data) return res.status(404).json({ error: 'Invoice not found' });

    const pdfBuffer = await buildInvoicePdf({
      invoice: data.invoice,
      customer: data.customer,
      location: data.location,
      workOrder: data.workOrder,
      vehicle: data.vehicle,
      lineItems: data.lineItems,
      payments: data.payments
    });

    const fileName = `${data.invoice.invoice_number}.pdf`;
    const { key: storageKey } = await uploadBuffer({
      buffer: pdfBuffer,
      contentType: 'application/pdf',
      prefix: `invoices/${data.invoice.id}`,
      fileName
    });

    const [doc] = await db('invoice_documents').insert({
      invoice_id: data.invoice.id,
      doc_type: 'INVOICE_PDF',
      file_name: fileName,
      mime_type: 'application/pdf',
      file_size_bytes: pdfBuffer.length,
      storage_key: storageKey,
      uploaded_by_user_id: req.user?.id || null
    }).returning('*');

    const downloadUrl = await getSignedDownloadUrl(storageKey);
    res.json({ success: true, data: doc, downloadUrl });
  } catch (error) {
    dtLogger.error('invoice_pdf_failed', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/invoices/{id}/pdf:
 *   get:
 *     summary: Get latest invoice PDF
 *     description: Returns the most recently generated PDF for the invoice, with a signed download URL. Requires authentication.
 *     tags:
 *       - Invoices
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice UUID
 *     responses:
 *       200:
 *         description: PDF document metadata and signed download URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                 downloadUrl:
 *                   type: string
 *                   format: uri
 *       404:
 *         description: PDF not found for this invoice
 *       401:
 *         description: Unauthorized - missing or invalid token
 */
router.get('/:id/pdf', authMiddleware, async (req, res) => {
  try {
    const doc = await db('invoice_documents')
      .where({ invoice_id: req.params.id, doc_type: 'INVOICE_PDF' })
      .orderBy('created_at', 'desc')
      .first();

    if (!doc) return res.status(404).json({ error: 'PDF not found' });
    const downloadUrl = await getSignedDownloadUrl(doc.storage_key);
    res.json({ success: true, data: doc, downloadUrl });
  } catch (error) {
    dtLogger.error('invoice_pdf_get_failed', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/invoices/{id}/documents:
 *   post:
 *     summary: Upload a supporting document
 *     description: >
 *       Upload a supporting document (e.g. receipt, photo) to an invoice.
 *       Allowed roles: admin, accounting, service_advisor, shop_manager, service_writer, shop_clerk.
 *     tags:
 *       - Invoices
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice UUID
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
 *                 description: The file to upload
 *     responses:
 *       201:
 *         description: Document uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                 downloadUrl:
 *                   type: string
 *                   format: uri
 *       400:
 *         description: File is required
 *       404:
 *         description: Invoice not found
 *       401:
 *         description: Unauthorized - missing or invalid token
 *       403:
 *         description: Forbidden - insufficient role
 */
router.post('/:id/documents', authMiddleware, requireRole(['admin', 'accounting', 'service_advisor', 'shop_manager', 'service_writer', 'shop_clerk']), upload.single('file'), async (req, res) => {
  try {
    const invoice = await db('invoices')
      .where({ id: req.params.id })
      .modify((qb) => {
        if (req.context?.tenantId) qb.andWhere('tenant_id', req.context.tenantId);
        if (req.context?.operatingEntityId) qb.andWhere('operating_entity_id', req.context.operatingEntityId);
      })
      .first();
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const file = req.file;
    if (!file) return res.status(400).json({ error: 'File is required' });

    const safeName = file.originalname ? file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_') : file.originalname;
    const { key: storageKey } = await uploadBuffer({
      buffer: file.buffer,
      contentType: file.mimetype,
      prefix: `invoices/${req.params.id}`,
      fileName: safeName
    });
    const [doc] = await db('invoice_documents').insert({
      invoice_id: req.params.id,
      doc_type: 'SUPPORTING',
      file_name: file.originalname,
      mime_type: file.mimetype,
      file_size_bytes: file.size,
      storage_key: storageKey,
      uploaded_by_user_id: req.user?.id || null
    }).returning('*');

    const downloadUrl = await getSignedDownloadUrl(storageKey);
    res.status(201).json({ success: true, data: doc, downloadUrl });
  } catch (error) {
    dtLogger.error('invoice_document_upload_failed', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/invoices/{id}/documents:
 *   get:
 *     summary: List invoice documents
 *     description: Returns all documents attached to an invoice, each with a signed download URL. Requires authentication.
 *     tags:
 *       - Invoices
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice UUID
 *     responses:
 *       200:
 *         description: Array of invoice documents with download URLs
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
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       invoice_id:
 *                         type: string
 *                         format: uuid
 *                       doc_type:
 *                         type: string
 *                       file_name:
 *                         type: string
 *                       mime_type:
 *                         type: string
 *                       file_size_bytes:
 *                         type: integer
 *                       downloadUrl:
 *                         type: string
 *                         format: uri
 *                         nullable: true
 *       404:
 *         description: Invoice not found
 *       401:
 *         description: Unauthorized - missing or invalid token
 */
router.get('/:id/documents', authMiddleware, async (req, res) => {
  try {
    const invoice = await db('invoices')
      .where({ id: req.params.id })
      .modify((qb) => {
        if (req.context?.tenantId) qb.andWhere('tenant_id', req.context.tenantId);
        if (req.context?.operatingEntityId) qb.andWhere('operating_entity_id', req.context.operatingEntityId);
      })
      .first();
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const docs = await db('invoice_documents').where({ invoice_id: req.params.id }).orderBy('created_at', 'desc');
    const data = await Promise.all(
      docs.map(async doc => ({
        ...doc,
        downloadUrl: doc.storage_key ? await getSignedDownloadUrl(doc.storage_key) : null
      }))
    );
    res.json({ success: true, data });
  } catch (error) {
    dtLogger.error('invoice_documents_get_failed', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/invoices/{id}/documents/{docId}/download:
 *   get:
 *     summary: Download an invoice document
 *     description: Returns a signed download URL for a specific document attached to the invoice. Requires authentication.
 *     tags:
 *       - Invoices
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice UUID
 *       - in: path
 *         name: docId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Document UUID
 *     responses:
 *       200:
 *         description: Signed download URL for the document
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 downloadUrl:
 *                   type: string
 *                   format: uri
 *       404:
 *         description: Invoice or document not found
 *       401:
 *         description: Unauthorized - missing or invalid token
 */
router.get('/:id/documents/:docId/download', authMiddleware, async (req, res) => {
  try {
    const invoice = await db('invoices')
      .where({ id: req.params.id })
      .modify((qb) => {
        if (req.context?.tenantId) qb.andWhere('tenant_id', req.context.tenantId);
        if (req.context?.operatingEntityId) qb.andWhere('operating_entity_id', req.context.operatingEntityId);
      })
      .first();
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const doc = await db('invoice_documents').where({ id: req.params.docId, invoice_id: req.params.id }).first();
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const downloadUrl = await getSignedDownloadUrl(doc.storage_key);
    res.json({ success: true, downloadUrl });
  } catch (error) {
    dtLogger.error('invoice_document_download_failed', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
