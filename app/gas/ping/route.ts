import { NextResponse } from 'next/server';

/** Unauthenticated reachability probe — used by native Find Gas diagnostics. */
export async function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() });
}
