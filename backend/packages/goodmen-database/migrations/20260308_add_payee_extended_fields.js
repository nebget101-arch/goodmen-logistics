/**
 * Extend payees table with address, regulatory, vendor, and settlement behavior fields.
 * Additive only - no breaking changes to existing columns.
 */
exports.up = async function (knex) {
  if (await knex.schema.hasTable('payees')) {
    const hasAddressField = await knex.schema.hasColumn('payees', 'address');
    
    if (!hasAddressField) {
      await knex.schema.alterTable('payees', (table) => {
        // Address fields
        table.text('address').nullable();
        table.text('address_line_2').nullable();
        table.text('city').nullable();
        table.text('state').nullable();
        table.text('zip').nullable();

        // Regulatory / Identification
        table.text('fid_ein').nullable().comment('Federal ID / EIN for vendors');
        table.text('mc').nullable().comment('Motor Carrier number');

        // Metadata
        table.text('notes').nullable();
        table.text('vendor_type').nullable().comment('vendor_type: reseller | direct_vendor | broker | supplier | equipment_rental | fuel_card_issuer | other');

        // Payee behavior flags
        table.boolean('is_additional_payee').notNullable().defaultTo(false).comment('Whether this payee can be used as additional_payee in settlements');
        table.boolean('is_equipment_owner').notNullable().defaultTo(false).comment('Deprecated: use type=owner instead. Kept for backwards compatibility.');

        // Settlement-specific fields
        table.decimal('additional_payee_rate', 5, 2).nullable().comment('Percentage or flat rate for additional payee (if applicable)');
        table.text('settlement_template_type').nullable().comment('settlement_template_type: standard | owner_truck | owner_operator | custom');
      });

      // Create indexes for new query patterns
      await knex.raw('CREATE INDEX IF NOT EXISTS idx_payees_city_state ON payees(city, state)');
      await knex.raw('CREATE INDEX IF NOT EXISTS idx_payees_vendor_type ON payees(vendor_type)');
      await knex.raw('CREATE INDEX IF NOT EXISTS idx_payees_is_additional ON payees(is_additional_payee)');
      await knex.raw('CREATE INDEX IF NOT EXISTS idx_payees_is_equipment_owner ON payees(is_equipment_owner)');
    }
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasTable('payees')) {
    const hasAddressField = await knex.schema.hasColumn('payees', 'address');
    
    if (hasAddressField) {
      await knex.raw('DROP INDEX IF EXISTS idx_payees_city_state');
      await knex.raw('DROP INDEX IF EXISTS idx_payees_vendor_type');
      await knex.raw('DROP INDEX IF EXISTS idx_payees_is_additional');
      await knex.raw('DROP INDEX IF EXISTS idx_payees_is_equipment_owner');

      await knex.schema.alterTable('payees', (table) => {
        table.dropColumn('address');
        table.dropColumn('address_line_2');
        table.dropColumn('city');
        table.dropColumn('state');
        table.dropColumn('zip');
        table.dropColumn('fid_ein');
        table.dropColumn('mc');
        table.dropColumn('notes');
        table.dropColumn('vendor_type');
        table.dropColumn('is_additional_payee');
        table.dropColumn('is_equipment_owner');
        table.dropColumn('additional_payee_rate');
        table.dropColumn('settlement_template_type');
      });
    }
  }
};
