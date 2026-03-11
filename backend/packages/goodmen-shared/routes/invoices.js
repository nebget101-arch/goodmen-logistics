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
    const role = req.user?.role || 'technician';
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

const upload = multer({ storage: multer.memoryStorage() });

router.param('id', (req, res, next, id) => {
  if (!UUID_RE.test(String(id || ''))) {
    return res.status(400).json({ error: 'Invalid invoice id' });
  }
  next();
});

router.post('/from-work-order/:workOrderId', authMiddleware, requireRole(['admin', 'accounting', 'service_advisor']), async (req, res) => {
  try {
    const invoice = await invoicesService.createInvoiceFromWorkOrder(req.params.workOrderId, req.body || {}, req.user?.id, req.context || null);
    res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    dtLogger.error('invoice_from_work_order_failed', error);
    res.status(400).json({ error: error.message });
  }
});

router.post('/', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
  try {
    const invoice = await invoicesService.createManualInvoice(req.body || {}, req.user?.id, req.context || null);
    res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    dtLogger.error('invoice_create_failed', error);
    res.status(400).json({ error: error.message });
  }
});

router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await invoicesService.listInvoices(req.query || {}, req.context || null);
    res.json({ success: true, ...result });
  } catch (error) {
    dtLogger.error('invoice_list_failed', error);
    res.status(500).json({ error: error.message });
  }
});

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

router.put('/:id', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
  try {
    const invoice = await invoicesService.updateInvoiceDraft(req.params.id, req.body || {}, req.user?.id, req.context || null);
    res.json({ success: true, data: invoice });
  } catch (error) {
    dtLogger.error('invoice_update_failed', error);
    res.status(400).json({ error: error.message });
  }
});

router.patch('/:id/status', authMiddleware, requireRole(['admin', 'accounting', 'service_advisor']), async (req, res) => {
  try {
    const invoice = await invoicesService.setInvoiceStatus(req.params.id, req.body?.status, req.body?.reason, req.user?.id, req.context || null);
    res.json({ success: true, data: invoice });
  } catch (error) {
    dtLogger.error('invoice_status_failed', error);
    res.status(400).json({ error: error.message });
  }
});

// Line items (optional)
router.post('/:id/line-items', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
  try {
    const item = await invoicesService.addLineItem(req.params.id, req.body || {}, req.context || null);
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    dtLogger.error('invoice_line_add_failed', error);
    res.status(400).json({ error: error.message });
  }
});

router.put('/:id/line-items/:lineItemId', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
  try {
    const item = await invoicesService.updateLineItem(req.params.id, req.params.lineItemId, req.body || {}, req.context || null);
    res.json({ success: true, data: item });
  } catch (error) {
    dtLogger.error('invoice_line_update_failed', error);
    res.status(400).json({ error: error.message });
  }
});

router.delete('/:id/line-items/:lineItemId', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
  try {
    await invoicesService.deleteLineItem(req.params.id, req.params.lineItemId, req.context || null);
    res.json({ success: true });
  } catch (error) {
    dtLogger.error('invoice_line_delete_failed', error);
    res.status(400).json({ error: error.message });
  }
});

// Payments
router.post('/:id/payments', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
  try {
    const invoice = await invoicesService.addPayment(req.params.id, req.body || {}, req.user?.id, req.context || null);
    res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    dtLogger.error('invoice_payment_failed', error);
    res.status(400).json({ error: error.message });
  }
});

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

router.delete('/:id/payments/:paymentId', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
  try {
    const invoice = await invoicesService.deletePayment(req.params.id, req.params.paymentId, req.context || null);
    res.json({ success: true, data: invoice });
  } catch (error) {
    dtLogger.error('invoice_payment_delete_failed', error);
    res.status(400).json({ error: error.message });
  }
});

// PDF
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

// Documents
router.post('/:id/documents', authMiddleware, requireRole(['admin', 'accounting', 'service_advisor']), upload.single('file'), async (req, res) => {
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
