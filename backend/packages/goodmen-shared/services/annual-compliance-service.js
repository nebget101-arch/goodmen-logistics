const { query } = require('../internal/db');
const {
  upsertRequirementStatus,
  computeAndUpdateDqfCompleteness
} = require('./dqf-service');

/**
 * Maps compliance_type to DQF requirement_key for syncing completions.
 */
const COMPLIANCE_TYPE_TO_DQF_KEY = {
  mvr_inquiry: 'annual_mvr_inquiry',
  driving_record_review: 'annual_driving_record_review',
  clearinghouse_limited_query: 'annual_clearinghouse_query'
  // medical_cert_renewal has no direct DQF requirement mapping
};

const COMPLIANCE_TYPES = [
  'mvr_inquiry',
  'driving_record_review',
  'clearinghouse_limited_query',
  'medical_cert_renewal'
];

/**
 * Generate annual compliance items for a single driver.
 * Uses ON CONFLICT ... DO NOTHING to prevent duplicates.
 */
async function generateAnnualItems(db, driverId, year, tenantId) {
  if (!driverId || !year || !tenantId) {
    throw new Error('driverId, year, and tenantId are required');
  }

  // Fetch driver hire_date and medical_cert_expiry
  const driverRes = await db(
    `SELECT d.hire_date, dc.medical_cert_expiry
     FROM drivers d
     LEFT JOIN driver_compliance dc ON dc.driver_id = d.id
     WHERE d.id = $1`,
    [driverId]
  );

  if (driverRes.rows.length === 0) {
    throw new Error(`Driver not found: ${driverId}`);
  }

  const driver = driverRes.rows[0];
  const createdItems = [];

  for (const complianceType of COMPLIANCE_TYPES) {
    const dueDate = calculateDueDate(complianceType, year, driver);
    if (!dueDate) continue;

    const result = await db(
      `INSERT INTO annual_compliance_items
         (driver_id, tenant_id, compliance_type, compliance_year, due_date, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       ON CONFLICT (driver_id, compliance_type, compliance_year) DO NOTHING
       RETURNING *`,
      [driverId, tenantId, complianceType, year, dueDate]
    );

    if (result.rows.length > 0) {
      createdItems.push(result.rows[0]);
    }
  }

  return createdItems;
}

/**
 * Calculate the due date for a given compliance type + year.
 * - medical_cert_renewal uses the driver's medical_cert_expiry
 * - all others use the driver's hire_date anniversary in the given year
 */
function calculateDueDate(complianceType, year, driver) {
  if (complianceType === 'medical_cert_renewal') {
    // Use medical cert expiry directly; null means we cannot generate this item
    if (!driver.medical_cert_expiry) return null;
    const expiry = new Date(driver.medical_cert_expiry);
    // Only generate if the expiry falls within the given year
    if (expiry.getFullYear() === year) {
      return driver.medical_cert_expiry;
    }
    return null;
  }

  // For hire-date-based items, use the anniversary in the target year
  if (!driver.hire_date) return null;
  const hireDate = new Date(driver.hire_date);
  const month = hireDate.getMonth(); // 0-indexed
  const day = hireDate.getDate();
  const anniversary = new Date(year, month, day);
  return anniversary.toISOString().split('T')[0];
}

/**
 * Generate annual compliance items for ALL active drivers in a tenant.
 */
async function generateAllAnnualItems(db, tenantId, year) {
  if (!tenantId || !year) {
    throw new Error('tenantId and year are required');
  }

  const driversRes = await db(
    `SELECT id FROM drivers WHERE tenant_id = $1 AND status = 'active'`,
    [tenantId]
  );

  let totalCreated = 0;
  let totalSkipped = 0;

  for (const driver of driversRes.rows) {
    const items = await generateAnnualItems(db, driver.id, year, tenantId);
    totalCreated += items.length;
    // Each driver has up to 4 types; created < 4 means some were skipped/duplicated
    totalSkipped += COMPLIANCE_TYPES.length - items.length;
  }

  return {
    total: driversRes.rows.length,
    created: totalCreated,
    skipped: totalSkipped
  };
}

