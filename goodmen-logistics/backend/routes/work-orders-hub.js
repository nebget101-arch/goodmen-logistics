const express = require('express');
const multer = require('multer');
const path = require('path');
const XLSX = require('xlsx');
const db = require('../config/knex');
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/dynatrace-logger');
const workOrdersService = require('../services/work-orders.service');
const { saveStream, ensureDirs } = require('../storage/local-storage');

const router = express.Router();

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

ensureDirs();
const upload = multer({ dest: path.join(__dirname, '..', 'uploads', 'work-orders') });
const bulkUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files are allowed'));
    }
  }
});

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

function normalizeEnum(value, allowedValues, fallback) {
  if (!value) return fallback;
  const normalized = String(value).trim().toUpperCase().replace(/\s+/g, '_');
  if (allowedValues.includes(normalized)) return normalized;
  return fallback;
}

async function resolveVehicle(row) {
  const vehicleId = normalizeText(row['Vehicle ID']);
  if (vehicleId) {
    const vehicle = await db('all_vehicles').where({ id: vehicleId }).first();
    return vehicle ? { vehicleId: vehicle.id, vehicle } : null;
  }

  const vin = normalizeText(row['Vehicle VIN'] || row['VIN']);
  const unitNumber = normalizeText(row['Vehicle Unit Number'] || row['Unit Number']);
  if (!vin && !unitNumber) return null;

  const vehicle = await db('all_vehicles')
    .where(qb => {
      if (vin) qb.orWhereRaw('LOWER(vin) = ?', [vin.toLowerCase()]);
      if (unitNumber) qb.orWhereRaw('LOWER(unit_number) = ?', [unitNumber.toLowerCase()]);
    })
    .first();

  return vehicle ? { vehicleId: vehicle.id, vehicle } : null;
}

async function resolveLocation(row, vehicle) {
  const locationId = normalizeText(row['Location ID']);
  if (locationId) {
    const location = await db('locations').where({ id: locationId }).first();
    return location ? location.id : null;
  }

  const locationName = normalizeText(row['Location Name'] || row['Location']);
  if (locationName) {
    const location = await db('locations')
      .whereRaw('LOWER(name) = ?', [locationName.toLowerCase()])
      .first();
    if (location) return location.id;
  }

  if (vehicle?.location_id) return vehicle.location_id;
  return null;
}

async function resolveCustomerId(row) {
  const customerId = normalizeText(row['Customer ID']);
  if (customerId) {
    const customer = await db('customers').where({ id: customerId }).first();
    return customer ? customer.id : null;
  }

  const customerEmail = normalizeText(row['Customer Email'] || row['Email']);
  if (customerEmail) {
    const customer = await db('customers')
      .whereRaw('LOWER(email) = ?', [customerEmail.toLowerCase()])
      .first();
    if (customer) return customer.id;
  }

  const dotNumber = normalizeText(row['Customer DOT'] || row['DOT Number']);
  if (dotNumber) {
    const customer = await db('customers').where({ dot_number: dotNumber }).first();
    if (customer) return customer.id;
  }

  const customerName = normalizeText(row['Customer Name'] || row['Company Name']);
  if (customerName) {
    const customer = await db('customers')
      .whereRaw('LOWER(company_name) = ?', [customerName.toLowerCase()])
      .first();
    if (customer) return customer.id;
  }

  return null;
}

async function resolveUserIdByUsername(username) {
  const normalized = normalizeText(username);
  if (!normalized) return null;
  const user = await db('users')
    .whereRaw('LOWER(username) = ?', [normalized.toLowerCase()])
    .first();
  return user ? user.id : null;
}

