/**
 * Warehouse-Shop Supply Rules API Routes (FN-693)
 *
 * CRUD endpoints for managing warehouse→shop supply relationships.
 * Mounted at /api/locations/:id/supply-rules in the inventory service.
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { knex } = require('../internal/db');

function tenantId(req) {
  return req.context?.tenantId || req.user?.tenantId || req.user?.tenant_id || null;
}

/**
 * Validate that a location exists for this tenant and has the expected type.
 * Returns the location row or null.
 */
async function validateLocationType(locationId, expectedType, tid) {
  const loc = await knex('locations')
    .where({ id: locationId })
    .modify((qb) => { if (tid) qb.where('tenant_id', tid); })
    .first('id', 'name', 'location_type');

  if (!loc) return { error: `Location ${locationId} not found`, status: 404 };
  if (!loc.location_type || loc.location_type.toUpperCase() !== expectedType) {
    return {
      error: `Location "${loc.name}" has type "${loc.location_type || 'NULL'}" — expected "${expectedType}"`,
      status: 422
    };
  }
  return { location: loc };
}

// ─── GET /api/locations/:id/supply-rules ────────────────────────────────────

/**
 * @openapi
 * /api/locations/{id}/supply-rules:
 *   get:
 *     summary: List supply rules for a location
 *     description: Returns all warehouse-shop supply rules where this location is either the warehouse or the shop.
 *     tags:
 *       - Warehouse Supply Rules
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Location ID (warehouse or shop)
 *     responses:
 *       200:
 *         description: Array of supply rules with joined location names
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
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Server error
 */
router.get('/', async (req, res) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(401).json({ success: false, error: 'Tenant context required' });

    const locationId = req.params.id;

    const rules = await knex('warehouse_shop_supply_rules as r')
      .leftJoin('locations as wh', 'wh.id', 'r.warehouse_location_id')
      .leftJoin('locations as sh', 'sh.id', 'r.shop_location_id')
      .where('r.tenant_id', tid)
      .where(function () {
        this.where('r.warehouse_location_id', locationId)
          .orWhere('r.shop_location_id', locationId);
      })
      .select(
        'r.*',
        'wh.name as warehouse_name',
        'wh.location_type as warehouse_type',
        'sh.name as shop_name',
        'sh.location_type as shop_type'
      )
      .orderBy('r.created_at', 'desc');

    res.json({ success: true, data: rules });
  } catch (err) {
    console.error('Error fetching supply rules:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch supply rules' });
  }
});

// ─── POST /api/locations/:id/supply-rules ───────────────────────────────────

/**
 * @openapi
 * /api/locations/{id}/supply-rules:
 *   post:
 *     summary: Create a supply rule
 *     description: Creates a warehouse→shop supply rule. Validates that warehouse_location_id references a WAREHOUSE and shop_location_id references a SHOP. If is_primary_supplier is true, unsets any existing primary supplier for the same shop.
 *     tags:
 *       - Warehouse Supply Rules
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Location ID (context — either warehouse or shop)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - warehouse_location_id
 *               - shop_location_id
 *             properties:
 *               warehouse_location_id:
 *                 type: string
 *                 format: uuid
 *               shop_location_id:
 *                 type: string
 *                 format: uuid
 *               is_primary_supplier:
 *                 type: boolean
 *                 default: false
 *               auto_replenish:
 *                 type: boolean
 *                 default: false
 *               delivery_days:
 *                 type: integer
 *                 nullable: true
 *               notes:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       201:
 *         description: Created supply rule
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Location not found
 *       409:
 *         description: Duplicate rule — this pair already exists
 *       422:
 *         description: Type validation failed (warehouse must be WAREHOUSE, shop must be SHOP)
 *       500:
 *         description: Server error
 */
