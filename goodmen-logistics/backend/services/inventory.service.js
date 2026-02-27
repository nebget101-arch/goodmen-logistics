const db = require('../config/knex');
const dtLogger = require('../utils/dynatrace-logger');
const { generateInvoiceNumber } = require('../utils/invoice-number');

function toPositiveInt(value, fieldName) {
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) {
		throw new Error(`${fieldName} must be a positive number`);
	}
	return Math.floor(n);
}

async function lockInventoryRow(trx, locationId, partId, { createIfMissing = false } = {}) {
	let row = await trx('inventory')
		.where({ location_id: locationId, part_id: partId })
		.forUpdate()
		.first();

	if (!row && createIfMissing) {
		await trx('inventory').insert({
			location_id: locationId,
			part_id: partId,
			on_hand_qty: 0,
			reserved_qty: 0
		});

		row = await trx('inventory')
			.where({ location_id: locationId, part_id: partId })
			.forUpdate()
			.first();
	}

	return row;
}

async function appendInventoryTransaction(trx, {
	txType,
	qtyChange,
	partId,
	locationId,
	referenceType,
	referenceId,
	performedBy,
	notes,
	unitCostAtTime
}) {
	const normalizedTxType = (txType || '').toString().toUpperCase();
	const legacyTransactionType = normalizedTxType === 'RECEIVE' ? 'RECEIVE' : 'ADJUST';
	const normalizedReferenceType = (referenceType || '').toString().toUpperCase();

	let legacyReferenceType = 'ADJUSTMENT';
	if (normalizedReferenceType === 'RECEIVING_TICKET') legacyReferenceType = 'RECEIVING_TICKET';
	if (normalizedReferenceType === 'CYCLE_COUNT') legacyReferenceType = 'CYCLE_COUNT';

	const [row] = await trx('inventory_transactions')
		.insert({
			location_id: locationId,
			part_id: partId,
			transaction_type: legacyTransactionType,
			tx_type: normalizedTxType || null,
			qty_change: qtyChange,
			unit_cost_at_time: unitCostAtTime || null,
			reference_type: legacyReferenceType,
			reference_id: referenceId,
			performed_by_user_id: performedBy || null,
			performed_by: performedBy || null,
			notes: notes || null
		})
		.returning('*');

	return row;
}

async function applyInventoryDelta(trx, {
	locationId,
	partId,
	qtyDelta,
	txType,
	referenceType,
	referenceId,
	performedBy,
	notes,
	unitCostAtTime,
	createIfMissing = false,
	requireSufficientStock = false
}) {
	const locked = await lockInventoryRow(trx, locationId, partId, { createIfMissing });
	if (!locked) {
		throw new Error(`Inventory row not found for location ${locationId}, part ${partId}`);
	}

	if (requireSufficientStock && qtyDelta < 0) {
		const requested = Math.abs(qtyDelta);
		if (Number(locked.on_hand_qty) < requested) {
			throw new Error(`Insufficient stock for part ${partId} at location ${locationId}`);
		}
	}

	const [updated] = await trx('inventory')
		.where({ id: locked.id })
		.update({
			on_hand_qty: trx.raw('on_hand_qty + ?', [qtyDelta]),
			last_received_at: txType === 'RECEIVE' ? trx.fn.now() : locked.last_received_at,
			last_issued_at: qtyDelta < 0 ? trx.fn.now() : locked.last_issued_at,
			updated_at: trx.fn.now()
		})
		.returning('*');

	if (Number(updated.on_hand_qty) < 0) {
		throw new Error(`Inventory cannot go negative for part ${partId} at location ${locationId}`);
	}

	const transaction = await appendInventoryTransaction(trx, {
		txType,
		qtyChange: qtyDelta,
		partId,
		locationId,
		referenceType,
		referenceId,
		performedBy,
		notes,
		unitCostAtTime
	});

	return { inventory: updated, transaction };
}

