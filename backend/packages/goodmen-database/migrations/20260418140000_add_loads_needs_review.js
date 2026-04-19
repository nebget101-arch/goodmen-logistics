// FN-746 — adds needs_review boolean flag to loads table
// Allows AI-created DRAFT loads to be flagged as "needs human review"
// so they surface in the dedicated Needs Review filter on the loads list.

exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('loads', 'needs_review');
  if (hasColumn) return;
  await knex.schema.table('loads', (table) => {
    table.boolean('needs_review').notNullable().defaultTo(false);
  });
};

exports.down = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('loads', 'needs_review');
  if (!hasColumn) return;
  await knex.schema.table('loads', (table) => {
    table.dropColumn('needs_review');
  });
};
