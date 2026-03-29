/**
 * FN-476: Add match_details JSONB column to fmcsa_inspection_history.
 * Stores AI fuzzy-match results (candidates, confidence, reasoning)
 * when the AI driver matching fallback is used.
 */
exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('fmcsa_inspection_history', 'match_details');
  if (!hasColumn) {
    await knex.schema.alterTable('fmcsa_inspection_history', (t) => {
      t.jsonb('match_details').nullable();
    });
  }
};

exports.down = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('fmcsa_inspection_history', 'match_details');
  if (hasColumn) {
    await knex.schema.alterTable('fmcsa_inspection_history', (t) => {
      t.dropColumn('match_details');
    });
  }
};
