/**
 * POST /api/giveaway/claim
 *
 * Body: { month: string; address: { street: string; city: string; state: string; zip: string } }
 *
 * 1. Verifies the requesting user is the winner for that month.
 * 2. Marks claimedAt on the GiveawayDraw record.
 * 3. Fires the GHL winner webhook with address details for VA/shipping follow-up.
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { prisma }           from '@/lib/prisma';

interface ClaimBody {
  month:   string;
  address: {
    street: string;
    city:   string;
    state:  string;
    zip:    string;
  };
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as { id?: string })?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as ClaimBody;
  const { month, address } = body;

  if (!month || !address?.street || !address?.city || !address?.state || !address?.zip) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 });
  }

  // Find the draw — must belong to this user and be unclaimed
  const draw = await prisma.giveawayDraw.findFirst({
    where: { month, winnerId: userId, claimedAt: null },
  });

  if (!draw) {
    return NextResponse.json(
      { error: 'No unclaimed prize found for this month and account.' },
      { status: 404 },
    );
  }

  // Mark claimed
  await prisma.giveawayDraw.update({
    where: { id: draw.id },
    data:  { claimedAt: new Date().toISOString() },
  });

  // Fire GHL webhook — VA picks up shipping details from here
  const webhookUrl = process.env.GHL_WINNER_WEBHOOK_URL;
  const [firstName, ...rest] = draw.winnerName.split(' ');
  const lastName = rest.join(' ');

  if (webhookUrl) {
    fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event:      'prize_claimed',
        firstName,
        lastName:   lastName || '',
        email:      draw.winnerEmail,
        month:      draw.month,
        prize:      '$25 Visa Prepaid Card',
        claimedAt:  new Date().toISOString(),
        // Shipping address
        street:     address.street,
        city:       address.city,
        state:      address.state,
        zip:        address.zip,
      }),
    }).catch((err) => console.error('[claim] GHL webhook failed:', err));
  }

  return NextResponse.json({ ok: true });
}