async function receiveInventory({ locationId, partId, qty, unitCostAtTime, referenceType, referenceId, performedBy, notes }) {
	const quantity = toPositiveInt(qty, 'qty');

	return db.transaction(async trx => {
		return applyInventoryDelta(trx, {
			locationId,
			partId,
			qtyDelta: quantity,
			txType: 'RECEIVE',
			referenceType: referenceType || 'RECEIVING_TICKET',
			referenceId,
			performedBy,
			notes,
			unitCostAtTime,
			createIfMissing: true,
			requireSufficientStock: false
		});
	});
}

async function createTransfer({ fromLocationId, toLocationId, lines, performedBy, notes }) {
	if (!Array.isArray(lines) || lines.length === 0) {
		throw new Error('lines are required');
	}
	if (!fromLocationId || !toLocationId) {
		throw new Error('fromLocationId and toLocationId are required');
	}
	if (fromLocationId === toLocationId) {
		throw new Error('fromLocationId and toLocationId must be different');
	}

	return db.transaction(async trx => {
		const transferNumber = `TRF-${Date.now()}`;
		const [transfer] = await trx('inventory_transfers')
			.insert({
				transfer_number: transferNumber,
				from_location_id: fromLocationId,
				to_location_id: toLocationId,
				status: 'SENT',
				created_by_user_id: performedBy || null,
				sent_by_user_id: performedBy || null,
				sent_at: trx.fn.now(),
				notes: notes || null
			})
			.returning('*');

		const createdLines = [];
		for (const line of lines) {
			const quantity = toPositiveInt(line.qty, 'line.qty');
			const partId = line.partId;
			if (!partId) throw new Error('line.partId is required');

			const [transferLine] = await trx('inventory_transfer_lines')
				.insert({
					transfer_id: transfer.id,
					part_id: partId,
					qty: quantity,
					qty_received: 0,
					unit_cost_at_time: line.unitCostAtTime || null,
					notes: line.notes || null
				})
				.returning('*');

			const result = await applyInventoryDelta(trx, {
				locationId: fromLocationId,
				partId,
				qtyDelta: -quantity,
				txType: 'TRANSFER_OUT',
				referenceType: 'TRANSFER',
				referenceId: transfer.id,
				performedBy,
				notes: notes || null,
				unitCostAtTime: line.unitCostAtTime || null,
				requireSufficientStock: true
			});

			createdLines.push({
				...transferLine,
				sourceInventory: result.inventory
			});
		}

		return { transfer, lines: createdLines };
	});
}

async function receiveTransfer({ transferId, receivedBy, notes }) {
	return db.transaction(async trx => {
		const transfer = await trx('inventory_transfers')
			.where({ id: transferId })
			.forUpdate()
			.first();

		if (!transfer) throw new Error('Transfer not found');
		if (transfer.status === 'RECEIVED') throw new Error('Transfer already received');
		if (transfer.status === 'CANCELLED') throw new Error('Cannot receive a cancelled transfer');

		const lines = await trx('inventory_transfer_lines')
			.where({ transfer_id: transferId })
			.forUpdate()
			.select('*');

		const receivedLines = [];
		for (const line of lines) {
			const qtyToReceive = Number(line.qty_received || 0) > 0 ? Number(line.qty_received) : Number(line.qty);

			const result = await applyInventoryDelta(trx, {
				locationId: transfer.to_location_id,
				partId: line.part_id,
				qtyDelta: qtyToReceive,
				txType: 'TRANSFER_IN',
				referenceType: 'TRANSFER',
				referenceId: transfer.id,
				performedBy: receivedBy,
				notes: notes || null,
				unitCostAtTime: line.unit_cost_at_time || null,
				createIfMissing: true,
				requireSufficientStock: false
			});

			await trx('inventory_transfer_lines')
				.where({ id: line.id })
				.update({
					qty_received: qtyToReceive,
					updated_at: trx.fn.now()
				});

			receivedLines.push({ lineId: line.id, partId: line.part_id, qtyReceived: qtyToReceive, targetInventory: result.inventory });
		}

		const [updatedTransfer] = await trx('inventory_transfers')
			.where({ id: transferId })
			.update({
				status: 'RECEIVED',
				received_by_user_id: receivedBy || null,
				received_at: trx.fn.now(),
				notes: notes || transfer.notes,
				updated_at: trx.fn.now()
			})
			.returning('*');

		return { transfer: updatedTransfer, lines: receivedLines };
	});
}

