const { query } = require('../internal/db');

async function storeDocumentBytes(buffer) {
  const result = await query(
    'INSERT INTO driver_document_blobs (bytes) VALUES ($1) RETURNING id',
    [buffer]
  );
  return result.rows[0].id;
}

/**
 * FN-244: Standard folder paths for driver documents.
 * All documents stored via createDriverDocument use a consistent
 * storage_key path: drivers/{driverId}/{folder}/{fileName}
 *
 * Recognized folders:
 *   employment-application  – employment application PDFs
 *   consents                – consent / authorization PDFs
 *   drug-tests              – drug & alcohol test results
 *   dqf-documents           – DQF requirement uploads
 *   documents               – general driver documents (default)
 */
const STANDARD_FOLDERS = new Set([
  'employment-application',
  'consents',
  'drug-tests',
  'dqf-documents',
  'documents'
]);

function buildStorageKey(driverId, folder, fileName) {
  const safeFolder = STANDARD_FOLDERS.has(folder) ? folder : 'documents';
  return `drivers/${driverId}/${safeFolder}/${fileName}`;
}

async function createDriverDocument({
  driverId,
  packetId = null,
  docType,
  fileName,
  mimeType,
  bytes,
  folder = 'documents'
}) {
  if (!driverId || !docType || !fileName || !mimeType || !bytes) {
    throw new Error('Missing required arguments to createDriverDocument');
  }

  const blobId = await storeDocumentBytes(bytes);
  const storageKey = buildStorageKey(driverId, folder, fileName);

  const result = await query(
    `INSERT INTO driver_documents (
      driver_id,
      packet_id,
      doc_type,
      file_name,
      mime_type,
      size_bytes,
      storage_mode,
      storage_key,
      blob_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, 'db', $7, $8)
    RETURNING *`,
    [
      driverId,
      packetId,
      docType,
      fileName,
      mimeType,
      Buffer.byteLength(bytes),
      storageKey,
      blobId
    ]
  );

  return result.rows[0];
}

module.exports = {
  storeDocumentBytes,
  createDriverDocument,
  buildStorageKey,
  STANDARD_FOLDERS
};

