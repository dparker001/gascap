/**
 * Compress an image File before upload.
 *
 * Loads the file into a canvas and re-encodes as JPEG — caps size, normalises
 * orientation, and converts HEIC/HEIF (common on iOS) to a format the server
 * accepts. Keeps the image large enough for OCR/AI analysis (1024px longest edge).
 *
 * Works in WKWebView (Capacitor iOS) where uploading a raw multi-megabyte photo
 * via FormData can crash the WebView due to memory pressure.
 */
export function compressImageForUpload(
  file: File,
  maxDimension = 1024,
  quality      = 0.88,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { naturalWidth: w, naturalHeight: h } = img;
      if (w > maxDimension || h > maxDimension) {
        if (w >= h) { h = Math.round(h * maxDimension / w); w = maxDimension; }
        else        { w = Math.round(w * maxDimension / h); h = maxDimension; }
      }

      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas unavailable')); return; }

      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')),
        'image/jpeg',
        quality,
      );
    };

    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

/**
 * Compress to a hard byte budget, returning a data URL.
 *
 * compressImageForUpload picks a fixed quality and accepts whatever size
 * falls out — fine when the result is POSTed and discarded, wrong when it's
 * stored in a database column. A detailed photo at quality 0.7 can still be
 * several times the size of a plain one, so the only way to actually respect
 * a budget is to measure and step down.
 *
 * Steps quality first (cheap, preserves framing), then dimension as a last
 * resort. Rejects rather than silently storing something over budget — the
 * server enforces the same ceiling, so an oversized result would just fail
 * later with a worse error.
 */
export async function compressImageToBudget(
  file: File,
  maxBytes: number,
  maxDimension: number,
): Promise<string> {
  const qualities  = [0.75, 0.6, 0.45, 0.32];
  const dimensions = [maxDimension, Math.round(maxDimension * 0.75), Math.round(maxDimension * 0.55)];

  for (const dim of dimensions) {
    for (const q of qualities) {
      const blob    = await compressImageForUpload(file, dim, q);
      const dataUrl = await blobToDataUrl(blob);
      // Measure the data URL, not the blob: base64 adds ~33%, and the data
      // URL is what actually goes in the column.
      if (dataUrl.length <= maxBytes) return dataUrl;
    }
  }
  throw new Error('Image could not be compressed within budget');
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Read failed'));
    reader.readAsDataURL(blob);
  });
}
