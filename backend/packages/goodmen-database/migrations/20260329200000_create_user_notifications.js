/**
 * Migration: create user_notifications table — FN-507
 *
 * Stores in-app notification bell records per user.
 * Consumed by GET /api/notifications and the Angular notification bell component (FN-508).
 */

exports.up = async function (knex) {
  await knex.schema.createTable('user_notifications', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').nullable().index();
    t.uuid('user_id').notNullable().index();
    t.string('type', 64).notNullable();       // e.g. 'idle_truck_week1', 'idle_truck_week2'
    t.string('title', 255).notNullable();
    t.text('body').nullable();
    t.jsonb('meta').nullable();               // { vehicle_id, driver_id, alert_id, accrued_deductions }
    t.boolean('is_read').notNullable().defaultTo(false);
    t.timestamp('read_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('user_notifications');
};
