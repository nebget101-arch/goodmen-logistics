/**
 * Decode barcode from image buffer (for camera/photo upload in inventory and scan-bridge).
 * Uses jimp + javascript-barcode-reader; supports Code-128, EAN-13, Code-39, etc.
 */

const Jimp = require('jimp');

const BARCODE_TYPES = [
  'code-128',
  'ean-13',
  'code-39',
  'ean-8',
  'upc-a',
  'upc-e',
  'code-93',
  'codabar'
];

let barcodeReader;
function getReader() {
  if (!barcodeReader) {
    barcodeReader = require('javascript-barcode-reader');
  }
  return barcodeReader;
}

/**
 * @param {Buffer} buffer - Image file buffer (JPEG, PNG, etc.)
 * @returns {Promise<{ barcode: string, format: string }|null>}
 */
async function decodeBarcodeFromBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    return null;
  }

  let image;
  try {
    image = await Jimp.read(buffer);
  } catch (err) {
    return null;
  }

  const bitmap = image.bitmap;
  if (!bitmap || !bitmap.data || !bitmap.width || !bitmap.height) {
    return null;
  }

  const imageData = {
    data: new Uint8ClampedArray(bitmap.data),
    width: bitmap.width,
    height: bitmap.height
  };

  const reader = getReader();

  for (const barcodeType of BARCODE_TYPES) {
    try {
      const code = await reader({
        image: imageData,
        barcode: barcodeType,
        options: {
          useAdaptiveThreshold: true,
          detectRotation: true
        }
      });
      if (code && typeof code === 'string' && code.trim()) {
        return { barcode: code.trim(), format: barcodeType };
      }
    } catch (_) {
      // Try next type
    }
  }

  return null;
}

module.exports = {
  decodeBarcodeFromBuffer
};
