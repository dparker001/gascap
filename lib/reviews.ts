/**
 * User reviews/testimonials — persisted in Postgres (Review model) via Prisma.
 *
 * Moderation: real user reviews default to approved: false.
 * Approve or reject them at /admin/reviews before they appear publicly.
 * No seed/placeholder reviews — only genuine approved reviews are ever shown
 * (FTC + App Store both prohibit fabricated testimonials).
 */
import { prisma } from './prisma';

export interface Review {
  id:          string;
  userId:      string;
  userName:    string;
  rating:      1 | 2 | 3 | 4 | 5;
  text:        string;
  vehicleName?: string;
  plan:        'free' | 'pro' | 'fleet';
  lifetime?:   boolean;   // true = reviewer is a Pro Lifetime member → badge shows "LIFETIME"
  approved:    boolean;   // false = pending moderation, true = live on homepage
  createdAt:   string;
  updatedAt:   string;
}

// Map a Prisma row to the public Review shape (narrow rating, drop falsy lifetime).
function toReview(r: {
  id: string; userId: string; userName: string; rating: number; text: string;
  vehicleName: string | null; plan: string; lifetime: boolean; approved: boolean;
  createdAt: string; updatedAt: string;
}): Review {
  return {
    id:          r.id,
    userId:      r.userId,
    userName:    r.userName,
    rating:      Math.max(1, Math.min(5, r.rating)) as 1 | 2 | 3 | 4 | 5,
    text:        r.text,
    vehicleName: r.vehicleName ?? undefined,
    plan:        (r.plan as 'free' | 'pro' | 'fleet'),
    lifetime:    r.lifetime || undefined,
    approved:    r.approved,
    createdAt:   r.createdAt,
    updatedAt:   r.updatedAt,
  };
}

/** Public homepage marquee — only real, approved reviews (newest first). */
export async function getPublicReviews(): Promise<Review[]> {
  const rows = await prisma.review.findMany({
    where:   { approved: true, text: { not: '' } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toReview);
}

/** Admin: all real user reviews (pending + approved), newest first. */
export async function getAllReviews(): Promise<Review[]> {
  const rows = await prisma.review.findMany({ orderBy: { createdAt: 'desc' } });
  return rows.map(toReview);
}

/** Admin: approve or reject a review by id. Returns false if not found. */
export async function setReviewApproval(id: string, approved: boolean): Promise<boolean> {
  try {
    await prisma.review.update({
      where: { id },
      data:  { approved, updatedAt: new Date().toISOString() },
    });
    return true;
  } catch {
    return false;
  }
}

export async function getReviewByUser(userId: string): Promise<Review | undefined> {
  const row = await prisma.review.findUnique({ where: { userId } });
  return row ? toReview(row) : undefined;
}

export async function upsertReview(
  userId:      string,
  userName:    string,
  rating:      number,
  text:        string,
  plan:        'free' | 'pro' | 'fleet',
  vehicleName?: string,
  lifetime?:   boolean,
): Promise<Review> {
  const now      = new Date().toISOString();
  const clamped  = Math.max(1, Math.min(5, Math.round(rating)));
  const cleanText = text.trim().slice(0, 500);
  const vehicle   = vehicleName?.trim() || null;

  const row = await prisma.review.upsert({
    where: { userId },
    create: {
      id:          crypto.randomUUID(),
      userId,
      userName,
      rating:      clamped,
      text:        cleanText,
      vehicleName: vehicle,
      plan,
      lifetime:    lifetime ?? false,
      approved:    false,        // new reviews start pending moderation
      createdAt:   now,
      updatedAt:   now,
    },
    update: {
      // Editing an existing review re-enters moderation is NOT forced here —
      // approval is preserved (only an admin flips it). Content + meta refresh.
      userName,
      rating:      clamped,
      text:        cleanText,
      vehicleName: vehicle,
      plan,
      lifetime:    lifetime ?? false,
      updatedAt:   now,
    },
  });
  return toReview(row);
}

export async function deleteReview(userId: string): Promise<void> {
  await prisma.review.deleteMany({ where: { userId } });
}