async function consumeInventory({ locationId, partId, qty, referenceType, referenceId, performedBy, notes }) {
	const quantity = toPositiveInt(qty, 'qty');

	return db.transaction(async trx => {
		return applyInventoryDelta(trx, {
			locationId,
			partId,
			qtyDelta: -quantity,
			txType: 'CONSUME',
			referenceType: referenceType || 'WORK_ORDER',
			referenceId,
			performedBy,
			notes,
			requireSufficientStock: true
		});
	});
}

async function createDirectSale({ customerId, locationId, items, performedBy, notes, taxRatePercent = 0 }) {
	if (!customerId || !locationId) {
		throw new Error('customerId and locationId are required');
	}
	if (!Array.isArray(items) || items.length === 0) {
		throw new Error('items are required');
	}

	return db.transaction(async trx => {
		const saleNumber = `SAL-${Date.now()}`;
		const [sale] = await trx('customer_sales')
			.insert({
				sale_number: saleNumber,
				customer_id: customerId,
				location_id: locationId,
				status: 'DRAFT',
				notes: notes || null,
				created_by_user_id: performedBy || null
			})
			.returning('*');

		let subtotal = 0;
		let taxAmount = 0;

		for (const item of items) {
			const quantity = toPositiveInt(item.qty, 'item.qty');
			const part = await trx('parts').where({ id: item.partId }).first();
			if (!part) throw new Error(`Part not found: ${item.partId}`);

			const unitPrice = Number(item.unitPrice ?? part.default_retail_price ?? 0);
			const lineSubtotal = unitPrice * quantity;
			const lineTax = part.taxable ? (lineSubtotal * Number(taxRatePercent || 0)) / 100 : 0;
			const lineTotal = lineSubtotal + lineTax;

			subtotal += lineSubtotal;
			taxAmount += lineTax;

			await trx('customer_sale_lines').insert({
				sale_id: sale.id,
				part_id: part.id,
				barcode_id: item.barcodeId || null,
				qty: quantity,
				unit_price: unitPrice,
				taxable: !!part.taxable,
				line_total: lineTotal
			});

			await applyInventoryDelta(trx, {
				locationId,
				partId: part.id,
				qtyDelta: -quantity,
				txType: 'SALE',
				referenceType: 'CUSTOMER_SALE',
				referenceId: sale.id,
				performedBy,
				notes,
				requireSufficientStock: true
			});
		}

		const totalAmount = subtotal + taxAmount;

		const invoiceNumber = await generateInvoiceNumber(trx);
		const [invoice] = await trx('invoices')
			.insert({
				invoice_number: invoiceNumber,
				work_order_id: null,
				customer_id: customerId,
				location_id: locationId,
				status: 'DRAFT',
				issued_date: trx.raw('CURRENT_DATE'),
				subtotal_labor: 0,
				subtotal_parts: subtotal,
				subtotal_fees: 0,
				tax_rate_percent: taxRatePercent,
				tax_amount: taxAmount,
				total_amount: totalAmount,
				amount_paid: 0,
				balance_due: totalAmount,
				notes: notes || null,
				created_by_user_id: performedBy || null
			})
			.returning('*');

		const lines = await trx('customer_sale_lines as sl')
			.join('parts as p', 'sl.part_id', 'p.id')
			.where({ 'sl.sale_id': sale.id })
			.select('sl.*', 'p.name as part_name');

		for (const line of lines) {
			await trx('invoice_line_items').insert({
				invoice_id: invoice.id,
				line_type: 'PART',
				source_ref_type: 'customer_sale_line',
				source_ref_id: line.id,
				description: line.part_name,
				quantity: line.qty,
				unit_price: line.unit_price,
				taxable: line.taxable,
				line_total: line.line_total
			});
		}

		const [updatedSale] = await trx('customer_sales')
			.where({ id: sale.id })
			.update({
				status: 'COMPLETED',
				invoice_id: invoice.id,
				subtotal,
				tax_amount: taxAmount,
				total_amount: totalAmount,
				completed_at: trx.fn.now(),
				updated_at: trx.fn.now()
			})
			.returning('*');

		return { sale: updatedSale, invoice };
	});
}

