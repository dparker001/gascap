/**
 * Legacy subscribe route — kept as a no-op so any old clients
 * don't receive unexpected errors. OneSignal now manages all
 * push subscriptions directly via their SDK.
 */
import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  return NextResponse.json({ ok: true });
}
