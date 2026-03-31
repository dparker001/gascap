/**
 * User reviews — persisted in data/reviews.json
 * For production: replace with a DB table.
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
  createdAt:   string;
  updatedAt:   string;
}

const DATA_FILE = path.join(process.cwd(), 'data', 'reviews.json');

// Seed reviews — shown until real user reviews accumulate.
// Remove individual entries once you have 6+ genuine reviews.
const SEED_REVIEWS: Review[] = [
  {
    id: 'seed-001', userId: 'seed-user-001', userName: 'Marcus T.',
    rating: 5,
    text: "Finally stopped guessing at the pump. Pulled up knowing exactly what I needed — saved $12 on my last fillup just by not over-filling. The live gas price lookup is a game changer.",
    vehicleName: '2021 Ford F-150', plan: 'pro',
    createdAt: '2026-03-20T14:32:00.000Z', updatedAt: '2026-03-20T14:32:00.000Z',
  },
  {
    id: 'seed-002', userId: 'seed-user-002', userName: 'Priya S.',
    rating: 5,
    text: "I manage two cars for our household and the garage feature is perfect. I can switch between my Civic and my husband's truck in seconds. MPG tracking has made me a way more efficient driver.",
    vehicleName: '2020 Honda Civic', plan: 'pro',
    createdAt: '2026-03-22T09:15:00.000Z', updatedAt: '2026-03-22T09:15:00.000Z',
  },
  {
    id: 'seed-003', userId: 'seed-user-003', userName: 'Derek W.',
    rating: 5,
    text: "The monthly budget tracker keeps me honest. I set a goal and GasCap tells me exactly how I'm tracking week by week. Simple, clean, no fluff. This is what a gas app should be.",
    vehicleName: '2019 Chevy Silverado', plan: 'pro',
    createdAt: '2026-03-24T16:45:00.000Z', updatedAt: '2026-03-24T16:45:00.000Z',
  },
  {
    id: 'seed-004', userId: 'seed-user-004', userName: 'Janelle R.',
    rating: 5,
    text: "Works without wifi — that alone sold me. I'm always in areas with spotty signal and every other app fails. GasCap just works. Installed it on my phone like an app and it's always there.",
    vehicleName: '2022 Toyota RAV4', plan: 'free',
    createdAt: '2026-03-25T11:20:00.000Z', updatedAt: '2026-03-25T11:20:00.000Z',
  },
  {
    id: 'seed-005', userId: 'seed-user-005', userName: 'Carlos M.',
    rating: 5,
    text: "I drive for work and fuel reimbursement is always a headache. The fill-up log and export feature makes it dead simple to submit expenses. Paid for itself the very first month.",
    vehicleName: '2023 Hyundai Tucson', plan: 'pro',
    createdAt: '2026-03-26T08:55:00.000Z', updatedAt: '2026-03-26T08:55:00.000Z',
  },
  {
    id: 'seed-006', userId: 'seed-user-006', userName: 'Aisha B.',
    rating: 5,
    text: "Shared this with my whole family. My teenage daughter uses it before every fillup now. The AI advisor answered her question about gas grades and she saved money immediately. Love this app.",
    vehicleName: '2018 Nissan Altima', plan: 'free',
    createdAt: '2026-03-27T13:10:00.000Z', updatedAt: '2026-03-27T13:10:00.000Z',
  },
];

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

export function getPublicReviews(): Review[] {
  const real = read().filter((r) => r.text.trim().length > 0);

  // Merge: real reviews take slots first; seeds fill in the rest up to 6 total.
  // Seeds whose userId is already claimed by a real review are skipped.
  const realIds = new Set(real.map((r) => r.userId));
  const seeds   = SEED_REVIEWS.filter((s) => !realIds.has(s.userId));
  const merged  = [...real, ...seeds].slice(0, Math.max(real.length, 6));

  return merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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
