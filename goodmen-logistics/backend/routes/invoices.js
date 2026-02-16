const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/dynatrace-logger');
const db = require('../config/knex');
const invoicesService = require('../services/invoices.service');
const { buildInvoicePdf } = require('../utils/invoice-pdf');
const { saveBuffer, ensureDirs } = require('../storage/local-storage');

function requireRole(allowedRoles) {
  return (req, res, next) => {
    const role = req.user?.role || 'technician';
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

ensureDirs();
const upload = multer({ dest: path.join(__dirname, '..', 'uploads', 'invoices') });

router.post('/from-work-order/:workOrderId', authMiddleware, requireRole(['admin', 'accounting', 'service_advisor']), async (req, res) => {
  try {
    const invoice = await invoicesService.createInvoiceFromWorkOrder(req.params.workOrderId, req.body || {}, req.user?.id);
    res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    dtLogger.error('invoice_from_work_order_failed', error);
    res.status(400).json({ error: error.message });
  }
});

router.post('/', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
  try {
    const invoice = await invoicesService.createManualInvoice(req.body || {}, req.user?.id);
    res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    dtLogger.error('invoice_create_failed', error);
    res.status(400).json({ error: error.message });
  }
});

router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await invoicesService.listInvoices(req.query || {});
    res.json({ success: true, ...result });
  } catch (error) {
    dtLogger.error('invoice_list_failed', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const data = await invoicesService.getInvoiceById(req.params.id);
    if (!data) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ success: true, ...data });
  } catch (error) {
    dtLogger.error('invoice_get_failed', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
  try {
    const invoice = await invoicesService.updateInvoiceDraft(req.params.id, req.body || {}, req.user?.id);
    res.json({ success: true, data: invoice });
  } catch (error) {
    dtLogger.error('invoice_update_failed', error);
    res.status(400).json({ error: error.message });
  }
});

router.patch('/:id/status', authMiddleware, requireRole(['admin', 'accounting', 'service_advisor']), async (req, res) => {
  try {
    const invoice = await invoicesService.setInvoiceStatus(req.params.id, req.body?.status, req.body?.reason, req.user?.id);
    res.json({ success: true, data: invoice });
  } catch (error) {
    dtLogger.error('invoice_status_failed', error);
    res.status(400).json({ error: error.message });
  }
});

// Line items (optional)
router.post('/:id/line-items', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
  try {
    const item = await invoicesService.addLineItem(req.params.id, req.body || {});
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    dtLogger.error('invoice_line_add_failed', error);
    res.status(400).json({ error: error.message });
  }
});

router.put('/:id/line-items/:lineItemId', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
  try {
    const item = await invoicesService.updateLineItem(req.params.id, req.params.lineItemId, req.body || {});
    res.json({ success: true, data: item });
  } catch (error) {
    dtLogger.error('invoice_line_update_failed', error);
    res.status(400).json({ error: error.message });
  }
});

router.delete('/:id/line-items/:lineItemId', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
  try {
    await invoicesService.deleteLineItem(req.params.id, req.params.lineItemId);
    res.json({ success: true });
  } catch (error) {
    dtLogger.error('invoice_line_delete_failed', error);
    res.status(400).json({ error: error.message });
  }
});

// Payments
router.post('/:id/payments', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
  try {
    const invoice = await invoicesService.addPayment(req.params.id, req.body || {}, req.user?.id);
    res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    dtLogger.error('invoice_payment_failed', error);
    res.status(400).json({ error: error.message });
  }
});

router.get('/:id/payments', authMiddleware, async (req, res) => {
  try {
    const payments = await db('invoice_payments').where({ invoice_id: req.params.id }).orderBy('payment_date', 'desc');
    res.json({ success: true, data: payments });
  } catch (error) {
    dtLogger.error('invoice_payments_get_failed', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id/payments/:paymentId', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
  try {
    const invoice = await invoicesService.deletePayment(req.params.id, req.params.paymentId);
    res.json({ success: true, data: invoice });
  } catch (error) {
    dtLogger.error('invoice_payment_delete_failed', error);
    res.status(400).json({ error: error.message });
  }
});

// PDF
router.post('/:id/pdf', authMiddleware, requireRole(['admin', 'accounting', 'service_advisor']), async (req, res) => {
  try {
    const data = await invoicesService.getInvoiceById(req.params.id);
    if (!data) return res.status(404).json({ error: 'Invoice not found' });

    const customer = await db('customers').where({ id: data.invoice.customer_id }).first();
    const location = await db('locations').where({ id: data.invoice.location_id }).first();

    const pdfBuffer = await buildInvoicePdf({
      invoice: data.invoice,
      customer,
      location,
      lineItems: data.lineItems,
      payments: data.payments
    });

    const fileName = `${data.invoice.invoice_number}.pdf`;
    const { storageKey } = saveBuffer(pdfBuffer, fileName);

    const [doc] = await db('invoice_documents').insert({
      invoice_id: data.invoice.id,
      doc_type: 'INVOICE_PDF',
      file_name: fileName,
      mime_type: 'application/pdf',
      file_size_bytes: pdfBuffer.length,
      storage_key: storageKey,
      uploaded_by_user_id: req.user?.id || null
    }).returning('*');

    res.json({ success: true, data: doc, downloadUrl: `/uploads/${storageKey}` });
  } catch (error) {
    dtLogger.error('invoice_pdf_failed', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/pdf', authMiddleware, async (req, res) => {
  try {
    const doc = await db('invoice_documents')
      .where({ invoice_id: req.params.id, doc_type: 'INVOICE_PDF' })
      .orderBy('created_at', 'desc')
      .first();

    if (!doc) return res.status(404).json({ error: 'PDF not found' });
    res.json({ success: true, data: doc, downloadUrl: `/uploads/${doc.storage_key}` });
  } catch (error) {
    dtLogger.error('invoice_pdf_get_failed', error);
    res.status(500).json({ error: error.message });
  }
});

// Documents
router.post('/:id/documents', authMiddleware, requireRole(['admin', 'accounting', 'service_advisor']), upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'File is required' });

    const storageKey = path.join('invoices', file.filename);
    const [doc] = await db('invoice_documents').insert({
      invoice_id: req.params.id,
      doc_type: 'SUPPORTING',
      file_name: file.originalname,
      mime_type: file.mimetype,
      file_size_bytes: file.size,
      storage_key: storageKey,
      uploaded_by_user_id: req.user?.id || null
    }).returning('*');

    res.status(201).json({ success: true, data: doc, downloadUrl: `/uploads/${storageKey}` });
  } catch (error) {
    dtLogger.error('invoice_document_upload_failed', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/documents', authMiddleware, async (req, res) => {
  try {
    const docs = await db('invoice_documents').where({ invoice_id: req.params.id }).orderBy('created_at', 'desc');
    res.json({ success: true, data: docs });
  } catch (error) {
    dtLogger.error('invoice_documents_get_failed', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/documents/:docId/download', authMiddleware, async (req, res) => {
  try {
    const doc = await db('invoice_documents').where({ id: req.params.docId, invoice_id: req.params.id }).first();
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const fullPath = path.join(__dirname, '..', 'uploads', doc.storage_key);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File missing' });
    res.download(fullPath, doc.file_name);
  } catch (error) {
    dtLogger.error('invoice_document_download_failed', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
