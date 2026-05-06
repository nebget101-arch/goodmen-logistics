'use strict';

/**
 * FMCSA bulk-file importer (FN-1413).
 *
 * Public API:
 *   - runCensusImport({ knex, source?, triggeredBy?, ... })
 *   - runAuthorityImport({ knex, source?, triggeredBy?, ... })
 *   - DEFAULT_CENSUS_URL, DEFAULT_AUTHORITY_URL — public dataset endpoints
 *
 * Bull job names exposed by fmcsa-import-queue.js:
 *   - 'import-fmcsa-census'
 *   - 'import-fmcsa-authority'
 *
 * Cron wiring is intentionally OUT of scope for this story (FN-1415 owns it).
 */

const { runCensusImport, DEFAULT_CENSUS_URL } = require('./census');
const { runAuthorityImport, DEFAULT_AUTHORITY_URL } = require('./authority');

module.exports = {
  runCensusImport,
  runAuthorityImport,
  DEFAULT_CENSUS_URL,
  DEFAULT_AUTHORITY_URL,
};