/**
 * Mark an annual compliance item as completed and sync with DQF.
 */
async function completeItem(db, itemId, userId, { reviewerName, reviewNotes, determination, evidenceDocumentId } = {}) {
  if (!itemId) throw new Error('itemId is required');

  const updateRes = await db(
    `UPDATE annual_compliance_items
     SET status = 'completed',
         completed_at = NOW(),
         completed_by = $2,
         reviewer_name = $3,
         review_notes = $4,
         determination = $5,
         evidence_document_id = $6,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [itemId, userId || null, reviewerName || null, reviewNotes || null, determination || null, evidenceDocumentId || null]
  );

  if (updateRes.rows.length === 0) {
    return null;
  }

  const item = updateRes.rows[0];

  // Sync with DQF if there is a mapping for this compliance type
  const dqfKey = COMPLIANCE_TYPE_TO_DQF_KEY[item.compliance_type];
  if (dqfKey) {
    await upsertRequirementStatus(item.driver_id, dqfKey, 'complete', evidenceDocumentId || null);
    await computeAndUpdateDqfCompleteness(item.driver_id);
  }

  return item;
}

/**
 * Get all annual compliance items for a driver in a given year.
 */
async function getDriverCompliance(db, driverId, year) {
  if (!driverId) throw new Error('driverId is required');

  const params = [driverId];
  let yearFilter = '';
  if (year) {
    params.push(year);
    yearFilter = ` AND aci.compliance_year = $${params.length}`;
  }

  const result = await db(
    `SELECT aci.*,
            dd.file_name AS evidence_file_name,
            dd.mime_type AS evidence_mime_type
     FROM annual_compliance_items aci
     LEFT JOIN driver_documents dd ON dd.id = aci.evidence_document_id
     WHERE aci.driver_id = $1${yearFilter}
     ORDER BY aci.due_date ASC`,
    params
  );

  return result.rows;
}

/**
 * Get overdue compliance items for a tenant.
 */
async function getOverdueItems(db, tenantId) {
  if (!tenantId) throw new Error('tenantId is required');

  const result = await db(
    `SELECT aci.*,
            d.first_name, d.last_name, d.cdl_number,
            d.operating_entity_id
     FROM annual_compliance_items aci
     JOIN drivers d ON d.id = aci.driver_id
     WHERE aci.tenant_id = $1
       AND aci.status != 'completed'
       AND aci.due_date < NOW()
     ORDER BY aci.due_date ASC`,
    [tenantId]
  );

  return result.rows;
}

/**
 * Get upcoming compliance items due within N days for a tenant.
 */
async function getUpcomingItems(db, tenantId, daysAhead = 30) {
  if (!tenantId) throw new Error('tenantId is required');

  const result = await db(
    `SELECT aci.*,
            d.first_name, d.last_name, d.cdl_number,
            d.operating_entity_id
     FROM annual_compliance_items aci
     JOIN drivers d ON d.id = aci.driver_id
     WHERE aci.tenant_id = $1
       AND aci.status != 'completed'
       AND aci.due_date >= NOW()
       AND aci.due_date <= NOW() + ($2 || ' days')::interval
     ORDER BY aci.due_date ASC`,
    [tenantId, daysAhead]
  );

  return result.rows;
}

/**
 * Dashboard summary: counts of compliant, overdue, due-soon drivers
 * plus medical cert expiry breakdown.
 */
async function getDashboardSummary(db, tenantId) {
  if (!tenantId) throw new Error('tenantId is required');

  // Total active drivers
  const totalRes = await db(
    `SELECT COUNT(*)::int AS count FROM drivers WHERE tenant_id = $1 AND status = 'active'`,
    [tenantId]
  );
  const totalDrivers = totalRes.rows[0]?.count || 0;

  // Overdue count (distinct drivers with overdue items)
  const overdueRes = await db(
    `SELECT COUNT(DISTINCT aci.driver_id)::int AS count
     FROM annual_compliance_items aci
     WHERE aci.tenant_id = $1
       AND aci.status != 'completed'
       AND aci.due_date < NOW()`,
    [tenantId]
  );
  const overdueCount = overdueRes.rows[0]?.count || 0;

  // Due soon count (distinct drivers with items due in next 30 days)
  const dueSoonRes = await db(
    `SELECT COUNT(DISTINCT aci.driver_id)::int AS count
     FROM annual_compliance_items aci
     WHERE aci.tenant_id = $1
       AND aci.status != 'completed'
       AND aci.due_date >= NOW()
       AND aci.due_date <= NOW() + '30 days'::interval`,
    [tenantId]
  );
  const dueSoonCount = dueSoonRes.rows[0]?.count || 0;

  // Fully compliant = drivers with no pending/overdue items for current year
  const currentYear = new Date().getFullYear();
  const nonCompliantRes = await db(
    `SELECT COUNT(DISTINCT aci.driver_id)::int AS count
     FROM annual_compliance_items aci
     WHERE aci.tenant_id = $1
       AND aci.compliance_year = $2
       AND aci.status != 'completed'`,
    [tenantId, currentYear]
  );
  const nonCompliantCount = nonCompliantRes.rows[0]?.count || 0;
  const fullyCompliant = Math.max(0, totalDrivers - nonCompliantCount);

  // Medical cert expiry breakdown from driver_compliance
  const medCertRes = await db(
    `SELECT
       COUNT(*) FILTER (WHERE dc.medical_cert_expiry <= NOW() + '30 days'::interval AND dc.medical_cert_expiry > NOW())::int AS in30,
       COUNT(*) FILTER (WHERE dc.medical_cert_expiry <= NOW() + '60 days'::interval AND dc.medical_cert_expiry > NOW())::int AS in60,
       COUNT(*) FILTER (WHERE dc.medical_cert_expiry <= NOW() + '90 days'::interval AND dc.medical_cert_expiry > NOW())::int AS in90
     FROM driver_compliance dc
     JOIN drivers d ON d.id = dc.driver_id
     WHERE d.tenant_id = $1 AND d.status = 'active'`,
    [tenantId]
  );

  const medCert = medCertRes.rows[0] || { in30: 0, in60: 0, in90: 0 };

  return {
    totalDrivers,
    fullyCompliant,
    overdueCount,
    dueSoonCount,
    medicalCertExpiring: {
      in30: medCert.in30 || 0,
      in60: medCert.in60 || 0,
      in90: medCert.in90 || 0
    }
  };
}

/**
 * Medical cert expiry report: list drivers with their cert expiry and days remaining.
 */
async function getMedicalCertExpiryReport(db, tenantId) {
  if (!tenantId) throw new Error('tenantId is required');

  const result = await db(
    `SELECT
       d.id AS driver_id,
       d.first_name,
       d.last_name,
       d.cdl_number,
       d.operating_entity_id,
       dc.medical_cert_expiry,
       EXTRACT(DAY FROM dc.medical_cert_expiry::timestamp - NOW())::int AS days_remaining
     FROM driver_compliance dc
     JOIN drivers d ON d.id = dc.driver_id
     WHERE d.tenant_id = $1
       AND d.status = 'active'
       AND dc.medical_cert_expiry IS NOT NULL
     ORDER BY dc.medical_cert_expiry ASC`,
    [tenantId]
  );

  return result.rows;
}

module.exports = {
  generateAnnualItems,
  generateAllAnnualItems,
  completeItem,
  getDriverCompliance,
  getOverdueItems,
  getUpcomingItems,
  getDashboardSummary,
  getMedicalCertExpiryReport
};
