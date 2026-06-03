'use strict';

const express = require('express');
const PDFDocument = require('pdfkit');

const router = express.Router();
const knex = require('../config/knex');
const dtLogger = require('../utils/logger');
const { loadUserRbac, requireAnyPermission } = require('../middleware/rbac-middleware');
const {
  round2,
  dateOnly,
  buildValidationFindings,
  computeAndPersistQuarterSummary,
  buildNarrative,
  getQuarterById,
} = require('../services/ifta-service');

const IFTA_PERMS = [
  'ifta.view',
  'ifta.edit',
  'ifta.import',
  'ifta.run_ai_review',
  'ifta.finalize',
  'ifta.export',
];

const canView = requireAnyPermission(['ifta.view']);
const canEdit = requireAnyPermission(['ifta.edit']);
const canImport = requireAnyPermission(['ifta.import', 'ifta.edit']);
const canRunAi = requireAnyPermission(['ifta.run_ai_review', 'ifta.edit']);
const canFinalize = requireAnyPermission(['ifta.finalize']);
const canExport = requireAnyPermission(['ifta.export']);

router.use(loadUserRbac);
router.use(requireAnyPermission(IFTA_PERMS));

function tenantId(req) {
  return req.context?.tenantId || req.user?.tenantId || req.user?.tenant_id || null;
}

function operatingEntityId(req) {
  return req.context?.operatingEntityId || null;
}

function requireTenant(req, res) {
  const tid = tenantId(req);
  if (!tid) {
    res.status(401).json({ error: 'Tenant context required' });
    return null;
  }
  return tid;
}

function parseCsvRows(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  const splitRow = (line) => {
    const out = [];
    let token = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          token += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        out.push(token.trim());
        token = '';
      } else {
        token += ch;
      }
    }
    out.push(token.trim());
    return out.map((v) => v.replace(/^"|"$/g, '').trim());
  };

  const headers = splitRow(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const vals = splitRow(lines[i]);
    if (!vals.some(Boolean)) continue;
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = vals[idx] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    const s = String(v ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((h) => esc(row[h])).join(','));
  return lines.join('\n');
}

async function loadQuarterOr404(req, res, tid) {
  const quarter = await getQuarterById(req.params.id, tid, operatingEntityId(req));
  if (!quarter) {
    res.status(404).json({ error: 'IFTA quarter not found' });
    return null;
  }
  return quarter;
}

function normalizeQuarterStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  if (['draft', 'under_review', 'finalized', 'exported'].includes(s)) return s;
  return 'draft';
}

/**
 * @openapi
 * /api/ifta/quarters:
 *   get:
 *     summary: List IFTA quarters
 *     description: >
 *       Returns all IFTA quarterly filing periods for the tenant, ordered by
 *       tax_year and quarter descending. IFTA requires carriers to file fuel-tax
 *       reports every calendar quarter. Use the optional filters to narrow results
 *       by year, quarter number, or filing status (draft, in_review, finalized).
 *     tags:
 *       - IFTA
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: tax_year
 *         schema:
 *           type: integer
 *         description: Filter by tax year (e.g. 2025)
 *       - in: query
 *         name: quarter
 *         schema:
 *           type: integer
 *           enum: [1, 2, 3, 4]
 *         description: Filter by quarter number (1-4)
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, under_review, finalized, exported]
 *         description: Filter by quarter status
 *     responses:
 *       200:
 *         description: Array of IFTA quarter records
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Server error
 */
router.get('/ifta/quarters', canView, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const q = knex('ifta_quarters').where({ tenant_id: tid });
    const op = operatingEntityId(req);
    if (op) q.andWhere('operating_entity_id', op);

    if (req.query.tax_year) q.andWhere('tax_year', Number(req.query.tax_year));
    if (req.query.quarter) q.andWhere('quarter', Number(req.query.quarter));
    if (req.query.status) q.andWhere('status', String(req.query.status));

    const rows = await q.orderBy('tax_year', 'desc').orderBy('quarter', 'desc').orderBy('created_at', 'desc').limit(100);
    res.json(rows);
  } catch (err) {
    dtLogger.error('ifta_quarters_list_failed', err);
    res.status(500).json({ error: 'Failed to list IFTA quarters' });
  }
});

/**
 * @openapi
 * /api/ifta/quarters:
 *   post:
 *     summary: Create a new IFTA quarter
 *     description: >
 *       Creates a new IFTA quarterly filing period in draft status. Each
 *       quarter (Q1-Q4) per tax year per operating entity must be unique.
 *       IFTA quarterly filing is mandatory for motor carriers operating in
 *       multiple jurisdictions; this endpoint initializes the filing workspace.
 *     tags:
 *       - IFTA
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - quarter
 *               - tax_year
 *             properties:
 *               quarter:
 *                 type: integer
 *                 enum: [1, 2, 3, 4]
 *                 description: Calendar quarter (1-4)
 *               tax_year:
 *                 type: integer
 *                 description: Tax year (2000-2100)
 *               filing_entity_name:
 *                 type: string
 *                 description: Name of the filing entity
 *               selected_truck_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Truck IDs included in this filing
 *     responses:
 *       201:
 *         description: Created IFTA quarter record
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Invalid quarter or tax_year
 *       401:
 *         description: Tenant context required
 *       409:
 *         description: Quarter already exists for this entity
 *       500:
 *         description: Server error
 */
router.post('/ifta/quarters', canEdit, async (req, res) => {
  const trx = await knex.transaction();
  try {
    const tid = requireTenant(req, res); if (!tid) { await trx.rollback(); return; }
    const quarter = Number(req.body?.quarter);
    const taxYear = Number(req.body?.tax_year);

    if (![1, 2, 3, 4].includes(quarter) || !Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100) {
      await trx.rollback();
      return res.status(400).json({ error: 'quarter must be 1..4 and tax_year must be valid' });
    }

    const op = operatingEntityId(req);
    const filingEntity = String(req.body?.filing_entity_name || '').trim() || 'Default Filing Entity';

    const existing = await trx('ifta_quarters')
      .where({ tenant_id: tid, quarter, tax_year: taxYear })
      .modify((qb) => { if (op) qb.andWhere('operating_entity_id', op); else qb.andWhereNull('operating_entity_id'); })
      .first();
    if (existing) {
      await trx.rollback();
      return res.status(409).json({ error: 'Quarter already exists for this entity', quarter: existing });
    }

    const [created] = await trx('ifta_quarters').insert({
      tenant_id: tid,
      operating_entity_id: op,
      company_id: req.context?.companyId || tid,
      mc_id: req.context?.mcId || null,
      quarter,
      tax_year: taxYear,
      filing_entity_name: filingEntity,
      status: 'draft',
      selected_truck_ids: Array.isArray(req.body?.selected_truck_ids) ? req.body.selected_truck_ids : [],
      created_by: req.user?.id || null,
      updated_by: req.user?.id || null,
    }).returning('*');

    await trx.commit();
    res.status(201).json(created);
  } catch (err) {
    await trx.rollback();
    dtLogger.error('ifta_quarter_create_failed', err);
    res.status(500).json({ error: 'Failed to create IFTA quarter' });
  }
});

/**
 * @openapi
 * /api/ifta/quarters/{id}:
 *   get:
 *     summary: Get a single IFTA quarter
 *     description: >
 *       Retrieves full details for one IFTA quarterly filing period, including
 *       the count of open warnings and blockers from the latest AI review.
 *     tags:
 *       - IFTA
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: IFTA quarter ID
 *     responses:
 *       200:
 *         description: IFTA quarter with open_warnings count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 open_warnings:
 *                   type: integer
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: IFTA quarter not found
 *       500:
 *         description: Server error
 */
router.get('/ifta/quarters/:id', canView, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const quarter = await loadQuarterOr404(req, res, tid);
    if (!quarter) return;

    const [openWarningsRow] = await knex('ifta_ai_findings')
      .where({ quarter_id: quarter.id, tenant_id: tid, resolved: false })
      .whereIn('severity', ['warning', 'blocker'])
      .count('* as count');

    const openWarnings = Number(openWarningsRow?.count || 0);

    res.json({ ...quarter, open_warnings: openWarnings });
  } catch (err) {
    dtLogger.error('ifta_quarter_get_failed', err);
    res.status(500).json({ error: 'Failed to get IFTA quarter' });
  }
});

