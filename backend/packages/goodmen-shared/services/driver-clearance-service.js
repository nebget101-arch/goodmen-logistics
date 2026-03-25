const { query } = require('../internal/db');

/**
 * Checks whether a driver meets all pre-employment clearance requirements
 * needed before they can be activated (applicant -> active).
 *
 * Checks:
 *  1. Pre-employment drug test with negative result exists
 *  2. Clearinghouse full query consent signed (dqf_driver_status 'clearinghouse_consent_received' = 'complete')
 *  3. Valid medical certificate on file (driver_compliance.medical_cert_expiry > now())
 *  4. Road test certificate or CDL on file (dqf_driver_status 'road_test_certificate' = 'complete' OR 'cdl_on_file' = 'complete')
 *
 * @param {object} db - unused, kept for interface consistency (uses shared query)
 * @param {string|number} driverId
 * @returns {Promise<{cleared: boolean, missing: string[]}>}
 */
async function isDriverClearedToDrive(db, driverId) {
  if (!driverId) {
    throw new Error('driverId is required');
  }

  const missing = [];

  // 1. Pre-employment drug test with negative result
  const drugTestRes = await query(
    `SELECT id FROM drug_alcohol_tests
     WHERE driver_id = $1
       AND test_type = 'pre_employment'
       AND UPPER(result) = 'NEGATIVE'
     LIMIT 1`,
    [driverId]
  );
  if (drugTestRes.rows.length === 0) {
    missing.push('pre_employment_drug_test');
  }

  // 2. Clearinghouse consent signed
  const clearinghouseRes = await query(
    `SELECT status FROM dqf_driver_status
     WHERE driver_id = $1
       AND requirement_key = 'clearinghouse_consent_received'
       AND status = 'complete'
     LIMIT 1`,
    [driverId]
  );
  if (clearinghouseRes.rows.length === 0) {
    missing.push('clearinghouse_consent');
  }

  // 3. Valid medical certificate on file
  const medCertRes = await query(
    `SELECT id FROM driver_compliance
     WHERE driver_id = $1
       AND medical_cert_expiry > NOW()
     LIMIT 1`,
    [driverId]
  );
  if (medCertRes.rows.length === 0) {
    missing.push('valid_medical_certificate');
  }

  // 4. Road test certificate OR CDL on file
  const roadCdlRes = await query(
    `SELECT requirement_key FROM dqf_driver_status
     WHERE driver_id = $1
       AND requirement_key IN ('road_test_certificate', 'cdl_on_file')
       AND status = 'complete'
     LIMIT 1`,
    [driverId]
  );
  if (roadCdlRes.rows.length === 0) {
    missing.push('road_test_or_cdl');
  }

  return {
    cleared: missing.length === 0,
    missing
  };
}

module.exports = { isDriverClearedToDrive };
