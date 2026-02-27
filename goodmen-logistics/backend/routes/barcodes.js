const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/dynatrace-logger');
const db = require('../config/knex');
const barcodesService = require('../services/barcodes.service');

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
