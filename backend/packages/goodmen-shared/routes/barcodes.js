const express = require('express');
const router = express.Router();
const multer = require('multer');
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/logger');
const db = require('../internal/db').knex;
const barcodesService = require('../services/barcodes.service');
const { decodeBarcodeFromBuffer } = require('../services/barcode-decode');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * @openapi
 * /api/barcodes/decode-image:
 *   post:
 *     summary: Decode a barcode from an image
 *     description: Accepts an uploaded image file and attempts to decode a barcode from it. Returns the barcode value and format if found, or null values if no barcode is detected.
 *     tags:
 *       - Barcodes
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - image
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Image file containing a barcode (max 10 MB)
 *     responses:
 *       200:
 *         description: Decode result (barcode may be null if not found)
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
 *                     barcode:
 *                       type: string
 *                       nullable: true
 *                     format:
 *                       type: string
 *                       nullable: true
 *       400:
 *         description: No image uploaded
 *       500:
 *         description: Failed to decode barcode
 */
router.post('/decode-image', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: 'No image uploaded; use field name "image".' });
    }
    const result = await decodeBarcodeFromBuffer(req.file.buffer);
    if (!result) {
      return res.status(200).json({ success: true, data: { barcode: null, format: null } });
    }
    return res.json({ success: true, data: result });
  } catch (error) {
    dtLogger.error('barcode_decode_image_failed', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to decode barcode from image.' });
  }
});

/**
 * @openapi
 * /api/barcodes/{code}:
 *   get:
 *     summary: Look up a barcode
 *     description: Looks up a barcode value and returns the associated part details and inventory-by-location breakdown. Optionally filter inventory to a single location.
 *     tags:
 *       - Barcodes
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: Barcode value to look up
 *       - in: query
 *         name: locationId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Optional location UUID to filter inventory
 *     responses:
 *       200:
 *         description: Barcode, part, and inventory data
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
 *                     barcode:
 *                       type: object
 *                     part:
 *                       type: object
 *                     inventory_by_location:
 *                       type: array
 *                       items:
 *                         type: object
 *       400:
 *         description: Barcode code is required
 *       404:
 *         description: Barcode not found
 *       500:
 *         description: Server error
 */
router.get('/:code', authMiddleware, async (req, res) => {
  try {
    const code = (req.params.code || '').trim();
    if (!code) {
      return res.status(400).json({ error: 'Barcode code is required' });
    }

    const barcode = await barcodesService.getBarcodeByCode(code);
    if (!barcode) {
      return res.status(404).json({ error: 'Barcode not found' });
    }

    let inventoryByLocation;
    const locationId = req.query.location_id || req.query.locationId;
    if (locationId) {
      inventoryByLocation = await db('inventory as i')
        .join('locations as l', 'i.location_id', 'l.id')
        .select(
          'i.location_id',
          'l.name as location_name',
          'i.on_hand_qty',
          'i.reserved_qty',
          db.raw('(i.on_hand_qty - i.reserved_qty) as available_qty')
        )
        .where({ 'i.part_id': barcode.part_id, 'i.location_id': locationId });
    } else {
      inventoryByLocation = await db('inventory as i')
        .join('locations as l', 'i.location_id', 'l.id')
        .select(
          'i.location_id',
          'l.name as location_name',
          'i.on_hand_qty',
          'i.reserved_qty',
          db.raw('(i.on_hand_qty - i.reserved_qty) as available_qty')
        )
        .where({ 'i.part_id': barcode.part_id });
    }

    res.json({
      success: true,
      data: {
        barcode: {
          id: barcode.id,
          barcode_value: barcode.barcode_value,
          part_id: barcode.part_id,
          pack_qty: barcode.pack_qty,
          vendor: barcode.vendor
        },
        part: {
          id: barcode.part_id,
          sku: barcode.sku,
          name: barcode.name,
          category: barcode.category,
          unit_price: barcode.unit_price,
          unit_cost: barcode.unit_cost,
          default_retail_price: barcode.default_retail_price,
          default_cost: barcode.default_cost,
          taxable: barcode.taxable
        },
        inventory_by_location: inventoryByLocation
      }
    });
  } catch (error) {
    dtLogger.error('barcode_lookup_failed', { code: req.params.code, error: error.message });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
