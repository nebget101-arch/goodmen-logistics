// FN-1840 — Client-side logo downscaling.
//
// The backend (branding.js) caps logos at 1024×1024 as a safety net so they stay
// small when embedded in PDFs/headers. Customers routinely export logos at
// 2000–4000 px, which the backend rejects outright. Rather than bounce a valid
// source image, we fit it within 1024×1024 in the browser before upload —
// preserving aspect ratio and PNG transparency — and only then POST the blob.
// Images already within bounds are uploaded byte-identical (no re-encode).

export const MAX_LOGO_DIMENSION = 1024; // px — mirrors backend MAX_LOGO_DIMENSION

export interface PreparedLogo {
  /** The file to upload: the original when within bounds, or a downscaled blob. */
  blob: Blob;
  /** True when the source exceeded 1024px on an axis and was downscaled. */
  resized: boolean;
  /** Final pixel dimensions of `blob`. */
  width: number;
  height: number;
}

/**
 * Compute the target dimensions that fit (width × height) within a `max`×`max`
 * box while preserving aspect ratio. Returns the input unchanged when it already
 * fits (so callers can skip re-encoding) along with a `resized` flag.
 */
export function fitWithin(
  width: number,
  height: number,
  max: number = MAX_LOGO_DIMENSION
): { width: number; height: number; resized: boolean } {
  if (width <= max && height <= max) {
    return { width, height, resized: false };
  }
  const scale = Math.min(max / width, max / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    resized: true
  };
}

/**
 * Read a logo's dimensions and, if it exceeds 1024px on either axis, downscale
 * it to fit within 1024×1024 (aspect ratio preserved) via an offscreen canvas.
 * The export keeps the original MIME type so PNG transparency survives and
 * JPEG/WebP stay in their format. Images already ≤1024px are returned untouched.
 *
 * Rejects when the image can't be decoded (corrupt file) or the canvas export
 * fails — callers surface these as genuine upload errors.
 */
export function prepareLogoForUpload(file: File): Promise<PreparedLogo> {
  return loadImage(file).then(({ image, url }) => {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    try {
      if (!width || !height) {
        throw new Error('Image has zero dimensions');
      }

      const fit = fitWithin(width, height);

      // Within bounds — upload the original bytes unchanged (no quality loss).
      if (!fit.resized) {
        return Promise.resolve<PreparedLogo>({ blob: file, resized: false, width, height });
      }

      const targetW = fit.width;
      const targetH = fit.height;

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Canvas 2D context unavailable');
      }
      // drawImage copies the pixels synchronously, so revoking the object URL in
      // the finally block below is safe even though toBlob resolves later.
      ctx.drawImage(image, 0, 0, targetW, targetH);

      return canvasToBlob(canvas, file.type).then((blob): PreparedLogo => ({
        blob,
        resized: true,
        width: targetW,
        height: targetH
      }));
    } finally {
      URL.revokeObjectURL(url);
    }
  });
}

function loadImage(file: File): Promise<{ image: HTMLImageElement; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image could not be decoded'));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))),
      type
    );
  });
}
