'use strict';

/**
 * Triage enrichment — joins AI-suggested parts with the tenant's live parts
 * catalog and inventory, attaching on-hand qty + bin location per SKU.
 *
 * Inputs from the AI handler may use the legacy `{ query, qty }` shape or
 * the normalized `{ partName, suggestedSku?, qty, confidence? }` shape.
 * Both are accepted; not-found SKUs are surfaced explicitly rather than dropped.
 */

function trimToString(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function toPositiveQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  if (n <= 0) return 1;
  return n;
}

function normalizeAiParts(rawParts) {
  if (!Array.isArray(rawParts)) return [];
  return rawParts
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const partName = trimToString(raw.partName) || trimToString(raw.query);
      const suggestedSku = trimToString(raw.suggestedSku) || null;
      const qty = toPositiveQty(raw.qty);
      const confidence = typeof raw.confidence === 'number' ? raw.confidence : null;
      if (!partName && !suggestedSku) return null;
      return { partName, suggestedSku, qty, confidence };
    })
    .filter(Boolean);
}

function uniqueUpper(values) {
  return Array.from(new Set(values.filter(Boolean).map((v) => String(v).toUpperCase())));
}

function uniqueLower(values) {
  return Array.from(new Set(values.filter(Boolean).map((v) => String(v).toLowerCase())));
}

async function findCandidateParts(knex, tenantId, normalized) {
  const skuSet = uniqueUpper(normalized.map((p) => p.suggestedSku));
  const nameSet = uniqueLower(normalized.map((p) => p.partName));
  if (skuSet.length === 0 && nameSet.length === 0) return [];

  return knex('parts')
    .where('is_active', true)
    .andWhere(function tenantScope() {
      // tenant_id may be NULL for legacy rows that predate multi-MC scoping
      this.where('tenant_id', tenantId).orWhereNull('tenant_id');
    })
    .andWhere(function matchClause() {
      if (skuSet.length > 0) {
        this.whereRaw('UPPER(sku) = ANY(?)', [skuSet]);
      }
      if (nameSet.length > 0) {
        this.orWhereRaw('LOWER(name) = ANY(?)', [nameSet]);
      }
    })
    .select('id', 'sku', 'name', 'reorder_point_default');
}

async function findInventoryForParts(knex, tenantId, locationId, partIds) {
  if (!Array.isArray(partIds) || partIds.length === 0) return [];
  let q = knex('inventory as i')
    .join('locations as l', 'l.id', 'i.location_id')
    .where('l.tenant_id', tenantId)
    .whereIn('i.part_id', partIds)
    .select(
      'i.part_id',
      'i.location_id',
      'i.on_hand_qty',
      'i.reserved_qty',
      'i.bin_location',
      'i.min_stock_level',
    );
  if (locationId) {
    q = q.andWhere('i.location_id', locationId);
  }
  return q;
}

function indexPartRows(partRows) {
  const bySku = new Map();
  const byName = new Map();
  for (const row of partRows) {
    if (row.sku) {
      const key = String(row.sku).toUpperCase();
      if (!bySku.has(key)) bySku.set(key, row);
    }
    if (row.name) {
      const key = String(row.name).toLowerCase();
      if (!byName.has(key)) byName.set(key, row);
    }
  }
  return { bySku, byName };
}

function aggregateInventory(inventoryRows) {
  const byPartId = new Map();
  for (const row of inventoryRows) {
    const acc = byPartId.get(row.part_id) || {
      onHand: 0,
      reserved: 0,
      binLocation: null,
      minStockLevel: null,
      hasRow: false,
    };
    const onHand = Number(row.on_hand_qty);
    const reserved = Number(row.reserved_qty);
    const min = row.min_stock_level == null ? null : Number(row.min_stock_level);
    acc.onHand += Number.isFinite(onHand) ? onHand : 0;
    acc.reserved += Number.isFinite(reserved) ? reserved : 0;
    if (acc.binLocation == null && row.bin_location) acc.binLocation = row.bin_location;
    if (acc.minStockLevel == null && Number.isFinite(min)) acc.minStockLevel = min;
    acc.hasRow = true;
    byPartId.set(row.part_id, acc);
  }
  return byPartId;
}

function classifyInventory(onHand, reorderPoint) {
  if (!Number.isFinite(onHand) || onHand <= 0) return 'out_of_stock';
  if (Number.isFinite(reorderPoint) && reorderPoint != null && onHand <= reorderPoint) {
    return 'low_stock';
  }
  return 'in_stock';
}

function resolveMatch(item, index) {
  if (item.suggestedSku) {
    const skuMatch = index.bySku.get(item.suggestedSku.toUpperCase());
    if (skuMatch) return skuMatch;
  }
  if (item.partName) {
    const nameMatch = index.byName.get(item.partName.toLowerCase());
    if (nameMatch) return nameMatch;
  }
  return null;
}

function buildEnrichedParts({ normalized, partRows, inventoryRows }) {
  const index = indexPartRows(partRows);
  const inventoryByPartId = aggregateInventory(inventoryRows);

  return normalized.map((item) => {
    const part = resolveMatch(item, index);
    const base = {
      partName: item.partName,
      suggestedSku: part ? part.sku : item.suggestedSku,
      qty: item.qty,
      confidence: item.confidence,
    };

    if (!part) {
      return {
        ...base,
        partId: null,
        onHand: null,
        binLocation: null,
        reorderPoint: null,
        isLowStock: false,
        inventoryStatus: 'not_found',
      };
    }

    const inv = inventoryByPartId.get(part.id);
    const reorderPoint = inv && inv.minStockLevel != null
      ? inv.minStockLevel
      : (part.reorder_point_default == null ? null : Number(part.reorder_point_default));

    if (!inv || !inv.hasRow) {
      return {
        ...base,
        partId: part.id,
        onHand: 0,
        binLocation: null,
        reorderPoint,
        isLowStock: true,
        inventoryStatus: 'out_of_stock',
      };
    }

    const onHand = inv.onHand;
    const inventoryStatus = classifyInventory(onHand, reorderPoint);
    const isLowStock = inventoryStatus !== 'in_stock';

    return {
      ...base,
      partId: part.id,
      onHand,
      binLocation: inv.binLocation,
      reorderPoint,
      isLowStock,
      inventoryStatus,
    };
  });
}

async function enrichTriageParts({ knex, tenantId, locationId, parts }) {
  const normalized = normalizeAiParts(parts);
  if (normalized.length === 0) return [];

  const partRows = await findCandidateParts(knex, tenantId, normalized);
  const matchedPartIds = Array.from(new Set(partRows.map((row) => row.id)));
  const inventoryRows = matchedPartIds.length === 0
    ? []
    : await findInventoryForParts(knex, tenantId, locationId, matchedPartIds);

  return buildEnrichedParts({ normalized, partRows, inventoryRows });
}

module.exports = {
  enrichTriageParts,
  normalizeAiParts,
  findCandidateParts,
  findInventoryForParts,
  buildEnrichedParts,
};
