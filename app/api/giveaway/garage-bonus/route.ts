/**
 * POST /api/giveaway/garage-bonus
 *
 * Awards +10 daily draw entries when a Pro/Fleet user taps to open their
 * garage door. Idempotent: only one award per calendar day.
 *
 * Response:
 *   { awarded: true,  bonusEntries: 10, totalGarageDays: number }  ← first open today
 *   { awarded: false, bonusEntries: 0,  totalGarageDays: number }  ← already opened today
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { prisma }           from '@/lib/prisma';

const BONUS_PER_OPEN = 10;

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id?: string })?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Only Pro/Fleet users earn bonus entries
  if (user.plan !== 'pro' && user.plan !== 'fleet') {
    return NextResponse.json({ awarded: false, bonusEntries: 0, totalGarageDays: 0 });
  }

  // Today's date in YYYY-MM-DD (UTC)
  const today = new Date().toISOString().slice(0, 10);

  if (user.garageLastOpenedDate === today) {
    // Already earned today
    return NextResponse.json({
      awarded:         false,
      bonusEntries:    0,
      totalGarageDays: (user.garageBonusDays ?? []).length,
    });
  }

  // First open today — award the bonus
  const updatedDays = [...(user.garageBonusDays ?? []), today];

  await prisma.user.update({
    where: { id: userId },
    data: {
      garageLastOpenedDate: today,
      garageBonusDays:      updatedDays,
    },
  });

  return NextResponse.json({
    awarded:         true,
    bonusEntries:    BONUS_PER_OPEN,
    totalGarageDays: updatedDays.length,
  });
}
