/**
 * Migration 3 — FN-688: Link inventory & receiving_ticket_lines to location_bins
 *
 * 1. Add bin_id UUID NULL FK -> location_bins.id ON DELETE SET NULL to inventory
 * 2. Add bin_id_override UUID NULL FK -> location_bins.id ON DELETE SET NULL to receiving_ticket_lines
 * 3. Backfill: for each distinct (location_id, bin_location) in inventory,
 *    create a matching location_bins row and set inventory.bin_id
 * 4. Same backfill pattern for receiving_ticket_lines.bin_location_override
 *
 * Keeps existing bin_location / bin_location_override text columns for backward compatibility.
 */

exports.up = async function up(knex) {
  // ── 1. Add bin_id to inventory ─────────────────────────────────────────────
  const hasInventoryBinId = await knex.schema.hasColumn('inventory', 'bin_id');
  if (!hasInventoryBinId) {
    await knex.schema.table('inventory', (table) => {
      table.uuid('bin_id').nullable().references('id').inTable('location_bins').onDelete('SET NULL');
    });
  }

  // ── 2. Add bin_id_override to receiving_ticket_lines ───────────────────────
  const hasReceivingBinId = await knex.schema.hasColumn('receiving_ticket_lines', 'bin_id_override');
  if (!hasReceivingBinId) {
    await knex.schema.table('receiving_ticket_lines', (table) => {
      table.uuid('bin_id_override').nullable().references('id').inTable('location_bins').onDelete('SET NULL');
    });
  }

  // ── 3. Backfill inventory.bin_id ───────────────────────────────────────────
  // Find all distinct (location_id, bin_location) pairs in inventory where bin_location is set
  const inventoryBins = await knex.raw(`
    SELECT DISTINCT i.location_id, i.bin_location, l.tenant_id
    FROM inventory i
    JOIN locations l ON l.id = i.location_id
    WHERE i.bin_location IS NOT NULL
      AND TRIM(i.bin_location) <> ''
      AND i.bin_id IS NULL
  `);

  for (const row of (inventoryBins.rows || [])) {
    // Upsert into location_bins (idempotent — skip if already exists)
    const existing = await knex('location_bins')
      .where({ location_id: row.location_id, bin_code: row.bin_location.trim() })
      .first('id');

    let binId;
    if (existing) {
      binId = existing.id;
    } else {
      const [inserted] = await knex('location_bins')
        .insert({
          tenant_id: row.tenant_id,
          location_id: row.location_id,
          bin_code: row.bin_location.trim(),
          bin_name: row.bin_location.trim(),
          active: true,
        })
        .returning('id');
      binId = inserted.id || inserted;
    }

    // Update all inventory rows at this location with this bin_location
    await knex('inventory')
      .where({ location_id: row.location_id, bin_location: row.bin_location })
      .whereNull('bin_id')
      .update({ bin_id: binId });
  }

  // ── 4. Backfill receiving_ticket_lines.bin_id_override ─────────────────────
  // Find distinct (location_id from parent ticket, bin_location_override) pairs
  const receivingBins = await knex.raw(`
    SELECT DISTINCT rt.location_id, rtl.bin_location_override, l.tenant_id
    FROM receiving_ticket_lines rtl
    JOIN receiving_tickets rt ON rt.id = rtl.ticket_id
    JOIN locations l ON l.id = rt.location_id
    WHERE rtl.bin_location_override IS NOT NULL
      AND TRIM(rtl.bin_location_override) <> ''
      AND rtl.bin_id_override IS NULL
  `);

  for (const row of (receivingBins.rows || [])) {
    const existing = await knex('location_bins')
      .where({ location_id: row.location_id, bin_code: row.bin_location_override.trim() })
      .first('id');

    let binId;
    if (existing) {
      binId = existing.id;
    } else {
      const [inserted] = await knex('location_bins')
        .insert({
          tenant_id: row.tenant_id,
          location_id: row.location_id,
          bin_code: row.bin_location_override.trim(),
          bin_name: row.bin_location_override.trim(),
          active: true,
        })
        .returning('id');
      binId = inserted.id || inserted;
    }

    // Update receiving_ticket_lines that reference this location + override text
    await knex('receiving_ticket_lines')
      .whereIn('ticket_id', function () {
        this.select('id').from('receiving_tickets').where({ location_id: row.location_id });
      })
      .where({ bin_location_override: row.bin_location_override })
      .whereNull('bin_id_override')
      .update({ bin_id_override: binId });
  }

  console.log('[FN-688] Migration up complete — inventory.bin_id and receiving_ticket_lines.bin_id_override added and backfilled.');
};

exports.down = async function down(knex) {
  // Remove FK columns (keep bin_location text columns untouched for backward compat)
  const hasReceivingBinId = await knex.schema.hasColumn('receiving_ticket_lines', 'bin_id_override');
  if (hasReceivingBinId) {
    await knex.schema.table('receiving_ticket_lines', (table) => {
      table.dropColumn('bin_id_override');
    });
  }

  const hasInventoryBinId = await knex.schema.hasColumn('inventory', 'bin_id');
  if (hasInventoryBinId) {
    await knex.schema.table('inventory', (table) => {
      table.dropColumn('bin_id');
    });
  }

  // NOTE: We do NOT delete the location_bins rows created during backfill.
  // Those rows may now be referenced by other features. The location_bins table
  // itself is managed by Migration 2 (FN-687).

  console.log('[FN-688] Migration down complete — bin_id columns removed. bin_location text columns preserved.');
};
