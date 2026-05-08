const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/logger');
const inventoryService = require('../services/inventory.service');
const partsService = require('../services/parts.service');
const db = require('../internal/db').knex;
const { v4: uuidv4 } = require('uuid');
const { uploadBuffer, getSignedDownloadUrl } = require('../storage/r2-storage');
const { extractInvoiceViaAi } = require('../services/receiving-invoice.service');

// FN-1490: invoice upload (image or PDF) for AI line extraction.
// 15 MB cap matches the AI service's 12 MiB document limit with headroom
// for multipart overhead; types restricted to formats Claude Vision and
// the Documents API support natively.
const INVOICE_ALLOWED_MIME = new Set([
	'image/jpeg',
	'image/png',
	'image/heic',
	'image/heif',
	'application/pdf'
]);
const INVOICE_ALLOWED_EXT = /^\.(jpe?g|png|heic|heif|pdf)$/i;
const INVOICE_MAX_BYTES = 15 * 1024 * 1024;

const invoiceUpload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: INVOICE_MAX_BYTES },
	fileFilter: (req, file, cb) => {
		const ext = path.extname(file.originalname || '').toLowerCase();
		if (INVOICE_ALLOWED_MIME.has(file.mimetype) && INVOICE_ALLOWED_EXT.test(ext)) {
			return cb(null, true);
		}
		cb(new Error('Only JPG, PNG, HEIC, or PDF files are allowed'));
	}
});

/**
 * Permission helpers
 */
function requireRole(allowedRoles) {
	return (req, res, next) => {
		const userRole = req.user?.role || 'technician';
		if (!allowedRoles.includes(userRole)) {
			return res.status(403).json({ error: `Insufficient permissions. Required role: ${allowedRoles.join(' or ')}` });
		}
		next();
	};
}

/**
 * Generate unique ticket number
 */
async function generateTicketNumber(locationId) {
	const locationPrefix = locationId.substring(0, 4).toUpperCase();
	const timestamp = Date.now();
	const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
	return `RCV-${locationPrefix}-${timestamp}-${random}`;
}

/**
 * @openapi
 * /api/receiving:
 *   get:
 *     summary: List receiving tickets
 *     description: Returns all receiving tickets for a location with their line items, ordered by creation date descending.
 *     tags:
 *       - Receiving
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: locationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Location UUID
 *     responses:
 *       200:
 *         description: Receiving tickets list with lines
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
 *       400:
 *         description: Missing locationId
 *       500:
 *         description: Server error
 */
