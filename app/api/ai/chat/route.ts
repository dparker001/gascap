/**
 * POST /api/ai/chat
 * GasCap AI Advisor — powered by Claude.
 * Accepts user context + a question, returns a concise fuel/vehicle insight.
 */
import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import Anthropic            from '@anthropic-ai/sdk';
import { getFillups, computeMpg, getFillupStats } from '@/lib/fillups';
import { getBudgetGoal }    from '@/lib/budgetGoals';
import { findById, findByEmail } from '@/lib/users';
import { getVehiclesForUser } from '@/lib/savedVehicles';
import { resolveVehicleMpg } from '@/lib/mpgResolver';

const client = new Anthropic({ apiKey: process.env.GASCAP_ANTHROPIC_KEY });

// Must stay in sync with PROMPT_CHIPS in AiAdvisor.tsx
const ALLOWED_SUGGESTED = new Set([
  'Why might my MPG be dropping?',
  'Am I on track with my fuel budget?',
  'Predict my fuel cost next month',
  'How can I improve my fuel efficiency?',
  'Tips for maximizing range on a long trip',
  'When might my vehicle need maintenance?',
]);

interface ChatRequest {
  question:    string;
  vehicles?:   Array<{ name: string; gallons: number; fuelType?: string }>;
  isSuggested?: boolean;
}