async function listTransactions(filters = {}) {
	const {
		locationId,
		userId,
		txType,
		referenceType,
		referenceId,
		dateFrom,
		dateTo,
		limit = 200
	} = filters;

	let query = db('inventory_transactions as it')
		.leftJoin('parts as p', 'it.part_id', 'p.id')
		.leftJoin('locations as l', 'it.location_id', 'l.id')
		.leftJoin('users as u', 'it.performed_by', 'u.id')
		.select(
			'it.*',
			db.raw('COALESCE(it.tx_type, it.transaction_type) as tx_type_effective'),
			'p.sku as part_sku',
			'p.name as part_name',
			'l.name as location_name',
			'u.username as performed_by_username'
		)
		.orderBy('it.created_at', 'desc')
		.limit(Math.min(Number(limit) || 200, 1000));

	if (locationId) query = query.where('it.location_id', locationId);
	if (userId) query = query.where(qb => qb.where('it.performed_by', userId).orWhere('it.performed_by_user_id', userId));
	if (txType) query = query.whereRaw('COALESCE(it.tx_type, it.transaction_type) = ?', [String(txType).toUpperCase()]);
	if (referenceType) query = query.where('it.reference_type', String(referenceType).toUpperCase());
	if (referenceId) query = query.where('it.reference_id', referenceId);
	if (dateFrom) query = query.where('it.created_at', '>=', dateFrom);
	if (dateTo) query = query.where('it.created_at', '<=', dateTo);

	return query;
}

/**
 * Create an inventory transaction (append-only audit log)
 * Handles qty changes, updates inventory levels, computes alerts
 */
async function createTransaction(locationId, partId, transactionType, qtyChange, {
	unitCostAtTime = null,
	referenceType = null,
	referenceId = null,
	performedByUserId = null,
	notes = null
} = {}) {
	const normalizedType = (transactionType || '').toUpperCase();
	const txType = normalizedType === 'CYCLE_COUNT_ADJUST' ? 'ADJUST' : normalizedType;

	return db.transaction(async trx => {
		const result = await applyInventoryDelta(trx, {
			locationId,
			partId,
			qtyDelta: Number(qtyChange),
			txType,
			referenceType,
			referenceId,
			performedBy: performedByUserId,
			notes,
			unitCostAtTime,
			createIfMissing: Number(qtyChange) > 0,
			requireSufficientStock: Number(qtyChange) < 0
		});

		dtLogger.info('inventory_transaction_created', {
			transactionType: txType,
			locationId,
			partId,
			qtyChange,
			newOnHand: result.inventory.on_hand_qty
		});

		return result;
	});
}

/**
 * Get alerts for a location (low stock + out of stock)
 * Returns computed alerts based on current inventory vs min levels
 */
