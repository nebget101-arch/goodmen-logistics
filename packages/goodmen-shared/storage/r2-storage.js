const crypto = require('crypto');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

function requireEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function getR2Config() {
  const accountId = requireEnv('R2_ACCOUNT_ID');
  const accessKeyId = requireEnv('R2_ACCESS_KEY_ID');
  const secretAccessKey = requireEnv('R2_SECRET_ACCESS_KEY');
  const bucket = requireEnv('R2_BUCKET');
  const region = process.env.R2_REGION || 'auto';

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    region
  };
}

function getClient() {
  const { accountId, accessKeyId, secretAccessKey, region } = getR2Config();
  return new S3Client({
    region,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey
    }
  });
}

function normalizePrefix(prefix) {
  if (!prefix) return '';
  return prefix.replace(/^\/+|\/+$/g, '');
}

function buildObjectKey({ prefix, fileName }) {
  const safePrefix = normalizePrefix(prefix);
  const safeName = (fileName || 'upload')
    .toString()
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, '_');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = crypto.randomBytes(6).toString('hex');
  const base = `${stamp}-${suffix}-${safeName}`;
  return safePrefix ? `${safePrefix}/${base}` : base;
}

async function uploadBuffer({ buffer, contentType, prefix, fileName, key }) {
  const client = getClient();
  const { bucket } = getR2Config();
  const objectKey = key || buildObjectKey({ prefix, fileName });

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: contentType
    })
  );

  return { key: objectKey };
}

async function uploadStream({ stream, contentType, prefix, fileName, key }) {
  const client = getClient();
  const { bucket } = getR2Config();
  const objectKey = key || buildObjectKey({ prefix, fileName });

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: stream,
      ContentType: contentType
    })
  );

  return { key: objectKey };
}

async function getSignedDownloadUrl(key, expiresInSeconds) {
  const client = getClient();
  const { bucket } = getR2Config();
  const ttl = Number(expiresInSeconds || process.env.R2_SIGNED_URL_EXPIRES_SECONDS || 900);

  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key
    }),
    { expiresIn: ttl }
  );
}

async function deleteObject(key) {
  const client = getClient();
  const { bucket } = getR2Config();

  if (!key) return;
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key
    })
  );
}

module.exports = {
  uploadBuffer,
  uploadStream,
  getSignedDownloadUrl,
  deleteObject
};