export async function POST(req: Request) {
  if (!process.env.GASCAP_ANTHROPIC_KEY || process.env.GASCAP_ANTHROPIC_KEY === 'your-key-here') {
    return NextResponse.json(
      { error: 'AI Advisor is not configured. Add ANTHROPIC_API_KEY to .env.local.' },
      { status: 503 }
    );
  }

  const session = await getServerSession(authOptions);
  const body    = await req.json() as ChatRequest;

  if (!body.question?.trim()) {
    return NextResponse.json({ error: 'Question required.' }, { status: 400 });
  }

  // ── Plan enforcement ──────────────────────────────────────────────────────
  // Suggested questions are allowed for everyone (guest / free / pro).
  // Open-ended / custom questions require Pro or Fleet.
  const isSuggested = body.isSuggested === true || ALLOWED_SUGGESTED.has(body.question.trim());

  if (!isSuggested) {
    // Look up fresh plan from store (avoids stale JWT)
    const userId      = (session?.user as { id?: string })?.id;
    const userEmail   = session?.user?.email;
    const storedUser  = userId ? await findById(userId) : (userEmail ? await findByEmail(userEmail) : undefined);
    const livePlan    = storedUser?.plan ?? 'free';
    const isProServer = livePlan === 'pro' || livePlan === 'fleet';

    if (!isProServer) {
      return NextResponse.json(
        { error: 'Open-ended questions require a GasCap™ Pro plan. Upgrade to unlock full AI access.' },
        { status: 403 }
      );
    }
  }

  // ── Build user context for the prompt ────────────────────────────────────
  const userId = (session?.user as { id?: string })?.id ?? session?.user?.email ?? null;

  let contextBlock = '';

  if (userId) {
    const fillups  = await getFillups(userId);
    const mpgMap   = computeMpg(fillups);
    const stats    = getFillupStats(fillups, mpgMap);
    const goal     = getBudgetGoal(userId);
    const vehicles = await getVehiclesForUser(userId);

    const now      = new Date();
    const month    = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthFills = fillups.filter((f) => f.date.startsWith(month));
    const monthSpent = monthFills.reduce((s, f) => s + f.totalCost, 0);

    // Recent MPG values per vehicle
    const mpgValues = Object.values(mpgMap).filter((v): v is number => v !== null);
    const latestMpg = mpgValues.length > 0 ? mpgValues[mpgValues.length - 1] : null;

    // MPG for the AI's context: prefer the same EPA-rating-first logic the app
    // itself shows (MpgInsightCard) — a VIN-added vehicle has a trustworthy MPG
    // immediately, it shouldn't need 2+ logged fill-ups just for the AI to know it.
    const epaMpgs = vehicles
      .map((v) => resolveVehicleMpg(v.vehicleSpecs, null).mpg)
      .filter((m): m is number => m != null);
    const epaAvgMpg = epaMpgs.length > 0
      ? Math.round((epaMpgs.reduce((s, m) => s + m, 0) / epaMpgs.length) * 10) / 10
      : null;
    const avgMpgLine = stats.avgMpg != null
      ? `${stats.avgMpg} (from logged fill-ups)`
      : epaAvgMpg != null
        ? `${epaAvgMpg} (EPA rating — no fill-up history logged yet)`
        : 'not yet available (add a vehicle with a VIN, or log 2+ fill-ups with odometer readings)';

    contextBlock = `
USER DATA CONTEXT:
- Vehicles: ${body.vehicles?.map((v) => `${v.name} (${v.gallons} gal tank${v.fuelType ? ', ' + v.fuelType : ''})`).join('; ') || 'none saved'}
- Total fillups logged: ${stats.count}
- Total fuel spent (all time): $${stats.totalSpent.toFixed(2)}
- Total gallons (all time): ${stats.totalGallons} gal
- Average MPG across all vehicles: ${avgMpgLine}
- Latest calculated MPG: ${latestMpg ?? 'N/A'}
- This month (${month}): ${monthFills.length} fillup${monthFills.length !== 1 ? 's' : ''}, $${monthSpent.toFixed(2)} spent
- Monthly budget goal: ${goal ? `$${goal.monthlyLimit} (${Math.round((monthSpent / goal.monthlyLimit) * 100)}% used)` : 'not set'}
`.trim();
  } else {
    contextBlock = 'USER DATA CONTEXT: User is not signed in — no personal data available.';
  }

  const systemPrompt = `You are GasCap AI, an expert fuel economy and vehicle advisor built into the GasCap™ app — a smart fuel calculator that helps drivers know before they go.

Your role: Help users optimize their fuel spending, understand MPG trends, make smart decisions at the pump, and get more out of their vehicle data.

APP FEATURES YOU CAN EXPLAIN:
- Fuel Calculator: calculates exact gallons needed to avoid overfilling (saves ~$0.40+ per fill-up vs industry-average pump overfill); set your current fuel level by dragging the needle on the fuel gauge dial or using the slider
- Find Gas tab: shows live gas prices at nearby stations via Google Places; tap any price chip to instantly fill the calculator; tap "Report Price" on any card to submit the price you see at the pump and earn +5 giveaway entries (rate-limited to 5 reports/day); community-reported prices appear in amber when Google's data is missing or outdated; hide out-of-business stations with the × button
- Fill-Up Logger: log gallons pumped, price, odometer, station, receipt photo; optional "Amount paid at pump" field for when the user rounds up (e.g. GasCap says $42.83, user pays $43 — savings card uses the actual amount); shows a savings card after saving if pre-filled from the calculator. Pro tip: most pumps support pre-pay by exact dollar amount — enter the GasCap figure at the keypad and the pump stops precisely there.
- Fill-Up History: grouped by month; year chips filter by year with spent + gallons per year vs all-time; export CSV or PDF
- Charts tab: MPG over time, fuel spend, gallons, and price per gallon charts — year chips at the top filter all charts to the selected year (same year selection syncs with Fill-Up History)
- MPG tracking, cost per mile, annual fuel cost projection, monthly report card, savings dashboard vs EIA national average
- Streak Rewards: milestones at 30/90/180/365 days — Monthly members earn free Pro months; Lifetime members earn bonus giveaway entries instead
- Weekly gas card giveaway (every Friday): Pro users earn daily entries based on usage + ambassador tier; bonus entries for streaks, plan level, referrals
- Trip Cost Estimator with Google Maps route mode, Station Comparison, Gas Price Alert, EV Charge calculator, AI Fuel Advisor (this feature)
- Getaway promo: anyone who purchases Pro Lifetime receives a complimentary resort hotel getaway (fulfilled by Marketing Boost / RedeemVacations). Hotel room rate is free (up to $350/night); traveler covers nightly taxes & fees and their own travel. Choose from Las Vegas, Denver, Miami, San Antonio, Orlando, or Nashville. Activate at gascap.app/getaway within 7 days; travel within 18 months. Lifetime Perks ($9.99/yr add-on) renews the getaway certificate annually.
- Upgrading / In-App Purchase: on the iPhone app, purchases go through Apple In-App Purchase (Apple Account billing); on the Android app, purchases go through Google Play In-App Purchase (Google Account billing); on the web, checkout is handled by Stripe. Pro unlocks everywhere regardless of where it was purchased.
- User Mode: logged-in users can choose how they use GasCap — Personal Driver, Gig Driver (Uber/Lyft/DoorDash etc.), Rental Car, or Business/Fleet. Mode is saved to their profile and personalizes their experience. Users who haven't selected a mode see a mode selector on login.
- Gig Driver Mode: when userMode is 'gig', a "Driver" tab appears in the Tools panel and in the native app bottom tab bar. Three views: Log Fill-Up (date, gallons, price/gal, station, platform), Log Mileage (date, miles or start/end odometer, platform, business/personal category), and History (last 52 weeks of entries with delete). Weekly summary shows total fuel spend, business miles, cost per mile, avg $/gal, fill-up count, total gallons. IRS mileage deduction card shows year-to-date business miles × $0.70 (2026 rate) once any business miles are logged. Tax Export in History: pick a year (current + 2 prior), download CSV with fill-ups + mileage + IRS deduction summary — opens in Excel/Google Sheets. Switching away from gig mode hides the Driver tab immediately. On first login (web and native), a mode selector modal prompts the user to choose their mode; on native, picking Gig Driver auto-navigates to the Driver tab with a one-time pulse animation. Supported platforms: Uber, Lyft, DoorDash, Instacart, Spark, Amazon Flex, Shipt, Courier, Other.
- Rental Car Return Mode: a toggle in the calculator for rental vehicle drop-offs. Rental presets (Economy/Compact/Midsize/Full-size/SUV/Minivan/Pickup) auto-fill tank size. Enter the rental company's per-gallon rate to see exactly how much you save by fueling up yourself. Auto-activates when userMode is 'rental' or when arriving via gascap.app/rental (which links to /?rental=1). Also available at gascap.app/rental — a public landing page explaining the feature with a checklist and partner pitch.

${contextBlock}

RESPONSE RULES:
- Be concise: 2–4 sentences max unless a list genuinely helps
- Be specific: reference the user's actual numbers when available
- Be practical: give actionable advice, not generic tips
- Be friendly but knowledgeable — like a helpful car-savvy friend
- If asked about something unrelated to vehicles, fuel, driving costs, or the GasCap app, politely redirect
- Never make up specific fuel prices, MPG specs, or vehicle data — reference the user's data or use general knowledge ranges
- Use dollar amounts and MPG figures from the user's context when relevant`;

  try {
    const message = await client.messages.create({
      model:      'claude-opus-4-5',
      max_tokens: 300,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: body.question.trim() }],
    });

    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    return NextResponse.json({ answer: text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `AI request failed: ${msg}` }, { status: 500 });
  }
}
