/**
 * Admin Feedback API — protected by ADMIN_PASSWORD env var
 * GET    /api/admin/feedback          — list all feedback
 * PATCH  /api/admin/feedback?id=xxx   — mark as read
 * DELETE /api/admin/feedback?id=xxx   — delete item
 */
import { NextResponse } from 'next/server';
import { getAllFeedback, markRead, deleteFeedback } from '@/lib/feedback';
import { sessionHasAdminRole, legacyAdminPasswordOk } from '@/lib/adminAuth';

async function auth(req: Request): Promise<boolean> {
  const legacyOk = legacyAdminPasswordOk(req, process.env.ADMIN_PASSWORD);
  return legacyOk || await sessionHasAdminRole();
}

export async function GET(req: Request) {
  if (!await auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ feedback: getAllFeedback() });
}

export async function PATCH(req: Request) {
  if (!await auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  markRead(id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (!await auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  deleteFeedback(id);
  return NextResponse.json({ ok: true });
}
