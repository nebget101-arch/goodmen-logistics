/**
 * Shared helper for embedding an operating-entity (MC) logo into a pdf-lib document.
 *
 * Resolves the logo from R2 using the storage key stored on the operating entity
 * (`operating_entities.logo_storage_key`, resolved via the document's
 * `operating_entity_id`) and embeds it as a pdf-lib image.
 *
 * Every entry point is graceful: a missing key, a download failure, an unsupported
 * image type, or a corrupt buffer all resolve to `null` so the caller falls back to
 * the existing text header and the PDF still generates.
 */
// Namespace import (not destructured) so downloadBuffer is resolved at call time —
// keeps the helper mockable in unit tests.
const r2Storage = require('../storage/r2-storage');

// PNG signature: 89 50 4E 47 ; JPEG SOI: FF D8 FF
function detectImageType(buffer, mimeHint) {
  if (buffer && buffer.length >= 4) {
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return 'png';
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'jpeg';
    }
  }
  const hint = (mimeHint || '').toString().toLowerCase();
  if (hint.includes('png')) return 'png';
  if (hint.includes('jpeg') || hint.includes('jpg')) return 'jpeg';
  return null;
}

/**
 * Read the logo storage key + mime hint off an operating-entity-shaped object.
 * Accepts both snake_case DB rows and camelCase view objects.
 */
function readLogoSource(source) {
  if (!source || typeof source !== 'object') return { key: null, mimeHint: null };
  return {
    key: source.logo_storage_key || source.logoStorageKey || null,
    mimeHint: source.logo_mime_type || source.logoMimeType || null
  };
}

/**
 * Fetch + embed the operating entity logo into the given pdf-lib document.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {object} source operating-entity row/view carrying `logo_storage_key`
 *   (+ optional `logo_mime_type`).
 * @returns {Promise<import('pdf-lib').PDFImage|null>} embedded image, or null on any
 *   missing key / fetch failure / unsupported type.
 */
async function embedOperatingEntityLogo(pdfDoc, source) {
  if (!pdfDoc) return null;
  const { key, mimeHint } = readLogoSource(source);
  if (!key) return null;

  try {
    const buffer = await r2Storage.downloadBuffer(key);
    if (!buffer || !buffer.length) return null;

    const type = detectImageType(buffer, mimeHint);
    if (type === 'png') return await pdfDoc.embedPng(buffer);
    if (type === 'jpeg') return await pdfDoc.embedJpg(buffer);
    return null;
  } catch (err) {
    // Non-fatal: caller falls back to the text header.
    return null;
  }
}

/**
 * Scale an embedded image to fit within a bounding box, preserving aspect ratio and
 * never upscaling past the source resolution.
 *
 * @returns {{width:number,height:number}|null}
 */
function scaleToFit(image, maxWidth, maxHeight) {
  if (!image || !image.width || !image.height) return null;
  const ratio = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  return { width: image.width * ratio, height: image.height * ratio };
}

module.exports = {
  embedOperatingEntityLogo,
  scaleToFit,
  detectImageType
};
