const express = require('express');
const multer = require('multer');
const path = require('path');
const XLSX = require('xlsx');
const db = require('../internal/db').knex;
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/logger');
const workOrdersService = require('../services/work-orders.service');
const { uploadBuffer, getSignedDownloadUrl } = require('../storage/r2-storage');

const router = express.Router();

async function resolveVehicleSource() {
  try {
    const viewResult = await db.raw("SELECT to_regclass('public.all_vehicles') AS rel");
    if (viewResult?.rows?.[0]?.rel) return 'all_vehicles';
    const tableResult = await db.raw("SELECT to_regclass('public.vehicles') AS rel");
    if (tableResult?.rows?.[0]?.rel) return 'vehicles';
    return 'none';
  } catch {
    return 'none';
  }
}

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
 * Roles that may finalize work orders (approve, close, void).
 * shop_clerk may NOT close or approve; only shop_manager/admin can.
 */
const WO_MANAGER_ROLES = ['admin', 'super_admin', 'shop_manager', 'carrier_accountant', 'accounting'];

/**
 * Status guard: blocks shop_clerk from transitioning to restricted statuses
 * (closed, approved, void). Other status transitions are allowed for all shop roles.
 */
function requireManagerForFinalStatus(req, res, next) {
  const targetStatus = (req.body?.status || '').toString().trim().toLowerCase();
  const RESTRICTED = ['closed', 'approved', 'void'];
  if (!RESTRICTED.includes(targetStatus)) return next();
  const role = (req.user?.role || '').toString().trim().toLowerCase();
  if (WO_MANAGER_ROLES.includes(role)) return next();
  return res.status(403).json({
    error: 'Forbidden: only managers may close, approve, or void work orders',
    targetStatus,
    requiredRoles: WO_MANAGER_ROLES,
  });
}

