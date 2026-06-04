'use strict';

/**
 * FN-1669 — Add ARRIVED_AT_PICKUP / ARRIVED_AT_DELIVERY to loads.status
 * (Story C — FN-1655: geofence event computation + load-status automation).
 *
 * The geofence-event worker (FN-1669) drives load-status automation off
 * geofence crossings. The agreed state machine (confirmed with PM) needs two
 * "arrived" states that the existing loads_status_check constraint did not
 * allow:
 *
 *   ENTER geofence:
 *     DISPATCHED / EN_ROUTE     → ARRIVED_AT_PICKUP
 *     IN_TRANSIT                → ARRIVED_AT_DELIVERY
 *   EXIT geofence:
 *     ARRIVED_AT_PICKUP         → IN_TRANSIT
 *     ARRIVED_AT_DELIVERY (>5m) → DELIVERED
 *
 * This migration only *widens* the CHECK constraint — it adds the two new
 * values and leaves every existing value intact. No data is rewritten (no row
 * can already hold a value outside the old constraint). It mirrors the
 * drop-and-re-add pattern used by the earlier load-status migrations
 * (20260307120000 / 20260308100000 / 20260309120000).
 *
 * NOTE (handoff): the frontend status pills / filters that enumerate load
 * statuses should be extended to render ARRIVED_AT_PICKUP / ARRIVED_AT_DELIVERY
 * — tracked separately, out of this backend subtask's scope.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

const STATUSES_WITH_ARRIVED = [
  'DRAFT',
  'NEW',
  'CANCELLED',
  'CANCELED',
  'TONU',
  'DISPATCHED',
  'EN_ROUTE',
  'PICKED_UP',
  'PICKED UP',
  'ARRIVED_AT_PICKUP',
  'IN_TRANSIT',
  'ARRIVED_AT_DELIVERY',
  'DELIVERED',
  'COMPLETED',
];

// The constraint as it stood before this migration (used by down()).
const STATUSES_WITHOUT_ARRIVED = STATUSES_WITH_ARRIVED.filter(
  (s) => s !== 'ARRIVED_AT_PICKUP' && s !== 'ARRIVED_AT_DELIVERY'
);

function checkClause(values) {
  const list = values.map((v) => `'${v}'`).join(', ');
  return `CHECK (status IN (${list}))`;
}

exports.up = async function up(knex) {
  const hasLoads = await knex.schema.hasTable('loads');
  if (!hasLoads) return;

  await knex.raw(`ALTER TABLE loads DROP CONSTRAINT IF EXISTS loads_status_check`);
  await knex.raw(`
    ALTER TABLE loads
    ADD CONSTRAINT loads_status_check
    ${checkClause(STATUSES_WITH_ARRIVED)}
  `);
};

exports.down = async function down(knex) {
  const hasLoads = await knex.schema.hasTable('loads');
  if (!hasLoads) return;

  // Roll back any rows parked in the new states so the narrower constraint can
  // be re-applied without violation. ARRIVED_AT_PICKUP collapses to PICKED_UP,
  // ARRIVED_AT_DELIVERY to IN_TRANSIT (their nearest pre-existing neighbours).
  await knex.raw(`UPDATE loads SET status = 'PICKED_UP'  WHERE status = 'ARRIVED_AT_PICKUP'`);
  await knex.raw(`UPDATE loads SET status = 'IN_TRANSIT' WHERE status = 'ARRIVED_AT_DELIVERY'`);

  await knex.raw(`ALTER TABLE loads DROP CONSTRAINT IF EXISTS loads_status_check`);
  await knex.raw(`
    ALTER TABLE loads
    ADD CONSTRAINT loads_status_check
    ${checkClause(STATUSES_WITHOUT_ARRIVED)}
  `);
};
