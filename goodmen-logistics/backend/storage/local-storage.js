const fs = require('fs');
const path = require('path');

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
const INVOICE_DIR = path.join(UPLOAD_ROOT, 'invoices');
const WORK_ORDER_DIR = path.join(UPLOAD_ROOT, 'work-orders');

function resolveStorageKey(fileName) {
  if (fileName.includes('/') || fileName.includes('\\')) {
    return fileName;
  }
  return path.join('invoices', fileName);
}

function ensureDirs() {
  if (!fs.existsSync(UPLOAD_ROOT)) {
    fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
  }
  if (!fs.existsSync(INVOICE_DIR)) {
    fs.mkdirSync(INVOICE_DIR, { recursive: true });
  }
  if (!fs.existsSync(WORK_ORDER_DIR)) {
    fs.mkdirSync(WORK_ORDER_DIR, { recursive: true });
  }
}

function saveBuffer(buffer, fileName) {
  ensureDirs();
  const storageKey = resolveStorageKey(fileName);
  const fullPath = path.join(UPLOAD_ROOT, storageKey);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, buffer);
  return { storageKey, fullPath };
}

function saveStream(readStream, fileName) {
  ensureDirs();
  const storageKey = resolveStorageKey(fileName);
  const fullPath = path.join(UPLOAD_ROOT, storageKey);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(fullPath);
    readStream.pipe(writeStream);
    writeStream.on('finish', () => resolve({ storageKey, fullPath }));
    writeStream.on('error', reject);
  });
}

module.exports = {
  ensureDirs,
  saveBuffer,
  saveStream,
  UPLOAD_ROOT
};
