#!/usr/bin/env node
/**
 * Backfill missing pickup_date and delivery_date in settlement_load_items
 * This script queries load_stops to populate missing dates in settlement load items
 * 
 * Usage (from repo root):
 *   node backend/scripts/backfill-settlement-load-dates.js
 */
const path = require('path');
const fs = require('fs');

const backendDir = path.join(__dirname, '..');
const repoRoot = path.join(backendDir, '..');
process.chdir(repoRoot);

try {
  const dotenvPath = require.resolve('dotenv', { paths: [path.join(backendDir, 'packages', 'goodmen-shared')] });
  const dotenv = require(dotenvPath);
  const envFile =
    process.env.NODE_ENV === 'production' && fs.existsSync(path.join(repoRoot, '.env.production'))
      ? path.join(repoRoot, '.env.production')
      : path.join(repoRoot, '.env');
  dotenv.config({ path: envFile });
} catch (_) {}

const knex = require('../packages/goodmen-shared/config/knex');

async function backfillAllSettlementLoadDates() {
  try {
    console.log('Starting backfill of settlement load dates...');
    
    // Find all settlement_load_items with missing dates
    const itemsWithMissingDates = await knex('settlement_load_items')
      .where(function () {
        this.whereNull('pickup_date').orWhereNull('delivery_date');
      })
      .select('id', 'settlement_id', 'load_id', 'pickup_date', 'delivery_date');

    console.log(`Found ${itemsWithMissingDates.length} load items with missing dates`);

    if (itemsWithMissingDates.length === 0) {
      console.log('✅ All settlement load items have dates populated');
      return;
    }

    let updated = 0;
    let errors = 0;

    for (const item of itemsWithMissingDates) {
      try {
        // Get load details
        const load = await knex('loads')
          .where({ id: item.load_id })
          .select('pickup_date', 'delivery_date')
          .first();

        // Get stop dates from load_stops
        const stops = await knex.raw(`
          SELECT stop_type, stop_date 
          FROM load_stops 
          WHERE load_id = ? 
          ORDER BY sequence ASC, stop_type
        `, [item.load_id]);

        const normalizeStopType = (type) => {
          if (!type) return '';
          const t = String(type).toUpperCase().trim();
          if (t.includes('PICK')) return 'PICKUP';
          if (t.includes('DELIV') || t.includes('DROP')) return 'DELIVERY';
          return t;
        };

        const pickups = (stops.rows || []).filter(s => normalizeStopType(s.stop_type) === 'PICKUP');
        const deliveries = (stops.rows || []).filter(s => normalizeStopType(s.stop_type) === 'DELIVERY');

        const pickupDate = item.pickup_date || pickups[0]?.stop_date || load?.pickup_date || null;
        const deliveryDate = item.delivery_date || 
                           (deliveries.length > 0 ? deliveries[deliveries.length - 1].stop_date : null) || 
                           load?.delivery_date || 
                           null;

        // Update the item
        await knex('settlement_load_items')
          .where({ id: item.id })
          .update({
            pickup_date: pickupDate,
            delivery_date: deliveryDate
          });

        console.log(`✓ Updated load item ${item.id} (load ${item.load_id}): pickup=${pickupDate}, delivery=${deliveryDate}`);
        updated++;
      } catch (err) {
        console.error(`✗ Error updating load item ${item.id}:`, err.message);
        errors++;
      }
    }

    console.log('\n=== Backfill Complete ===');
    console.log(`✅ Updated: ${updated}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📊 Total processed: ${itemsWithMissingDates.length}`);

  } catch (err) {
    console.error('Fatal error during backfill:', err);
    throw err;
  } finally {
    await knex.destroy();
  }
}

// Run the backfill
backfillAllSettlementLoadDates()
  .then(() => {
    console.log('\n✨ Backfill script completed');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n💥 Backfill script failed:', err);
    process.exit(1);
  });