const upload = multer({ storage: multer.memoryStorage() });
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
  const vehicleSource = await resolveVehicleSource();
  if (vehicleSource === 'none') return null;

  const vehicleId = normalizeText(row['Vehicle ID']);
  if (vehicleId) {
    const vehicle = await db(vehicleSource).where({ id: vehicleId }).first();
    return vehicle ? { vehicleId: vehicle.id, vehicle } : null;
  }

  const vin = normalizeText(row['Vehicle VIN'] || row['VIN']);
  const unitNumber = normalizeText(row['Vehicle Unit Number'] || row['Unit Number']);
  if (!vin && !unitNumber) return null;

  const vehicle = await db(vehicleSource)
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
    const customer = await db('shop_clients').where({ id: customerId }).first();
    return customer ? customer.id : null;
  }

  const customerEmail = normalizeText(row['Customer Email'] || row['Email']);
  if (customerEmail) {
    const customer = await db('shop_clients')
      .whereRaw('LOWER(email) = ?', [customerEmail.toLowerCase()])
      .first();
    if (customer) return customer.id;
  }

  const dotNumber = normalizeText(row['Customer DOT'] || row['DOT Number']);
  if (dotNumber) {
    const customer = await db('shop_clients').where({ dot_number: dotNumber }).first();
    if (customer) return customer.id;
  }

  const customerName = normalizeText(row['Customer Name'] || row['Company Name']);
  if (customerName) {
    const customer = await db('shop_clients')
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

/**
 * @openapi
 * /api/work-orders/bulk-upload/template:
 *   get:
 *     summary: Download bulk upload Excel template
 *     description: >-
 *       Returns an Excel (.xlsx) template file with sample data and instructions
 *       for bulk-uploading work orders. The template includes columns for vehicle
 *       identification, customer info, type, priority, and status. Status workflow:
 *       DRAFT -> IN_PROGRESS -> WAITING_PARTS -> COMPLETED -> CLOSED.
 *     tags:
 *       - Work Orders
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Excel template file download
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       500:
 *         description: Failed to generate template
 */
router.get('/bulk-upload/template', authMiddleware, requireRole(['admin', 'service_advisor', 'shop_manager', 'shop_clerk', 'service_writer']), (_req, res) => {
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

/**
 * @openapi
 * /api/work-orders/bulk-upload:
 *   post:
 *     summary: Bulk upload work orders from Excel file
 *     description: >-
 *       Parses an uploaded Excel file and creates work orders for each valid row.
 *       Vehicles are resolved by VIN or unit number, locations by name or ID,
 *       and customers by email, DOT number, or name. Status workflow:
 *       DRAFT -> IN_PROGRESS -> WAITING_PARTS -> COMPLETED -> CLOSED.
 *     tags:
 *       - Work Orders
 *     security:
 *       - bearerAuth: []
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
 *                 description: Excel file (.xlsx or .xls)
 *     responses:
 *       200:
 *         description: Bulk upload results with successful and failed rows
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 results:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     successful:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           row:
 *                             type: integer
 *                           workOrderId:
 *                             type: string
 *                           workOrderNumber:
 *                             type: string
 *                     failed:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           row:
 *                             type: integer
 *                           errors:
 *                             type: array
 *                             items:
 *                               type: string
 *       400:
 *         description: No file provided or parse error
 *       500:
 *         description: Server error
 */
router.post('/bulk-upload', authMiddleware, requireRole(['admin', 'service_advisor', 'shop_manager', 'shop_clerk', 'service_writer']), bulkUpload.single('file'), async (req, res) => {
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

        const workOrder = await workOrdersService.createWorkOrder(payload, requestedByUserId || req.user?.id, req.context || null);
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

/**
 * @openapi
 * /api/work-orders:
 *   get:
 *     summary: List work orders
 *     description: >-
 *       Returns a paginated list of work orders with optional query filters.
 *       Status workflow: DRAFT -> IN_PROGRESS -> WAITING_PARTS -> COMPLETED -> CLOSED.
 *     tags:
 *       - Work Orders
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [DRAFT, IN_PROGRESS, WAITING_PARTS, COMPLETED, CLOSED, CANCELED]
 *         description: Filter by work order status
 *       - in: query
 *         name: vehicleId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by vehicle ID
 *       - in: query
 *         name: customerId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by customer ID
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Results per page
 *     responses:
 *       200:
 *         description: Paginated work orders list
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
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await workOrdersService.listWorkOrders(req.query || {}, req.context || null);
    res.json({ success: true, ...result });
  } catch (error) {
    dtLogger.error('work_orders_list_failed', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/work-orders:
 *   post:
 *     summary: Create a work order
 *     description: >-
 *       Creates a new work order. New work orders typically start in DRAFT status.
 *       Status workflow: DRAFT -> IN_PROGRESS -> WAITING_PARTS -> COMPLETED -> CLOSED.
 *     tags:
 *       - Work Orders
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               vehicleId:
 *                 type: string
 *                 format: uuid
 *               customerId:
 *                 type: string
 *                 format: uuid
 *               locationId:
 *                 type: string
 *                 format: uuid
 *               type:
 *                 type: string
 *                 enum: [REPAIR, PM, INSPECTION, TIRE, OTHER]
 *               priority:
 *                 type: string
 *                 enum: [LOW, NORMAL, HIGH, URGENT]
 *               status:
 *                 type: string
 *                 enum: [DRAFT, IN_PROGRESS, WAITING_PARTS, COMPLETED, CLOSED, CANCELED]
 *               description:
 *                 type: string
 *               odometerMiles:
 *                 type: number
 *               assignedMechanicUserId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Work order created
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
 */
router.post('/', authMiddleware, requireRole(['admin', 'service_advisor', 'shop_manager', 'shop_clerk', 'service_writer', 'mechanic', 'technician']), async (req, res) => {
  try {
    const workOrder = await workOrdersService.createWorkOrder(req.body || {}, req.user?.id, req.context || null);
    res.status(201).json({ success: true, data: workOrder });
  } catch (error) {
    dtLogger.error('work_orders_create_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/work-orders/{id}:
 *   get:
 *     summary: Get work order by ID
 *     description: >-
 *       Returns a single work order with all related data (labor lines, parts,
 *       documents, invoices). Status workflow:
 *       DRAFT -> IN_PROGRESS -> WAITING_PARTS -> COMPLETED -> CLOSED.
 *     tags:
 *       - Work Orders
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Work order ID
 *     responses:
 *       200:
 *         description: Work order details
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
 *         description: Work order not found
 *       500:
 *         description: Server error
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const data = await workOrdersService.getWorkOrderById(req.params.id, req.context || null);
    if (!data) return res.status(404).json({ error: 'Work order not found' });
    res.json({ success: true, data });
  } catch (error) {
    dtLogger.error('work_orders_get_failed', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/work-orders/{id}:
 *   put:
 *     summary: Update a work order
 *     description: >-
 *       Updates an existing work order's fields. UUID fields that are empty strings
 *       are normalized to null. Status workflow:
 *       DRAFT -> IN_PROGRESS -> WAITING_PARTS -> COMPLETED -> CLOSED.
 *     tags:
 *       - Work Orders
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Work order ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               vehicleId:
 *                 type: string
 *                 format: uuid
 *               customerId:
 *                 type: string
 *                 format: uuid
 *               locationId:
 *                 type: string
 *                 format: uuid
 *               assignedMechanicUserId:
 *                 type: string
 *                 format: uuid
 *               type:
 *                 type: string
 *               priority:
 *                 type: string
 *               description:
 *                 type: string
 *               odometerMiles:
 *                 type: number
 *     responses:
 *       200:
 *         description: Work order updated
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
 */
router.put('/:id', authMiddleware, requireRole(['admin', 'service_advisor', 'shop_manager', 'shop_clerk', 'service_writer', 'mechanic', 'technician']), async (req, res) => {
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

    const workOrder = await workOrdersService.updateWorkOrder(req.params.id, payload, req.user?.id, req.context || null);
    res.json({ success: true, data: workOrder });
  } catch (error) {
    dtLogger.error('work_orders_update_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/work-orders/{id}/status:
 *   patch:
 *     summary: Transition work order status
 *     description: >-
 *       Updates the status of a work order. Status workflow:
 *       DRAFT -> IN_PROGRESS -> WAITING_PARTS -> COMPLETED -> CLOSED.
 *       Restricted statuses (closed, approved, void) require manager role.
 *       shop_clerk may only set open, in_progress, waiting_parts, completed,
 *       or ready_to_invoice.
 *     tags:
 *       - Work Orders
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Work order ID
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
 *                 enum: [DRAFT, IN_PROGRESS, WAITING_PARTS, COMPLETED, CLOSED, APPROVED, VOID, CANCELED]
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
 *         description: Invalid status transition
 *       403:
 *         description: Insufficient role for restricted status
 */
// Status transitions: shop_clerk may set open/in_progress/waiting_parts/completed/ready_to_invoice.
// closed/approved/void require manager role (enforced by requireManagerForFinalStatus).
router.patch('/:id/status', authMiddleware,
  requireRole(['admin', 'service_advisor', 'technician', 'shop_manager', 'shop_clerk', 'service_writer', 'mechanic']),
  requireManagerForFinalStatus,
  async (req, res) => {
  try {
    const workOrder = await workOrdersService.updateWorkOrderStatus(req.params.id, req.body?.status, req.user?.role);
    res.json({ success: true, data: workOrder });
  } catch (error) {
    dtLogger.error('work_orders_status_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/work-orders/{id}/labor:
 *   post:
 *     summary: Add a labor line to a work order
 *     description: Adds a new labor line item to the specified work order.
 *     tags:
 *       - Work Orders
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Work order ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               description:
 *                 type: string
 *               hours:
 *                 type: number
 *               rate:
 *                 type: number
 *               technicianId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Labor line added
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
 */
// Labor
router.post('/:id/labor', authMiddleware, requireRole(['admin', 'service_advisor', 'technician', 'shop_manager', 'shop_clerk', 'service_writer', 'mechanic']), async (req, res) => {
  try {
    const line = await workOrdersService.addLaborLine(req.params.id, req.body || {});
    res.status(201).json({ success: true, data: line });
  } catch (error) {
    dtLogger.error('work_orders_labor_add_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/work-orders/{id}/labor/{laborId}:
 *   put:
 *     summary: Update a labor line
 *     description: Updates an existing labor line on the specified work order.
 *     tags:
 *       - Work Orders
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Work order ID
 *       - in: path
 *         name: laborId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Labor line ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               description:
 *                 type: string
 *               hours:
 *                 type: number
 *               rate:
 *                 type: number
 *               technicianId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Labor line updated
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
 */
router.put('/:id/labor/:laborId', authMiddleware, requireRole(['admin', 'service_advisor', 'technician', 'shop_manager', 'shop_clerk', 'service_writer', 'mechanic']), async (req, res) => {
  try {
    const line = await workOrdersService.updateLaborLine(req.params.id, req.params.laborId, req.body || {});
    res.json({ success: true, data: line });
  } catch (error) {
    dtLogger.error('work_orders_labor_update_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/work-orders/{id}/labor/{laborId}:
 *   delete:
 *     summary: Delete a labor line
 *     description: >-
 *       Removes a labor line from the work order. Manager-only operation;
 *       shop_clerk cannot delete labor lines.
 *     tags:
 *       - Work Orders
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Work order ID
 *       - in: path
 *         name: laborId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Labor line ID
 *     responses:
 *       200:
 *         description: Labor line deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       400:
 *         description: Validation error
 */
// Labor delete is manager-only; shop_clerk cannot remove labor lines.
router.delete('/:id/labor/:laborId', authMiddleware, requireRole(['admin', 'service_advisor', 'shop_manager', 'service_writer']), async (req, res) => {
  try {
    await workOrdersService.deleteLaborLine(req.params.id, req.params.laborId);
    res.json({ success: true });
  } catch (error) {
    dtLogger.error('work_orders_labor_delete_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/work-orders/{id}/parts:
 *   post:
 *     summary: Reserve a part for a work order
 *     description: Reserves a part from inventory and adds it as a line item to the work order.
 *     tags:
 *       - Work Orders
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Work order ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               partId:
 *                 type: string
 *                 format: uuid
 *               quantity:
 *                 type: number
 *               unitPrice:
 *                 type: number
 *     responses:
 *       201:
 *         description: Part reserved
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
 */
// Parts
router.post('/:id/parts', authMiddleware, requireRole(['admin', 'service_advisor', 'technician', 'shop_manager', 'shop_clerk', 'service_writer', 'mechanic']), async (req, res) => {
  try {
    const line = await workOrdersService.reservePart(req.params.id, req.body || {}, req.user?.id);
    res.status(201).json({ success: true, data: line });
  } catch (error) {
    dtLogger.error('work_orders_part_reserve_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/work-orders/{id}/parts/scan:
 *   post:
 *     summary: Reserve parts by barcode scan
 *     description: >-
 *       Scans one or more barcodes and reserves the matching parts on the work order.
 *       Resolves parts via the part_barcodes table.
 *     tags:
 *       - Work Orders
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Work order ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               barcodes:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of barcode values to scan
 *     responses:
 *       201:
 *         description: Parts reserved from barcode scan
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
 */
router.post('/:id/parts/scan', authMiddleware, requireRole(['admin', 'service_advisor', 'technician', 'shop_manager', 'shop_clerk', 'service_writer', 'mechanic']), async (req, res) => {
  try {
    const result = await workOrdersService.reservePartsFromBarcodes(req.params.id, req.body || {}, req.user?.id);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    dtLogger.error('work_orders_part_scan_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/work-orders/{id}/parts/{partLineId}/issue:
 *   post:
 *     summary: Issue a reserved part
 *     description: >-
 *       Transitions a reserved part line to issued status, deducting from inventory.
 *       The part must already be reserved on the work order.
 *     tags:
 *       - Work Orders
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Work order ID
 *       - in: path
 *         name: partLineId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Part line ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               quantity:
 *                 type: number
 *                 description: Quantity to issue (defaults to reserved quantity)
 *     responses:
 *       200:
 *         description: Part issued
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
 */
router.post('/:id/parts/:partLineId/issue', authMiddleware, requireRole(['admin', 'service_advisor', 'technician', 'shop_manager', 'shop_clerk', 'service_writer', 'mechanic']), async (req, res) => {
  try {
    const updated = await workOrdersService.issuePart(req.params.id, req.params.partLineId, req.body || {}, req.user?.id);
    res.json({ success: true, data: updated });
  } catch (error) {
    dtLogger.error('work_orders_part_issue_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/work-orders/{id}/parts/{partLineId}/return:
 *   post:
 *     summary: Return an issued part
 *     description: >-
 *       Returns a previously issued part back to inventory. Restores inventory
 *       quantity and updates the part line status.
 *     tags:
 *       - Work Orders
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Work order ID
 *       - in: path
 *         name: partLineId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Part line ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               quantity:
 *                 type: number
 *                 description: Quantity to return
 *               reason:
 *                 type: string
 *                 description: Reason for return
 *     responses:
 *       200:
 *         description: Part returned
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
 */
router.post('/:id/parts/:partLineId/return', authMiddleware, requireRole(['admin', 'service_advisor', 'technician', 'shop_manager', 'shop_clerk', 'service_writer', 'mechanic']), async (req, res) => {
  try {
    const updated = await workOrdersService.returnPart(req.params.id, req.params.partLineId, req.body || {}, req.user?.id);
    res.json({ success: true, data: updated });
  } catch (error) {
    dtLogger.error('work_orders_part_return_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/work-orders/{id}/charges:
 *   put:
 *     summary: Update work order charges
 *     description: >-
 *       Updates pricing and charge information on the work order. Manager-only;
 *       shop_clerk cannot modify charges.
 *     tags:
 *       - Work Orders
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Work order ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               laborTotal:
 *                 type: number
 *               partsTotal:
 *                 type: number
 *               taxRate:
 *                 type: number
 *               discount:
 *                 type: number
 *               shopSuppliesFee:
 *                 type: number
 *     responses:
 *       200:
 *         description: Charges updated
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
 */
// Charges
// Charge/pricing updates: shop_manager and above only (not shop_clerk).
router.put('/:id/charges', authMiddleware, requireRole(['admin', 'service_advisor', 'shop_manager', 'service_writer']), async (req, res) => {
  try {
    const workOrder = await workOrdersService.updateCharges(req.params.id, req.body || {});
    res.json({ success: true, data: workOrder });
  } catch (error) {
    dtLogger.error('work_orders_charges_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/work-orders/{id}/generate-invoice:
 *   post:
 *     summary: Generate invoice from work order
 *     description: >-
 *       Creates a draft invoice from the work order's labor, parts, and charges.
 *       shop_clerk may generate draft invoices; posting requires manager role.
 *     tags:
 *       - Work Orders
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Work order ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *               dueDate:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: Invoice generated
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
 */
// Invoice integration
// shop_clerk may generate a draft invoice from a work order (draft status; posting still requires manager).
router.post('/:id/generate-invoice', authMiddleware, requireRole(['admin', 'service_advisor', 'accounting', 'shop_manager', 'shop_clerk', 'service_writer']), async (req, res) => {
  try {
    const invoice = await workOrdersService.generateInvoiceForWorkOrder(req.params.id, req.user?.id, req.body, req.context || null);
    res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    dtLogger.error('work_orders_invoice_failed', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/work-orders/{id}/invoices:
 *   get:
 *     summary: List invoices for a work order
 *     description: Returns all invoices linked to the specified work order.
 *     tags:
 *       - Work Orders
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Work order ID
 *     responses:
 *       200:
 *         description: List of invoices
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
 *       404:
 *         description: Work order not found
 *       500:
 *         description: Server error
 */
router.get('/:id/invoices', authMiddleware, async (req, res) => {
  try {
    const data = await workOrdersService.getWorkOrderById(req.params.id, req.context || null);
    if (!data) return res.status(404).json({ error: 'Work order not found' });
    res.json({ success: true, data: data.invoices || [] });
  } catch (error) {
    dtLogger.error('work_orders_invoice_list_failed', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/work-orders/{id}/documents:
 *   post:
 *     summary: Upload a document to a work order
 *     description: >-
 *       Uploads a file to R2 storage and attaches it as a document to the work order.
 *       Returns the document metadata and a signed download URL.
 *     tags:
 *       - Work Orders
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Work order ID
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
 *     responses:
 *       201:
 *         description: Document uploaded
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
 *       400:
 *         description: File is required
 *       500:
 *         description: Upload failed
 */
// Documents
router.post('/:id/documents', authMiddleware, requireRole(['admin', 'service_advisor', 'technician', 'shop_manager', 'shop_clerk', 'service_writer', 'mechanic']), upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'File is required' });

    const safeName = file.originalname ? file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_') : file.filename;
    const { key: storageKey } = await uploadBuffer({
      buffer: file.buffer,
      contentType: file.mimetype,
      prefix: `work-orders/${req.params.id}`,
      fileName: safeName
    });

    const doc = await workOrdersService.uploadDocument(req.params.id, {
      originalname: safeName,
      mimetype: file.mimetype,
      size: file.size,
      storage_key: storageKey
    }, req.user?.id);

    const downloadUrl = await getSignedDownloadUrl(storageKey);
    res.status(201).json({ success: true, data: doc, downloadUrl });
  } catch (error) {
    dtLogger.error('work_orders_document_upload_failed', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/work-orders/{id}/documents:
 *   get:
 *     summary: List documents for a work order
 *     description: Returns all documents attached to the work order with signed download URLs.
 *     tags:
 *       - Work Orders
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Work order ID
 *     responses:
 *       200:
 *         description: List of documents with download URLs
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
 *                       originalname:
 *                         type: string
 *                       mimetype:
 *                         type: string
 *                       size:
 *                         type: integer
 *                       downloadUrl:
 *                         type: string
 *       404:
 *         description: Work order not found
 *       500:
 *         description: Server error
 */
router.get('/:id/documents', authMiddleware, async (req, res) => {
  try {
    const data = await workOrdersService.getWorkOrderById(req.params.id, req.context || null);
    if (!data) return res.status(404).json({ error: 'Work order not found' });
    const documents = data.documents || [];
    const withUrls = await Promise.all(
      documents.map(async doc => ({
        ...doc,
        downloadUrl: doc.storage_key ? await getSignedDownloadUrl(doc.storage_key) : null
      }))
    );
    res.json({ success: true, data: withUrls });
  } catch (error) {
    dtLogger.error('work_orders_document_list_failed', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/work-orders/{id}/documents/{docId}/download:
 *   get:
 *     summary: Get download URL for a work order document
 *     description: Returns a signed download URL for the specified document.
 *     tags:
 *       - Work Orders
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Work order ID
 *       - in: path
 *         name: docId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Document ID
 *     responses:
 *       200:
 *         description: Signed download URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 downloadUrl:
 *                   type: string
 *       404:
 *         description: Work order or document not found
 *       500:
 *         description: Server error
 */
router.get('/:id/documents/:docId/download', authMiddleware, async (req, res) => {
  try {
    const data = await workOrdersService.getWorkOrderById(req.params.id, req.context || null);
    if (!data) return res.status(404).json({ error: 'Work order not found' });

    const doc = (data.documents || []).find(d => String(d.id) === String(req.params.docId));
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const downloadUrl = await getSignedDownloadUrl(doc.storage_key);
    res.json({ success: true, downloadUrl });
  } catch (error) {
    dtLogger.error('work_orders_document_download_failed', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
