/**
 * FN-1488 — Add invoice columns to `receiving_tickets`.
 *
 * Supports the FN-1480 invoice-upload + AI line-extraction flow:
 *   - `invoice_file_url`        — uploaded file location (S3/storage URL)
 *   - `invoice_extracted_at`    — timestamp when AI extraction completed
 *   - `invoice_extracted_data`  — Claude Vision payload:
 *       { vendor, reference, invoiceDate, lines: [{ sku?, description, qty, unitCost, match }] }
 *
 * Additive and nullable: existing rows remain NULL and legacy receiving
 * flows are unaffected. `hasColumn` guards make this idempotent.
 */
exports.up = async function up(knex) {
  const hasReceivingTickets = await knex.schema.hasTable('receiving_tickets');
  if (!hasReceivingTickets) return;

  const [hasFileUrl, hasExtractedAt, hasExtractedData] = await Promise.all([
    knex.schema.hasColumn('receiving_tickets', 'invoice_file_url'),
    knex.schema.hasColumn('receiving_tickets', 'invoice_extracted_at'),
    knex.schema.hasColumn('receiving_tickets', 'invoice_extracted_data'),
  ]);

  if (hasFileUrl && hasExtractedAt && hasExtractedData) return;

  await knex.schema.alterTable('receiving_tickets', (table) => {
    if (!hasFileUrl) table.string('invoice_file_url').nullable();
    if (!hasExtractedAt) table.timestamp('invoice_extracted_at').nullable();
    if (!hasExtractedData) table.jsonb('invoice_extracted_data').nullable();
  });
};

exports.down = async function down(knex) {
  const hasReceivingTickets = await knex.schema.hasTable('receiving_tickets');
  if (!hasReceivingTickets) return;

  const [hasFileUrl, hasExtractedAt, hasExtractedData] = await Promise.all([
    knex.schema.hasColumn('receiving_tickets', 'invoice_file_url'),
    knex.schema.hasColumn('receiving_tickets', 'invoice_extracted_at'),
    knex.schema.hasColumn('receiving_tickets', 'invoice_extracted_data'),
  ]);

  if (!hasFileUrl && !hasExtractedAt && !hasExtractedData) return;

  await knex.schema.alterTable('receiving_tickets', (table) => {
    if (hasExtractedData) table.dropColumn('invoice_extracted_data');
    if (hasExtractedAt) table.dropColumn('invoice_extracted_at');
    if (hasFileUrl) table.dropColumn('invoice_file_url');
  });
};