async function getAlerts(locationId, filters = {}) {
	try {
		let query = db('inventory')
			.join('parts', 'inventory.part_id', 'parts.id')
			.select(
				'inventory.location_id',
				'inventory.part_id',
				'parts.sku',
				'parts.name',
				'inventory.on_hand_qty',
				'inventory.min_stock_level',
				'inventory.available_qty as availableQty',
				db.raw(`
					CASE 
						WHEN inventory.on_hand_qty = 0 THEN 'OUT'
						WHEN (inventory.on_hand_qty - inventory.reserved_qty) <= inventory.min_stock_level THEN 'LOW'
						ELSE 'NORMAL'
					END as severity
				`),
				'inventory.updated_at as lastActivity'
			)
			.where({ 'inventory.location_id': locationId });

		// Filter by severity if provided
		if (filters.severity && filters.severity !== 'ALL') {
			if (filters.severity === 'OUT') {
				query = query.whereRaw('inventory.on_hand_qty = 0');
			} else if (filters.severity === 'LOW') {
				query = query.whereRaw('(inventory.on_hand_qty - inventory.reserved_qty) <= inventory.min_stock_level')
					.andWhereRaw('inventory.on_hand_qty > 0');
			}
		} else {
			// Default: return OUT or LOW
			query = query.whereRaw(
				'inventory.on_hand_qty = 0 OR (inventory.on_hand_qty - inventory.reserved_qty) <= inventory.min_stock_level'
			);
		}

		const alerts = await query.orderBy('inventory.on_hand_qty', 'asc');

		dtLogger.info('alerts_retrieved', { locationId, count: alerts.length });

		return alerts;
	} catch (error) {
		dtLogger.error('alerts_retrieval_failed', { locationId, error: error.message });
		throw error;
	}
}

/**
 * Validate that an inventory operation is allowed
 */
async function validateInventoryOperation(locationId, partId, requiredQty, operationType = 'ADJUST') {
	try {
		const part = await db('parts').where({ id: partId }).first();
		if (!part) {
			throw new Error(`Part ${partId} not found`);
		}

		const inventory = await db('inventory')
			.where({ location_id: locationId, part_id: partId })
			.first();

		if (!inventory) {
			throw new Error(`Inventory record not found for location ${locationId}, part ${partId}`);
		}

		if (requiredQty < 0 && operationType !== 'ADJUST') {
			throw new Error(`Required quantity must be positive for ${operationType}`);
		}

		return { part, inventory };
	} catch (error) {
		dtLogger.error('inventory_validation_failed', { locationId, partId, error: error.message });
		throw error;
	}
}

/**
 * Get available quantity for a part at a location
 */
async function getAvailableQty(locationId, partId) {
	try {
		const inventory = await db('inventory')
			.where({ location_id: locationId, part_id: partId })
			.select(
				'on_hand_qty',
				'reserved_qty',
				db.raw('(on_hand_qty - reserved_qty) as available_qty')
			)
			.first();

		return inventory ? (inventory.on_hand_qty - inventory.reserved_qty) : 0;
	} catch (error) {
		dtLogger.error('available_qty_retrieval_failed', { locationId, partId, error: error.message });
		throw error;
	}
}

/**
 * Get inventory status for a location (summary)
 */
async function getInventoryStatus(locationId) {
	try {
		const status = await db('inventory')
			.where('location_id', locationId)
			.select(
				db.raw('COUNT(*) as total_items'),
				db.raw('COUNT(CASE WHEN on_hand_qty = 0 THEN 1 END) as out_of_stock'),
				db.raw('COUNT(CASE WHEN (on_hand_qty - reserved_qty) <= min_stock_level AND on_hand_qty > 0 THEN 1 END) as low_stock'),
				db.raw('SUM(on_hand_qty) as total_on_hand'),
				db.raw('SUM(reserved_qty) as total_reserved')
			)
			.first();

		return status;
	} catch (error) {
		dtLogger.error('inventory_status_retrieval_failed', { locationId, error: error.message });
		throw error;
	}
}

module.exports = {
	createTransaction,
	receiveInventory,
	createTransfer,
	receiveTransfer,
	consumeInventory,
	createDirectSale,
	listTransactions,
	getAlerts,
	validateInventoryOperation,
	getAvailableQty,
	getInventoryStatus
};