/**
 * @openapi
 * /api/ifta/quarters/{id}:
 *   patch:
 *     summary: Update an IFTA quarter
 *     description: >
 *       Partially updates an existing IFTA quarterly filing period. You can
 *       change the filing entity name, selected trucks, or status. Quarter
 *       statuses follow the lifecycle: draft -> under_review -> finalized -> exported.
 *     tags:
 *       - IFTA
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: IFTA quarter ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               filing_entity_name:
 *                 type: string
 *               selected_truck_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *               status:
 *                 type: string
 *                 enum: [draft, under_review, finalized, exported]
 *     responses:
 *       200:
 *         description: Updated IFTA quarter record
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: IFTA quarter not found
 *       500:
 *         description: Server error
 */
router.patch('/ifta/quarters/:id', canEdit, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const quarter = await loadQuarterOr404(req, res, tid);
    if (!quarter) return;

    const patch = {};
    if (req.body?.filing_entity_name !== undefined) patch.filing_entity_name = String(req.body.filing_entity_name || '').trim() || null;
    if (req.body?.selected_truck_ids !== undefined) patch.selected_truck_ids = Array.isArray(req.body.selected_truck_ids) ? req.body.selected_truck_ids : [];
    if (req.body?.status !== undefined) patch.status = normalizeQuarterStatus(req.body.status);
    patch.updated_by = req.user?.id || null;
    patch.updated_at = knex.fn.now();

    const [updated] = await knex('ifta_quarters')
      .where({ id: quarter.id, tenant_id: tid })
      .update(patch)
      .returning('*');

    res.json(updated);
  } catch (err) {
    dtLogger.error('ifta_quarter_patch_failed', err);
    res.status(500).json({ error: 'Failed to update IFTA quarter' });
  }
});

/**
 * @openapi
 * /api/ifta/quarters/{id}/recalculate:
 *   post:
 *     summary: Recalculate IFTA quarter summary
 *     description: >
 *       Recomputes the jurisdiction-level summary (miles, gallons, MPG, tax
 *       due/credit) for the given IFTA quarter. Call this after bulk edits to
 *       miles or fuel entries to ensure the quarterly filing totals are accurate
 *       before review or finalization.
 *     tags:
 *       - IFTA
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: IFTA quarter ID
 *     responses:
 *       200:
 *         description: Recalculated summary object
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: IFTA quarter not found
 *       500:
 *         description: Server error
 */
router.post('/ifta/quarters/:id/recalculate', canEdit, async (req, res) => {
  const trx = await knex.transaction();
  try {
    const tid = requireTenant(req, res); if (!tid) { await trx.rollback(); return; }
    const quarter = await loadQuarterOr404(req, res, tid);
    if (!quarter) { await trx.rollback(); return; }

    const summary = await computeAndPersistQuarterSummary({
      quarterId: quarter.id,
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      userId: req.user?.id || null,
      trx,
    });

    await trx.commit();
    res.json(summary);
  } catch (err) {
    await trx.rollback();
    dtLogger.error('ifta_recalculate_failed', err);
    res.status(500).json({ error: 'Failed to recalculate IFTA quarter' });
  }
});

/**
 * @openapi
 * /api/ifta/quarters/{id}/miles:
 *   get:
 *     summary: List mileage entries for an IFTA quarter
 *     description: >
 *       Returns paginated mileage entries recorded against this IFTA quarter,
 *       along with per-jurisdiction totals. Mileage data is a core component
 *       of IFTA quarterly filings and must be reported by jurisdiction.
 *     tags:
 *       - IFTA
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: IFTA quarter ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           minimum: 1
 *           maximum: 500
 *         description: Page size
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Pagination offset
 *       - in: query
 *         name: unit
 *         schema:
 *           type: string
 *         description: Filter by truck unit number (partial match)
 *       - in: query
 *         name: jurisdiction
 *         schema:
 *           type: string
 *         description: Filter by jurisdiction code (exact, uppercased)
 *     responses:
 *       200:
 *         description: Paginated mileage rows with jurisdiction totals
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 rows:
 *                   type: array
 *                   items:
 *                     type: object
 *                 total:
 *                   type: integer
 *                 totals:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       jurisdiction:
 *                         type: string
 *                       taxable_miles:
 *                         type: number
 *                       non_taxable_miles:
 *                         type: number
 *                       total_miles:
 *                         type: number
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: IFTA quarter not found
 *       500:
 *         description: Server error
 */
router.get('/ifta/quarters/:id/miles', canView, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const quarter = await loadQuarterOr404(req, res, tid);
    if (!quarter) return;

    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 500);
    const offset = Math.max(Number(req.query.offset || 0), 0);

    const q = knex('ifta_miles_entries').where({ quarter_id: quarter.id, tenant_id: tid, is_deleted: false });
    if (operatingEntityId(req)) q.andWhere('operating_entity_id', operatingEntityId(req));
    if (req.query.unit) q.andWhere('unit', 'ilike', `%${String(req.query.unit).trim()}%`);
    if (req.query.jurisdiction) q.andWhere('jurisdiction', String(req.query.jurisdiction).trim().toUpperCase());

    const rows = await q.clone().orderBy('created_at', 'desc').limit(limit).offset(offset);
    const [{ total }] = await q.clone().clearSelect().clearOrder().count('* as total');

    const totals = await knex('ifta_miles_entries')
      .where({ quarter_id: quarter.id, tenant_id: tid, is_deleted: false })
      .modify((qb) => { if (operatingEntityId(req)) qb.andWhere('operating_entity_id', operatingEntityId(req)); })
      .select('jurisdiction')
      .sum({ taxable_miles: 'taxable_miles', non_taxable_miles: 'non_taxable_miles', total_miles: 'total_miles' })
      .groupBy('jurisdiction')
      .orderBy('jurisdiction', 'asc');

    res.json({ rows, total: Number(total || 0), totals });
  } catch (err) {
    dtLogger.error('ifta_miles_list_failed', err);
    res.status(500).json({ error: 'Failed to list mileage entries' });
  }
});

/**
 * @openapi
 * /api/ifta/quarters/{id}/miles:
 *   post:
 *     summary: Create a mileage entry
 *     description: >
 *       Adds a single mileage entry to an IFTA quarter. Miles must be
 *       broken down by jurisdiction for IFTA quarterly filing. The quarter
 *       summary is automatically recalculated after insertion.
 *     tags:
 *       - IFTA
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: IFTA quarter ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - unit
 *               - jurisdiction
 *             properties:
 *               unit:
 *                 type: string
 *                 description: Truck unit number
 *               jurisdiction:
 *                 type: string
 *                 description: Two-letter jurisdiction code (uppercased automatically)
 *               taxable_miles:
 *                 type: number
 *               non_taxable_miles:
 *                 type: number
 *               total_miles:
 *                 type: number
 *                 description: Defaults to taxable + non_taxable if omitted
 *               truck_id:
 *                 type: string
 *               source:
 *                 type: string
 *                 default: manual
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Created mileage entry
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Missing unit, jurisdiction, or invalid miles
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: IFTA quarter not found
 *       500:
 *         description: Server error
 */
