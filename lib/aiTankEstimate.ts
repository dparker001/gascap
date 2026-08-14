/**
 * Shared AI fallback for factory tank capacity when EPA's fueleconomy.gov data
 * has no usable comb08/range pair to derive it from — extracted from
 * app/api/vin/route.ts so app/api/fueleconomy/route.ts can use the same
 * fallback instead of silently returning no tank size.
 */
import Anthropic from '@anthropic-ai/sdk';

export async function aiFallbackTankSize(
  year: string | number,
  make: string,
  model: string,
  trim?: string,
): Promise<number | null> {
  try {
    const apiKey = process.env.GASCAP_ANTHROPIC_KEY;
    if (!apiKey) return null;

    const client = new Anthropic({ apiKey });

    const vehicleDesc = [year, make, model, trim].filter(Boolean).join(' ');

    const msg = await client.messages.create({
      model:      'claude-haiku-4-5',
      max_tokens: 64,
      messages: [
        {
          role:    'user',
          content: `What is the factory fuel tank capacity in US gallons for a ${vehicleDesc}?
Respond with ONLY a JSON object in this exact format: {"tankGallons": 15.9}
Use the most common trim's factory tank size. If you are not confident, use your best estimate based on the vehicle class. Do NOT include any explanation.`,
        },
      ],
    });

    const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
    const match = raw.match(/\{[\s\S]*?\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]) as { tankGallons?: unknown };
    const val = Number(parsed.tankGallons);
    if (!isNaN(val) && val > 0 && val < 150) return Math.round(val * 10) / 10;
    return null;
  } catch {
    return null;
  }
}
