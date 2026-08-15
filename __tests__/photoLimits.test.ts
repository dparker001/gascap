import { describe, it, expect } from 'vitest';
import {
  validateRentalPhotos,
  dataUrlBytes,
  photoCapKb,
  RENTAL_PHOTO_FIELDS,
  PHOTO_MAX_DATA_URL_BYTES,
} from '../lib/photoLimits';

const under = 'data:image/jpeg;base64,' + 'A'.repeat(1_000);
const over  = 'data:image/jpeg;base64,' + 'A'.repeat(PHOTO_MAX_DATA_URL_BYTES + 1);

describe('rental photo size cap', () => {
  it('accepts a body with no photos at all', () => {
    expect(validateRentalPhotos({ rentalCompany: 'Avis' }).ok).toBe(true);
  });

  it('accepts photos within budget', () => {
    const body = Object.fromEntries(RENTAL_PHOTO_FIELDS.map((f) => [f, under]));
    expect(validateRentalPhotos(body).ok).toBe(true);
  });

  it('rejects an oversized photo and names the field', () => {
    const res = validateRentalPhotos({ returnGaugePhotoThumb: over });
    expect(res.ok).toBe(false);
    expect(res.field).toBe('returnGaugePhotoThumb');
    expect(res.bytes).toBeGreaterThan(PHOTO_MAX_DATA_URL_BYTES);
  });

  it('checks EVERY photo column, not just the first', () => {
    // Regression guard: a loop that returned early on the first present field
    // would pass this, since the oversized one is last.
    const body: Record<string, unknown> = { pickupVehiclePhotoThumb: under, returnReceiptPhotoThumb: over };
    const res = validateRentalPhotos(body);
    expect(res.ok).toBe(false);
    expect(res.field).toBe('returnReceiptPhotoThumb');
  });

  it('ignores empty strings and non-string values rather than erroring', () => {
    expect(validateRentalPhotos({ pickupGaugePhotoThumb: '' }).ok).toBe(true);
    expect(validateRentalPhotos({ pickupGaugePhotoThumb: null }).ok).toBe(true);
    expect(validateRentalPhotos({ pickupGaugePhotoThumb: 42 }).ok).toBe(true);
  });

  it('measures the data URL string, since that is what occupies the column', () => {
    expect(dataUrlBytes('abc')).toBe(3);
  });

  it('exposes a sane cap for error copy', () => {
    expect(photoCapKb()).toBe(160);
  });

  it('caps a fully documented rental under 1MB', () => {
    // Five columns is the schema-imposed count limit; this pins the worst case.
    expect(RENTAL_PHOTO_FIELDS.length * PHOTO_MAX_DATA_URL_BYTES).toBeLessThan(1_000_000);
  });
});