router.post('/ifta/quarters/:id/miles', canEdit, async (req, res) => {
  const trx = await knex.transaction();
  try {
    const tid = requireTenant(req, res); if (!tid) { await trx.rollback(); return; }
    const quarter = await loadQuarterOr404(req, res, tid);
    if (!quarter) { await trx.rollback(); return; }

    const taxable = round2(req.body?.taxable_miles);
    const nonTaxable = round2(req.body?.non_taxable_miles);
    const total = round2((req.body?.total_miles !== undefined && req.body?.total_miles !== null)
      ? req.body.total_miles
      : taxable + nonTaxable);

    if (!req.body?.unit || !req.body?.jurisdiction || total < 0 || taxable < 0 || nonTaxable < 0) {
      await trx.rollback();
      return res.status(400).json({ error: 'unit, jurisdiction and valid miles are required' });
    }

    const [row] = await trx('ifta_miles_entries').insert({
      quarter_id: quarter.id,
      tenant_id: tid,
      operating_entity_id: operatingEntityId(req),
      truck_id: req.body?.truck_id || null,
      unit: String(req.body.unit).trim(),
      jurisdiction: String(req.body.jurisdiction).trim().toUpperCase(),
      taxable_miles: taxable,
      non_taxable_miles: nonTaxable,
      total_miles: total,
      source: String(req.body?.source || 'manual').trim() || 'manual',
      notes: req.body?.notes || null,
      created_by: req.user?.id || null,
      updated_by: req.user?.id || null,
    }).returning('*');

    await computeAndPersistQuarterSummary({
      quarterId: quarter.id,
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      userId: req.user?.id || null,
      trx,
    });

    await trx.commit();
    res.status(201).json(row);
  } catch (err) {
    await trx.rollback();
    dtLogger.error('ifta_miles_create_failed', err);
    res.status(500).json({ error: 'Failed to create mileage row' });
  }
});

/**
 * @openapi
 * /api/ifta/quarters/{id}/miles/import:
 *   post:
 *     summary: Bulk-import mileage entries
 *     description: >
 *       Imports multiple mileage rows into an IFTA quarter from either a JSON
 *       array or CSV text. A source file record is created for audit trail.
 *       The quarter summary is automatically recalculated after import. This
 *       supports large-scale quarterly filing preparation by allowing ELD or
 *       GPS data uploads.
 *     tags:
 *       - IFTA
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: IFTA quarter ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rows:
 *                 type: array
 *                 description: Array of mileage row objects (takes priority over csv_text)
 *                 items:
 *                   type: object
 *                   properties:
 *                     unit:
 *                       type: string
 *                     jurisdiction:
 *                       type: string
 *                     taxable_miles:
 *                       type: number
 *                     non_taxable_miles:
 *                       type: number
 *                     total_miles:
 *                       type: number
 *                     truck_id:
 *                       type: string
 *                     source:
 *                       type: string
 *                     notes:
 *                       type: string
 *               csv_text:
 *                 type: string
 *                 description: Raw CSV text (used if rows is not provided)
 *               file_name:
 *                 type: string
 *                 description: Original file name for audit trail
 *     responses:
 *       201:
 *         description: Import result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 inserted:
 *                   type: integer
 *       400:
 *         description: No valid rows to import
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: IFTA quarter not found
 *       500:
 *         description: Server error
 */
router.post('/ifta/quarters/:id/miles/import', canImport, async (req, res) => {
  const trx = await knex.transaction();
  try {
    const tid = requireTenant(req, res); if (!tid) { await trx.rollback(); return; }
    const quarter = await loadQuarterOr404(req, res, tid);
    if (!quarter) { await trx.rollback(); return; }

    const csvRows = req.body?.csv_text ? parseCsvRows(req.body.csv_text) : [];
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : csvRows;
    if (!rows.length) {
      await trx.rollback();
      return res.status(400).json({ error: 'No rows to import' });
    }

    const normalized = rows.map((r) => {
      const taxable = round2(r.taxable_miles);
      const nonTaxable = round2(r.non_taxable_miles);
      const total = round2(r.total_miles !== undefined && r.total_miles !== null ? r.total_miles : taxable + nonTaxable);
      return {
        quarter_id: quarter.id,
        tenant_id: tid,
        operating_entity_id: operatingEntityId(req),
        truck_id: r.truck_id || null,
        unit: String(r.unit || '').trim(),
        jurisdiction: String(r.jurisdiction || '').trim().toUpperCase(),
        taxable_miles: taxable,
        non_taxable_miles: nonTaxable,
        total_miles: total,
        source: String(r.source || 'csv_import').trim(),
        notes: r.notes || null,
        created_by: req.user?.id || null,
        updated_by: req.user?.id || null,
      };
    }).filter((r) => r.unit && r.jurisdiction);

    if (!normalized.length) {
      await trx.rollback();
      return res.status(400).json({ error: 'Rows are invalid after normalization' });
    }

    await trx('ifta_miles_entries').insert(normalized);
    await trx('ifta_source_files').insert({
      quarter_id: quarter.id,
      tenant_id: tid,
      operating_entity_id: operatingEntityId(req),
      file_type: 'miles',
      source_name: req.body?.file_name || 'miles-import.csv',
      row_count: normalized.length,
      metadata: JSON.stringify({ imported: normalized.length }),
      uploaded_by: req.user?.id || null,
      created_by: req.user?.id || null,
      updated_by: req.user?.id || null,
    });

    await computeAndPersistQuarterSummary({
      quarterId: quarter.id,
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      userId: req.user?.id || null,
      trx,
    });

    await trx.commit();
    res.status(201).json({ inserted: normalized.length });
  } catch (err) {
    await trx.rollback();
    dtLogger.error('ifta_miles_import_failed', err);
    res.status(500).json({ error: 'Failed to import miles rows' });
  }
});

/**
 * @openapi
 * /api/ifta/quarters/{id}/miles/{entryId}:
 *   patch:
 *     summary: Update a mileage entry
 *     description: >
 *       Partially updates a single mileage entry within an IFTA quarter. If
 *       taxable or non-taxable miles change and total_miles is not provided,
 *       total is auto-recalculated. The quarter summary is recalculated after
 *       the update.
 *     tags:
 *       - IFTA
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: IFTA quarter ID
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Mileage entry ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               unit:
 *                 type: string
 *               jurisdiction:
 *                 type: string
 *               taxable_miles:
 *                 type: number
 *               non_taxable_miles:
 *                 type: number
 *               total_miles:
 *                 type: number
 *               source:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated mileage entry
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: IFTA quarter or mileage row not found
 *       500:
 *         description: Server error
 */
router.patch('/ifta/quarters/:id/miles/:entryId', canEdit, async (req, res) => {
  const trx = await knex.transaction();
  try {
    const tid = requireTenant(req, res); if (!tid) { await trx.rollback(); return; }
    const quarter = await loadQuarterOr404(req, res, tid);
    if (!quarter) { await trx.rollback(); return; }

    const patch = {};
    if (req.body?.unit !== undefined) patch.unit = String(req.body.unit || '').trim();
    if (req.body?.jurisdiction !== undefined) patch.jurisdiction = String(req.body.jurisdiction || '').trim().toUpperCase();
    if (req.body?.taxable_miles !== undefined) patch.taxable_miles = round2(req.body.taxable_miles);
    if (req.body?.non_taxable_miles !== undefined) patch.non_taxable_miles = round2(req.body.non_taxable_miles);
    if (req.body?.total_miles !== undefined) patch.total_miles = round2(req.body.total_miles);
    if (req.body?.source !== undefined) patch.source = String(req.body.source || '').trim();
    if (req.body?.notes !== undefined) patch.notes = req.body.notes || null;

    if (patch.total_miles === undefined && (patch.taxable_miles !== undefined || patch.non_taxable_miles !== undefined)) {
      const existing = await trx('ifta_miles_entries').where({ id: req.params.entryId, quarter_id: quarter.id, tenant_id: tid, is_deleted: false }).first();
      if (!existing) { await trx.rollback(); return res.status(404).json({ error: 'Mileage row not found' }); }
      patch.total_miles = round2(
        Number(patch.taxable_miles !== undefined ? patch.taxable_miles : existing.taxable_miles || 0)
        + Number(patch.non_taxable_miles !== undefined ? patch.non_taxable_miles : existing.non_taxable_miles || 0)
      );
    }

    patch.updated_by = req.user?.id || null;
    patch.updated_at = trx.fn.now();

    const [row] = await trx('ifta_miles_entries')
      .where({ id: req.params.entryId, quarter_id: quarter.id, tenant_id: tid, is_deleted: false })
      .update(patch)
      .returning('*');

    if (!row) { await trx.rollback(); return res.status(404).json({ error: 'Mileage row not found' }); }

    await computeAndPersistQuarterSummary({
      quarterId: quarter.id,
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      userId: req.user?.id || null,
      trx,
    });

    await trx.commit();
    res.json(row);
  } catch (err) {
    await trx.rollback();
    dtLogger.error('ifta_miles_patch_failed', err);
    res.status(500).json({ error: 'Failed to update mileage row' });
  }
});

