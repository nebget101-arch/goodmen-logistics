const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../internal/db');
const auth = require('./auth-middleware');

const LIST_DEFAULT_PAGE_SIZE = 50;
const LIST_MAX_PAGE_SIZE = 100;
const NAME_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 2000;

router.use(auth(['admin', 'dispatch']));

function getTenantId(req) {
  return (
    req.context?.tenantId ||
    req.user?.tenantId ||
    req.user?.tenant_id ||
    null
  );
}

function getOperatingEntityId(req) {
  return req.context?.operatingEntityId || null;
}

function trimOrNull(value, max) {
  if (value === undefined || value === null) return null;
  const trimmed = value.toString().trim();
  if (!trimmed) return null;
  return max ? trimmed.slice(0, max) : trimmed;
}

async function loadTemplateById(id, tenantId) {
  const result = await query(
    `SELECT id, tenant_id, name, description, template_data, created_by, last_used_at, created_at, updated_at
       FROM load_templates
      WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  return result.rows[0] || null;
}

async function snapshotLoadAsTemplateData(loadId, tenantId, operatingEntityId) {
  const params = [loadId, tenantId];
  let whereSql = 'l.id = $1 AND l.tenant_id = $2';
  if (operatingEntityId) {
    params.push(operatingEntityId);
    whereSql += ` AND l.operating_entity_id = $${params.length}`;
  }

  const loadResult = await query(
    `SELECT l.* FROM loads l WHERE ${whereSql}`,
    params
  );
  if (loadResult.rows.length === 0) return null;
  const load = loadResult.rows[0];

  const stopsResult = await query(
    `SELECT stop_type, stop_date, city, state, zip, address1, address2, sequence
       FROM load_stops
      WHERE load_id = $1
      ORDER BY sequence, created_at`,
    [loadId]
  );

  return {
    source_load_id: load.id,
    load: {
      status: 'DRAFT',
      billing_status: load.billing_status || null,
      broker_id: load.broker_id || null,
      broker_name: load.broker_name || null,
      driver_id: load.driver_id || null,
      truck_id: load.truck_id || null,
      trailer_id: load.trailer_id || null,
      rate: load.rate != null ? Number(load.rate) : null,
      notes: load.notes || null
    },
    stops: (stopsResult.rows || []).map((s) => ({
      stop_type: s.stop_type,
      stop_date: s.stop_date,
      city: s.city,
      state: s.state,
      zip: s.zip,
      address1: s.address1,
      address2: s.address2,
      sequence: s.sequence
    }))
  };
}

/**
 * @openapi
 * /api/load-templates:
 *   get:
 *     summary: List load templates for the current tenant
 *     tags:
 *       - Load Templates
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Optional name/description search term
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 50, maximum: 100 }
 *     responses:
 *       200:
 *         description: Template list
 *   post:
 *     summary: Create template by snapshotting an existing load
 *     tags:
 *       - Load Templates
 *     requestBody:
 *       required: true
 *     responses:
 *       201:
 *         description: Template created
 */
router.get('/', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });

    const q = trimOrNull(req.query.q, 200);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(
      LIST_MAX_PAGE_SIZE,
      Math.max(1, parseInt(req.query.pageSize, 10) || LIST_DEFAULT_PAGE_SIZE)
    );
    const offset = (page - 1) * pageSize;

    const params = [tenantId];
    let whereSql = 'tenant_id = $1';
    if (q) {
      params.push(`%${q}%`);
      whereSql += ` AND (name ILIKE $${params.length} OR COALESCE(description, '') ILIKE $${params.length})`;
    }

    const countResult = await query(
      `SELECT COUNT(*)::int AS total FROM load_templates WHERE ${whereSql}`,
      params
    );
    const total = countResult.rows[0]?.total || 0;

    const listParams = params.slice();
    listParams.push(pageSize);
    listParams.push(offset);

    const listResult = await query(
      `SELECT id, tenant_id, name, description, template_data, created_by, last_used_at, created_at, updated_at
         FROM load_templates
        WHERE ${whereSql}
        ORDER BY COALESCE(last_used_at, updated_at, created_at) DESC, name ASC
        LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    res.json({
      success: true,
      data: listResult.rows,
      meta: { page, pageSize, total, totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0 }
    });
  } catch (err) {
    console.error('Error listing load templates:', err);
    res.status(500).json({ success: false, error: 'Failed to list load templates' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });

    const row = await loadTemplateById(req.params.id, tenantId);
    if (!row) return res.status(404).json({ success: false, error: 'Load template not found' });
    res.json({ success: true, data: row });
  } catch (err) {
    console.error('Error fetching load template:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch load template' });
  }
});