router.post('/', async (req, res) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(401).json({ success: false, error: 'Tenant context required' });

    const {
      warehouse_location_id,
      shop_location_id,
      is_primary_supplier = false,
      auto_replenish = false,
      delivery_days = null,
      notes = null
    } = req.body;

    if (!warehouse_location_id || !shop_location_id) {
      return res.status(400).json({ success: false, error: 'warehouse_location_id and shop_location_id are required' });
    }

    if (warehouse_location_id === shop_location_id) {
      return res.status(400).json({ success: false, error: 'Warehouse and shop must be different locations' });
    }

    // Validate types
    const whResult = await validateLocationType(warehouse_location_id, 'WAREHOUSE', tid);
    if (whResult.error) return res.status(whResult.status).json({ success: false, error: whResult.error });

    const shResult = await validateLocationType(shop_location_id, 'SHOP', tid);
    if (shResult.error) return res.status(shResult.status).json({ success: false, error: shResult.error });

    // Check for existing duplicate
    const existing = await knex('warehouse_shop_supply_rules')
      .where({ tenant_id: tid, warehouse_location_id, shop_location_id })
      .first('id');
    if (existing) {
      return res.status(409).json({ success: false, error: 'A supply rule for this warehouse-shop pair already exists', existingId: existing.id });
    }

    // If setting as primary, unset existing primary for this shop
    if (is_primary_supplier) {
      await knex('warehouse_shop_supply_rules')
        .where({ tenant_id: tid, shop_location_id, is_primary_supplier: true })
        .update({ is_primary_supplier: false, updated_at: knex.fn.now() });
    }

    const [rule] = await knex('warehouse_shop_supply_rules')
      .insert({
        tenant_id: tid,
        warehouse_location_id,
        shop_location_id,
        is_primary_supplier: !!is_primary_supplier,
        auto_replenish: !!auto_replenish,
        delivery_days: delivery_days != null ? parseInt(delivery_days, 10) : null,
        notes: notes || null,
        active: true,
      })
      .returning('*');

    res.status(201).json({ success: true, data: rule });
  } catch (err) {
    console.error('Error creating supply rule:', err);
    if (err.code === '23505') {
      return res.status(409).json({ success: false, error: 'Duplicate supply rule for this warehouse-shop pair' });
    }
    res.status(500).json({ success: false, error: 'Failed to create supply rule' });
  }
});

// ─── PATCH /api/locations/:id/supply-rules/:ruleId ──────────────────────────

/**
 * @openapi
 * /api/locations/{id}/supply-rules/{ruleId}:
 *   patch:
 *     summary: Update a supply rule
 *     description: Partially updates a warehouse-shop supply rule. If is_primary_supplier is set to true, unsets any other primary supplier for the same shop.
 *     tags:
 *       - Warehouse Supply Rules
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: ruleId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               is_primary_supplier:
 *                 type: boolean
 *               auto_replenish:
 *                 type: boolean
 *               delivery_days:
 *                 type: integer
 *                 nullable: true
 *               notes:
 *                 type: string
 *                 nullable: true
 *               active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Updated supply rule
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Rule not found
 *       500:
 *         description: Server error
 */
router.patch('/:ruleId', async (req, res) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(401).json({ success: false, error: 'Tenant context required' });

    const { ruleId } = req.params;

    const rule = await knex('warehouse_shop_supply_rules')
      .where({ id: ruleId, tenant_id: tid })
      .first();
    if (!rule) return res.status(404).json({ success: false, error: 'Supply rule not found' });

    const updates = {};
    const body = req.body || {};

    if (body.is_primary_supplier !== undefined) updates.is_primary_supplier = !!body.is_primary_supplier;
    if (body.auto_replenish !== undefined) updates.auto_replenish = !!body.auto_replenish;
    if (body.delivery_days !== undefined) updates.delivery_days = body.delivery_days != null ? parseInt(body.delivery_days, 10) : null;
    if (body.notes !== undefined) updates.notes = body.notes || null;
    if (body.active !== undefined) updates.active = !!body.active;

    if (Object.keys(updates).length === 0) {
      return res.json({ success: true, data: rule, message: 'No changes' });
    }

    updates.updated_at = knex.fn.now();

    // If flipping to primary, unset other primaries for this shop
    if (updates.is_primary_supplier === true) {
      await knex('warehouse_shop_supply_rules')
        .where({ tenant_id: tid, shop_location_id: rule.shop_location_id, is_primary_supplier: true })
        .whereNot({ id: ruleId })
        .update({ is_primary_supplier: false, updated_at: knex.fn.now() });
    }

    const [updated] = await knex('warehouse_shop_supply_rules')
      .where({ id: ruleId, tenant_id: tid })
      .update(updates)
      .returning('*');

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Error updating supply rule:', err);
    res.status(500).json({ success: false, error: 'Failed to update supply rule' });
  }
});

// ─── DELETE /api/locations/:id/supply-rules/:ruleId ─────────────────────────

/**
 * @openapi
 * /api/locations/{id}/supply-rules/{ruleId}:
 *   delete:
 *     summary: Delete a supply rule
 *     description: Permanently deletes a warehouse-shop supply rule.
 *     tags:
 *       - Warehouse Supply Rules
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: ruleId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Deleted supply rule
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Rule not found
 *       500:
 *         description: Server error
 */
router.delete('/:ruleId', async (req, res) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(401).json({ success: false, error: 'Tenant context required' });

    const { ruleId } = req.params;

    const [deleted] = await knex('warehouse_shop_supply_rules')
      .where({ id: ruleId, tenant_id: tid })
      .delete()
      .returning('*');

    if (!deleted) return res.status(404).json({ success: false, error: 'Supply rule not found' });

    res.json({ success: true, data: deleted, message: 'Supply rule deleted' });
  } catch (err) {
    console.error('Error deleting supply rule:', err);
    res.status(500).json({ success: false, error: 'Failed to delete supply rule' });
  }
});

module.exports = router;
