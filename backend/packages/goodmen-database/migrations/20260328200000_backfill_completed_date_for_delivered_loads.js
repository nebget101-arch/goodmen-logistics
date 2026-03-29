/**
 * FN-401: Backfill completed_date for loads that have status DELIVERED or
 * COMPLETED but NULL completed_date. Uses COALESCE to prefer delivery_date,
 * then updated_at, then created_at.
 */
exports.up = async function (knex) {
  await knex.raw(`
    UPDATE loads
    SET completed_date = COALESCE(delivery_date, updated_at::date, created_at::date),
        updated_at = CURRENT_TIMESTAMP
    WHERE UPPER(status) IN ('DELIVERED', 'COMPLETED')
      AND completed_date IS NULL
  `);
};

exports.down = async function () {
  // No rollback — cannot distinguish auto-set from manually-set values
};