router.post('/', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });

    const userId = req.user?.id || req.user?.sub || null;
    if (!userId) return res.status(401).json({ success: false, error: 'User context required' });

    const body = req.body || {};
    const name = trimOrNull(body.name, NAME_MAX_LENGTH);
    if (!name) return res.status(400).json({ success: false, error: 'name is required' });

    const description = trimOrNull(body.description, DESCRIPTION_MAX_LENGTH);
    const loadId = trimOrNull(body.load_id || body.loadId);

    let templateData;
    if (loadId) {
      templateData = await snapshotLoadAsTemplateData(loadId, tenantId, getOperatingEntityId(req));
      if (!templateData) return res.status(404).json({ success: false, error: 'Load not found' });
    } else if (body.template_data && typeof body.template_data === 'object') {
      // Allow callers to supply a prebuilt snapshot (e.g., unsaved wizard data)
      templateData = body.template_data;
    } else {
      return res.status(400).json({ success: false, error: 'load_id or template_data is required' });
    }

    const id = uuidv4();
    try {
      const result = await query(
        `INSERT INTO load_templates (id, tenant_id, name, description, template_data, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW(), NOW())
         RETURNING id, tenant_id, name, description, template_data, created_by, last_used_at, created_at, updated_at`,
        [id, tenantId, name, description, JSON.stringify(templateData), userId]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
      if (err && err.code === '23505') {
        return res.status(409).json({ success: false, error: 'A load template with this name already exists' });
      }
      throw err;
    }
  } catch (err) {
    console.error('Error creating load template:', err);
    res.status(500).json({ success: false, error: 'Failed to create load template' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });

    const body = req.body || {};
    const sets = [];
    const params = [];

    if (Object.prototype.hasOwnProperty.call(body, 'name')) {
      const name = trimOrNull(body.name, NAME_MAX_LENGTH);
      if (!name) return res.status(400).json({ success: false, error: 'name cannot be empty' });
      params.push(name);
      sets.push(`name = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'description')) {
      const description = trimOrNull(body.description, DESCRIPTION_MAX_LENGTH);
      params.push(description);
      sets.push(`description = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'template_data')) {
      if (body.template_data && typeof body.template_data !== 'object') {
        return res.status(400).json({ success: false, error: 'template_data must be an object' });
      }
      params.push(JSON.stringify(body.template_data));
      sets.push(`template_data = $${params.length}::jsonb`);
    }

    if (sets.length === 0) {
      const current = await loadTemplateById(req.params.id, tenantId);
      if (!current) return res.status(404).json({ success: false, error: 'Load template not found' });
      return res.json({ success: true, data: current });
    }

    params.push(req.params.id);
    params.push(tenantId);

    try {
      const result = await query(
        `UPDATE load_templates SET ${sets.join(', ')}, updated_at = NOW()
          WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
        RETURNING id, tenant_id, name, description, template_data, created_by, last_used_at, created_at, updated_at`,
        params
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Load template not found' });
      }
      res.json({ success: true, data: result.rows[0] });
    } catch (err) {
      if (err && err.code === '23505') {
        return res.status(409).json({ success: false, error: 'A load template with this name already exists' });
      }
      throw err;
    }
  } catch (err) {
    console.error('Error updating load template:', err);
    res.status(500).json({ success: false, error: 'Failed to update load template' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });

    const result = await query(
      `DELETE FROM load_templates WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [req.params.id, tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Load template not found' });
    }
    res.json({ success: true, data: { id: result.rows[0].id } });
  } catch (err) {
    console.error('Error deleting load template:', err);
    res.status(500).json({ success: false, error: 'Failed to delete load template' });
  }
});

/** POST /:id/use — stamp last_used_at and return the template payload for the wizard */
router.post('/:id/use', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });

    const result = await query(
      `UPDATE load_templates SET last_used_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
      RETURNING id, tenant_id, name, description, template_data, created_by, last_used_at, created_at, updated_at`,
      [req.params.id, tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Load template not found' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('Error marking load template as used:', err);
    res.status(500).json({ success: false, error: 'Failed to mark load template as used' });
  }
});

module.exports = router;
