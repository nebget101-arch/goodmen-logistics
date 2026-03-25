/**
 * FN-223: Pre-Hire Checklist automation
 *
 * 1. Seed new DQF requirement: pre_employment_drug_test_result_received
 * 2. Add completion_date column to dqf_driver_status for date capture
 * 3. Add result_document_id column to drug_alcohol_tests for attached result files
 */
exports.up = async function (knex) {
  // 1) Seed new requirement key
  const hasReq = await knex.schema.hasTable('dqf_requirements');
  if (hasReq) {
    await knex('dqf_requirements')
      .insert({
        key: 'pre_employment_drug_test_result_received',
        label: 'Pre-Employment Drug Test Result Received (§382.301)',
        weight: 5
      })
      .onConflict('key')
      .ignore();
  }

  // 2) Add completion_date to dqf_driver_status (for clearinghouse date capture)
  const hasDqfStatus = await knex.schema.hasTable('dqf_driver_status');
  if (hasDqfStatus) {
    const hasCompletionDate = await knex.schema.hasColumn('dqf_driver_status', 'completion_date');
    if (!hasCompletionDate) {
      await knex.schema.alterTable('dqf_driver_status', (t) => {
        t.date('completion_date').nullable().comment('Date the requirement was fulfilled (e.g. consent sent date)');
      });
    }
  }

  // 3) Add result_document_id to drug_alcohol_tests (FK to driver_documents for result attachment)
  const hasDrugTests = await knex.schema.hasTable('drug_alcohol_tests');
  if (hasDrugTests) {
    const hasResultDoc = await knex.schema.hasColumn('drug_alcohol_tests', 'result_document_id');
    if (!hasResultDoc) {
      await knex.schema.alterTable('drug_alcohol_tests', (t) => {
        t.uuid('result_document_id').nullable().comment('FK to driver_documents for the uploaded test result file');
      });
    }
  }
};

exports.down = async function (knex) {
  const hasReq = await knex.schema.hasTable('dqf_requirements');
  if (hasReq) {
    await knex('dqf_requirements').where('key', 'pre_employment_drug_test_result_received').del();
  }

  const hasDqfStatus = await knex.schema.hasTable('dqf_driver_status');
  if (hasDqfStatus) {
    const hasCol = await knex.schema.hasColumn('dqf_driver_status', 'completion_date');
    if (hasCol) {
      await knex.schema.alterTable('dqf_driver_status', (t) => {
        t.dropColumn('completion_date');
      });
    }
  }

  const hasDrugTests = await knex.schema.hasTable('drug_alcohol_tests');
  if (hasDrugTests) {
    const hasCol = await knex.schema.hasColumn('drug_alcohol_tests', 'result_document_id');
    if (hasCol) {
      await knex.schema.alterTable('drug_alcohol_tests', (t) => {
        t.dropColumn('result_document_id');
      });
    }
  }
};
