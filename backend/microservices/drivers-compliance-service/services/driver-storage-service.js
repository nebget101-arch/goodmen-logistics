const { query } = require('@goodmen/shared/config/database');

async function storeDocumentBytes(buffer) {
  const result = await query(
    'INSERT INTO driver_document_blobs (bytes) VALUES ($1) RETURNING id',
    [buffer]
  );
  return result.rows[0].id;
}

async function createDriverDocument({
  driverId,
  packetId = null,
  docType,
  fileName,
  mimeType,
  bytes
}) {
  if (!driverId || !docType || !fileName || !mimeType || !bytes) {
    throw new Error('Missing required arguments to createDriverDocument');
  }

  const blobId = await storeDocumentBytes(bytes);

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
      blobId.toString(),
      blobId
    ]
  );

  return result.rows[0];
}

module.exports = {
  storeDocumentBytes,
  createDriverDocument
};
