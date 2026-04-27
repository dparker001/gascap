/**
 * GET /api/announcements
 *
 * Returns active announcements filtered by:
 *  - active: true
 *  - today's date falls within [startDate, endDate]
 *  - user's plan is in targetPlans (or targetPlans is empty = all plans)
 *
 * Called client-side by AnnouncementToast. No auth required — the
 * client decides which to show based on the user's session plan.
 *
 * POST /api/announcements  (admin-only)
 *
 * Saves the announcements.json file. Protected by x-admin-password header.
 */

import { NextResponse }  from 'next/server';
import fs                from 'fs';
import path              from 'path';

const FILE = path.join(process.cwd(), 'data', 'announcements.json');

export interface Announcement {
  id:           string;
  emoji:        string;
  title:        string;
  message:      string;
  link?:        string;
  linkText?:    string;
  startDate:    string;  // YYYY-MM-DD
  endDate:      string;  // YYYY-MM-DD
  targetPlans:  string[];   // [] = all plans
  dismissible:  boolean;
  active:       boolean;
}

function readAll(): Announcement[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf-8')) as Announcement[];
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const url    = new URL(req.url);
  const isAll  = url.searchParams.get('all') === '1';

  // Admin-only: return raw list
  if (isAll) {
    const adminPw = process.env.ADMIN_PASSWORD ?? '';
    const header  = req.headers.get('x-admin-password') ?? '';
    if (!adminPw || header !== adminPw) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(readAll());
  }

  const all   = readAll();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const active = all.filter((a) => {
    if (!a.active) return false;
    if (today < a.startDate || today > a.endDate) return false;
    return true;
  });

  return NextResponse.json(active);
}

export async function POST(req: Request) {
  const adminPw = process.env.ADMIN_PASSWORD ?? '';
  const header  = req.headers.get('x-admin-password') ?? '';
  if (!adminPw || header !== adminPw) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json() as Announcement[];
    if (!Array.isArray(body)) throw new Error('Expected array');
    fs.writeFileSync(FILE, JSON.stringify(body, null, 2));
    return NextResponse.json({ ok: true, count: body.length });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