/**
 * @openapi
 * /api/ifta/quarters/{id}/miles/{entryId}:
 *   delete:
 *     summary: Soft-delete a mileage entry
 *     description: >
 *       Marks a mileage entry as deleted (soft delete). The quarter summary
 *       is recalculated after removal to keep IFTA quarterly filing totals
 *       accurate.
 *     tags:
 *       - IFTA
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: IFTA quarter ID
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Mileage entry ID
 *     responses:
 *       200:
 *         description: Deletion confirmation
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: IFTA quarter or mileage row not found
 *       500:
 *         description: Server error
 */
router.delete('/ifta/quarters/:id/miles/:entryId', canEdit, async (req, res) => {
  const trx = await knex.transaction();
  try {
    const tid = requireTenant(req, res); if (!tid) { await trx.rollback(); return; }
    const quarter = await loadQuarterOr404(req, res, tid);
    if (!quarter) { await trx.rollback(); return; }

    const [row] = await trx('ifta_miles_entries')
      .where({ id: req.params.entryId, quarter_id: quarter.id, tenant_id: tid, is_deleted: false })
      .update({ is_deleted: true, updated_by: req.user?.id || null, updated_at: trx.fn.now() })
      .returning('*');

    if (!row) { await trx.rollback(); return res.status(404).json({ error: 'Mileage row not found' }); }

    await computeAndPersistQuarterSummary({
      quarterId: quarter.id,
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      userId: req.user?.id || null,
      trx,
    });

    await trx.commit();
    res.json({ success: true });
  } catch (err) {
    await trx.rollback();
    dtLogger.error('ifta_miles_delete_failed', err);
    res.status(500).json({ error: 'Failed to delete mileage row' });
  }
});

/**
 * @openapi
 * /api/ifta/quarters/{id}/fuel:
 *   get:
 *     summary: List fuel purchase entries for an IFTA quarter
 *     description: >
 *       Returns paginated fuel purchase entries recorded against this IFTA
 *       quarter, along with per-jurisdiction totals for gallons and amount.
 *       Fuel purchases by jurisdiction are required for IFTA quarterly filing
 *       to compute tax credits for fuel purchased in each state/province.
 *     tags:
 *       - IFTA
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: IFTA quarter ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           minimum: 1
 *           maximum: 500
 *         description: Page size
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Pagination offset
 *       - in: query
 *         name: unit
 *         schema:
 *           type: string
 *         description: Filter by truck unit number (partial match)
 *       - in: query
 *         name: jurisdiction
 *         schema:
 *           type: string
 *         description: Filter by jurisdiction code (exact, uppercased)
 *     responses:
 *       200:
 *         description: Paginated fuel rows with jurisdiction totals
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 rows:
 *                   type: array
 *                   items:
 *                     type: object
 *                 total:
 *                   type: integer
 *                 totals:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       jurisdiction:
 *                         type: string
 *                       gallons:
 *                         type: number
 *                       amount:
 *                         type: number
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: IFTA quarter not found
 *       500:
 *         description: Server error
 */
router.get('/ifta/quarters/:id/fuel', canView, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const quarter = await loadQuarterOr404(req, res, tid);
    if (!quarter) return;

    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 500);
    const offset = Math.max(Number(req.query.offset || 0), 0);

    const q = knex('ifta_fuel_entries').where({ quarter_id: quarter.id, tenant_id: tid, is_deleted: false });
    if (operatingEntityId(req)) q.andWhere('operating_entity_id', operatingEntityId(req));
    if (req.query.unit) q.andWhere('unit', 'ilike', `%${String(req.query.unit).trim()}%`);
    if (req.query.jurisdiction) q.andWhere('jurisdiction', String(req.query.jurisdiction).trim().toUpperCase());

    const rows = await q.clone().orderBy('purchase_date', 'desc').orderBy('created_at', 'desc').limit(limit).offset(offset);
    const [{ total }] = await q.clone().clearSelect().clearOrder().count('* as total');

    const totals = await knex('ifta_fuel_entries')
      .where({ quarter_id: quarter.id, tenant_id: tid, is_deleted: false })
      .modify((qb) => { if (operatingEntityId(req)) qb.andWhere('operating_entity_id', operatingEntityId(req)); })
      .select('jurisdiction')
      .sum({ gallons: 'gallons', amount: 'amount' })
      .groupBy('jurisdiction')
      .orderBy('jurisdiction', 'asc');

    res.json({ rows, total: Number(total || 0), totals });
  } catch (err) {
    dtLogger.error('ifta_fuel_list_failed', err);
    res.status(500).json({ error: 'Failed to list fuel entries' });
  }
});

/**
 * @openapi
 * /api/ifta/quarters/{id}/fuel:
 *   post:
 *     summary: Create a fuel purchase entry
 *     description: >
 *       Adds a single fuel purchase entry to an IFTA quarter. Duplicate
 *       detection is performed when a receipt_invoice_number is provided
 *       (same unit + receipt + date). The quarter summary is automatically
 *       recalculated after insertion. Fuel purchases must be allocated by
 *       jurisdiction for IFTA quarterly filing.
 *     tags:
 *       - IFTA
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: IFTA quarter ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - purchase_date
 *               - unit
 *               - jurisdiction
 *               - gallons
 *               - amount
 *             properties:
 *               purchase_date:
 *                 type: string
 *                 format: date
 *               unit:
 *                 type: string
 *                 description: Truck unit number
 *               jurisdiction:
 *                 type: string
 *                 description: Two-letter jurisdiction code
 *               gallons:
 *                 type: number
 *                 description: Must be greater than 0
 *               amount:
 *                 type: number
 *                 description: Dollar amount (>= 0)
 *               truck_id:
 *                 type: string
 *               vendor:
 *                 type: string
 *               receipt_invoice_number:
 *                 type: string
 *               fuel_type:
 *                 type: string
 *                 default: diesel
 *               tax_paid:
 *                 type: boolean
 *                 default: true
 *               attachment_link:
 *                 type: string
 *               source:
 *                 type: string
 *                 default: manual
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Created fuel entry (includes duplicate_suspected flag)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Missing required fields or invalid values
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: IFTA quarter not found
 *       500:
 *         description: Server error
 */
router.post('/ifta/quarters/:id/fuel', canEdit, async (req, res) => {
  const trx = await knex.transaction();
  try {
    const tid = requireTenant(req, res); if (!tid) { await trx.rollback(); return; }
    const quarter = await loadQuarterOr404(req, res, tid);
    if (!quarter) { await trx.rollback(); return; }

    const purchaseDate = dateOnly(req.body?.purchase_date);
    const gallons = round2(req.body?.gallons);
    const amount = round2(req.body?.amount);

    if (!purchaseDate || !req.body?.unit || !req.body?.jurisdiction || gallons <= 0 || amount < 0) {
      await trx.rollback();
      return res.status(400).json({ error: 'purchase_date, unit, jurisdiction, gallons and amount are required' });
    }

    const receipt = String(req.body?.receipt_invoice_number || '').trim();
    let duplicateSuspected = false;
    if (receipt) {
      const duplicate = await trx('ifta_fuel_entries')
        .where({ quarter_id: quarter.id, tenant_id: tid, is_deleted: false })
        .andWhereRaw('upper(unit) = upper(?)', [String(req.body.unit)])
        .andWhereRaw('upper(receipt_invoice_number) = upper(?)', [receipt])
        .andWhere('purchase_date', purchaseDate)
        .first();
      duplicateSuspected = !!duplicate;
    }

    const [row] = await trx('ifta_fuel_entries').insert({
      quarter_id: quarter.id,
      tenant_id: tid,
      operating_entity_id: operatingEntityId(req),
      truck_id: req.body?.truck_id || null,
      purchase_date: purchaseDate,
      unit: String(req.body.unit).trim(),
      jurisdiction: String(req.body.jurisdiction).trim().toUpperCase(),
      vendor: req.body?.vendor || null,
      receipt_invoice_number: receipt || null,
      gallons,
      amount,
      fuel_type: req.body?.fuel_type || 'diesel',
      tax_paid: req.body?.tax_paid !== false,
      attachment_link: req.body?.attachment_link || null,
      source: String(req.body?.source || 'manual').trim() || 'manual',
      notes: req.body?.notes || null,
      duplicate_suspected: duplicateSuspected,
      purchase_outside_quarter: false,
      created_by: req.user?.id || null,
      updated_by: req.user?.id || null,
    }).returning('*');

    await computeAndPersistQuarterSummary({
      quarterId: quarter.id,
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      userId: req.user?.id || null,
      trx,
    });

    await trx.commit();
    res.status(201).json(row);
  } catch (err) {
    await trx.rollback();
    dtLogger.error('ifta_fuel_create_failed', err);
    res.status(500).json({ error: 'Failed to create fuel entry' });
  }
});

