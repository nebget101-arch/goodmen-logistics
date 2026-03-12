/**
 * Roadside Service AI - Phase 1 (schema + domain foundation)
 *
 * Additive, migration-safe tables:
 * - roadside_calls
 * - roadside_sessions
 * - roadside_intakes
 * - roadside_media
 * - roadside_locations
 * - roadside_ai_assessments
 * - roadside_dispatch_assignments
 * - roadside_payments
 * - roadside_event_logs
 * - roadside_public_link_tokens
 * - roadside_work_order_links (low-disruption 1:1 bridge)
 */

/* eslint-disable no-await-in-loop */

const withTz = { useTz: true };

async function hasTable(knex, tableName) {
  return knex.schema.hasTable(tableName);
}

async function createIfMissing(knex, tableName, cb) {
  const exists = await hasTable(knex, tableName);
  if (!exists) {
    await knex.schema.createTable(tableName, cb);
  }
}

function q(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function addFkIfPossible(knex, {
  sourceTable,
  sourceColumn,
  constraintName,
  targetTable,
  targetColumn,
  onDelete = 'SET NULL'
}) {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ${q(sourceTable)}
      )
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${q(sourceTable)} AND column_name = ${q(sourceColumn)}
      )
      AND EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ${q(targetTable)}
      )
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${q(targetTable)} AND column_name = ${q(targetColumn)}
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = ${q(sourceTable)}
          AND c.conname = ${q(constraintName)}
      ) THEN
        EXECUTE 'ALTER TABLE ${sourceTable} ADD CONSTRAINT ${constraintName} FOREIGN KEY (${sourceColumn}) REFERENCES ${targetTable}(${targetColumn}) ON DELETE ${onDelete}';
      END IF;
    END $$;
  `);
}

exports.up = async function up(knex) {
  await createIfMissing(knex, 'roadside_calls', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').nullable();
    table.uuid('operating_entity_id').nullable();

    table.text('call_number').notNullable().unique();
    table.enu('source_channel', ['PHONE', 'SMS', 'APP', 'WEB', 'DISPATCH']).notNullable().defaultTo('PHONE');

    table.text('caller_name').nullable();
    table.text('caller_phone').nullable();
    table.text('caller_email').nullable();

    table.uuid('driver_id').nullable();
    table.uuid('customer_id').nullable();
    table.uuid('unit_id').nullable();
    table.uuid('trailer_id').nullable();

    table.text('issue_type').nullable();
    table.text('incident_summary').nullable();
    table.enu('urgency', ['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).notNullable().defaultTo('NORMAL');
    table.enu('status', [
      'OPEN',
      'TRIAGED',
      'DISPATCHED',
      'EN_ROUTE',
      'ON_SCENE',
      'TOWING',
      'RESOLVED',
      'CANCELED'
    ]).notNullable().defaultTo('OPEN');

    table.jsonb('location_snapshot').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));

    table.timestamp('opened_at', withTz).notNullable().defaultTo(knex.fn.now());
    table.timestamp('closed_at', withTz).nullable();

    table.uuid('created_by').nullable();
    table.uuid('updated_by').nullable();
    table.timestamp('created_at', withTz).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', withTz).notNullable().defaultTo(knex.fn.now());
  });

  await createIfMissing(knex, 'roadside_sessions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('call_id').notNullable();
    table.enu('session_status', ['ACTIVE', 'ENDED', 'EXPIRED']).notNullable().defaultTo('ACTIVE');
    table.text('ai_model').nullable();
    table.text('prompt_version').nullable();
    table.jsonb('transcript').notNullable().defaultTo(knex.raw(`'[]'::jsonb`));
    table.text('summary').nullable();
    table.decimal('overall_confidence', 5, 2).nullable();
    table.timestamp('started_at', withTz).notNullable().defaultTo(knex.fn.now());
    table.timestamp('ended_at', withTz).nullable();
    table.timestamp('created_at', withTz).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', withTz).notNullable().defaultTo(knex.fn.now());
  });

  await createIfMissing(knex, 'roadside_intakes', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('call_id').notNullable().unique();
    table.enu('intake_source', ['AI_AGENT', 'HUMAN_AGENT', 'DRIVER_SELF']).notNullable().defaultTo('AI_AGENT');
    table.jsonb('intake_payload').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
    table.text('symptoms').nullable();
    table.boolean('requires_tow').notNullable().defaultTo(false);
    table.boolean('safety_risk').notNullable().defaultTo(false);
    table.text('recommended_action').nullable();
    table.timestamp('captured_at', withTz).notNullable().defaultTo(knex.fn.now());
    table.timestamp('created_at', withTz).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', withTz).notNullable().defaultTo(knex.fn.now());
  });

  await createIfMissing(knex, 'roadside_media', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('call_id').notNullable();
    table.uuid('session_id').nullable();
    table.enu('media_type', ['PHOTO', 'VIDEO', 'AUDIO', 'DOCUMENT']).notNullable().defaultTo('PHOTO');
    table.text('storage_provider').notNullable().defaultTo('r2');
    table.text('storage_key').notNullable();
    table.text('mime_type').nullable();
    table.bigint('size_bytes').nullable();
    table.uuid('uploaded_by_driver_id').nullable();
    table.uuid('uploaded_by_user_id').nullable();
    table.jsonb('metadata').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
    table.timestamp('created_at', withTz).notNullable().defaultTo(knex.fn.now());
  });

  await createIfMissing(knex, 'roadside_locations', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('call_id').notNullable();
    table.enu('source', ['GPS', 'MANUAL', 'TELEMATICS']).notNullable().defaultTo('GPS');
    table.decimal('latitude', 10, 7).notNullable();
    table.decimal('longitude', 10, 7).notNullable();
    table.decimal('heading', 6, 2).nullable();
    table.decimal('speed_mph', 7, 2).nullable();
    table.decimal('accuracy_meters', 8, 2).nullable();
    table.timestamp('captured_at', withTz).notNullable().defaultTo(knex.fn.now());
    table.jsonb('raw_payload').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
    table.timestamp('created_at', withTz).notNullable().defaultTo(knex.fn.now());
  });

  await createIfMissing(knex, 'roadside_ai_assessments', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('call_id').notNullable();
    table.integer('assessment_version').notNullable().defaultTo(1);
    table.text('model_name').nullable();
    table.text('prompt_version').nullable();
    table.decimal('confidence_score', 5, 2).nullable();
    table.enu('risk_level', ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).notNullable().defaultTo('LOW');
    table.boolean('requires_human_review').notNullable().defaultTo(false);
    table.text('reasoning').nullable();
    table.jsonb('recommendation').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
    table.timestamp('created_at', withTz).notNullable().defaultTo(knex.fn.now());
  });

  await createIfMissing(knex, 'roadside_dispatch_assignments', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('call_id').notNullable();
    table.uuid('assigned_driver_id').nullable();
    table.text('assigned_vendor_name').nullable();
    table.text('assigned_vendor_phone').nullable();
    table.enu('dispatch_status', ['PENDING', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'COMPLETED', 'CANCELED']).notNullable().defaultTo('PENDING');
    table.integer('eta_minutes').nullable();
    table.timestamp('dispatched_at', withTz).nullable();
    table.timestamp('arrived_at', withTz).nullable();
    table.timestamp('completed_at', withTz).nullable();
    table.text('notes').nullable();
    table.uuid('created_by').nullable();
    table.timestamp('created_at', withTz).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', withTz).notNullable().defaultTo(knex.fn.now());
  });

  await createIfMissing(knex, 'roadside_payments', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('call_id').notNullable();
    table.enu('payer_type', ['COMPANY', 'DRIVER', 'CUSTOMER', 'INSURANCE', 'OTHER']).notNullable().defaultTo('COMPANY');
    table.enu('payment_status', ['UNPAID', 'PENDING', 'AUTHORIZED', 'PAID', 'FAILED', 'REFUNDED']).notNullable().defaultTo('UNPAID');
    table.decimal('amount', 12, 2).notNullable().defaultTo(0);
    table.string('currency', 3).notNullable().defaultTo('USD');
    table.text('payment_method').nullable();
    table.text('external_reference').nullable();
    table.timestamp('authorized_at', withTz).nullable();
    table.timestamp('paid_at', withTz).nullable();
    table.jsonb('metadata').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
    table.timestamp('created_at', withTz).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', withTz).notNullable().defaultTo(knex.fn.now());
  });

  await createIfMissing(knex, 'roadside_event_logs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('call_id').notNullable();
    table.uuid('session_id').nullable();
    table.enu('actor_type', ['SYSTEM', 'AI', 'USER', 'DRIVER', 'DISPATCHER']).notNullable().defaultTo('SYSTEM');
    table.uuid('actor_id').nullable();
    table.text('event_type').notNullable();
    table.jsonb('event_payload').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
    table.timestamp('occurred_at', withTz).notNullable().defaultTo(knex.fn.now());
    table.timestamp('created_at', withTz).notNullable().defaultTo(knex.fn.now());
  });

  await createIfMissing(knex, 'roadside_public_link_tokens', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('call_id').notNullable();
    table.text('token_hash').notNullable().unique();
    table.enu('status', ['ACTIVE', 'USED', 'EXPIRED', 'REVOKED']).notNullable().defaultTo('ACTIVE');
    table.timestamp('expires_at', withTz).notNullable();
    table.timestamp('used_at', withTz).nullable();
    table.uuid('created_by').nullable();
    table.timestamp('created_at', withTz).notNullable().defaultTo(knex.fn.now());
  });

  await createIfMissing(knex, 'roadside_work_order_links', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('roadside_call_id').notNullable().unique();
    table.uuid('work_order_id').nullable().unique();
    table.enu('link_status', ['PENDING', 'CREATED', 'LINKED', 'CLOSED', 'FAILED']).notNullable().defaultTo('PENDING');
    table.text('failure_reason').nullable();
    table.timestamp('linked_at', withTz).nullable();
    table.timestamp('created_at', withTz).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', withTz).notNullable().defaultTo(knex.fn.now());
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_calls',
    sourceColumn: 'tenant_id',
    constraintName: 'fk_roadside_calls_tenant_id',
    targetTable: 'tenants',
    targetColumn: 'id',
    onDelete: 'SET NULL'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_calls',
    sourceColumn: 'operating_entity_id',
    constraintName: 'fk_roadside_calls_operating_entity_id',
    targetTable: 'operating_entities',
    targetColumn: 'id',
    onDelete: 'SET NULL'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_calls',
    sourceColumn: 'driver_id',
    constraintName: 'fk_roadside_calls_driver_id',
    targetTable: 'drivers',
    targetColumn: 'id',
    onDelete: 'SET NULL'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_calls',
    sourceColumn: 'customer_id',
    constraintName: 'fk_roadside_calls_customer_id',
    targetTable: 'customers',
    targetColumn: 'id',
    onDelete: 'SET NULL'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_calls',
    sourceColumn: 'unit_id',
    constraintName: 'fk_roadside_calls_unit_id',
    targetTable: 'customer_vehicles',
    targetColumn: 'vehicle_uuid',
    onDelete: 'SET NULL'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_calls',
    sourceColumn: 'trailer_id',
    constraintName: 'fk_roadside_calls_trailer_id',
    targetTable: 'vehicles',
    targetColumn: 'id',
    onDelete: 'SET NULL'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_calls',
    sourceColumn: 'created_by',
    constraintName: 'fk_roadside_calls_created_by',
    targetTable: 'users',
    targetColumn: 'id',
    onDelete: 'SET NULL'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_calls',
    sourceColumn: 'updated_by',
    constraintName: 'fk_roadside_calls_updated_by',
    targetTable: 'users',
    targetColumn: 'id',
    onDelete: 'SET NULL'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_sessions',
    sourceColumn: 'call_id',
    constraintName: 'fk_roadside_sessions_call_id',
    targetTable: 'roadside_calls',
    targetColumn: 'id',
    onDelete: 'CASCADE'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_intakes',
    sourceColumn: 'call_id',
    constraintName: 'fk_roadside_intakes_call_id',
    targetTable: 'roadside_calls',
    targetColumn: 'id',
    onDelete: 'CASCADE'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_media',
    sourceColumn: 'call_id',
    constraintName: 'fk_roadside_media_call_id',
    targetTable: 'roadside_calls',
    targetColumn: 'id',
    onDelete: 'CASCADE'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_media',
    sourceColumn: 'session_id',
    constraintName: 'fk_roadside_media_session_id',
    targetTable: 'roadside_sessions',
    targetColumn: 'id',
    onDelete: 'SET NULL'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_media',
    sourceColumn: 'uploaded_by_driver_id',
    constraintName: 'fk_roadside_media_uploaded_by_driver_id',
    targetTable: 'drivers',
    targetColumn: 'id',
    onDelete: 'SET NULL'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_media',
    sourceColumn: 'uploaded_by_user_id',
    constraintName: 'fk_roadside_media_uploaded_by_user_id',
    targetTable: 'users',
    targetColumn: 'id',
    onDelete: 'SET NULL'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_locations',
    sourceColumn: 'call_id',
    constraintName: 'fk_roadside_locations_call_id',
    targetTable: 'roadside_calls',
    targetColumn: 'id',
    onDelete: 'CASCADE'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_ai_assessments',
    sourceColumn: 'call_id',
    constraintName: 'fk_roadside_ai_assessments_call_id',
    targetTable: 'roadside_calls',
    targetColumn: 'id',
    onDelete: 'CASCADE'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_dispatch_assignments',
    sourceColumn: 'call_id',
    constraintName: 'fk_roadside_dispatch_assignments_call_id',
    targetTable: 'roadside_calls',
    targetColumn: 'id',
    onDelete: 'CASCADE'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_dispatch_assignments',
    sourceColumn: 'assigned_driver_id',
    constraintName: 'fk_roadside_dispatch_assignments_assigned_driver_id',
    targetTable: 'drivers',
    targetColumn: 'id',
    onDelete: 'SET NULL'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_dispatch_assignments',
    sourceColumn: 'created_by',
    constraintName: 'fk_roadside_dispatch_assignments_created_by',
    targetTable: 'users',
    targetColumn: 'id',
    onDelete: 'SET NULL'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_payments',
    sourceColumn: 'call_id',
    constraintName: 'fk_roadside_payments_call_id',
    targetTable: 'roadside_calls',
    targetColumn: 'id',
    onDelete: 'CASCADE'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_event_logs',
    sourceColumn: 'call_id',
    constraintName: 'fk_roadside_event_logs_call_id',
    targetTable: 'roadside_calls',
    targetColumn: 'id',
    onDelete: 'CASCADE'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_event_logs',
    sourceColumn: 'session_id',
    constraintName: 'fk_roadside_event_logs_session_id',
    targetTable: 'roadside_sessions',
    targetColumn: 'id',
    onDelete: 'SET NULL'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_public_link_tokens',
    sourceColumn: 'call_id',
    constraintName: 'fk_roadside_public_link_tokens_call_id',
    targetTable: 'roadside_calls',
    targetColumn: 'id',
    onDelete: 'CASCADE'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_public_link_tokens',
    sourceColumn: 'created_by',
    constraintName: 'fk_roadside_public_link_tokens_created_by',
    targetTable: 'users',
    targetColumn: 'id',
    onDelete: 'SET NULL'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_work_order_links',
    sourceColumn: 'roadside_call_id',
    constraintName: 'fk_roadside_work_order_links_call_id',
    targetTable: 'roadside_calls',
    targetColumn: 'id',
    onDelete: 'CASCADE'
  });

  await addFkIfPossible(knex, {
    sourceTable: 'roadside_work_order_links',
    sourceColumn: 'work_order_id',
    constraintName: 'fk_roadside_work_order_links_work_order_id',
    targetTable: 'work_orders',
    targetColumn: 'id',
    onDelete: 'SET NULL'
  });

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_roadside_calls_tenant_status ON roadside_calls (tenant_id, status)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_roadside_calls_oe_status ON roadside_calls (operating_entity_id, status)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_roadside_calls_customer_id ON roadside_calls (customer_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_roadside_calls_driver_id ON roadside_calls (driver_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_roadside_calls_opened_at ON roadside_calls (opened_at DESC)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_roadside_calls_urgency ON roadside_calls (urgency)');

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_roadside_sessions_call_id ON roadside_sessions (call_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_roadside_media_call_id ON roadside_media (call_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_roadside_media_session_id ON roadside_media (session_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_roadside_locations_call_captured ON roadside_locations (call_id, captured_at DESC)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_roadside_ai_assessments_call_created ON roadside_ai_assessments (call_id, created_at DESC)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_roadside_dispatch_call_status ON roadside_dispatch_assignments (call_id, dispatch_status)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_roadside_payments_call_status ON roadside_payments (call_id, payment_status)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_roadside_event_logs_call_occurred ON roadside_event_logs (call_id, occurred_at DESC)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_roadside_public_tokens_call_status ON roadside_public_link_tokens (call_id, status)');

  await knex.raw(`
    DO $$
    DECLARE enum_type_name text;
    BEGIN
      SELECT t.typname
      INTO enum_type_name
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typname LIKE 'work_orders%type%'
      GROUP BY t.typname
      LIMIT 1;

      IF enum_type_name IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = enum_type_name
            AND e.enumlabel = 'ROADSIDE'
        ) THEN
          EXECUTE 'ALTER TYPE ' || quote_ident(enum_type_name) || ' ADD VALUE ''ROADSIDE''';
        END IF;
      END IF;
    END $$;
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('roadside_work_order_links');
  await knex.schema.dropTableIfExists('roadside_public_link_tokens');
  await knex.schema.dropTableIfExists('roadside_event_logs');
  await knex.schema.dropTableIfExists('roadside_payments');
  await knex.schema.dropTableIfExists('roadside_dispatch_assignments');
  await knex.schema.dropTableIfExists('roadside_ai_assessments');
  await knex.schema.dropTableIfExists('roadside_locations');
  await knex.schema.dropTableIfExists('roadside_media');
  await knex.schema.dropTableIfExists('roadside_intakes');
  await knex.schema.dropTableIfExists('roadside_sessions');
  await knex.schema.dropTableIfExists('roadside_calls');
};
