'use strict';

/**
 * FN-1832: shared helpers that populate the company-profile header on DQF consent
 * PDFs from an operating-entity row. Pure functions (no I/O) so both the
 * authenticated signing flow (consent-service) and the public driver-link flow
 * (public-consents route) compose the header identically and can be unit-tested.
 */

/**
 * Compose the postal address as `address_line1[, address_line2], city, state zip`.
 * State and zip are space-joined (not comma-separated); any missing piece is
 * omitted so a partial profile yields no stray separators. Returns '' when no
 * entity is given.
 *
 * @param {object|null} operatingEntity operating-entity row with discrete address columns
 * @returns {string}
 */
function composeEntityAddress(operatingEntity) {
  if (!operatingEntity) return '';
  const stateZip = [operatingEntity.state, operatingEntity.zip_code].filter(Boolean).join(' ');
  return [operatingEntity.address_line1, operatingEntity.address_line2, operatingEntity.city, stateZip]
    .filter(Boolean)
    .join(', ');
}

/**
 * Build the `company` object consumed by generateConsentPdf from an
 * operating-entity row. Returns null when no entity exists so the PDF header
 * falls back to its default. Carries logo fields for MC-logo branding (FN-1739).
 *
 * @param {object|null} operatingEntity operating-entity row
 * @returns {{name: string, address: string, phone: string, email: string, logo_storage_key: ?string, logo_mime_type: ?string}|null}
 */
function buildConsentCompany(operatingEntity) {
  if (!operatingEntity) return null;
  return {
    name: operatingEntity.name || operatingEntity.legal_name || '',
    address: composeEntityAddress(operatingEntity),
    phone: operatingEntity.phone || '',
    email: operatingEntity.email || '',
    logo_storage_key: operatingEntity.logo_storage_key || null,
    logo_mime_type: operatingEntity.logo_mime_type || null,
  };
}

module.exports = { composeEntityAddress, buildConsentCompany };
