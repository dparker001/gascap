/**
 * Shared AI fallback for factory tank capacity when EPA's fueleconomy.gov data
 * has no usable comb08/range pair to derive it from — extracted from
 * app/api/vin/route.ts so app/api/fueleconomy/route.ts can use the same
 * fallback instead of silently returning no tank size.
 *
 * Grounded in EPA's own size class where we have it. The estimate used to go
 * out with nothing but year/make/model and came back accepted so long as it
 * was under 150 gallons — which let a 2026 Pathfinder resolve to 14 gal
 * against a real ~19.5. That error is not symmetric: too small a tank makes
 * every gallons-needed figure too low, so a renter under-fills and pays the
 * rental company's rate on the difference.
 */
import Anthropic from '@anthropic-ai/sdk';
import { tankBandForVClass, checkTankPlausibility, bandMidpoint } from './tankPlausibility';

export interface TankEstimateContext {
  /** EPA VClass, e.g. "Standard Sport Utility Vehicle 4WD". The useful one. */
  vClass?: string | null;
  displ?: string | number | null;
  cylinders?: string | number | null;
  drive?: string | null;
}

async function askModel(
  client: Anthropic,
  vehicleDesc: string,
  ctx: TankEstimateContext,
  correction?: string,
): Promise<number | null> {
  const facts = [
    ctx.vClass    ? `EPA size class: ${ctx.vClass}` : null,
    ctx.displ     ? `Engine: ${ctx.displ}L` : null,
    ctx.cylinders ? `${ctx.cylinders} cylinders` : null,
    ctx.drive     ? `Drive: ${ctx.drive}` : null,
  ].filter(Boolean).join('\n');

  const msg = await client.messages.create({
    model:      'claude-haiku-4-5',
    max_tokens: 64,
    messages: [{
      role: 'user',
      content: `What is the factory fuel tank capacity in US gallons for a ${vehicleDesc}?
${facts ? `\nKnown EPA data for this exact vehicle:\n${facts}\n` : ''}${correction ? `\n${correction}\n` : ''}
Respond with ONLY a JSON object in this exact format: {"tankGallons": 15.9}
Use the most common trim's factory tank size. If you are not confident, estimate from the EPA size class above. Do NOT include any explanation.`,
    }],
  });

  const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  const parsed = JSON.parse(match[0]) as { tankGallons?: unknown };
  const val = Number(parsed.tankGallons);
  if (!isNaN(val) && val > 0 && val < 150) return Math.round(val * 10) / 10;
  return null;
}

export async function aiFallbackTankSize(
  year: string | number,
  make: string,
  model: string,
  trim?: string,
  ctx: TankEstimateContext = {},
): Promise<number | null> {
  try {
    const apiKey = process.env.GASCAP_ANTHROPIC_KEY;
    if (!apiKey) return null;

    const client = new Anthropic({ apiKey });
    const vehicleDesc = [year, make, model, trim].filter(Boolean).join(' ');

    const first = await askModel(client, vehicleDesc, ctx);
    if (first == null) return null;

    // No EPA class to check against — take it as before rather than block a
    // lookup on a check we can't perform.
    if (checkTankPlausibility(first, ctx.vClass) !== 'out_of_band') return first;

    const band = tankBandForVClass(ctx.vClass)!;
    // One retry, told plainly what was wrong. Cheap (Haiku, 64 tokens) and it
    // usually lands once the class constraint is explicit.
    const second = await askModel(
      client, vehicleDesc, ctx,
      `Your previous answer of ${first} gallons is implausible for a ${ctx.vClass} — vehicles in that class hold roughly ${band.min}–${band.max} US gallons. Reconsider.`,
    );
    if (second != null && checkTankPlausibility(second, ctx.vClass) === 'ok') return second;

    return bandMidpoint(band);
  } catch {
    return null;
  }
}
