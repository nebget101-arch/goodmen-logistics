const express = require('express');
const router = express.Router({ mergeParams: true });
const { query } = require('../internal/db');
const dtLogger = require('../utils/logger');

const VALID_BIN_TYPES = ['SHELF', 'RACK', 'FLOOR', 'CABINET', 'FREEZER', 'OUTDOOR'];

/**
 * @openapi
 * /api/locations/{locationId}/bins:
 *   get:
 *     summary: List bins for a location
 *     description: Retrieves all bins for the specified location. Supports filtering by active status.
 *     tags:
 *       - Location Bins
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: locationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *         description: Filter by active status (omit for all)
 *     responses:
 *       200:
 *         description: List of bins
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
 *                   bin_code:
 *                     type: string
 *                   bin_name:
 *                     type: string
 *                     nullable: true
 *                   bin_type:
 *                     type: string
 *                     nullable: true
 *                   zone:
 *                     type: string
 *                     nullable: true
 *                   aisle:
 *                     type: string
 *                     nullable: true
 *                   shelf:
 *                     type: string
 *                     nullable: true
 *                   position:
 *                     type: string
 *                     nullable: true
 *                   active:
 *                     type: boolean
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/', async (req, res) => {
  const start = Date.now();
  try {
    const { locationId } = req.params;
    const params = [locationId];
    let whereClause = 'WHERE lb.location_id = $1';

    if (req.query.active !== undefined) {
      params.push(req.query.active === 'true');
      whereClause += ` AND lb.active = $${params.length}`;
    }

    if (req.context?.tenantId) {
      params.push(req.context.tenantId);
      whereClause += ` AND lb.tenant_id = $${params.length}`;
    }

    const result = await query(
      `SELECT lb.*,
              (SELECT COUNT(*) FROM inventory i WHERE i.bin_id = lb.id) AS inventory_count
       FROM location_bins lb
       ${whereClause}
       ORDER BY lb.zone NULLS LAST, lb.aisle NULLS LAST, lb.shelf NULLS LAST, lb.bin_code`,
      params
    );

    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', `/api/locations/${locationId}/bins`, 200, duration, { count: result.rows.length });

    res.json(result.rows);
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('Failed to fetch location bins', error, { locationId: req.params.locationId });
    dtLogger.trackRequest('GET', `/api/locations/${req.params.locationId}/bins`, 500, duration);
    console.error('Error fetching location bins:', error);
    res.status(500).json({ message: 'Failed to fetch bins' });
  }
});

/**
 * @openapi
 * /api/locations/{locationId}/bins:
 *   post:
 *     summary: Create a bin
 *     description: Creates a new bin in the specified location. Rejects duplicate bin_code with 409.
 *     tags:
 *       - Location Bins
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: locationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - bin_code
 *             properties:
 *               bin_code:
 *                 type: string
 *               bin_name:
 *                 type: string
 *               bin_type:
 *                 type: string
 *                 enum: [SHELF, RACK, FLOOR, CABINET, FREEZER, OUTDOOR]
 *               zone:
 *                 type: string
 *               aisle:
 *                 type: string
 *               shelf:
 *                 type: string
 *               position:
 *                 type: string
 *               capacity_notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Bin created
 *       400:
 *         description: Missing bin_code or invalid bin_type
 *       409:
 *         description: Duplicate bin_code in this location
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/', async (req, res) => {
  const start = Date.now();
  try {
    const { locationId } = req.params;
    const { bin_code, bin_name, bin_type, zone, aisle, shelf, position, capacity_notes } = req.body || {};
    const tenantId = req.context?.tenantId || null;

    if (!bin_code || !bin_code.trim()) {
      return res.status(400).json({ message: 'bin_code is required' });
    }
    if (bin_type && !VALID_BIN_TYPES.includes(bin_type.toUpperCase())) {
      return res.status(400).json({ message: `Invalid bin_type. Must be one of: ${VALID_BIN_TYPES.join(', ')}` });
    }

    const result = await query(
      `INSERT INTO location_bins (tenant_id, location_id, bin_code, bin_name, bin_type, zone, aisle, shelf, position, capacity_notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        tenantId, locationId, bin_code.trim(),
        bin_name || null, bin_type ? bin_type.toUpperCase() : null,
        zone || null, aisle || null, shelf || null, position || null, capacity_notes || null
      ]
    );

    const duration = Date.now() - start;
    dtLogger.trackRequest('POST', `/api/locations/${locationId}/bins`, 201, duration);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    const duration = Date.now() - start;
    if (error.code === '23505') {
      dtLogger.trackRequest('POST', `/api/locations/${req.params.locationId}/bins`, 409, duration);
      return res.status(409).json({ message: 'A bin with this code already exists in this location' });
    }
    dtLogger.error('Failed to create bin', error, { locationId: req.params.locationId });
    dtLogger.trackRequest('POST', `/api/locations/${req.params.locationId}/bins`, 500, duration);
    console.error('Error creating bin:', error);
    res.status(500).json({ message: 'Failed to create bin' });
  }
});

/**
 * @openapi
 * /api/locations/{locationId}/bins/bulk:
 *   post:
 *     summary: Bulk create bins from pattern
 *     description: |
 *       Creates multiple bins using pattern-based generation.
 *       Supports two patterns:
 *       - Range: `{ pattern: "A-1..A-20" }` → creates bins A-1 through A-20
 *       - Zone + rows: `{ zone: "X", rows: ["R1","R2","R3"] }` → creates bins in zone X
 *     tags:
 *       - Location Bins
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: locationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - type: object
 *                 required: [pattern]
 *                 properties:
 *                   pattern:
 *                     type: string
 *                     description: Range pattern like "A-1..A-20"
 *                   bin_type:
 *                     type: string
 *                   zone:
 *                     type: string
 *               - type: object
 *                 required: [zone, rows]
 *                 properties:
 *                   zone:
 *                     type: string
 *                   rows:
 *                     type: array
 *                     items:
 *                       type: string
 *                   bin_type:
 *                     type: string
 *     responses:
 *       201:
 *         description: Bins created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 created:
 *                   type: integer
 *                 skipped:
 *                   type: integer
 *                 bins:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Invalid pattern or missing fields
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/bulk', async (req, res) => {
  const start = Date.now();
  try {
    const { locationId } = req.params;
    const { pattern, zone, rows, bin_type } = req.body || {};
    const tenantId = req.context?.tenantId || null;

    let binCodes = [];

    if (pattern) {
      // Range pattern: "A-1..A-20" or "SHELF-01..SHELF-50"
      binCodes = parseRangePattern(pattern);
      if (!binCodes || binCodes.length === 0) {
        return res.status(400).json({ message: `Invalid range pattern: "${pattern}". Expected format: PREFIX-START..PREFIX-END (e.g., A-1..A-20)` });
      }
    } else if (zone && Array.isArray(rows) && rows.length > 0) {
      // Zone + rows pattern
      binCodes = rows.map((row) => `${zone}-${row}`);
    } else {
      return res.status(400).json({ message: 'Provide either { pattern: "A-1..A-20" } or { zone: "X", rows: ["R1","R2"] }' });
    }

    if (binCodes.length > 500) {
      return res.status(400).json({ message: `Pattern would generate ${binCodes.length} bins. Maximum is 500.` });
    }

    const normalizedType = bin_type && VALID_BIN_TYPES.includes(bin_type.toUpperCase()) ? bin_type.toUpperCase() : null;

    const created = [];
    let skipped = 0;

    for (const code of binCodes) {
      try {
        const result = await query(
          `INSERT INTO location_bins (tenant_id, location_id, bin_code, bin_type, zone)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (location_id, bin_code) DO NOTHING
           RETURNING *`,
          [tenantId, locationId, code, normalizedType, zone || null]
        );
        if (result.rows.length > 0) {
          created.push(result.rows[0]);
        } else {
          skipped++;
        }
      } catch (insertErr) {
        dtLogger.warn('bulk_bin_insert_skip', { code, error: insertErr?.message });
        skipped++;
      }
    }

    const duration = Date.now() - start;
    dtLogger.trackRequest('POST', `/api/locations/${locationId}/bins/bulk`, 201, duration, {
      requested: binCodes.length, created: created.length, skipped
    });

    res.status(201).json({ created: created.length, skipped, bins: created });
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('Failed to bulk create bins', error, { locationId: req.params.locationId });
    dtLogger.trackRequest('POST', `/api/locations/${req.params.locationId}/bins/bulk`, 500, duration);
    console.error('Error bulk creating bins:', error);
    res.status(500).json({ message: 'Failed to bulk create bins' });
  }
});

/**
 * Parse a range pattern like "A-1..A-20" into an array of bin codes.
 * Supports numeric ranges: "A-1..A-20" → ["A-1","A-2",...,"A-20"]
 * Also supports zero-padded: "SHELF-01..SHELF-50" → ["SHELF-01","SHELF-02",...,"SHELF-50"]
 */