/**
 * @openapi
 * /api/ifta/quarters/{id}/fuel/import:
 *   post:
 *     summary: Bulk-import fuel purchase entries
 *     description: >
 *       Imports multiple fuel purchase rows into an IFTA quarter from either
 *       a JSON array or CSV text. Duplicate detection is applied per row when
 *       receipt numbers are present. A source file record is created for audit
 *       trail and the quarter summary is recalculated. Supports fuel card
 *       statement uploads for efficient IFTA quarterly filing preparation.
 *     tags:
 *       - IFTA
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: IFTA quarter ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rows:
 *                 type: array
 *                 description: Array of fuel row objects (takes priority over csv_text)
 *                 items:
 *                   type: object
 *                   properties:
 *                     purchase_date:
 *                       type: string
 *                       format: date
 *                     unit:
 *                       type: string
 *                     jurisdiction:
 *                       type: string
 *                     gallons:
 *                       type: number
 *                     amount:
 *                       type: number
 *                     vendor:
 *                       type: string
 *                     receipt_invoice_number:
 *                       type: string
 *                     fuel_type:
 *                       type: string
 *                     tax_paid:
 *                       type: boolean
 *                     truck_id:
 *                       type: string
 *                     source:
 *                       type: string
 *                     notes:
 *                       type: string
 *               csv_text:
 *                 type: string
 *                 description: Raw CSV text (used if rows is not provided)
 *               file_name:
 *                 type: string
 *                 description: Original file name for audit trail
 *     responses:
 *       201:
 *         description: Import result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 inserted:
 *                   type: integer
 *       400:
 *         description: No valid rows to import
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: IFTA quarter not found
 *       500:
 *         description: Server error
 */
router.post('/ifta/quarters/:id/fuel/import', canImport, async (req, res) => {
  const trx = await knex.transaction();
  try {
    const tid = requireTenant(req, res); if (!tid) { await trx.rollback(); return; }
    const quarter = await loadQuarterOr404(req, res, tid);
    if (!quarter) { await trx.rollback(); return; }

    const csvRows = req.body?.csv_text ? parseCsvRows(req.body.csv_text) : [];
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : csvRows;
    if (!rows.length) {
      await trx.rollback();
      return res.status(400).json({ error: 'No rows to import' });
    }

    const normalized = [];
    for (const r of rows) {
      const purchaseDate = dateOnly(r.date || r.purchase_date);
      const unit = String(r.unit || '').trim();
      const jurisdiction = String(r.jurisdiction || '').trim().toUpperCase();
      const gallons = round2(r.gallons);
      const amount = round2(r.amount);
      if (!purchaseDate || !unit || !jurisdiction || gallons <= 0) continue;

      const receipt = String(r.receipt_invoice_number || r.receipt || '').trim();
      let duplicateSuspected = false;
      if (receipt) {
        const duplicate = await trx('ifta_fuel_entries')
          .where({ quarter_id: quarter.id, tenant_id: tid, is_deleted: false })
          .andWhereRaw('upper(unit) = upper(?)', [unit])
          .andWhereRaw('upper(receipt_invoice_number) = upper(?)', [receipt])
          .andWhere('purchase_date', purchaseDate)
          .first();
        duplicateSuspected = !!duplicate;
      }

      normalized.push({
        quarter_id: quarter.id,
        tenant_id: tid,
        operating_entity_id: operatingEntityId(req),
        truck_id: r.truck_id || null,
        purchase_date: purchaseDate,
        unit,
        jurisdiction,
        vendor: r.vendor || null,
        receipt_invoice_number: receipt || null,
        gallons,
        amount,
        fuel_type: String(r.fuel_type || 'diesel').toLowerCase(),
        tax_paid: String(r.tax_paid ?? 'true').toLowerCase() !== 'false',
        attachment_link: r.attachment_link || null,
        source: String(r.source || 'csv_import').trim(),
        notes: r.notes || null,
        duplicate_suspected: duplicateSuspected,
        purchase_outside_quarter: false,
        created_by: req.user?.id || null,
        updated_by: req.user?.id || null,
      });
    }

    if (!normalized.length) {
      await trx.rollback();
      return res.status(400).json({ error: 'Rows are invalid after normalization' });
    }

    await trx('ifta_fuel_entries').insert(normalized);
    await trx('ifta_source_files').insert({
      quarter_id: quarter.id,
      tenant_id: tid,
      operating_entity_id: operatingEntityId(req),
      file_type: 'fuel',
      source_name: req.body?.file_name || 'fuel-import.csv',
      row_count: normalized.length,
      metadata: JSON.stringify({ imported: normalized.length }),
      uploaded_by: req.user?.id || null,
      created_by: req.user?.id || null,
      updated_by: req.user?.id || null,
    });

    await computeAndPersistQuarterSummary({
      quarterId: quarter.id,
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      userId: req.user?.id || null,
      trx,
    });

    await trx.commit();
    res.status(201).json({ inserted: normalized.length });
  } catch (err) {
    await trx.rollback();
    dtLogger.error('ifta_fuel_import_failed', err);
    res.status(500).json({ error: 'Failed to import fuel rows' });
  }
});

/**
 * @openapi
 * /api/ifta/quarters/{id}/fuel/{entryId}:
 *   patch:
 *     summary: Update a fuel purchase entry
 *     description: >
 *       Partially updates a single fuel purchase entry within an IFTA quarter.
 *       The quarter summary is recalculated after the update to keep filing
 *       totals accurate.
 *     tags:
 *       - IFTA
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: IFTA quarter ID
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Fuel entry ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               purchase_date:
 *                 type: string
 *                 format: date
 *               unit:
 *                 type: string
 *               jurisdiction:
 *                 type: string
 *               vendor:
 *                 type: string
 *               receipt_invoice_number:
 *                 type: string
 *               gallons:
 *                 type: number
 *               amount:
 *                 type: number
 *               fuel_type:
 *                 type: string
 *               tax_paid:
 *                 type: boolean
 *               attachment_link:
 *                 type: string
 *               source:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated fuel entry
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: IFTA quarter or fuel row not found
 *       500:
 *         description: Server error
 */
router.patch('/ifta/quarters/:id/fuel/:entryId', canEdit, async (req, res) => {
  const trx = await knex.transaction();
  try {
    const tid = requireTenant(req, res); if (!tid) { await trx.rollback(); return; }
    const quarter = await loadQuarterOr404(req, res, tid);
    if (!quarter) { await trx.rollback(); return; }

    const patch = {};
    if (req.body?.purchase_date !== undefined) patch.purchase_date = dateOnly(req.body.purchase_date);
    if (req.body?.unit !== undefined) patch.unit = String(req.body.unit || '').trim();
    if (req.body?.jurisdiction !== undefined) patch.jurisdiction = String(req.body.jurisdiction || '').trim().toUpperCase();
    if (req.body?.vendor !== undefined) patch.vendor = req.body.vendor || null;
    if (req.body?.receipt_invoice_number !== undefined) patch.receipt_invoice_number = String(req.body.receipt_invoice_number || '').trim() || null;
    if (req.body?.gallons !== undefined) patch.gallons = round2(req.body.gallons);
    if (req.body?.amount !== undefined) patch.amount = round2(req.body.amount);
    if (req.body?.fuel_type !== undefined) patch.fuel_type = String(req.body.fuel_type || '').trim().toLowerCase() || 'diesel';
    if (req.body?.tax_paid !== undefined) patch.tax_paid = !!req.body.tax_paid;
    if (req.body?.attachment_link !== undefined) patch.attachment_link = req.body.attachment_link || null;
    if (req.body?.source !== undefined) patch.source = String(req.body.source || '').trim();
    if (req.body?.notes !== undefined) patch.notes = req.body.notes || null;

    patch.updated_by = req.user?.id || null;
    patch.updated_at = trx.fn.now();

    const [row] = await trx('ifta_fuel_entries')
      .where({ id: req.params.entryId, quarter_id: quarter.id, tenant_id: tid, is_deleted: false })
      .update(patch)
      .returning('*');

    if (!row) { await trx.rollback(); return res.status(404).json({ error: 'Fuel row not found' }); }

    await computeAndPersistQuarterSummary({
      quarterId: quarter.id,
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      userId: req.user?.id || null,
      trx,
    });

    await trx.commit();
    res.json(row);
  } catch (err) {
    await trx.rollback();
    dtLogger.error('ifta_fuel_patch_failed', err);
    res.status(500).json({ error: 'Failed to update fuel entry' });
  }
});

