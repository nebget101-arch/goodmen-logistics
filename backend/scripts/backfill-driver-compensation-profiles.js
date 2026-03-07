#!/usr/bin/env node
/**
 * Backfill driver_compensation_profiles from existing drivers table.
 * One active profile per driver with effective_start_date = driver hire_date or created_at,
 * and effective_end_date = null. Maps drivers.driver_type, pay_basis, pay_rate, pay_percentage
 * into the new profile. Idempotent: skips drivers who already have an active profile.
 *
 * Usage (from repo root):
 *   NODE_ENV=production node backend/scripts/backfill-driver-compensation-profiles.js
 *
 * Requires: DATABASE_URL or PG_* env; goodmen-database migrations run (payroll tables exist).
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

const PAY_BASIS_TO_PAY_MODEL = {
  per_mile: 'per_mile',
  percentage: 'percentage',
  flatpay: 'flat_weekly',
  hourly: 'flat_weekly' // map legacy hourly to flat_weekly for backfill
};

async function backfill() {
  const hasProfiles = await knex.schema.hasTable('driver_compensation_profiles');
  const hasDrivers = await knex.schema.hasTable('drivers');
  if (!hasProfiles || !hasDrivers) {
    console.log('Missing driver_compensation_profiles or drivers table. Run migrations first.');
    return;
  }

  const drivers = await knex('drivers')
    .select(
      'id',
      'driver_type',
      'pay_basis',
      'pay_rate',
      'pay_percentage',
      'hire_date',
      'created_at'
    );

  let created = 0;
  let skipped = 0;

  for (const d of drivers) {
    const existing = await knex('driver_compensation_profiles')
      .where({ driver_id: d.id, status: 'active' })
      .whereNull('effective_end_date')
      .first();
    if (existing) {
      skipped++;
      continue;
    }

    const payBasis = (d.pay_basis || '').toString().trim().toLowerCase() || null;
    const payModel = payBasis ? PAY_BASIS_TO_PAY_MODEL[payBasis] || 'per_mile' : 'per_mile';
    const profileType =
      (d.driver_type || '').toString().trim().toLowerCase() === 'owner_operator'
        ? 'owner_operator'
        : 'company_driver';

    const effectiveStart =
      d.hire_date || (d.created_at ? new Date(d.created_at).toISOString().slice(0, 10) : null) || new Date().toISOString().slice(0, 10);

    await knex('driver_compensation_profiles').insert({
      driver_id: d.id,
      profile_type: profileType,
      pay_model: payModel,
      percentage_rate: payModel === 'percentage' && d.pay_percentage != null ? d.pay_percentage : null,
      cents_per_mile: payModel === 'per_mile' && d.pay_rate != null ? d.pay_rate : null,
      flat_weekly_amount: payModel === 'flat_weekly' && d.pay_rate != null ? d.pay_rate : null,
      flat_per_load_amount: null,
      expense_sharing_enabled: false,
      effective_start_date: effectiveStart,
      effective_end_date: null,
      status: 'active',
      notes: 'Backfilled from drivers table'
    });
    created++;
  }

  console.log(`Backfill complete: ${created} profiles created, ${skipped} drivers skipped (already had active profile).`);
}

backfill()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err.message);
    process.exit(1);
  })
  .finally(() => knex.destroy());
