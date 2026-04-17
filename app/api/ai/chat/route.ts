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
    const fillups  = getFillups(userId);
    const mpgMap   = computeMpg(fillups);
    const stats    = getFillupStats(fillups, mpgMap);
    const goal     = getBudgetGoal(userId);

    const now      = new Date();
    const month    = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthFills = fillups.filter((f) => f.date.startsWith(month));
    const monthSpent = monthFills.reduce((s, f) => s + f.totalCost, 0);

    // Recent MPG values per vehicle
    const mpgValues = Object.values(mpgMap).filter((v): v is number => v !== null);
    const latestMpg = mpgValues.length > 0 ? mpgValues[mpgValues.length - 1] : null;

    contextBlock = `
USER DATA CONTEXT:
- Vehicles: ${body.vehicles?.map((v) => `${v.name} (${v.gallons} gal tank${v.fuelType ? ', ' + v.fuelType : ''})`).join('; ') || 'none saved'}
- Total fillups logged: ${stats.count}
- Total fuel spent (all time): $${stats.totalSpent.toFixed(2)}
- Total gallons (all time): ${stats.totalGallons} gal
- Average MPG across all vehicles: ${stats.avgMpg ?? 'not yet calculated (needs odometer readings)'}
- Latest calculated MPG: ${latestMpg ?? 'N/A'}
- This month (${month}): ${monthFills.length} fillup${monthFills.length !== 1 ? 's' : ''}, $${monthSpent.toFixed(2)} spent
- Monthly budget goal: ${goal ? `$${goal.monthlyLimit} (${Math.round((monthSpent / goal.monthlyLimit) * 100)}% used)` : 'not set'}
`.trim();
  } else {
    contextBlock = 'USER DATA CONTEXT: User is not signed in — no personal data available.';
  }

  const systemPrompt = `You are GasCap AI, an expert fuel economy and vehicle advisor built into the GasCap™ app — a smart fuel calculator that helps drivers know before they go.

Your role: Help users optimize their fuel spending, understand MPG trends, make smart decisions at the pump, and get more out of their vehicle data.

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
