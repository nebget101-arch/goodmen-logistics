/*
 Backfill script: For each tenant choose a default operating_entity_id and
 set it on existing `drivers` and `vehicles` rows where operating_entity_id IS NULL.

 Strategy: pick the first active operating_entity for the tenant ordered by created_at.
 This is conservative and reversible; review before running in production.
*/

const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || 'postgres://localhost:5432/goodmen';

async function main() {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    // Get tenants
    const tenantsRes = await client.query('SELECT id FROM tenants');
    for (const t of tenantsRes.rows) {
      const tenantId = t.id;
      // Prefer an operating_entity that users have marked as default for this tenant
      const preferredRes = await client.query(
        `SELECT uoe.operating_entity_id AS id
         FROM user_operating_entities uoe
         JOIN user_tenant_memberships utm ON uoe.user_id = utm.user_id
         WHERE utm.tenant_id = $1 AND uoe.is_default = true
         LIMIT 1`,
        [tenantId]
      );
      let oeRes;
      if (preferredRes.rows.length) {
        oeRes = preferredRes;
      } else {
        // fallback: pick first active operating_entity for tenant
        oeRes = await client.query(
          `SELECT id FROM operating_entities WHERE tenant_id = $1 AND is_active = true ORDER BY created_at LIMIT 1`,
          [tenantId]
        );
      }
      if (!oeRes.rows.length) {
        console.log(`tenant ${tenantId} has no active operating_entities, skipping`);
        continue;
      }
      const oeId = oeRes.rows[0].id;
      console.log(`Tenant ${tenantId} -> choosing operating_entity ${oeId}`);
      // backfill drivers
      const updDrivers = await client.query(
        `UPDATE drivers SET operating_entity_id = $1 WHERE tenant_id = $2 AND operating_entity_id IS NULL RETURNING id`,
        [oeId, tenantId]
      );
      console.log(`Updated drivers: ${updDrivers.rowCount}`);
      // backfill vehicles
      const updVehicles = await client.query(
        `UPDATE vehicles SET operating_entity_id = $1 WHERE tenant_id = $2 AND operating_entity_id IS NULL RETURNING id`,
        [oeId, tenantId]
      );
      console.log(`Updated vehicles: ${updVehicles.rowCount}`);
    }

    console.log('Backfill complete');
  } catch (err) {
    console.error('Backfill failed', err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (require.main === module) main();

module.exports = { main };