router.get('/', authMiddleware, async (req, res) => {
	try {
		const locationId = req.query.locationId;
		if (!locationId) {
			return res.status(400).json({ error: 'locationId query parameter is required' });
		}

		const tickets = await db('receiving_tickets')
			.where('location_id', locationId)
			.leftJoin('users as created_user', 'receiving_tickets.created_by', 'created_user.id')
			.leftJoin('users as posted_user', 'receiving_tickets.posted_by', 'posted_user.id')
			.select(
				'receiving_tickets.*',
				db.raw("COALESCE(created_user.first_name || ' ' || created_user.last_name, '') AS created_by_name"),
				db.raw("COALESCE(posted_user.first_name || ' ' || posted_user.last_name, '') AS posted_by_name")
			)
			.orderBy('receiving_tickets.created_at', 'desc');

		// Include line items
		for (const ticket of tickets) {
			const lines = await db('receiving_ticket_lines')
				.where('ticket_id', ticket.id)
				.join('parts', 'receiving_ticket_lines.part_id', 'parts.id')
				.select(
					'receiving_ticket_lines.*',
					'parts.sku',
					'parts.name',
					'parts.uom',
					'parts.default_cost'
				);

			ticket.lines = lines;
		}

		res.json({
			success: true,
			data: tickets
		});
	} catch (error) {
		dtLogger.error('receiving_tickets_get_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/receiving/draft:
 *   get:
 *     summary: Get the current user's open DRAFT ticket for a location
 *     description: Returns the most recent DRAFT receiving ticket created by the authenticated user at the given location, with its line items pre-joined. Returns 204 No Content when the user has no open DRAFT — the frontend uses this to decide whether to resume work or create a new ticket.
 *     tags:
 *       - Receiving
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: locationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Location UUID
 *     responses:
 *       200:
 *         description: Open DRAFT ticket with lines
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       204:
 *         description: No open DRAFT for this user/location
 *       400:
 *         description: Missing locationId
 *       500:
 *         description: Server error
 */
router.get('/draft', authMiddleware, async (req, res) => {
	try {
		const locationId = req.query.locationId;
		if (!locationId) {
			return res.status(400).json({ error: 'locationId query parameter is required' });
		}

		const ticket = await db('receiving_tickets')
			.where({
				location_id: locationId,
				status: 'DRAFT',
				created_by: req.user.id
			})
			.leftJoin('users as created_user', 'receiving_tickets.created_by', 'created_user.id')
			.select(
				'receiving_tickets.*',
				db.raw("COALESCE(created_user.first_name || ' ' || created_user.last_name, '') AS created_by_name")
			)
			.orderBy('receiving_tickets.created_at', 'desc')
			.first();

		if (!ticket) {
			return res.status(204).end();
		}

		const lines = await db('receiving_ticket_lines')
			.where('ticket_id', ticket.id)
			.join('parts', 'receiving_ticket_lines.part_id', 'parts.id')
			.select(
				'receiving_ticket_lines.*',
				'parts.sku',
				'parts.name',
				'parts.uom',
				'parts.default_cost'
			);

		ticket.lines = lines;

		res.json({
			success: true,
			data: ticket
		});
	} catch (error) {
		dtLogger.error('receiving_draft_get_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/receiving/summary/today:
 *   get:
 *     summary: Today's receiving summary for a location
 *     description: Returns aggregated counts for receiving tickets posted at the given location since 00:00 of the server's local day. Used by the receiving page header metric strip.
 *     tags:
 *       - Receiving
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: locationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Location UUID
 *     responses:
 *       200:
 *         description: Aggregated counts for today
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
 *                     totalParts:
 *                       type: number
 *                       description: Sum of qty_received across all lines on tickets posted today
 *                     totalLines:
 *                       type: number
 *                       description: Count of line items on tickets posted today
 *                     totalTickets:
 *                       type: number
 *                       description: Count of tickets posted today
 *       400:
 *         description: Missing locationId
 *       500:
 *         description: Server error
 */
router.get('/summary/today', authMiddleware, async (req, res) => {
	try {
		const locationId = req.query.locationId;
		if (!locationId) {
			return res.status(400).json({ error: 'locationId query parameter is required' });
		}

		const startOfToday = new Date();
		startOfToday.setHours(0, 0, 0, 0);

		const ticketRow = await db('receiving_tickets')
			.where('location_id', locationId)
			.andWhere('status', 'POSTED')
			.andWhere('posted_at', '>=', startOfToday)
			.count({ totalTickets: 'id' })
			.first();

		const totalTickets = Number(ticketRow?.totalTickets || 0);

		let totalLines = 0;
		let totalParts = 0;

		if (totalTickets > 0) {
			const lineAgg = await db('receiving_ticket_lines as l')
				.join('receiving_tickets as t', 'l.ticket_id', 't.id')
				.where('t.location_id', locationId)
				.andWhere('t.status', 'POSTED')
				.andWhere('t.posted_at', '>=', startOfToday)
				.select(
					db.raw('count(l.id) as "totalLines"'),
					db.raw('coalesce(sum(l.qty_received), 0) as "totalParts"')
				)
				.first();

			totalLines = Number(lineAgg?.totalLines || 0);
			totalParts = Number(lineAgg?.totalParts || 0);
		}

		res.json({
			success: true,
			data: { totalParts, totalLines, totalTickets }
		});
	} catch (error) {
		dtLogger.error('receiving_summary_today_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * Build a knex query with the receiving-activity filter set applied.
 * `query` is expected to already have `receiving_tickets` in its FROM/JOIN graph
 * because every filter column is qualified with the table name.
 */
function applyActivityFilters(query, filters) {
	query.where('receiving_tickets.status', 'POSTED');
	if (filters.locationId) {
		query.andWhere('receiving_tickets.location_id', filters.locationId);
	}
	if (filters.from) {
		const fromDate = filters.from instanceof Date ? filters.from : new Date(filters.from);
		if (!Number.isNaN(fromDate.getTime())) {
			query.andWhere('receiving_tickets.posted_at', '>=', fromDate);
		}
	}
	if (filters.to) {
		const toDate = filters.to instanceof Date ? filters.to : new Date(filters.to);
		if (!Number.isNaN(toDate.getTime())) {
			query.andWhere('receiving_tickets.posted_at', '<=', toDate);
		}
	}
	if (filters.userId) {
		query.andWhere('receiving_tickets.posted_by', filters.userId);
	}
	if (filters.vendor) {
		query.andWhere('receiving_tickets.vendor_name', filters.vendor);
	}
	return query;
}

/**
 * Escape a single CSV cell. Wraps the value in double quotes when it contains a
 * comma, quote, CR, or LF; doubles any embedded quotes.
 */
function csvEscape(value) {
	const s = value === null || value === undefined ? '' : String(value);
	if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
		return '"' + s.replace(/"/g, '""') + '"';
	}
	return s;
}

/**
 * @openapi
 * /api/receiving/activity:
 *   get:
 *     summary: Receiving activity report (paginated, with aggregations)
 *     description: |
 *       Returns POSTED receiving tickets matching the supplied filters, with line
 *       items expanded for the current page and `posted_by_name` + `location_name`
 *       resolved on every ticket. Aggregations (totalParts/totalLines/totalCost,
 *       byUser, byVendor) are computed across the full filtered set, not just the
 *       returned page. Pagination defaults to page=1, pageSize=25 (max 200).
 *       Auth required; no role gate beyond auth.
 *     tags:
 *       - Receiving
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: locationId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *         description: Lower bound for posted_at (inclusive)
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *         description: Upper bound for posted_at (inclusive)
 *       - in: query
 *         name: userId
 *         schema: { type: string, format: uuid }
 *         description: Filter by ticket poster (receiving_tickets.posted_by)
 *       - in: query
 *         name: vendor
 *         schema: { type: string }
 *         description: Exact vendor_name match
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 25 }
 *     responses:
 *       200:
 *         description: Paged ticket list with aggregations. `X-Total-Count` header carries the unpaged total.
 *         headers:
 *           X-Total-Count:
 *             schema: { type: integer }
 *             description: Total number of matching tickets (unpaged)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { type: object } }
 *                 page: { type: integer }
 *                 pageSize: { type: integer }
 *                 total: { type: integer }
 *                 totalParts: { type: number }
 *                 totalLines: { type: integer }
 *                 totalCost: { type: number }
 *                 byUser:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       userId: { type: string }
 *                       name: { type: string }
 *                       count: { type: integer }
 *                       totalParts: { type: number }
 *                 byVendor:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name: { type: string }
 *                       count: { type: integer }
 *       500:
 *         description: Server error
 */
router.get('/activity', authMiddleware, async (req, res) => {
	try {
		const page = Math.max(1, parseInt(req.query.page, 10) || 1);
		const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 25));

		const ticketsQuery = db('receiving_tickets')
			.leftJoin('users as posted_user', 'receiving_tickets.posted_by', 'posted_user.id')
			.leftJoin('locations', 'receiving_tickets.location_id', 'locations.id')
			.select(
				'receiving_tickets.*',
				db.raw("COALESCE(posted_user.first_name || ' ' || posted_user.last_name, '') AS posted_by_name"),
				db.raw('locations.name AS location_name')
			)
			.orderBy('receiving_tickets.posted_at', 'desc');
		applyActivityFilters(ticketsQuery, req.query);
		const allTickets = await ticketsQuery;

		const total = allTickets.length;
		const offset = (page - 1) * pageSize;
		const pageTickets = allTickets.slice(offset, offset + pageSize);

		// Lines for the current page only (kept off the wire for non-rendered pages).
		for (const ticket of pageTickets) {
			ticket.lines = await db('receiving_ticket_lines')
				.where('ticket_id', ticket.id)
				.leftJoin('parts', 'receiving_ticket_lines.part_id', 'parts.id')
				.select(
					'receiving_ticket_lines.*',
					'parts.sku',
					'parts.name',
					'parts.uom',
					'parts.default_cost'
				);
		}

		// Aggregations cover the full filtered set, not just the page.
		const ticketIds = allTickets.map((t) => t.id);
		let allLines = [];
		if (ticketIds.length > 0) {
			allLines = await db('receiving_ticket_lines')
				.whereIn('ticket_id', ticketIds)
				.select('ticket_id', 'qty_received', 'unit_cost');
		}

		let totalParts = 0;
		let totalCost = 0;
		const linesByTicket = new Map();
		for (const line of allLines) {
			const qty = Number(line.qty_received) || 0;
			const cost = Number(line.unit_cost) || 0;
			totalParts += qty;
			totalCost += qty * cost;
			const acc = linesByTicket.get(line.ticket_id) || 0;
			linesByTicket.set(line.ticket_id, acc + qty);
		}
		const totalLines = allLines.length;

		const byUserMap = new Map();
		for (const t of allTickets) {
			const key = t.posted_by || '__null__';
			if (!byUserMap.has(key)) {
				byUserMap.set(key, {
					userId: t.posted_by || null,
					name: t.posted_by_name || '',
					count: 0,
					totalParts: 0
				});
			}
			const entry = byUserMap.get(key);
			entry.count += 1;
			entry.totalParts += linesByTicket.get(t.id) || 0;
		}
		const byUser = Array.from(byUserMap.values()).sort((a, b) => b.count - a.count);

		const byVendorMap = new Map();
		for (const t of allTickets) {
			const name = t.vendor_name || '';
			if (!byVendorMap.has(name)) {
				byVendorMap.set(name, { name, count: 0 });
			}
			byVendorMap.get(name).count += 1;
		}
		const byVendor = Array.from(byVendorMap.values()).sort((a, b) => b.count - a.count);

		res.setHeader('X-Total-Count', String(total));
		res.json({
			success: true,
			data: pageTickets,
			page,
			pageSize,
			total,
			totalParts,
			totalLines,
			totalCost,
			byUser,
			byVendor
		});
	} catch (error) {
		dtLogger.error('receiving_activity_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/receiving/activity.csv:
 *   get:
 *     summary: Receiving activity report — CSV export (one row per line item)
 *     description: |
 *       Streams a CSV of every line item belonging to the filtered POSTED receiving
 *       tickets. The result is streamed row-by-row from the database (using
 *       knex `.stream()`) so memory stays bounded for >10k rows. Auth required;
 *       no role gate beyond auth.
 *
 *       Columns (in order): ticket_number, posted_at, location_name, vendor_name,
 *       reference_number, sku, name, qty_received, unit_cost, posted_by_name.
 *       Filters mirror `GET /api/receiving/activity`.
 *     tags:
 *       - Receiving
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: locationId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: userId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: vendor
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: CSV stream
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *       500:
 *         description: Server error
 */
router.get('/activity.csv', authMiddleware, async (req, res) => {
	const csvHeaders = [
		'ticket_number',
		'posted_at',
		'location_name',
		'vendor_name',
		'reference_number',
		'sku',
		'part_name',
		'qty_received',
		'unit_cost',
		'posted_by_name'
	];

	res.setHeader('Content-Type', 'text/csv; charset=utf-8');
	res.setHeader('Content-Disposition', 'attachment; filename="receiving-activity.csv"');

	let streamErrored = false;
	const handleError = (err) => {
		if (streamErrored) return;
		streamErrored = true;
		dtLogger.error('receiving_activity_csv_failed', { error: err.message });
		if (!res.headersSent) {
			res.status(500).json({ error: err.message });
		} else {
			try { res.end(); } catch (_e) { /* socket already torn down */ }
		}
	};

	try {
		res.write(csvHeaders.join(',') + '\n');

		const query = db('receiving_ticket_lines')
			.join('receiving_tickets', 'receiving_ticket_lines.ticket_id', 'receiving_tickets.id')
			.leftJoin('parts', 'receiving_ticket_lines.part_id', 'parts.id')
			.leftJoin('users as posted_user', 'receiving_tickets.posted_by', 'posted_user.id')
			.leftJoin('locations', 'receiving_tickets.location_id', 'locations.id')
			.select(
				'receiving_tickets.ticket_number as ticket_number',
				'receiving_tickets.posted_at as posted_at',
				db.raw('locations.name AS location_name'),
				'receiving_tickets.vendor_name as vendor_name',
				'receiving_tickets.reference_number as reference_number',
				'parts.sku as sku',
				'parts.name as part_name',
				'receiving_ticket_lines.qty_received as qty_received',
				'receiving_ticket_lines.unit_cost as unit_cost',
				db.raw("COALESCE(posted_user.first_name || ' ' || posted_user.last_name, '') AS posted_by_name")
			)
			.orderBy('receiving_tickets.posted_at', 'desc');
		applyActivityFilters(query, req.query);

		const stream = query.stream();
		stream.on('data', (row) => {
			const csvRow = csvHeaders.map((h) => csvEscape(row[h])).join(',');
			res.write(csvRow + '\n');
		});
		stream.on('end', () => {
			if (!streamErrored) res.end();
		});
		stream.on('error', handleError);
	} catch (err) {
		handleError(err);
	}
});

/**
 * @openapi
 * /api/receiving/{id}:
 *   get:
 *     summary: Get a receiving ticket by ID
 *     description: Returns a single receiving ticket with its line items and part details.
 *     tags:
 *       - Receiving
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Receiving ticket UUID
 *     responses:
 *       200:
 *         description: Receiving ticket with lines
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
 *         description: Receiving ticket not found
 *       500:
 *         description: Server error
 */
router.get('/:id', authMiddleware, async (req, res) => {
	try {
		const ticket = await db('receiving_tickets')
			.where('id', req.params.id)
			.leftJoin('users as created_user', 'receiving_tickets.created_by', 'created_user.id')
			.leftJoin('users as posted_user', 'receiving_tickets.posted_by', 'posted_user.id')
			.select(
				'receiving_tickets.*',
				db.raw("COALESCE(created_user.first_name || ' ' || created_user.last_name, '') AS created_by_name"),
				db.raw("COALESCE(posted_user.first_name || ' ' || posted_user.last_name, '') AS posted_by_name")
			)
			.first();

		if (!ticket) {
			return res.status(404).json({ error: 'Receiving ticket not found' });
		}

		// Include line items
		const lines = await db('receiving_ticket_lines')
			.where('ticket_id', ticket.id)
			.join('parts', 'receiving_ticket_lines.part_id', 'parts.id')
			.select(
				'receiving_ticket_lines.*',
				'parts.sku',
				'parts.name',
				'parts.uom',
				'parts.default_cost'
			);

		ticket.lines = lines;

		res.json({
			success: true,
			data: ticket
		});
	} catch (error) {
		dtLogger.error('receiving_ticket_get_failed', { id: req.params.id, error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/receiving:
 *   post:
 *     summary: Create a receiving ticket
 *     description: Creates a new DRAFT receiving ticket for a location. Requires Admin or Parts Manager role.
 *     tags:
 *       - Receiving
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - locationId
 *             properties:
 *               locationId:
 *                 type: string
 *                 format: uuid
 *               vendorName:
 *                 type: string
 *               referenceNumber:
 *                 type: string
 *                 description: PO or vendor reference number
 *     responses:
 *       201:
 *         description: Receiving ticket created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                 message:
 *                   type: string
 *       400:
 *         description: Missing locationId
 *       404:
 *         description: Location not found
 */
router.post('/', authMiddleware, requireRole(['admin', 'parts_manager']), async (req, res) => {
	try {
		const { locationId, vendorName, referenceNumber } = req.body;

		if (!locationId) {
			return res.status(400).json({ error: 'locationId is required' });
		}

		// Verify location exists
		const location = await db('locations').where('id', locationId).first();
		if (!location) {
			return res.status(404).json({ error: 'Location not found' });
		}

		const ticketNumber = await generateTicketNumber(locationId);

		const ticket = await db('receiving_tickets').insert({
			id: uuidv4(),
			location_id: locationId,
			ticket_number: ticketNumber,
			vendor_name: vendorName || null,
			reference_number: referenceNumber || null,
			status: 'DRAFT',
			created_by: req.user.id
		}).returning('*');

		dtLogger.info('receiving_ticket_created', { ticketId: ticket[0].id, ticketNumber });

		res.status(201).json({
			success: true,
			data: ticket[0],
			message: `Receiving ticket ${ticketNumber} created successfully`
		});
	} catch (error) {
		dtLogger.error('receiving_ticket_creation_failed', { error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/receiving/{id}/lines:
 *   post:
 *     summary: Add a line to a receiving ticket
 *     description: Adds a part line item to a DRAFT receiving ticket. The ticket must be in DRAFT status. Requires Admin or Parts Manager role.
 *     tags:
 *       - Receiving
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Receiving ticket UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - partId
 *               - qtyReceived
 *             properties:
 *               partId:
 *                 type: string
 *                 format: uuid
 *               qtyReceived:
 *                 type: number
 *                 minimum: 1
 *               unitCost:
 *                 type: number
 *                 description: Overrides default part cost
 *               binLocationOverride:
 *                 type: string
 *                 description: Override bin location for this receipt
 *     responses:
 *       201:
 *         description: Line item added
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                 message:
 *                   type: string
 *       400:
 *         description: Ticket not in DRAFT status or invalid qty
 *       404:
 *         description: Ticket or part not found
 */
router.post('/:id/lines', authMiddleware, requireRole(['admin', 'parts_manager']), async (req, res) => {
	try {
		const { partId, qtyReceived, unitCost, binLocationOverride } = req.body;

		const ticket = await db('receiving_tickets').where('id', req.params.id).first();
		if (!ticket) {
			return res.status(404).json({ error: 'Receiving ticket not found' });
		}

		if (ticket.status !== 'DRAFT') {
			return res.status(400).json({ error: 'Cannot add lines to a posted ticket' });
		}

		// Validate part
		const part = await db('parts').where('id', partId).first();
		if (!part) {
			return res.status(404).json({ error: 'Part not found' });
		}

		if (!part.is_active) {
			return res.status(400).json({ error: `Part ${part.sku} is inactive` });
		}

		if (!qtyReceived || qtyReceived <= 0) {
			return res.status(400).json({ error: 'qtyReceived must be positive' });
		}

		const line = await db('receiving_ticket_lines').insert({
			id: uuidv4(),
			ticket_id: ticket.id,
			part_id: partId,
			qty_received: qtyReceived,
			unit_cost: unitCost || part.default_cost || null,
			bin_location_override: binLocationOverride || null
		}).returning('*');

		dtLogger.info('receiving_line_added', { ticketId: ticket.id, partId, qty: qtyReceived });

		res.status(201).json({
			success: true,
			data: line[0],
			message: 'Line item added successfully'
		});
	} catch (error) {
		dtLogger.error('receiving_line_creation_failed', { ticketId: req.params.id, error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/receiving/{ticketId}/lines/{lineId}:
 *   delete:
 *     summary: Remove a line from a receiving ticket
 *     description: Deletes a line item from a DRAFT receiving ticket. Cannot remove lines from posted tickets. Requires Admin or Parts Manager role.
 *     tags:
 *       - Receiving
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Receiving ticket UUID
 *       - in: path
 *         name: lineId
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
 *                 message:
 *                   type: string
 *       400:
 *         description: Ticket not in DRAFT status
 *       404:
 *         description: Ticket or line not found
 */
router.delete('/:ticketId/lines/:lineId', authMiddleware, requireRole(['admin', 'parts_manager']), async (req, res) => {
	try {
		const ticket = await db('receiving_tickets').where('id', req.params.ticketId).first();
		if (!ticket) {
			return res.status(404).json({ error: 'Receiving ticket not found' });
		}

		if (ticket.status !== 'DRAFT') {
			return res.status(400).json({ error: 'Cannot delete lines from a posted ticket' });
		}

		const line = await db('receiving_ticket_lines').where('id', req.params.lineId).first();
		if (!line) {
			return res.status(404).json({ error: 'Line item not found' });
		}

		await db('receiving_ticket_lines').where('id', req.params.lineId).del();

		dtLogger.info('receiving_line_deleted', { ticketId: req.params.ticketId, lineId: req.params.lineId });

		res.json({
			success: true,
			message: 'Line item deleted successfully'
		});
	} catch (error) {
		dtLogger.error('receiving_line_deletion_failed', { ticketId: req.params.ticketId, error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/receiving/{id}/post:
 *   post:
 *     summary: Post a receiving ticket
 *     description: Finalizes a receiving ticket by creating RECEIVE inventory transactions for each line, incrementing on-hand quantities, and updating bin locations. This is a RECEIVE transaction type. Requires Admin or Parts Manager role.
 *     tags:
 *       - Receiving
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Receiving ticket UUID
 *     responses:
 *       200:
 *         description: Ticket posted and inventory updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                 message:
 *                   type: string
 *       400:
 *         description: Already posted, no lines, or invalid line data
 *       404:
 *         description: Receiving ticket not found
 */
router.post('/:id/post', authMiddleware, requireRole(['admin', 'parts_manager']), async (req, res) => {
	try {
		const ticket = await db('receiving_tickets').where('id', req.params.id).first();
		if (!ticket) {
			return res.status(404).json({ error: 'Receiving ticket not found' });
		}

		if (ticket.status === 'POSTED') {
			return res.status(400).json({ error: 'Ticket is already posted' });
		}

		const lines = await db('receiving_ticket_lines')
			.where('ticket_id', ticket.id)
			.join('parts', 'receiving_ticket_lines.part_id', 'parts.id');

		if (lines.length === 0) {
			return res.status(400).json({ error: 'Receiving ticket must have at least one line item' });
		}

		// Validate all lines
		for (const line of lines) {
			if (!line.qty_received || line.qty_received <= 0) {
				return res.status(400).json({ error: `Line item for part ${line.sku} has invalid qty` });
			}

			if (!line.is_active) {
				return res.status(400).json({ error: `Part ${line.sku} is inactive and cannot be received` });
			}
		}

		// Process all lines and create transactions
		const trx = await db.transaction();

		try {
			// Update ticket to POSTED
			await trx('receiving_tickets')
				.where('id', ticket.id)
				.update({
					status: 'POSTED',
					posted_by: req.user.id,
					posted_at: new Date()
				});

			// Create transactions and update inventory
			for (const line of lines) {
				const binLocation = line.bin_location_override || null;

				// Create inventory transaction
				await trx('inventory_transactions').insert({
					id: uuidv4(),
					location_id: ticket.location_id,
					part_id: line.part_id,
					transaction_type: 'RECEIVE',
					qty_change: line.qty_received,
					unit_cost_at_time: line.unit_cost || null,
					reference_type: 'RECEIVING_TICKET',
					reference_id: ticket.id,
					performed_by_user_id: req.user.id,
					notes: `Received from ${ticket.vendor_name || 'Unknown Vendor'}`
				});

				// Update inventory qty
				await trx('inventory')
					.where({ location_id: ticket.location_id, part_id: line.part_id })
					.increment('on_hand_qty', line.qty_received);

				// Also update parts.quantity_on_hand if column exists
				const partsColumns = await trx('parts').columnInfo();
				if ('quantity_on_hand' in partsColumns) {
					await trx('parts')
						.where({ id: line.part_id })
						.increment('quantity_on_hand', line.qty_received);
				}

				// Update bin location if override provided
				if (binLocation) {
					await trx('inventory')
						.where({ location_id: ticket.location_id, part_id: line.part_id })
						.update({ bin_location: binLocation });
				}

				// Update last_received_at
				await trx('inventory')
					.where({ location_id: ticket.location_id, part_id: line.part_id })
					.update({ last_received_at: new Date() });
			}

			await trx.commit();

			dtLogger.info('receiving_ticket_posted', { ticketId: ticket.id, lineCount: lines.length });

			// Fetch updated ticket
			const updatedTicket = await db('receiving_tickets').where('id', ticket.id).first();

			res.json({
				success: true,
				data: updatedTicket,
				message: `Receiving ticket posted successfully. ${lines.length} line(s) processed.`
			});
		} catch (error) {
			await trx.rollback();
			throw error;
		}
	} catch (error) {
		dtLogger.error('receiving_ticket_post_failed', { ticketId: req.params.id, error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/receiving/{id}/invoice:
 *   post:
 *     summary: Upload a vendor invoice and run AI line extraction
 *     description: |
 *       Uploads an invoice image or PDF (multipart/form-data, field name `file`),
 *       persists the storage reference on the receiving ticket, then forwards
 *       a short-lived signed URL to the AI service for vendor + line extraction.
 *
 *       Re-uploading replaces the previous file and extraction (orphaned R2
 *       objects are reaped by a separate sweeper, out of scope here).
 *
 *       The file is persisted to storage **before** the AI call, so an AI
 *       upstream failure leaves the ticket with a usable file_url and a null
 *       extraction. Callers can retry just the extraction in a follow-up.
 *
 *       Vendor name and reference number are auto-filled from the extraction
 *       only when currently null on the ticket — never overwritten.
 *
 *       Requires `admin` or `parts_manager` role.
 *     tags:
 *       - Receiving
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Receiving ticket UUID (must be in DRAFT status).
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Invoice image (jpg/png/heic) or PDF, up to 15 MB.
 *     responses:
 *       200:
 *         description: File uploaded; extraction succeeded or returned null on AI failure.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     ticket: { type: object, description: Updated receiving ticket. }
 *                     extraction:
 *                       type: object
 *                       nullable: true
 *                       description: |
 *                         Claude Vision payload —
 *                         `{ vendor, reference, invoiceDate, lines: [{ sku, description, qty, unitCost, match }] }`.
 *                         Null when the AI call failed; the file is still persisted.
 *                     fileUrl:
 *                       type: string
 *                       description: Short-lived signed download URL for the uploaded file.
 *                     aiError:
 *                       type: string
 *                       nullable: true
 *                       description: Upstream error code when extraction failed; null on success.
 *       400:
 *         description: Missing file, unsupported type, or ticket not in DRAFT.
 *       403:
 *         description: Caller lacks admin or parts_manager role.
 *       404:
 *         description: Receiving ticket not found.
 *       500:
 *         description: Storage upload failed.
 */
/**
 * Core handler for POST /:id/invoice — extracted from the Express closure
 * so it can be unit-tested with injected deps. The route below is just a
 * thin wrapper that wires multer + the real R2 + AI client.
 */
async function processInvoiceUpload(
	{ ticketId, file },
	{ db: dbDep, uploadBuffer: uploadDep, getSignedDownloadUrl: signDep, extractInvoiceViaAi: aiDep, logger, req }
) {
	if (!file) {
		return { status: 400, body: { error: 'file is required (multipart field "file")' } };
	}

	const ticket = await dbDep('receiving_tickets').where('id', ticketId).first();
	if (!ticket) {
		return { status: 404, body: { error: 'Receiving ticket not found' } };
	}
	if (ticket.status !== 'DRAFT') {
		return { status: 400, body: { error: 'Cannot attach invoice to a posted ticket' } };
	}

	let storageKey;
	try {
		const uploaded = await uploadDep({
			buffer: file.buffer,
			contentType: file.mimetype,
			prefix: `receiving/${ticketId}/invoice`,
			fileName: file.originalname || 'invoice'
		});
		storageKey = uploaded.key;
	} catch (uploadErr) {
		logger.error('receiving_invoice_upload_failed', { ticketId, error: uploadErr.message });
		return { status: 500, body: { error: 'Failed to upload invoice file' } };
	}

	// Persist the file reference BEFORE calling AI so a downstream AI failure
	// doesn't lose the upload. Stored value is the R2 storage key (signed on
	// demand for downloads); column name reads "url" but holds the key.
	await dbDep('receiving_tickets')
		.where('id', ticketId)
		.update({
			invoice_file_url: storageKey,
			invoice_extracted_data: null,
			invoice_extracted_at: null
		});

	let signedUrl;
	try {
		signedUrl = await signDep(storageKey);
	} catch (signErr) {
		logger.error('receiving_invoice_sign_failed', { ticketId, error: signErr.message });
		return { status: 500, body: { error: 'Failed to sign invoice URL for AI service' } };
	}

	const aiResult = await aiDep(req, { fileUrl: signedUrl, contentType: file.mimetype });

	let extraction = null;
	let aiError = null;
	if (aiResult && aiResult.ok && aiResult.data) {
		extraction = aiResult.data;
		const ticketPatch = {
			invoice_extracted_data: JSON.stringify(extraction),
			invoice_extracted_at: new Date()
		};
		if (!ticket.vendor_name && extraction.vendor) {
			ticketPatch.vendor_name = extraction.vendor;
		}
		if (!ticket.reference_number && extraction.reference) {
			ticketPatch.reference_number = extraction.reference;
		}
		await dbDep('receiving_tickets').where('id', ticketId).update(ticketPatch);
		logger.info('receiving_invoice_extracted', {
			ticketId,
			lineCount: Array.isArray(extraction.lines) ? extraction.lines.length : 0,
			vendorAutoFilled: !ticket.vendor_name && Boolean(extraction.vendor),
			referenceAutoFilled: !ticket.reference_number && Boolean(extraction.reference)
		});
	} else {
		aiError = (aiResult && aiResult.error) || 'AI_UPSTREAM_ERROR';
		logger.warn('receiving_invoice_extract_failed', { ticketId, aiError });
	}

	const updatedTicket = await dbDep('receiving_tickets').where('id', ticketId).first();

	return {
		status: 200,
		body: {
			success: true,
			data: {
				ticket: updatedTicket,
				extraction,
				fileUrl: signedUrl,
				aiError
			}
		}
	};
}

router.post(
	'/:id/invoice',
	authMiddleware,
	requireRole(['admin', 'parts_manager']),
	(req, res, next) => {
		invoiceUpload.single('file')(req, res, (err) => {
			if (!err) return next();
			if (err.code === 'LIMIT_FILE_SIZE') {
				return res.status(400).json({ error: 'File exceeds 15 MB limit' });
			}
			return res.status(400).json({ error: err.message || 'Upload failed' });
		});
	},
	async (req, res) => {
		try {
			const result = await processInvoiceUpload(
				{ ticketId: req.params.id, file: req.file },
				{
					db,
					uploadBuffer,
					getSignedDownloadUrl,
					extractInvoiceViaAi,
					logger: dtLogger,
					req
				}
			);
			return res.status(result.status).json(result.body);
		} catch (error) {
			dtLogger.error('receiving_invoice_endpoint_failed', {
				ticketId: req.params.id,
				error: error.message
			});
			return res.status(500).json({ error: error.message });
		}
	}
);

module.exports = router;
module.exports.processInvoiceUpload = processInvoiceUpload;
module.exports.INVOICE_ALLOWED_MIME = INVOICE_ALLOWED_MIME;
module.exports.INVOICE_MAX_BYTES = INVOICE_MAX_BYTES;
