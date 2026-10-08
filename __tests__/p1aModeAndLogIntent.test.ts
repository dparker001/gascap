/**
 * Phase 1 P1-A — skippable mode selector (+ mode analytics), the `/?log=1`
 * deep link, and the no-vehicle fill-up logger dead end.
 *
 * The repo's vitest runs in a node environment without jsdom, so component
 * behaviour is asserted the way the neighbouring suites do it: pure logic is
 * executed (lib/logIntent.ts, the analytics route), and component wiring is
 * asserted against the source text.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  hasLogIntent, stripLogIntent, requestLogIntent, peekLogIntent, consumeLogIntent,
  LOG_INTENT_TTL_MS, _resetLogIntentForTests,
} from '../lib/logIntent';

const root = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

// ── /?log=1 ─────────────────────────────────────────────────────────────────
describe('/?log=1 intent (lib/logIntent.ts)', () => {
  beforeEach(() => _resetLogIntentForTests());

  it('recognises log=1 and nothing else', () => {
    expect(hasLogIntent('?log=1')).toBe(true);
    expect(hasLogIntent('?a=b&log=1&c=d')).toBe(true);
    expect(hasLogIntent('?log=0')).toBe(false);
    expect(hasLogIntent('?log=')).toBe(false);
    expect(hasLogIntent('')).toBe(false);
    expect(hasLogIntent('?logx=1')).toBe(false);
  });

  it('strips only log=1 and preserves the other parameters in order', () => {
    expect(stripLogIntent('?log=1')).toBe('');
    expect(stripLogIntent('?welcome=1&log=1&ref=abc')).toBe('?welcome=1&ref=abc');
    expect(stripLogIntent('?ref=abc')).toBe('?ref=abc');          // unchanged
    expect(stripLogIntent('?log=0&x=1')).toBe('?log=0&x=1');      // not our intent
  });

  it('is applied once: the second consume is false (no repeated reopening)', () => {
    const t = 1_000_000;
    requestLogIntent(t);
    expect(peekLogIntent(t + 10)).toBe(true);
    expect(consumeLogIntent(t + 10)).toBe(true);
    expect(consumeLogIntent(t + 20)).toBe(false);
    expect(peekLogIntent(t + 20)).toBe(false);
  });

  it('expires if nothing consumed it, so it cannot pop the logger open later', () => {
    const t = 5_000_000;
    requestLogIntent(t);
    expect(consumeLogIntent(t + LOG_INTENT_TTL_MS + 1)).toBe(false);
  });

  it('nothing is consumed when no intent was requested', () => {
    expect(consumeLogIntent()).toBe(false);
  });
});

describe('/?log=1 wiring', () => {
  const handler = read('components/LogIntentHandler.tsx');
  const page = read('app/page.tsx');

  it('the handler only acts for an authenticated session and removes the param from the URL', () => {
    expect(handler).toMatch(/status !== 'authenticated'/);
    expect(handler).toMatch(/stripLogIntent\(window\.location\.search\)/);
    expect(handler).toMatch(/history\.replaceState/);
    expect(handler).toMatch(/hasLogIntent\(window\.location\.search\)\)\s*return/);   // already handled → no-op
  });

  it('issues no redirect (cannot loop)', () => {
    expect(handler).not.toMatch(/router\.(push|replace)|window\.location\.(href|assign|replace)\s*=|redirect\(/);
  });

  it('is mounted on both the web page and the native shell branch', () => {
    const mounts = page.match(/<LogIntentHandler \/>/g) ?? [];
    expect(mounts.length).toBe(2);
    expect(page).toMatch(/if \(isNative\) return \([\s\S]*?<NativeAppShell \/>[\s\S]*?<LogIntentHandler \/>/);
  });

  it('Tools selects the Log tab and the logger consumes the intent once', () => {
    const tools = read('components/ToolsPanel.tsx');
    expect(tools).toMatch(/peekLogIntent\(\)\) setActiveTab\('log'\)/);
    expect(tools).toMatch(/addEventListener\(LOG_INTENT_EVENT/);
    const logger = read('components/ManualFillupLogger.tsx');
    expect(logger).toMatch(/consumeLogIntent\(\)/);
    // only the visible copy (page mounts a mobile and a desktop ToolsPanel) acts
    expect(logger).toMatch(/getClientRects\(\)\.length === 0\) return/);
  });

  it('the nudge schedule/copy is untouched (still links to /?log=1)', () => {
    expect(read('lib/emailCampaign.ts')).toMatch(/\/\?log=1/);
    expect(read('app/api/cron/first-fillup-nudge/route.ts')).toMatch(/'\/\?log=1'/);
  });
});

// ── no-vehicle logger ───────────────────────────────────────────────────────
describe('fill-up logger with no saved vehicle', () => {
  const src = read('components/ManualFillupLogger.tsx');
  const empty = src.slice(src.indexOf('vehicles.length === 0 &&'), src.indexOf('{selected && ('));

  it('exposes an "Add a vehicle" call to action, not just Cancel', () => {
    expect(empty).toMatch(/t\.manualFillupLogger\.addVehicle/);
    expect(empty).toMatch(/onClick=\{handleAddVehicle\}/);
  });

  it('opens the existing add-vehicle flow and creates nothing itself', () => {
    expect(src).toMatch(/gascap:focus-vehicles/);
    expect(src).not.toMatch(/method:\s*'POST'/);
    expect(src).not.toMatch(/\/api\/vehicles['"`],\s*\{/);          // only the read-only GET list
  });

  it('returns to logging after a vehicle is saved', () => {
    expect(src).toMatch(/addEventListener\('vehicle-saved'/);
    expect(src).toMatch(/returnToLogRef\.current = true/);
    expect(src).toMatch(/setOpen\(true\)/);
  });

  it('has EN and ES copy for the button', () => {
    const tr = read('lib/translations.ts');
    expect(tr).toMatch(/addVehicle: 'Add a vehicle'/);
    expect(tr).toMatch(/addVehicle: 'Agregar un vehículo'/);
  });

  it('vehicle limits/entitlements are untouched by this change', () => {
    expect(read('app/api/vehicles/route.ts')).toMatch(/PLAN_LIMITS = \{ free: 1, pro: 9999, fleet: 9999 \}/);
  });
});

// ── mode selector ───────────────────────────────────────────────────────────
describe('mode selector is skippable for everyone', () => {
  const sel = read('components/UserModeSelector.tsx');
  const skipFn = sel.slice(sel.indexOf('function handleSkip'), sel.indexOf('const modal'));

  it('has a "Skip for now" control wired to handleSkip', () => {
    expect(sel).toMatch(/Skip for now/);
    expect(sel).toMatch(/onClick=\{handleSkip\}/);
  });

  it('skipping assigns no mode: no profile write and no default', () => {
    expect(skipFn).not.toMatch(/fetch\(/);
    expect(skipFn).not.toMatch(/userMode|update\(\)|onComplete/);
    expect(skipFn).toMatch(/onSkip\?\.\(\)/);
  });

  it('emits mode_skipped / mode_selected from handlers (not render), guarded to once', () => {
    expect(skipFn).toMatch(/trackClientEvent\('mode_skipped'\)/);
    expect(sel).toMatch(/trackClientEvent\('mode_selected', \{ mode: selected \}\)/);
    expect(sel).toMatch(/const decided = useRef\(false\)/);
    expect(skipFn).toMatch(/decided\.current\) return/);
    // no event call at component top level
    const beforeHandlers = sel.slice(0, sel.indexOf('async function handleSave'));
    expect(beforeHandlers).not.toMatch(/trackClientEvent\(/);
  });

  it('selecting a mode still saves it exactly as before', () => {
    expect(sel).toMatch(/fetch\('\/api\/user\/profile', \{[\s\S]*?PATCH[\s\S]*?userMode: selected/);
    expect(sel).toMatch(/gc:user-mode/);
    expect(sel).toMatch(/onComplete\(selected\)/);
  });

  it('web and native both honour a skip, and no experiment flag is involved', () => {
    for (const f of ['app/page.tsx', 'components/native/NativeAppShell.tsx']) {
      const s = read(f);
      expect(s, f).toMatch(/useModeSelectorSkip\(/);
      expect(s, f).toMatch(/!modeSkip\.skipped/);
      expect(s, f).toMatch(/onSkip=\{\(\) => \{ modeSkip\.markSkipped\(\)/);
    }
    for (const f of ['components/UserModeSelector.tsx', 'hooks/useModeSelectorSkip.ts', 'components/LogIntentHandler.tsx']) {
      expect(read(f), f).not.toMatch(/experiment|variant|ACTIVATION_EXPERIMENT/i);
    }
  });

  it('a skip is remembered per user so the prompt does not return on every load', () => {
    const hook = read('hooks/useModeSelectorSkip.ts');
    expect(hook).toMatch(/localStorage\.setItem\(modeSkipKey\(userId\), '1'\)/);
    expect(hook).not.toMatch(/userMode/);
  });

  it('Settings still lets the user choose a mode later', () => {
    expect(read('app/settings/page.tsx')).toMatch(/userMode:\s+userMode \|\| null/);
  });
});

// ── mode analytics: allowlist + strict metadata ─────────────────────────────
const getServerSession = vi.fn(async (..._a: unknown[]) => null as unknown);
const recordAnalyticsEvent = vi.fn(async (..._a: unknown[]) => ({ outcome: 'written' as const, id: 'e1' }));
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...(a as [])) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/analyticsEvents', () => ({ recordAnalyticsEvent: (...a: unknown[]) => recordAnalyticsEvent(...(a as [])) }));
vi.mock('@/lib/rateLimitDb', () => ({
  checkRateLimitDb: async () => ({ allowed: true, remaining: 59, resetInSeconds: 60 }),
  hashRateLimitIdentifier: (s: string) => `h:${s}`,
}));
vi.mock('@/lib/clientIp', () => ({ getTrustedClientIp: () => '203.0.113.7' }));

async function post(body: unknown) {
  const { POST } = await import('@/app/api/analytics/event/route');
  return POST(new Request('https://www.gascap.app/api/analytics/event', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}

describe('mode_selected / mode_skipped ingest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSession.mockResolvedValue({ user: { id: 'user-1' } });
  });

  it.each(['personal', 'gig', 'rental', 'fleet'])('accepts mode_selected with mode %s', async (mode) => {
    const res = await post({ eventType: 'mode_selected', originPlatform: 'web', metadata: { mode } });
    expect(res.status).toBe(202);
    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(1);
    expect(recordAnalyticsEvent.mock.calls[0][0]).toMatchObject({ eventType: 'mode_selected', userId: 'user-1', metadata: { mode } });
  });

  it.each(['admin', 'Personal', '', 'personal ', 'x@y.com', 42, null, ['gig']])('rejects invalid mode value %j', async (mode) => {
    const res = await post({ eventType: 'mode_selected', originPlatform: 'web', metadata: { mode } });
    expect(res.status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('rejects mode_selected with no metadata, an unknown key, or PII-bearing extras', async () => {
    expect((await post({ eventType: 'mode_selected', originPlatform: 'web' })).status).toBe(400);
    expect((await post({ eventType: 'mode_selected', originPlatform: 'web', metadata: { mode: 'gig', email: 'a@b.co' } })).status).toBe(400);
    expect((await post({ eventType: 'mode_selected', originPlatform: 'web', metadata: { mode: 'gig', name: 'Don' } })).status).toBe(400);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('accepts mode_skipped with no metadata and rejects any metadata', async () => {
    expect((await post({ eventType: 'mode_skipped', originPlatform: 'ios' })).status).toBe(202);
    recordAnalyticsEvent.mockClear();
    expect((await post({ eventType: 'mode_skipped', originPlatform: 'ios', metadata: { mode: 'gig' } })).status).toBe(400);
    expect((await post({ eventType: 'mode_skipped', originPlatform: 'ios', metadata: {} })).status).toBe(202);
  });

  it('requires a signed-in user (not in the anonymous allowlist)', async () => {
    getServerSession.mockResolvedValue(null);
    expect((await post({ eventType: 'mode_skipped', originPlatform: 'web' })).status).toBe(401);
    expect((await post({ eventType: 'mode_selected', originPlatform: 'web', metadata: { mode: 'gig' } })).status).toBe(401);
  });
});
