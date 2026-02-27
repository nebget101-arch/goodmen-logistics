const db = require('../config/knex');

function normalizeScanCode(value) {
  return String(value || '')
    .trim()
    .replace(/^sku\s*[:#-]?\s*/i, '')
    .trim();
}

async function getBarcodeByCode(code) {
  const rawCode = String(code || '').trim();
  const normalizedCode = normalizeScanCode(rawCode);
  if (!rawCode && !normalizedCode) return null;

  const barcode = await db('part_barcodes as pb')
    .join('parts as p', 'pb.part_id', 'p.id')
    .select(
      'pb.id',
      'pb.barcode_value',
      'pb.pack_qty',
      'pb.vendor',
      'pb.part_id',
      'p.sku',
      'p.name',
      'p.category',
      'p.default_retail_price',
      'p.default_cost',
      'p.taxable'
    )
    .where({ 'pb.is_active': true })
    .andWhere(function () {
      if (rawCode) {
        this.orWhereRaw('LOWER(TRIM(pb.barcode_value)) = LOWER(?)', [rawCode]);
      }
      if (normalizedCode && normalizedCode !== rawCode) {
        this.orWhereRaw('LOWER(TRIM(pb.barcode_value)) = LOWER(?)', [normalizedCode]);
      }
    })
    .first();

  if (barcode) return barcode;

  // Fallback: allow scanning SKU directly (e.g. "TRK-001" or "SKU: TRK-001")
  const part = await db('parts as p')
    .select(
      'p.id as part_id',
      'p.sku',
      'p.name',
      'p.category',
      'p.default_retail_price',
      'p.default_cost',
      'p.taxable'
    )
    .whereRaw('LOWER(TRIM(p.sku)) = LOWER(?)', [normalizedCode])
    .first();

  if (!part) return null;

  return {
    id: null,
    barcode_value: normalizedCode,
    pack_qty: 1,
    vendor: null,
    part_id: part.part_id,
    sku: part.sku,
    name: part.name,
    category: part.category,
    default_retail_price: part.default_retail_price,
    default_cost: part.default_cost,
    taxable: part.taxable
  };
}

async function assignBarcodeToPart(partId, { barcodeValue, packQty = 1, vendor = null }) {
  if (!barcodeValue) {
    throw new Error('barcodeValue is required');
  }
  if (!partId) {
    throw new Error('partId is required');
  }

  const qty = Number(packQty);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error('packQty must be a positive number');
  }

  return db.transaction(async trx => {
    const part = await trx('parts').where({ id: partId }).first();
    if (!part) throw new Error('Part not found');

    const existing = await trx('part_barcodes')
      .where({ barcode_value: barcodeValue })
      .first();

    if (existing && existing.part_id !== partId) {
      throw new Error('Barcode is already assigned to a different part');
    }
    if (existing && existing.part_id === partId) {
      throw new Error('Barcode is already assigned to this part');
    }

    const [created] = await trx('part_barcodes')
      .insert({
        barcode_value: barcodeValue,
        part_id: partId,
        pack_qty: Math.floor(qty),
        vendor,
        is_active: true
      })
      .returning('*');

    return created;
  });
}

async function getBarcodesByPart(partId) {
  return db('part_barcodes')
    .where({ part_id: partId })
    .orderBy('created_at', 'desc');
}

module.exports = {
  getBarcodeByCode,
  assignBarcodeToPart,
  getBarcodesByPart
};
