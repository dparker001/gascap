import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }         from 'next-auth';
import { authOptions }              from '@/lib/auth';
import { findById }                 from '@/lib/users';
import fs   from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'data', 'users.json');

function readUsers() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch { return []; }
}
function writeUsers(users: unknown[]) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
}

// ── GET — return current threshold ────────────────────────────────────────────

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = findById((session.user as { id: string }).id);
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    threshold: user.priceAlertThreshold ?? null,
    plan:      user.plan,
  });
}

// ── PATCH — save threshold ────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const uid  = (session.user as { id: string }).id;
  const user = findById(uid);
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Only Pro / Fleet users can set price alerts
  if (user.plan !== 'pro' && user.plan !== 'fleet') {
    return NextResponse.json({ error: 'Pro plan required' }, { status: 403 });
  }

  const body: { threshold?: number | null } = await req.json();

  const users = readUsers();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const idx   = users.findIndex((u: any) => u.id === uid);
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (body.threshold === null || body.threshold === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (users[idx] as any).priceAlertThreshold;
  } else {
    const t = parseFloat(String(body.threshold));
    if (isNaN(t) || t <= 0 || t > 10) {
      return NextResponse.json({ error: 'Invalid threshold' }, { status: 400 });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (users[idx] as any).priceAlertThreshold = t;
  }

  writeUsers(users);
  return NextResponse.json({ ok: true });
}