/**
 * @openapi
 * /api/ifta/quarters/{id}/fuel/{entryId}:
 *   delete:
 *     summary: Soft-delete a fuel purchase entry
 *     description: >
 *       Marks a fuel purchase entry as deleted (soft delete). The quarter
 *       summary is recalculated after removal to keep IFTA quarterly filing
 *       totals accurate.
 *     tags:
 *       - IFTA
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: IFTA quarter ID
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Fuel entry ID
 *     responses:
 *       200:
 *         description: Deletion confirmation
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: IFTA quarter or fuel row not found
 *       500:
 *         description: Server error
 */
router.delete('/ifta/quarters/:id/fuel/:entryId', canEdit, async (req, res) => {
  const trx = await knex.transaction();
  try {
    const tid = requireTenant(req, res); if (!tid) { await trx.rollback(); return; }
    const quarter = await loadQuarterOr404(req, res, tid);
    if (!quarter) { await trx.rollback(); return; }

    const [row] = await trx('ifta_fuel_entries')
      .where({ id: req.params.entryId, quarter_id: quarter.id, tenant_id: tid, is_deleted: false })
      .update({ is_deleted: true, updated_by: req.user?.id || null, updated_at: trx.fn.now() })
      .returning('*');

    if (!row) { await trx.rollback(); return res.status(404).json({ error: 'Fuel row not found' }); }

    await computeAndPersistQuarterSummary({
      quarterId: quarter.id,
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      userId: req.user?.id || null,
      trx,
    });

    await trx.commit();
    res.json({ success: true });
  } catch (err) {
    await trx.rollback();
    dtLogger.error('ifta_fuel_delete_failed', err);
    res.status(500).json({ error: 'Failed to delete fuel entry' });
  }
});

/**
 * @openapi
 * /api/ifta/quarters/{id}/run-ai-review:
 *   post:
 *     summary: Run AI validation review on an IFTA quarter
 *     description: >
 *       Recalculates the quarter summary, runs automated validation rules to
 *       produce findings (blockers, warnings, info), computes a readiness
 *       score (0-100), and generates an AI narrative. Previous findings are
 *       archived. If any blockers exist, the quarter status reverts to draft;
 *       otherwise it advances to under_review. This is a key step in the IFTA
 *       quarterly filing workflow to catch data quality issues before
 *       finalization.
 *     tags:
 *       - IFTA
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: IFTA quarter ID
 *     responses:
 *       200:
 *         description: AI review results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 quarter:
 *                   type: object
 *                 readiness_score:
 *                   type: integer
 *                   minimum: 0
 *                   maximum: 100
 *                 narrative:
 *                   type: string
 *                 findings:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       type:
 *                         type: string
 *                       severity:
 *                         type: string
 *                         enum: [blocker, warning, info]
 *                       title:
 *                         type: string
 *                       details:
 *                         type: string
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: IFTA quarter not found
 *       500:
 *         description: Server error
 */
router.post('/ifta/quarters/:id/run-ai-review', canRunAi, async (req, res) => {
  const trx = await knex.transaction();
  try {
    const tid = requireTenant(req, res); if (!tid) { await trx.rollback(); return; }
    const quarter = await loadQuarterOr404(req, res, tid);
    if (!quarter) { await trx.rollback(); return; }

    const summary = await computeAndPersistQuarterSummary({
      quarterId: quarter.id,
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      userId: req.user?.id || null,
      trx,
    });

    const findings = await buildValidationFindings({
      quarterId: quarter.id,
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      trx,
    });

    await trx('ifta_ai_findings').where({ quarter_id: quarter.id, tenant_id: tid }).update({
      is_archived: true,
      updated_by: req.user?.id || null,
      updated_at: trx.fn.now(),
    });

    if (findings.length) {
      await trx('ifta_ai_findings').insert(findings.map((f) => ({
        quarter_id: quarter.id,
        tenant_id: tid,
        operating_entity_id: operatingEntityId(req),
        finding_type: f.type,
        severity: f.severity,
        title: f.title,
        details: f.details,
        resolved: false,
        is_archived: false,
        created_by: req.user?.id || null,
        updated_by: req.user?.id || null,
      })));
    }

    const blockerCount = findings.filter((f) => f.severity === 'blocker').length;
    const warningCount = findings.filter((f) => f.severity === 'warning').length;
    const readinessScore = Math.max(0, Math.min(100, 100 - blockerCount * 35 - warningCount * 10));
    const narrative = buildNarrative({
      quarter,
      cards: summary.cards,
      findings: findings.map((f) => ({ ...f, resolved: false })),
    });

    const [updatedQuarter] = await trx('ifta_quarters').where({ id: quarter.id, tenant_id: tid }).update({
      ai_readiness_score: readinessScore,
      ai_narrative: narrative,
      status: blockerCount > 0 ? 'draft' : 'under_review',
      updated_by: req.user?.id || null,
      updated_at: trx.fn.now(),
    }).returning('*');

    await trx.commit();
    res.json({
      quarter: updatedQuarter,
      readiness_score: readinessScore,
      narrative,
      findings,
    });
  } catch (err) {
    await trx.rollback();
    dtLogger.error('ifta_ai_review_failed', err);
    res.status(500).json({ error: 'Failed to run AI review' });
  }
});

/**
 * @openapi
 * /api/ifta/quarters/{id}/findings:
 *   get:
 *     summary: List AI findings for an IFTA quarter
 *     description: >
 *       Returns all non-archived AI validation findings for the given IFTA
 *       quarter, ordered by severity (blockers first, then warnings, then
 *       info). Findings are produced by the AI review step and must be
 *       resolved or acknowledged before the quarter can be finalized for
 *       IFTA quarterly filing.
 *     tags:
 *       - IFTA
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: IFTA quarter ID
 *     responses:
 *       200:
 *         description: Array of AI finding records
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: IFTA quarter not found
 *       500:
 *         description: Server error
 */
router.get('/ifta/quarters/:id/findings', canView, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const quarter = await loadQuarterOr404(req, res, tid);
    if (!quarter) return;

    const rows = await knex('ifta_ai_findings')
      .where({ quarter_id: quarter.id, tenant_id: tid, is_archived: false })
      .orderByRaw(`CASE severity WHEN 'blocker' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END`)
      .orderBy('created_at', 'desc');

    res.json(rows);
  } catch (err) {
    dtLogger.error('ifta_findings_list_failed', err);
    res.status(500).json({ error: 'Failed to list AI findings' });
  }
});

/**
 * @openapi
 * /api/ifta/findings/{findingId}/resolve:
 *   post:
 *     summary: Resolve an AI finding
 *     description: >
 *       Marks a single AI validation finding as resolved with optional notes.
 *       Resolving all blocker findings is required before an IFTA quarter can
 *       be finalized for quarterly filing submission.
 *     tags:
 *       - IFTA
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: findingId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: AI finding ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *                 description: Resolution notes explaining the action taken
 *     responses:
 *       200:
 *         description: Resolved finding record
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Finding not found
 *       500:
 *         description: Server error
 */