function parseRangePattern(pattern) {
  const match = pattern.match(/^(.+?)(\d+)\.\.(.+?)(\d+)$/);
  if (!match) return null;

  const [, prefixStart, startNumStr, prefixEnd, endNumStr] = match;

  // Prefixes must match (e.g., "A-" on both sides)
  if (prefixStart !== prefixEnd) return null;

  const startNum = parseInt(startNumStr, 10);
  const endNum = parseInt(endNumStr, 10);

  if (isNaN(startNum) || isNaN(endNum) || endNum < startNum) return null;

  const padLength = startNumStr.length; // preserve zero-padding
  const codes = [];
  for (let i = startNum; i <= endNum; i++) {
    codes.push(`${prefixStart}${String(i).padStart(padLength, '0')}`);
  }
  return codes;
}

/**
 * @openapi
 * /api/locations/{locationId}/bins/{binId}:
 *   patch:
 *     summary: Update a bin
 *     description: Partially updates a bin's properties.
 *     tags:
 *       - Location Bins
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: locationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: binId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               bin_code:
 *                 type: string
 *               bin_name:
 *                 type: string
 *               bin_type:
 *                 type: string
 *                 enum: [SHELF, RACK, FLOOR, CABINET, FREEZER, OUTDOOR]
 *               zone:
 *                 type: string
 *               aisle:
 *                 type: string
 *               shelf:
 *                 type: string
 *               position:
 *                 type: string
 *               capacity_notes:
 *                 type: string
 *               active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Bin updated
 *       400:
 *         description: Invalid bin_type
 *       404:
 *         description: Bin not found
 *       409:
 *         description: Duplicate bin_code in this location
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.patch('/:binId', async (req, res) => {
  const start = Date.now();
  try {
    const { locationId, binId } = req.params;
    const body = req.body || {};

    const allowedFields = ['bin_code', 'bin_name', 'bin_type', 'zone', 'aisle', 'shelf', 'position', 'capacity_notes', 'active'];
    const updates = [];
    const values = [];
    let paramIdx = 1;

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        let val = body[field];
        if (field === 'bin_type' && val) {
          val = val.toUpperCase();
          if (!VALID_BIN_TYPES.includes(val)) {
            return res.status(400).json({ message: `Invalid bin_type. Must be one of: ${VALID_BIN_TYPES.join(', ')}` });
          }
        }
        if (field === 'bin_code' && val) {
          val = val.trim();
        }
        updates.push(`${field} = $${paramIdx}`);
        values.push(val);
        paramIdx++;
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(binId, locationId);

    const result = await query(
      `UPDATE location_bins SET ${updates.join(', ')} WHERE id = $${paramIdx} AND location_id = $${paramIdx + 1} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Bin not found' });
    }

    const duration = Date.now() - start;
    dtLogger.trackRequest('PATCH', `/api/locations/${locationId}/bins/${binId}`, 200, duration);

    res.json(result.rows[0]);
  } catch (error) {
    const duration = Date.now() - start;
    if (error.code === '23505') {
      dtLogger.trackRequest('PATCH', `/api/locations/${req.params.locationId}/bins/${req.params.binId}`, 409, duration);
      return res.status(409).json({ message: 'A bin with this code already exists in this location' });
    }
    dtLogger.error('Failed to update bin', error, { locationId: req.params.locationId, binId: req.params.binId });
    dtLogger.trackRequest('PATCH', `/api/locations/${req.params.locationId}/bins/${req.params.binId}`, 500, duration);
    console.error('Error updating bin:', error);
    res.status(500).json({ message: 'Failed to update bin' });
  }
});

/**
 * @openapi
 * /api/locations/{locationId}/bins/{binId}:
 *   delete:
 *     summary: Delete a bin
 *     description: Deletes a bin. If inventory items reference this bin, performs a soft delete (sets active=false) instead of hard delete.
 *     tags:
 *       - Location Bins
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: locationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: binId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Bin deleted or soft-deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 soft_deleted:
 *                   type: boolean
 *       404:
 *         description: Bin not found
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.delete('/:binId', async (req, res) => {
  const start = Date.now();
  try {
    const { locationId, binId } = req.params;

    // Check if bin exists
    const binRes = await query(
      'SELECT id FROM location_bins WHERE id = $1 AND location_id = $2',
      [binId, locationId]
    );
    if (binRes.rows.length === 0) {
      return res.status(404).json({ message: 'Bin not found' });
    }

    // Check if inventory references this bin
    const inventoryCount = await query(
      'SELECT COUNT(*) AS cnt FROM inventory WHERE bin_id = $1',
      [binId]
    );
    const hasInventory = parseInt(inventoryCount.rows[0]?.cnt || '0', 10) > 0;

    if (hasInventory) {
      // Soft delete — set active = false
      await query(
        'UPDATE location_bins SET active = false, updated_at = NOW() WHERE id = $1',
        [binId]
      );

      const duration = Date.now() - start;
      dtLogger.trackRequest('DELETE', `/api/locations/${locationId}/bins/${binId}`, 200, duration, { soft_deleted: true });

      return res.json({ message: 'Bin deactivated (inventory items still reference it)', soft_deleted: true });
    }

    // Hard delete
    await query('DELETE FROM location_bins WHERE id = $1', [binId]);

    const duration = Date.now() - start;
    dtLogger.trackRequest('DELETE', `/api/locations/${locationId}/bins/${binId}`, 200, duration, { soft_deleted: false });

    res.json({ message: 'Bin deleted', soft_deleted: false });
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('Failed to delete bin', error, { locationId: req.params.locationId, binId: req.params.binId });
    dtLogger.trackRequest('DELETE', `/api/locations/${req.params.locationId}/bins/${req.params.binId}`, 500, duration);
    console.error('Error deleting bin:', error);
    res.status(500).json({ message: 'Failed to delete bin' });
  }
});

module.exports = router;
