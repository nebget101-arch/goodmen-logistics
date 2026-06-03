'use strict';

const { query } = require('../internal/db');

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

async function resolveVehicleSource() {
  try {
    const viewResult = await query("SELECT to_regclass('public.all_vehicles') AS rel");
    if (viewResult?.rows?.[0]?.rel) return 'all_vehicles';
    const tableResult = await query("SELECT to_regclass('public.vehicles') AS rel");
    if (tableResult?.rows?.[0]?.rel) return 'vehicles';
    return 'none';
  } catch {
    return 'none';
  }
}

function clampPage(value) {
  const num = parseInt(value, 10);
  return Number.isFinite(num) && num > 0 ? num : 1;
}

function clampPageSize(value) {
  const num = parseInt(value, 10);
  if (!Number.isFinite(num) || num <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(num, MAX_PAGE_SIZE);
}

function toNumberOrNull(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * Fetch the maintenance history for a single fleet or customer-owned vehicle.
 *
 * Resolution flow:
 *   1. Look up VIN from the all_vehicles view (or vehicles table) for the given
 *      :id within the caller's tenant. Returns null if the vehicle is not
 *      visible to this tenant — caller maps that to 404.
 *   2. Find every customer_vehicles.vehicle_uuid sharing that VIN within the
 *      tenant. work_orders.vehicle_id is FK'd to customer_vehicles.vehicle_uuid
 *      since 20260228182000_update_work_orders_vehicle_fk_to_customer_vehicles.
 *   3. Aggregate total + lifetime_spend across all WOs (excluding CANCELED).
 *   4. Page the WO+invoice rows.
 *
 * lifetime_spend deliberately excludes CANCELED work orders since those represent
 * voided spend, not actual maintenance cost.
 *
 * @param {string} vehicleId  vehicles.id (fleet) or customer_vehicles.vehicle_uuid (customer-owned)
 * @param {object} options
 * @param {string} options.tenantId  required — enforces tenant scoping at every step
 * @param {number} [options.page=1]
 * @param {number} [options.pageSize=25]
 * @param {boolean} [options.includeInvoices=true]  when false, the `invoice` field is omitted from each row
 * @returns {Promise<{ data: Array, meta: object } | null>}  null when the vehicle is not visible to the tenant
 */
async function getVehicleMaintenanceHistory(vehicleId, { tenantId, page = 1, pageSize = DEFAULT_PAGE_SIZE, includeInvoices = true } = {}) {
  if (!vehicleId || !tenantId) return null;

  const vehicleSource = await resolveVehicleSource();
  if (vehicleSource === 'none') return null;

  const vehicleResult = await query(
    `SELECT vin FROM ${vehicleSource} WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [vehicleId, tenantId]
  );
  if (!vehicleResult.rows.length) return null;
  const vin = vehicleResult.rows[0].vin;

  const safePage = clampPage(page);
  const safePageSize = clampPageSize(pageSize);

  const emptyMeta = {
    page: safePage,
    pageSize: safePageSize,
    total: 0,
    lifetime_spend: 0
  };

  if (!vin) {
    return { data: [], meta: emptyMeta };
  }

  const cvResult = await query(
    'SELECT vehicle_uuid FROM customer_vehicles WHERE vin = $1 AND tenant_id = $2',
    [vin, tenantId]
  );
  const vehicleUuids = cvResult.rows.map((r) => r.vehicle_uuid).filter(Boolean);
  if (!vehicleUuids.length) {
    return { data: [], meta: emptyMeta };
  }

  const aggResult = await query(
    `SELECT COUNT(*)::bigint AS total,
            COALESCE(SUM(CASE WHEN status = 'CANCELED' THEN 0 ELSE total_amount END), 0)::numeric AS lifetime_spend
       FROM work_orders
      WHERE vehicle_id = ANY($1::uuid[])
        AND tenant_id = $2`,
    [vehicleUuids, tenantId]
  );
  const total = parseInt(aggResult.rows[0]?.total || '0', 10);
  const lifetimeSpend = Number(aggResult.rows[0]?.lifetime_spend || 0);

  const offset = (safePage - 1) * safePageSize;

  const rowResult = await query(
    `SELECT
        wo.id                      AS work_order_id,
        wo.work_order_number       AS work_order_number,
        wo.type                    AS type,
        wo.status                  AS status,
        wo.description             AS title,
        wo.created_at::date        AS request_date,
        wo.completed_at::date      AS completion_date,
        l.name                     AS shop_location_name,
        wo.labor_subtotal::numeric AS labor_total,
        wo.parts_subtotal::numeric AS parts_total,
        wo.total_amount::numeric   AS grand_total,
        i.id                       AS invoice_id,
        i.invoice_number           AS invoice_number,
        i.status                   AS invoice_status,
        i.balance_due::numeric     AS invoice_amount_due
      FROM work_orders wo
      LEFT JOIN locations l ON l.id = wo.location_id
      LEFT JOIN LATERAL (
        SELECT inv.id, inv.invoice_number, inv.status, inv.balance_due
          FROM invoices inv
         WHERE inv.work_order_id = wo.id
           AND inv.tenant_id = $2
         ORDER BY inv.created_at DESC
         LIMIT 1
      ) i ON TRUE
      WHERE wo.vehicle_id = ANY($1::uuid[])
        AND wo.tenant_id = $2
      ORDER BY wo.created_at DESC
      LIMIT $3 OFFSET $4`,
    [vehicleUuids, tenantId, safePageSize, offset]
  );

  const data = rowResult.rows.map((r) => {
    const row = {
      work_order_id: r.work_order_id,
      work_order_number: r.work_order_number,
      type: r.type,
      status: r.status,
      title: r.title,
      request_date: r.request_date,
      completion_date: r.completion_date,
      shop_location_name: r.shop_location_name,
      labor_total: toNumberOrNull(r.labor_total),
      parts_total: toNumberOrNull(r.parts_total),
      grand_total: toNumberOrNull(r.grand_total)
    };
    if (includeInvoices) {
      row.invoice = r.invoice_id
        ? {
            id: r.invoice_id,
            number: r.invoice_number,
            status: r.invoice_status,
            amount_due: toNumberOrNull(r.invoice_amount_due),
            pdf_url: `/api/invoices/${r.invoice_id}/pdf`
          }
        : null;
    }
    return row;
  });

  return {
    data,
    meta: {
      page: safePage,
      pageSize: safePageSize,
      total,
      lifetime_spend: lifetimeSpend
    }
  };
}

module.exports = {
  getVehicleMaintenanceHistory,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE
};
