/**
 * Admin API — review moderation
 * GET   /api/admin/reviews           — list all user reviews (pending + approved)
 * PATCH /api/admin/reviews?id=xxx    — approve or reject a review
 *                                      body: { approved: true | false }
 * DELETE /api/admin/reviews?id=xxx   — permanently delete a review
 *
 * Protected by x-admin-password header (ADMIN_PASSWORD env var).
 */
import { NextResponse } from 'next/server';
import { getAllReviews, setReviewApproval, deleteReview } from '@/lib/reviews';

function auth(req: Request): 'ok' | 'no-env' | 'wrong' {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return 'no-env';
  const header = req.headers.get('x-admin-password') ?? '';
  return header === pw ? 'ok' : 'wrong';
}

export async function GET(req: Request) {
  const status = auth(req);
  if (status === 'no-env') return NextResponse.json({ error: 'ADMIN_PASSWORD not set' }, { status: 500 });
  if (status === 'wrong')  return NextResponse.json({ error: 'Unauthorized' },            { status: 401 });

  const reviews = getAllReviews();
  return NextResponse.json({ reviews });
}

export async function PATCH(req: Request) {
  const status = auth(req);
  if (status === 'no-env') return NextResponse.json({ error: 'ADMIN_PASSWORD not set' }, { status: 500 });
  if (status === 'wrong')  return NextResponse.json({ error: 'Unauthorized' },            { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing ?id=' }, { status: 400 });

  const body = await req.json() as { approved?: boolean };
  if (typeof body.approved !== 'boolean')
    return NextResponse.json({ error: 'Body must include { approved: boolean }' }, { status: 400 });

  const ok = setReviewApproval(id, body.approved);
  if (!ok) return NextResponse.json({ error: 'Review not found' }, { status: 404 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const status = auth(req);
  if (status === 'no-env') return NextResponse.json({ error: 'ADMIN_PASSWORD not set' }, { status: 500 });
  if (status === 'wrong')  return NextResponse.json({ error: 'Unauthorized' },            { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing ?id=' }, { status: 400 });

  // deleteReview takes userId; find the review first to get userId
  const all = getAllReviews();
  const review = all.find((r) => r.id === id);
  if (!review) return NextResponse.json({ error: 'Review not found' }, { status: 404 });

  deleteReview(review.userId);
  return NextResponse.json({ ok: true });
}