router.post('/ifta/findings/:findingId/resolve', canEdit, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;

    const [row] = await knex('ifta_ai_findings')
      .where({ id: req.params.findingId, tenant_id: tid, is_archived: false })
      .update({
        resolved: true,
        resolved_notes: req.body?.notes || null,
        resolved_by: req.user?.id || null,
        resolved_at: knex.fn.now(),
        updated_by: req.user?.id || null,
        updated_at: knex.fn.now(),
      })
      .returning('*');

    if (!row) return res.status(404).json({ error: 'Finding not found' });
    res.json(row);
  } catch (err) {
    dtLogger.error('ifta_finding_resolve_failed', err);
    res.status(500).json({ error: 'Failed to resolve finding' });
  }
});

/**
 * @openapi
 * /api/ifta/quarters/{id}/report-preview:
 *   get:
 *     summary: Preview the IFTA quarterly filing report
 *     description: >
 *       Returns a consolidated preview of the quarterly IFTA filing report
 *       including top-level metric cards, jurisdiction summary rows, open
 *       warning count, and the AI narrative. Use this to review the filing
 *       before finalization. IFTA quarterly filings must be submitted to
 *       the base jurisdiction within 30 days after quarter end.
 *     tags:
 *       - IFTA
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: IFTA quarter ID
 *     responses:
 *       200:
 *         description: Report preview payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 quarter:
 *                   type: object
 *                 cards:
 *                   type: object
 *                   properties:
 *                     total_fleet_miles:
 *                       type: number
 *                     total_gallons:
 *                       type: number
 *                     fleet_mpg:
 *                       type: number
 *                     total_due_credit:
 *                       type: number
 *                     open_warnings:
 *                       type: integer
 *                 summary:
 *                   type: array
 *                   items:
 *                     type: object
 *                 ai_narrative:
 *                   type: string
 *                   nullable: true
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: IFTA quarter not found
 *       500:
 *         description: Server error
 */
router.get('/ifta/quarters/:id/report-preview', canView, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const quarter = await loadQuarterOr404(req, res, tid);
    if (!quarter) return;

    const summaryRows = await knex('ifta_jurisdiction_summary')
      .where({ quarter_id: quarter.id, tenant_id: tid, is_current: true })
      .orderBy('jurisdiction', 'asc');

    const [openWarningsRow] = await knex('ifta_ai_findings')
      .where({ quarter_id: quarter.id, tenant_id: tid, is_archived: false, resolved: false })
      .whereIn('severity', ['warning', 'blocker'])
      .count('* as count');

    res.json({
      quarter,
      cards: {
        total_fleet_miles: Number(quarter.total_fleet_miles || 0),
        total_gallons: Number(quarter.total_gallons || 0),
        fleet_mpg: Number(quarter.fleet_mpg || 0),
        total_due_credit: Number(quarter.total_due_credit || 0),
        open_warnings: Number(openWarningsRow?.count || 0),
      },
      summary: summaryRows,
      ai_narrative: quarter.ai_narrative || null,
    });
  } catch (err) {
    dtLogger.error('ifta_report_preview_failed', err);
    res.status(500).json({ error: 'Failed to fetch report preview' });
  }
});

/**
 * @openapi
 * /api/ifta/quarters/{id}/finalize:
 *   post:
 *     summary: Finalize an IFTA quarter
 *     description: >
 *       Locks the IFTA quarter by setting its status to finalized. The
 *       quarter summary is recalculated and validation rules are re-run
 *       first. If any blocker-severity findings exist the request is
 *       rejected. Once finalized, the quarter data is considered ready
 *       for official IFTA quarterly filing submission to the base
 *       jurisdiction.
 *     tags:
 *       - IFTA
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: IFTA quarter ID
 *     responses:
 *       200:
 *         description: Finalized quarter with summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 quarter:
 *                   type: object
 *                 summary:
 *                   type: object
 *       400:
 *         description: Validation blockers prevent finalization
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 blockers:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: IFTA quarter not found
 *       500:
 *         description: Server error
 */
router.post('/ifta/quarters/:id/finalize', canFinalize, async (req, res) => {
  const trx = await knex.transaction();
  try {
    const tid = requireTenant(req, res); if (!tid) { await trx.rollback(); return; }
    const quarter = await loadQuarterOr404(req, res, tid);
    if (!quarter) { await trx.rollback(); return; }

    const summary = await computeAndPersistQuarterSummary({
      quarterId: quarter.id,
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      userId: req.user?.id || null,
      trx,
    });

    const findings = await buildValidationFindings({
      quarterId: quarter.id,
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      trx,
    });

    const blockers = findings.filter((f) => f.severity === 'blocker');
    if (blockers.length) {
      await trx.rollback();
      return res.status(400).json({
        error: 'Quarter cannot be finalized due to validation blockers',
        blockers,
      });
    }

    const [updated] = await trx('ifta_quarters').where({ id: quarter.id, tenant_id: tid }).update({
      status: 'finalized',
      finalized_by: req.user?.id || null,
      finalized_at: trx.fn.now(),
      updated_by: req.user?.id || null,
      updated_at: trx.fn.now(),
    }).returning('*');

    await trx.commit();
    res.json({ quarter: updated, summary });
  } catch (err) {
    await trx.rollback();
    dtLogger.error('ifta_finalize_failed', err);
    res.status(500).json({ error: 'Failed to finalize quarter' });
  }
});

/**
 * @openapi
 * /api/ifta/quarters/{id}/filing-payload:
 *   get:
 *     summary: Get the machine-readable IFTA filing payload
 *     description: >
 *       Returns a versioned JSON payload containing all data needed for
 *       IFTA quarterly filing: quarter metadata, fleet-level metrics,
 *       jurisdiction summary rows, AI readiness score, narrative, and
 *       findings. Intended for integration with state filing portals or
 *       third-party IFTA filing services.
 *     tags:
 *       - IFTA
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: IFTA quarter ID
 *     responses:
 *       200:
 *         description: Filing payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 version:
 *                   type: string
 *                   example: ifta-filing-payload-v1
 *                 generated_at:
 *                   type: string
 *                   format: date-time
 *                 quarter:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     quarter:
 *                       type: integer
 *                     tax_year:
 *                       type: integer
 *                     filing_entity_name:
 *                       type: string
 *                     status:
 *                       type: string
 *                 metrics:
 *                   type: object
 *                   properties:
 *                     total_fleet_miles:
 *                       type: number
 *                     total_taxable_miles:
 *                       type: number
 *                     total_gallons:
 *                       type: number
 *                     fleet_mpg:
 *                       type: number
 *                     total_due_credit:
 *                       type: number
 *                 jurisdiction_summary:
 *                   type: array
 *                   items:
 *                     type: object
 *                 ai:
 *                   type: object
 *                   properties:
 *                     readiness_score:
 *                       type: integer
 *                     narrative:
 *                       type: string
 *                       nullable: true
 *                     findings:
 *                       type: array
 *                       items:
 *                         type: object
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: IFTA quarter not found
 *       500:
 *         description: Server error
 */
router.get('/ifta/quarters/:id/filing-payload', canExport, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const quarter = await loadQuarterOr404(req, res, tid);
    if (!quarter) return;

    const [summaryRows, findings] = await Promise.all([
      knex('ifta_jurisdiction_summary').where({ quarter_id: quarter.id, tenant_id: tid, is_current: true }).orderBy('jurisdiction', 'asc'),
      knex('ifta_ai_findings').where({ quarter_id: quarter.id, tenant_id: tid, is_archived: false }).orderBy('created_at', 'asc')
    ]);

    res.json({
      version: 'ifta-filing-payload-v1',
      generated_at: new Date().toISOString(),
      quarter: {
        id: quarter.id,
        quarter: quarter.quarter,
        tax_year: quarter.tax_year,
        filing_entity_name: quarter.filing_entity_name,
        status: quarter.status,
      },
      metrics: {
        total_fleet_miles: Number(quarter.total_fleet_miles || 0),
        total_taxable_miles: Number(quarter.total_taxable_miles || 0),
        total_gallons: Number(quarter.total_gallons || 0),
        fleet_mpg: Number(quarter.fleet_mpg || 0),
        total_due_credit: Number(quarter.total_due_credit || 0),
      },
      jurisdiction_summary: summaryRows,
      ai: {
        readiness_score: Number(quarter.ai_readiness_score || 0),
        narrative: quarter.ai_narrative,
        findings,
      }
    });
  } catch (err) {
    dtLogger.error('ifta_filing_payload_failed', err);
    res.status(500).json({ error: 'Failed to build filing payload' });
  }
});

