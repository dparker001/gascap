/**
 * User reviews — persisted in data/reviews.json
 * For production: replace with a DB table.
 *
 * Moderation: real user reviews default to approved: false.
 * Approve or reject them at /admin/reviews before they appear publicly.
 * Seed reviews are always shown and need no approval.
 */
import fs   from 'fs';
import path from 'path';

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

const DATA_FILE = path.join(process.cwd(), 'data', 'reviews.json');

// No seed/placeholder reviews — only real, user-submitted, admin-approved reviews
// are ever shown publicly (FTC + App Store both prohibit fabricated testimonials).
// The marquee hides itself entirely until genuine approved reviews exist.

function read(): Review[] {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as Review[];
  } catch {
    return [];
  }
}

function write(rows: Review[]) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2));
}

/** Public homepage marquee — only real, approved reviews. */
export function getPublicReviews(): Review[] {
  return read()
    .filter((r) => r.text.trim().length > 0 && r.approved === true)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** Admin: all real user reviews (pending + approved). */
export function getAllReviews(): Review[] {
  return read().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** Admin: approve or reject a review by id. */
export function setReviewApproval(id: string, approved: boolean): boolean {
  const all = read();
  const idx = all.findIndex((r) => r.id === id);
  if (idx < 0) return false;
  all[idx].approved  = approved;
  all[idx].updatedAt = new Date().toISOString();
  write(all);
  return true;
}

export function getReviewByUser(userId: string): Review | undefined {
  return read().find((r) => r.userId === userId);
}

export function upsertReview(
  userId:      string,
  userName:    string,
  rating:      number,
  text:        string,
  plan:        'free' | 'pro' | 'fleet',
  vehicleName?: string,
  lifetime?:   boolean,
): Review {
  const all      = read();
  const existing = all.findIndex((r) => r.userId === userId);
  const now      = new Date().toISOString();

  const review: Review = {
    id:          existing >= 0 ? all[existing].id : crypto.randomUUID(),
    userId,
    userName,
    rating:      Math.max(1, Math.min(5, Math.round(rating))) as 1|2|3|4|5,
    text:        text.trim().slice(0, 500),
    vehicleName: vehicleName?.trim() || undefined,
    plan,
    lifetime:    lifetime || undefined,
    // Preserve approval status on edit; new reviews start as pending
    approved:    existing >= 0 ? all[existing].approved : false,
    createdAt:   existing >= 0 ? all[existing].createdAt : now,
    updatedAt:   now,
  };

  if (existing >= 0) all[existing] = review;
  else all.push(review);
  write(all);
  return review;
}

export function deleteReview(userId: string): void {
  write(read().filter((r) => r.userId !== userId));
}
