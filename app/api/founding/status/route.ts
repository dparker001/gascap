/**
 * GET /api/founding/status — live Founding Member promo status for the banner.
 * { active, cap, spotsLeft, price }
 */

import { NextResponse } from 'next/server';
import { foundingStatus } from '@/lib/foundingPromo';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = await foundingStatus();
    return NextResponse.json(status);
  } catch {
    // Never break the page if the count fails — just report the promo inactive.
    return NextResponse.json({ active: false, cap: 100, spotsLeft: 0, price: 9.99 });
  }
}
