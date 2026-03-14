'use strict';

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('trial_requests');
  if (!hasTable) return;

  const addColumnIfMissing = async (columnName, callback) => {
    const hasColumn = await knex.schema.hasColumn('trial_requests', columnName);
    if (!hasColumn) {
      await knex.schema.alterTable('trial_requests', callback);
    }
  };

  await addColumnIfMissing('approved_at', (table) => {
    table.timestamp('approved_at').nullable();
  });

  await addColumnIfMissing('approved_by_user_id', (table) => {
    table.uuid('approved_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
  });

  await addColumnIfMissing('signup_token', (table) => {
    table.text('signup_token').nullable();
  });

  await addColumnIfMissing('signup_token_expires_at', (table) => {
    table.timestamp('signup_token_expires_at').nullable();
  });

  await addColumnIfMissing('signup_completed_at', (table) => {
    table.timestamp('signup_completed_at').nullable();
  });

  await addColumnIfMissing('created_tenant_id', (table) => {
    table.uuid('created_tenant_id').nullable().references('id').inTable('tenants').onDelete('SET NULL');
  });

  await addColumnIfMissing('created_operating_entity_id', (table) => {
    table.uuid('created_operating_entity_id').nullable().references('id').inTable('operating_entities').onDelete('SET NULL');
  });

  await addColumnIfMissing('created_user_id', (table) => {
    table.uuid('created_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
  });

  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS uq_trial_requests_signup_token_not_null ON trial_requests(signup_token) WHERE signup_token IS NOT NULL');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_trial_requests_signup_token_expires_at ON trial_requests(signup_token_expires_at)');
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('trial_requests');
  if (!hasTable) return;

  await knex.raw('DROP INDEX IF EXISTS uq_trial_requests_signup_token_not_null');
  await knex.raw('DROP INDEX IF EXISTS idx_trial_requests_signup_token_expires_at');

  const dropColumnIfExists = async (columnName) => {
    const hasColumn = await knex.schema.hasColumn('trial_requests', columnName);
    if (hasColumn) {
      await knex.schema.alterTable('trial_requests', (table) => {
        table.dropColumn(columnName);
      });
    }
  };

  await dropColumnIfExists('created_user_id');
  await dropColumnIfExists('created_operating_entity_id');
  await dropColumnIfExists('created_tenant_id');
  await dropColumnIfExists('signup_completed_at');
  await dropColumnIfExists('signup_token_expires_at');
  await dropColumnIfExists('signup_token');
  await dropColumnIfExists('approved_by_user_id');
  await dropColumnIfExists('approved_at');
};
