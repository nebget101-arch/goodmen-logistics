/**
 * FN-653 — Add cached AI insights payload to settlements.
 *
 * This is intentionally additive and nullable so legacy settlements
 * and pre-PDF flows continue to work until insights are generated.
 */
exports.up = async function up(knex) {
  const hasSettlements = await knex.schema.hasTable('settlements');
  if (!hasSettlements) return;

  const hasAiInsights = await knex.schema.hasColumn('settlements', 'ai_insights');
  if (!hasAiInsights) {
    await knex.schema.alterTable('settlements', (table) => {
      table.jsonb('ai_insights').nullable();
    });
  }
};

exports.down = async function down(knex) {
  const hasSettlements = await knex.schema.hasTable('settlements');
  if (!hasSettlements) return;

  const hasAiInsights = await knex.schema.hasColumn('settlements', 'ai_insights');
  if (!hasAiInsights) return;

  await knex.schema.alterTable('settlements', (table) => {
    table.dropColumn('ai_insights');
  });
};