router.get('/bulk-upload/template', authMiddleware, requireRole(['admin', 'service_advisor']), (_req, res) => {
  try {
    const wb = XLSX.utils.book_new();
    const templateData = [
      {
        'Vehicle VIN': '1FTFW1ET1EKF51234',
        'Vehicle Unit Number': 'TRK-101',
        'Customer Email': 'ops@abctrucking.com',
        'Location Name': 'Main Shop',
        'Type': 'REPAIR',
        'Priority': 'NORMAL',
        'Status': 'DRAFT',
        'Description': 'Brake inspection and repair',
        'Odometer Miles': 125000,
        'Assigned Mechanic': 'tech1',
        'Requested By': 'service_advisor'
      }
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    ws['!cols'] = [
      { wch: 18 },
      { wch: 18 },
      { wch: 26 },
      { wch: 18 },
      { wch: 12 },
      { wch: 12 },
      { wch: 14 },
      { wch: 36 },
      { wch: 16 },
      { wch: 18 },
      { wch: 18 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'WorkOrders');

    const instructions = [
      { Field: 'Vehicle VIN / Vehicle Unit Number', Required: 'Yes', Description: 'Provide VIN or Unit Number to match a vehicle' },
      { Field: 'Location Name', Required: 'Yes', Description: 'Must match an existing location name (or vehicle location is used)' },
      { Field: 'Customer Email/DOT/Name', Required: 'No', Description: 'Optional for internal work orders' },
      { Field: 'Type', Required: 'No', Description: 'REPAIR, PM, INSPECTION, TIRE, OTHER (default: REPAIR)' },
      { Field: 'Priority', Required: 'No', Description: 'LOW, NORMAL, HIGH, URGENT (default: NORMAL)' },
      { Field: 'Status', Required: 'No', Description: 'DRAFT, IN_PROGRESS, WAITING_PARTS, COMPLETED, CLOSED, CANCELED (default: DRAFT)' },
      { Field: 'Assigned Mechanic / Requested By', Required: 'No', Description: 'Use usernames from the users table' }
    ];
    const wsInstructions = XLSX.utils.json_to_sheet(instructions);
    wsInstructions['!cols'] = [{ wch: 32 }, { wch: 12 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

    const fileName = 'work-order-upload-template.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
    res.send(buffer);
  } catch (error) {
    dtLogger.error('work_order_template_download_failed', error);
    res.status(500).json({ error: 'Failed to generate template' });
  }
});

router.post('/bulk-upload', authMiddleware, requireRole(['admin', 'service_advisor']), bulkUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    let workbook, rows;
    try {
      workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
    } catch (parseError) {
      return res.status(400).json({ error: 'Failed to parse Excel file: ' + parseError.message });
    }

    if (!rows.length) {
      return res.status(400).json({ error: 'No data found in Excel file' });
    }

    const results = { successful: [], failed: [], total: rows.length };
    const allowedTypes = ['REPAIR', 'PM', 'INSPECTION', 'TIRE', 'OTHER'];
    const allowedPriorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
    const allowedStatuses = ['DRAFT', 'IN_PROGRESS', 'WAITING_PARTS', 'COMPLETED', 'CLOSED', 'CANCELED'];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const vehicleMatch = await resolveVehicle(row);
        if (!vehicleMatch) {
          results.failed.push({
            row: i + 2,
            errors: ['Vehicle not found. Provide Vehicle VIN or Vehicle Unit Number.']
          });
          continue;
        }

        const locationId = await resolveLocation(row, vehicleMatch.vehicle);
        if (!locationId) {
          results.failed.push({
            row: i + 2,
            errors: ['Location not found. Provide Location Name or Location ID.']
          });
          continue;
        }

        const customerId = await resolveCustomerId(row);
        const customerProvided = normalizeText(row['Customer ID']) || normalizeText(row['Customer Email']) || normalizeText(row['Customer DOT']) || normalizeText(row['Customer Name']);
        if (customerProvided && !customerId) {
          results.failed.push({
            row: i + 2,
            errors: ['Customer not found. Check Customer Email/DOT/Name or Customer ID.']
          });
          continue;
        }

        const assignedMechanicUsername = normalizeText(row['Assigned Mechanic']);
        const requestedByUsername = normalizeText(row['Requested By']);
        const assignedMechanicUserId = await resolveUserIdByUsername(assignedMechanicUsername);
        const requestedByUserId = await resolveUserIdByUsername(requestedByUsername);

        if (assignedMechanicUsername && !assignedMechanicUserId) {
          results.failed.push({
            row: i + 2,
            errors: ['Assigned Mechanic username not found.']
          });
          continue;
        }

        const payload = {
          vehicleId: vehicleMatch.vehicleId,
          customerId: customerId || null,
          locationId,
          type: normalizeEnum(row['Type'], allowedTypes, 'REPAIR'),
          priority: normalizeEnum(row['Priority'], allowedPriorities, 'NORMAL'),
          status: normalizeEnum(row['Status'], allowedStatuses, 'DRAFT'),
          description: normalizeText(row['Description'] || row['Work Order Description']) || 'Bulk upload work order',
          odometerMiles: normalizeText(row['Odometer Miles']) ? Number(row['Odometer Miles']) : null,
          assignedMechanicUserId: assignedMechanicUserId || null,
          requestedByUsername: requestedByUsername || null
        };

        const workOrder = await workOrdersService.createWorkOrder(payload, requestedByUserId || req.user?.id);
        results.successful.push({
          row: i + 2,
          workOrderId: workOrder.id,
          workOrderNumber: workOrder.work_order_number
        });
      } catch (error) {
        results.failed.push({
          row: i + 2,
          errors: [error.message || 'Failed to create work order']
        });
      }
    }

    dtLogger.info('work_orders_bulk_upload_completed', {
      successful: results.successful.length,
      failed: results.failed.length
    });

    res.json({
      success: true,
      message: `Uploaded ${results.successful.length} work orders, ${results.failed.length} failed`,
      results
    });
  } catch (error) {
    dtLogger.error('work_orders_bulk_upload_failed', error);
    res.status(500).json({ error: error.message || 'Failed to process upload' });
  }
});

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

    const workOrder = await workOrdersService.updateWorkOrder(req.params.id, payload, req.user?.id);
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
    const invoice = await workOrdersService.generateInvoiceForWorkOrder(req.params.id, req.user?.id, req.body);
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
