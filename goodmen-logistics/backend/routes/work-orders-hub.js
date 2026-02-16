const express = require('express');
const multer = require('multer');
const path = require('path');
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/dynatrace-logger');
const workOrdersService = require('../services/work-orders.service');
const { saveStream, ensureDirs } = require('../storage/local-storage');

const router = express.Router();

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
const upload = multer({ dest: path.join(__dirname, '..', 'uploads', 'work-orders') });

router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await workOrdersService.listWorkOrders(req.query || {});
    res.json({ success: true, ...result });
  } catch (error) {
    dtLogger.error('work_orders_list_failed', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authMiddleware, requireRole(['admin', 'service_advisor']), async (req, res) => {
  try {
    const workOrder = await workOrdersService.createWorkOrder(req.body || {}, req.user?.id);
    res.status(201).json({ success: true, data: workOrder });
  } catch (error) {
    dtLogger.error('work_orders_create_failed', error);
    res.status(400).json({ error: error.message });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const data = await workOrdersService.getWorkOrderById(req.params.id);
    if (!data) return res.status(404).json({ error: 'Work order not found' });
    res.json({ success: true, data });
  } catch (error) {
    dtLogger.error('work_orders_get_failed', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', authMiddleware, requireRole(['admin', 'service_advisor']), async (req, res) => {
  try {
    const payload = req.body || {};
    const normalizeUuidInput = (value) => {
      if (value === undefined || value === null) return value;
      if (typeof value === 'string' && value.trim() === '') return null;
      return value;
    };
    payload.vehicleId = normalizeUuidInput(payload.vehicleId);
    payload.customerId = normalizeUuidInput(payload.customerId);
    payload.locationId = normalizeUuidInput(payload.locationId);
    payload.assignedMechanicUserId = normalizeUuidInput(payload.assignedMechanicUserId);

    const workOrder = await workOrdersService.updateWorkOrder(req.params.id, payload);
    res.json({ success: true, data: workOrder });
  } catch (error) {
    dtLogger.error('work_orders_update_failed', error);
    res.status(400).json({ error: error.message });
  }
});

router.patch('/:id/status', authMiddleware, requireRole(['admin', 'service_advisor', 'technician']), async (req, res) => {
  try {
    const workOrder = await workOrdersService.updateWorkOrderStatus(req.params.id, req.body?.status, req.user?.role);
    res.json({ success: true, data: workOrder });
  } catch (error) {
    dtLogger.error('work_orders_status_failed', error);
    res.status(400).json({ error: error.message });
  }
});

// Labor
router.post('/:id/labor', authMiddleware, requireRole(['admin', 'service_advisor', 'technician']), async (req, res) => {
  try {
    const line = await workOrdersService.addLaborLine(req.params.id, req.body || {});
    res.status(201).json({ success: true, data: line });
  } catch (error) {
    dtLogger.error('work_orders_labor_add_failed', error);
    res.status(400).json({ error: error.message });
  }
});

router.put('/:id/labor/:laborId', authMiddleware, requireRole(['admin', 'service_advisor', 'technician']), async (req, res) => {
  try {
    const line = await workOrdersService.updateLaborLine(req.params.id, req.params.laborId, req.body || {});
    res.json({ success: true, data: line });
  } catch (error) {
    dtLogger.error('work_orders_labor_update_failed', error);
    res.status(400).json({ error: error.message });
  }
});

router.delete('/:id/labor/:laborId', authMiddleware, requireRole(['admin', 'service_advisor']), async (req, res) => {
  try {
    await workOrdersService.deleteLaborLine(req.params.id, req.params.laborId);
    res.json({ success: true });
  } catch (error) {
    dtLogger.error('work_orders_labor_delete_failed', error);
    res.status(400).json({ error: error.message });
  }
});

// Parts
router.post('/:id/parts', authMiddleware, requireRole(['admin', 'service_advisor', 'technician']), async (req, res) => {
  try {
    const line = await workOrdersService.reservePart(req.params.id, req.body || {}, req.user?.id);
    res.status(201).json({ success: true, data: line });
  } catch (error) {
    dtLogger.error('work_orders_part_reserve_failed', error);
    res.status(400).json({ error: error.message });
  }
});

router.post('/:id/parts/:partLineId/issue', authMiddleware, requireRole(['admin', 'service_advisor', 'technician']), async (req, res) => {
  try {
    const updated = await workOrdersService.issuePart(req.params.id, req.params.partLineId, req.body || {}, req.user?.id);
    res.json({ success: true, data: updated });
  } catch (error) {
    dtLogger.error('work_orders_part_issue_failed', error);
    res.status(400).json({ error: error.message });
  }
});

router.post('/:id/parts/:partLineId/return', authMiddleware, requireRole(['admin', 'service_advisor', 'technician']), async (req, res) => {
  try {
    const updated = await workOrdersService.returnPart(req.params.id, req.params.partLineId, req.body || {}, req.user?.id);
    res.json({ success: true, data: updated });
  } catch (error) {
    dtLogger.error('work_orders_part_return_failed', error);
    res.status(400).json({ error: error.message });
  }
});

// Charges
router.put('/:id/charges', authMiddleware, requireRole(['admin', 'service_advisor']), async (req, res) => {
  try {
    const workOrder = await workOrdersService.updateCharges(req.params.id, req.body || {});
    res.json({ success: true, data: workOrder });
  } catch (error) {
    dtLogger.error('work_orders_charges_failed', error);
    res.status(400).json({ error: error.message });
  }
});

// Invoice integration
router.post('/:id/generate-invoice', authMiddleware, requireRole(['admin', 'service_advisor', 'accounting']), async (req, res) => {
  try {
    const invoice = await workOrdersService.generateInvoiceForWorkOrder(req.params.id, req.user?.id);
    res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    dtLogger.error('work_orders_invoice_failed', error);
    res.status(400).json({ error: error.message });
  }
});

router.get('/:id/invoices', authMiddleware, async (req, res) => {
  try {
    const data = await workOrdersService.getWorkOrderById(req.params.id);
    if (!data) return res.status(404).json({ error: 'Work order not found' });
    res.json({ success: true, data: data.invoices || [] });
  } catch (error) {
    dtLogger.error('work_orders_invoice_list_failed', error);
    res.status(500).json({ error: error.message });
  }
});

// Documents
router.post('/:id/documents', authMiddleware, requireRole(['admin', 'service_advisor', 'technician']), upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'File is required' });

    const safeName = file.originalname ? file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_') : file.filename;
    const fileStream = require('fs').createReadStream(file.path);
    const { storageKey } = await saveStream(fileStream, path.join('work-orders', safeName));

    const doc = await workOrdersService.uploadDocument(req.params.id, {
      originalname: safeName,
      mimetype: file.mimetype,
      size: file.size,
      storage_key: storageKey
    }, req.user?.id);

    res.status(201).json({ success: true, data: doc, downloadUrl: `/uploads/${storageKey}` });
  } catch (error) {
    dtLogger.error('work_orders_document_upload_failed', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/documents', authMiddleware, async (req, res) => {
  try {
    const data = await workOrdersService.getWorkOrderById(req.params.id);
    if (!data) return res.status(404).json({ error: 'Work order not found' });
    res.json({ success: true, data: data.documents || [] });
  } catch (error) {
    dtLogger.error('work_orders_document_list_failed', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/documents/:docId/download', authMiddleware, async (req, res) => {
  try {
    const data = await workOrdersService.getWorkOrderById(req.params.id);
    if (!data) return res.status(404).json({ error: 'Work order not found' });

    const doc = (data.documents || []).find(d => String(d.id) === String(req.params.docId));
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const fullPath = path.join(__dirname, '..', 'uploads', doc.storage_key);
    res.download(fullPath, doc.file_name);
  } catch (error) {
    dtLogger.error('work_orders_document_download_failed', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
