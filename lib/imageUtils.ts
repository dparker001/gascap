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
