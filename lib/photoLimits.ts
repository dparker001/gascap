/**
 * Storage budget for rental documentation photos.
 *
 * These live as base64 data URLs in Postgres columns (the receiptThumb
 * pattern), so every byte is a row byte — there's no object store to absorb
 * them. At the shared 1024px/0.88 upload settings a single photo lands around
 * 200–500KB after base64's ~33% inflation, and a rental can carry five of
 * them. That's multi-megabyte rows for what are, in practice, reference
 * snapshots a renter glances at.
 *
 * Count is already bounded by the schema: five named columns (three pickup,
 * two return), so there's no unbounded list to cap. The size is the part that
 * needed a limit.
 *
 * Chosen over a Pro gate deliberately. Photos are the renter's evidence if a
 * fuel fee is disputed, and the people most exposed to a bogus fee are the
 * least likely to be paying for Pro. Capping the cost keeps the protection
 * available to everyone.
 */

/** Longest edge for a stored documentation photo. */
export const PHOTO_MAX_DIMENSION = 800;

/**
 * Hard ceiling per stored photo, in bytes of the data URL string.
 *
 * ~160KB each, so a fully documented rental tops out near 800KB. Comfortably
 * legible for a gauge needle or an agreement number at 800px, which is all
 * these are for. Note this measures the base64 string, not the decoded image —
 * that's what actually occupies the column.
 */
export const PHOTO_MAX_DATA_URL_BYTES = 160_000;

/** Every photo column on RentalSession, so validation can't miss one. */
export const RENTAL_PHOTO_FIELDS = [
  'pickupVehiclePhotoThumb',
  'pickupGaugePhotoThumb',
  'pickupAgreementPhotoThumb',
  'returnGaugePhotoThumb',
  'returnReceiptPhotoThumb',
] as const;

export type RentalPhotoField = typeof RENTAL_PHOTO_FIELDS[number];

/**
 * Byte length of a data URL string. Uses the string length directly rather
 * than Buffer/Blob so this is safe to call on both server and client; base64
 * is single-byte ASCII, so length === bytes.
 */
export function dataUrlBytes(dataUrl: string): number {
  return dataUrl.length;
}

export interface PhotoValidationResult {
  ok: boolean;
  /** The first field that failed, for a specific error message. */
  field?: RentalPhotoField;
  bytes?: number;
}

/**
 * Reject oversized photos server-side. The client compresses to budget, but
 * the client is not the enforcement point — a direct POST bypasses it, and
 * that's the request that would bloat the table.
 */
export function validateRentalPhotos(
  body: Record<string, unknown>,
): PhotoValidationResult {
  for (const field of RENTAL_PHOTO_FIELDS) {
    const value = body[field];
    if (typeof value !== 'string' || value === '') continue;
    const bytes = dataUrlBytes(value);
    if (bytes > PHOTO_MAX_DATA_URL_BYTES) {
      return { ok: false, field, bytes };
    }
  }
  return { ok: true };
}

/** Human-readable cap, for error copy. */
export function photoCapKb(): number {
  return Math.round(PHOTO_MAX_DATA_URL_BYTES / 1000);
}
