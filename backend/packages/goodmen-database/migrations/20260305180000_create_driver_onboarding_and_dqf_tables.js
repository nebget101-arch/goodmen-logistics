/**
 * Driver onboarding + DQF core tables.
 *
 * Tables:
 * - driver_onboarding_packets
 * - driver_onboarding_sections
 * - driver_esignatures
 * - driver_document_blobs
 * - driver_documents
 * - dqf_requirements
 * - dqf_driver_status
 *
 * Also ensures drivers.dqf_completeness column exists.
 */

/* eslint-disable no-await-in-loop */

exports.up = async function up(knex) {
  const hasDrivers = await knex.schema.hasTable('drivers');
  const hasUsers = await knex.schema.hasTable('users');

  // 1) driver_onboarding_packets
  const hasPackets = await knex.schema.hasTable('driver_onboarding_packets');
  if (!hasPackets) {
    await knex.schema.createTable('driver_onboarding_packets', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      const driverId = table
        .uuid('driver_id')
        .notNullable();
      if (hasDrivers) {
        driverId
          .references('id')
          .inTable('drivers');
      }
      table
        .text('status')
        .notNullable()
        .defaultTo('draft');
      table.text('token_hash').notNullable();
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.text('sent_via');
      table.text('sent_to_phone');
      table.text('sent_to_email');
      const createdBy = table
        .uuid('created_by');
      if (hasUsers) {
        createdBy
          .references('id')
          .inTable('users');
      }
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    });
  }

  // 2) driver_onboarding_sections
  const hasSections = await knex.schema.hasTable('driver_onboarding_sections');
  if (!hasSections) {
    await knex.schema.createTable('driver_onboarding_sections', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table
        .uuid('packet_id')
        .notNullable()
        .references('id')
        .inTable('driver_onboarding_packets')
        .onDelete('CASCADE');
      table.text('section_key').notNullable();
      table
        .text('status')
        .notNullable()
        .defaultTo('not_started');
      table.timestamp('completed_at', { useTz: true });
      table.jsonb('data').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

      table.unique(['packet_id', 'section_key']);
    });
  }

  // 3) driver_esignatures
  const hasEsign = await knex.schema.hasTable('driver_esignatures');
  if (!hasEsign) {
    await knex.schema.createTable('driver_esignatures', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table
        .uuid('packet_id')
        .notNullable()
        .references('id')
        .inTable('driver_onboarding_packets')
        .onDelete('CASCADE');
      table
        .text('section_key')
        .notNullable()
        .defaultTo('employment_application');
      table.text('signer_name').notNullable();
      table.text('signature_type').notNullable();
      table.text('signature_value').notNullable();
      table.timestamp('signed_at', { useTz: true }).notNullable();
      table.text('ip_address');
      table.text('user_agent');
      table.text('consent_text_version').notNullable();
      table.text('signature_hash').notNullable();
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    });
  }

  // 4) driver_document_blobs
  const hasBlobs = await knex.schema.hasTable('driver_document_blobs');
  if (!hasBlobs) {
    await knex.schema.createTable('driver_document_blobs', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.binary('bytes').notNullable();
    });
  }

  // 5) driver_documents
  const hasDocs = await knex.schema.hasTable('driver_documents');
  if (!hasDocs) {
    await knex.schema.createTable('driver_documents', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      const driverId = table
        .uuid('driver_id')
        .notNullable();
      if (hasDrivers) {
        driverId
          .references('id')
          .inTable('drivers');
      }
      table
        .uuid('packet_id')
        .references('id')
        .inTable('driver_onboarding_packets')
        .onDelete('SET NULL');
      table.text('doc_type').notNullable();
      table.text('file_name').notNullable();
      table.text('mime_type').notNullable();
      table.integer('size_bytes').notNullable();
      table
        .text('storage_mode')
        .notNullable()
        .defaultTo('db');
      table
        .text('storage_key')
        .notNullable();
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table
        .uuid('blob_id')
        .references('id')
        .inTable('driver_document_blobs');
    });
  } else {
    const hasPacketId = await knex.schema.hasColumn('driver_documents', 'packet_id');
    if (!hasPacketId) {
      await knex.schema.alterTable('driver_documents', (table) => {
        table
          .uuid('packet_id')
          .references('id')
          .inTable('driver_onboarding_packets')
          .onDelete('SET NULL');
      });
    }
  }

  // 6) dqf_requirements
  const hasReq = await knex.schema.hasTable('dqf_requirements');
  if (!hasReq) {
    await knex.schema.createTable('dqf_requirements', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('key').notNullable().unique();
      table.text('label').notNullable();
      table.integer('weight').notNullable().defaultTo(1);
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    });
  }

  // 7) dqf_driver_status
  const hasStatus = await knex.schema.hasTable('dqf_driver_status');
  if (!hasStatus) {
    await knex.schema.createTable('dqf_driver_status', (table) => {
      const driverId = table
        .uuid('driver_id')
        .notNullable();
      if (hasDrivers) {
        driverId
          .references('id')
          .inTable('drivers')
          .onDelete('CASCADE');
      }
      table
        .text('requirement_key')
        .notNullable()
        .references('key')
        .inTable('dqf_requirements');
      table
        .text('status')
        .notNullable()
        .defaultTo('missing');
      table
        .uuid('evidence_document_id')
        .references('id')
        .inTable('driver_documents');
      table
        .timestamp('last_updated_at', { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());

      table.primary(['driver_id', 'requirement_key']);
    });
  }

  // 8) Seed dqf_requirements
  const requirements = [
    {
      key: 'employment_application_completed',
      label: 'Employment application completed',
      weight: 3
    },
    {
      key: 'employment_application_signed',
      label: 'Employment application signed',
      weight: 3
    },
    {
      key: 'mvr_authorization_signed',
      label: 'MVR authorization signed',
      weight: 3
    },
    {
      key: 'cdl_on_file',
      label: 'CDL on file',
      weight: 2
    },
    {
      key: 'medical_cert_on_file',
      label: 'Medical certificate on file',
      weight: 2
    }
  ];

  for (const r of requirements) {
    // eslint-disable-next-line no-await-in-loop
    await knex('dqf_requirements')
      .insert(r)
      .onConflict('key')
      .ignore();
  }

  // 9) Ensure drivers.dqf_completeness exists
  if (hasDrivers) {
    const hasDqfCol = await knex.schema.hasColumn('drivers', 'dqf_completeness');
    if (!hasDqfCol) {
      await knex.schema.alterTable('drivers', (table) => {
        table.integer('dqf_completeness').defaultTo(0);
      });
    }
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('dqf_driver_status');
  await knex.schema.dropTableIfExists('dqf_requirements');
  await knex.schema.dropTableIfExists('driver_documents');
  await knex.schema.dropTableIfExists('driver_document_blobs');
  await knex.schema.dropTableIfExists('driver_esignatures');
  await knex.schema.dropTableIfExists('driver_onboarding_sections');
  await knex.schema.dropTableIfExists('driver_onboarding_packets');
};