/**
 * @openapi
 * /api/ifta/quarters/{id}/export/csv/{kind}:
 *   get:
 *     summary: Export IFTA quarter data as CSV
 *     description: >
 *       Exports miles, fuel, or jurisdiction-summary data for the given IFTA
 *       quarter as a downloadable CSV file. An export audit record is created
 *       and the quarter status is set to exported. Exported CSVs can be used
 *       to submit IFTA quarterly filing data to state portals that accept
 *       CSV uploads.
 *     tags:
 *       - IFTA
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: IFTA quarter ID
 *       - in: path
 *         name: kind
 *         required: true
 *         schema:
 *           type: string
 *           enum: [miles, fuel, jurisdiction-summary]
 *         description: Type of data to export
 *     responses:
 *       200:
 *         description: CSV file download
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *       400:
 *         description: Invalid kind parameter
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: IFTA quarter not found
 *       500:
 *         description: Server error
 */
router.get('/ifta/quarters/:id/export/csv/:kind', canExport, async (req, res) => {
  const trx = await knex.transaction();
  try {
    const tid = requireTenant(req, res); if (!tid) { await trx.rollback(); return; }
    const quarter = await loadQuarterOr404(req, res, tid);
    if (!quarter) { await trx.rollback(); return; }

    const kind = String(req.params.kind || '').toLowerCase();
    let rows = [];
    if (kind === 'miles') {
      rows = await trx('ifta_miles_entries')
        .where({ quarter_id: quarter.id, tenant_id: tid, is_deleted: false })
        .orderBy('created_at', 'asc');
    } else if (kind === 'fuel') {
      rows = await trx('ifta_fuel_entries')
        .where({ quarter_id: quarter.id, tenant_id: tid, is_deleted: false })
        .orderBy('purchase_date', 'asc');
    } else if (kind === 'jurisdiction-summary') {
      rows = await trx('ifta_jurisdiction_summary')
        .where({ quarter_id: quarter.id, tenant_id: tid, is_current: true })
        .orderBy('jurisdiction', 'asc');
    } else {
      await trx.rollback();
      return res.status(400).json({ error: 'kind must be miles, fuel, or jurisdiction-summary' });
    }

    const csv = toCsv(rows);
    const fileName = `ifta-q${quarter.quarter}-${quarter.tax_year}-${kind}.csv`;

    await trx('ifta_exports').insert({
      quarter_id: quarter.id,
      tenant_id: tid,
      operating_entity_id: operatingEntityId(req),
      export_type: `csv_${kind}`,
      file_name: fileName,
      exported_by: req.user?.id || null,
      payload_json: JSON.stringify({ rows: rows.length }),
      created_by: req.user?.id || null,
      updated_by: req.user?.id || null,
    });

    await trx('ifta_quarters').where({ id: quarter.id, tenant_id: tid }).update({
      status: 'exported',
      exported_at: trx.fn.now(),
      updated_by: req.user?.id || null,
      updated_at: trx.fn.now(),
    });

    await trx.commit();

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(csv);
  } catch (err) {
    await trx.rollback();
    dtLogger.error('ifta_export_csv_failed', err);
    res.status(500).json({ error: 'Failed to export CSV' });
  }
});

/**
 * @openapi
 * /api/ifta/quarters/{id}/export/pdf:
 *   get:
 *     summary: Export IFTA quarter summary as PDF
 *     description: >
 *       Generates and downloads a PDF report containing the IFTA quarter
 *       summary: fleet-level metrics, jurisdiction breakdown, AI narrative,
 *       and open findings. An export audit record is created and the quarter
 *       status is set to exported. This PDF serves as a printable record of
 *       the IFTA quarterly filing for internal review or auditor requests.
 *     tags:
 *       - IFTA
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: IFTA quarter ID
 *     responses:
 *       200:
 *         description: PDF file download
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: IFTA quarter not found
 *       500:
 *         description: Server error
 */
router.get('/ifta/quarters/:id/export/pdf', canExport, async (req, res) => {
  const trx = await knex.transaction();
  try {
    const tid = requireTenant(req, res); if (!tid) { await trx.rollback(); return; }
    const quarter = await loadQuarterOr404(req, res, tid);
    if (!quarter) { await trx.rollback(); return; }

    const summaryRows = await trx('ifta_jurisdiction_summary')
      .where({ quarter_id: quarter.id, tenant_id: tid, is_current: true })
      .orderBy('jurisdiction', 'asc');

    const findings = await trx('ifta_ai_findings')
      .where({ quarter_id: quarter.id, tenant_id: tid, is_archived: false, resolved: false })
      .orderByRaw(`CASE severity WHEN 'blocker' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END`)
      .orderBy('created_at', 'desc')
      .limit(10);

    const fileName = `ifta-q${quarter.quarter}-${quarter.tax_year}-summary.pdf`;

    await trx('ifta_exports').insert({
      quarter_id: quarter.id,
      tenant_id: tid,
      operating_entity_id: operatingEntityId(req),
      export_type: 'pdf_summary',
      file_name: fileName,
      exported_by: req.user?.id || null,
      payload_json: JSON.stringify({ summary_rows: summaryRows.length }),
      created_by: req.user?.id || null,
      updated_by: req.user?.id || null,
    });

    await trx('ifta_quarters').where({ id: quarter.id, tenant_id: tid }).update({
      status: 'exported',
      exported_at: trx.fn.now(),
      updated_by: req.user?.id || null,
      updated_at: trx.fn.now(),
    });

    await trx.commit();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.pipe(res);

    doc.fontSize(18).text(`FleetNeuron IFTA Quarterly Filing`);
    doc.moveDown(0.25);
    doc.fontSize(11).fillColor('#444').text(`Quarter: Q${quarter.quarter} ${quarter.tax_year}`);
    doc.text(`Entity: ${quarter.filing_entity_name || 'N/A'}`);
    doc.text(`Status: ${quarter.status}`);
    doc.moveDown(0.5);

    doc.fillColor('#000').fontSize(12).text('Top Summary');
    doc.fontSize(10)
      .text(`Total fleet miles: ${Number(quarter.total_fleet_miles || 0).toLocaleString()}`)
      .text(`Total gallons: ${Number(quarter.total_gallons || 0).toLocaleString()}`)
      .text(`Fleet MPG: ${Number(quarter.fleet_mpg || 0)}`)
      .text(`Total due/credit: ${Number(quarter.total_due_credit || 0).toFixed(2)} USD`);

    if (quarter.ai_narrative) {
      doc.moveDown(0.5);
      doc.fontSize(12).text('AI Narrative');
      doc.fontSize(10).text(String(quarter.ai_narrative));
    }

    doc.moveDown(0.5);
    doc.fontSize(12).text('Jurisdiction Summary');
    doc.moveDown(0.2);

    summaryRows.forEach((row) => {
      doc.fontSize(9).text(
        `${row.jurisdiction} | Miles: ${Number(row.total_miles || 0).toFixed(2)} | Taxable miles: ${Number(row.taxable_miles || 0).toFixed(2)} | Tax-paid gal: ${Number(row.tax_paid_gallons || 0).toFixed(2)} | Net gal: ${Number(row.net_taxable_gallons || 0).toFixed(2)} | Rate: ${Number(row.tax_rate || 0).toFixed(4)} | Due/Credit: ${Number(row.tax_due_credit || 0).toFixed(2)}`
      );
    });

    if (findings.length) {
      doc.moveDown(0.5);
      doc.fontSize(12).text('Open Findings');
      findings.forEach((f) => {
        doc.fontSize(9).text(`[${String(f.severity || '').toUpperCase()}] ${f.title}: ${f.details || ''}`);
      });
    }

    doc.end();
  } catch (err) {
    await trx.rollback();
    dtLogger.error('ifta_export_pdf_failed', err);
    res.status(500).json({ error: 'Failed to export PDF' });
  }
});

module.exports = router;
