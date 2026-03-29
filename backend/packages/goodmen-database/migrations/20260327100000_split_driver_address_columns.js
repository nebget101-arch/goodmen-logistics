/**
 * FN-284: Split the single `address` column on the drivers table into
 * `street_address`, `city`, `state`, and `zip_code`.
 *
 * Existing `address` data is copied to `street_address` before the
 * original column is dropped.
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('drivers');
  if (!hasTable) return;

  const hasAddress = await knex.schema.hasColumn('drivers', 'address');
  const hasStreetAddress = await knex.schema.hasColumn('drivers', 'street_address');

  // Add new columns (only if they don't already exist)
  if (!hasStreetAddress) {
    await knex.schema.alterTable('drivers', (table) => {
      table.text('street_address').nullable();
    });
  }

  const hasCity = await knex.schema.hasColumn('drivers', 'city');
  if (!hasCity) {
    await knex.schema.alterTable('drivers', (table) => {
      table.string('city', 100).nullable();
    });
  }

  const hasState = await knex.schema.hasColumn('drivers', 'state');
  if (!hasState) {
    await knex.schema.alterTable('drivers', (table) => {
      table.string('state', 2).nullable();
    });
  }

  const hasZipCode = await knex.schema.hasColumn('drivers', 'zip_code');
  if (!hasZipCode) {
    await knex.schema.alterTable('drivers', (table) => {
      table.string('zip_code', 10).nullable();
    });
  }

  // Copy existing address data to street_address
  if (hasAddress && !hasStreetAddress) {
    await knex.raw(`
      UPDATE drivers SET street_address = address WHERE address IS NOT NULL
    `);
  }

  // Drop the old address column
  if (hasAddress) {
    await knex.schema.alterTable('drivers', (table) => {
      table.dropColumn('address');
    });
  }
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable('drivers');
  if (!hasTable) return;

  const hasStreetAddress = await knex.schema.hasColumn('drivers', 'street_address');
  const hasAddress = await knex.schema.hasColumn('drivers', 'address');

  // Re-create the original address column
  if (!hasAddress) {
    await knex.schema.alterTable('drivers', (table) => {
      table.text('address').nullable();
    });
  }

  // Copy street_address back to address
  if (hasStreetAddress) {
    await knex.raw(`
      UPDATE drivers SET address = street_address WHERE street_address IS NOT NULL
    `);
  }

  // Drop the new columns
  await knex.schema.alterTable('drivers', (table) => {
    if (hasStreetAddress) table.dropColumn('street_address');
  });

  const hasCity = await knex.schema.hasColumn('drivers', 'city');
  if (hasCity) {
    await knex.schema.alterTable('drivers', (table) => {
      table.dropColumn('city');
    });
  }

  const hasState = await knex.schema.hasColumn('drivers', 'state');
  if (hasState) {
    await knex.schema.alterTable('drivers', (table) => {
      table.dropColumn('state');
    });
  }

  const hasZipCode = await knex.schema.hasColumn('drivers', 'zip_code');
  if (hasZipCode) {
    await knex.schema.alterTable('drivers', (table) => {
      table.dropColumn('zip_code');
    });
  }
};
