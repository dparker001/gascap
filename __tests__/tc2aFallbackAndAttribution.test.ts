/**
 * TC-2A pre-merge fix regression (2026-09-01) — two narrow corrections found
 * during PR #51 review:
 *
 *   1. sendCampaignEmail()'s Trial Value Summary fetch (Day-21/step 4,
 *      Day-28/step 5) is optional enhancement data — a rejected
 *      getTrialValueSummary() must never prevent the underlying trial
 *      email from sending. Behavioral test against sendCampaignEmail()
 *      itself, not just the template render functions (which were already
 *      covered in __tests__/trialValueEmails.test.ts).
 *
 *   2. TrialExpiryBanner's trial_value_recap_upgrade_clicked must fire only
 *      when the personalized recap line actually rendered — a zero-activity
 *      or failed-fetch generic-banner click must not be attributed as a
 *      recap click. Structural test against the component source (this
 *      repo's established no-JSX-harness style for this file).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..');

// ── Fix 1 — sendCampaignEmail() fallback behavior ──────────────────────────

const sendMailCalls: Array<{ to: string; subject: string; html: string; text: string }> = [];
let sendMailBehavior: 'ok' | 'reject' = 'ok';
const logEmailCalls: Array<{ type: string }> = [];
let getTrialValueSummaryBehavior: 'resolve' | 'reject' = 'resolve';

vi.mock('@/lib/email', () => ({
  sendMail: vi.fn(async (opts: { to: string; subject: string; html: string; text: string }) => {
    sendMailCalls.push(opts);
    if (sendMailBehavior === 'reject') throw new Error('Email send failed: 422 invalid recipient');
  }),
  brandHeader: () => '<tr><td>header</td></tr>',
}));
vi.mock('@/lib/emailLog', () => ({
  logEmail: vi.fn(async (opts: { type: string }) => { logEmailCalls.push(opts); }),
  logEmailError: vi.fn(async () => {}),
}));
vi.mock('@/lib/trialValue', () => ({
  getTrialValueSummary: vi.fn(async () => {
    if (getTrialValueSummaryBehavior === 'reject') throw new Error('db unavailable');
    return { calculations: 4, vehicles: 1, fillups: 2, rentalSessions: 0 };
  }),
  trialValuePhrases: (s: { calculations: number | null; vehicles: number; fillups: number; rentalSessions: number }) => {
    const out: string[] = [];
    if (s.calculations) out.push(`${s.calculations} GasCap calculations`);
    if (s.vehicles) out.push(`${s.vehicles} vehicles saved`);
    if (s.fillups) out.push(`${s.fillups} fill-ups logged`);
    if (s.rentalSessions) out.push(`${s.rentalSessions} rentals tracked`);
    return out;
  },
}));

beforeEach(() => {
  sendMailCalls.length = 0;
  logEmailCalls.length = 0;
  sendMailBehavior = 'ok';
  getTrialValueSummaryBehavior = 'resolve';
  vi.clearAllMocks();
});

const testUser = {
  id: 'user-1', name: 'Jane Doe', email: 'jane@example.com',
  verifyUrl: 'https://www.gascap.app/verify?token=abc', isDelayed: false,
};

describe('Fix 1 — sendCampaignEmail() never lets a Trial Value Summary failure block the email', () => {
  it('1. getTrialValueSummary rejection during step 4 (Day-21) does NOT reject sendCampaignEmail()', async () => {
    getTrialValueSummaryBehavior = 'reject';
    const { sendCampaignEmail } = await import('@/lib/emailCampaign');
    await expect(sendCampaignEmail(4, testUser)).resolves.toBeUndefined();
  });

  it('2. Day-21 sendMail still runs (with generic/no-recap content) despite the rejection', async () => {
    getTrialValueSummaryBehavior = 'reject';
    const { sendCampaignEmail } = await import('@/lib/emailCampaign');
    await sendCampaignEmail(4, testUser);
    expect(sendMailCalls.length).toBe(1);
    expect(sendMailCalls[0].html).not.toContain('GasCap calculations');
    expect(logEmailCalls.length).toBe(1);
    expect(logEmailCalls[0].type).toBe('trial-d4');
  });

  it('3. getTrialValueSummary rejection during step 5 (Day-28) does NOT reject sendCampaignEmail()', async () => {
    getTrialValueSummaryBehavior = 'reject';
    const { sendCampaignEmail } = await import('@/lib/emailCampaign');
    await expect(sendCampaignEmail(5, testUser)).resolves.toBeUndefined();
  });

  it('4. Day-28 sendMail still runs (with generic/no-recap content) despite the rejection', async () => {
    getTrialValueSummaryBehavior = 'reject';
    const { sendCampaignEmail } = await import('@/lib/emailCampaign');
    await sendCampaignEmail(5, testUser);
    expect(sendMailCalls.length).toBe(1);
    expect(sendMailCalls[0].html).not.toContain('GasCap calculations');
    expect(logEmailCalls.length).toBe(1);
    expect(logEmailCalls[0].type).toBe('trial-d5');
  });

  it('5. steps 1-3 still never query the Trial Value Summary (mock not invoked)', async () => {
    const { getTrialValueSummary } = await import('@/lib/trialValue');
    const { sendCampaignEmail } = await import('@/lib/emailCampaign');
    await sendCampaignEmail(1, testUser);
    await sendCampaignEmail(2, testUser);
    await sendCampaignEmail(3, testUser);
    expect(getTrialValueSummary).not.toHaveBeenCalled();
    expect(sendMailCalls.length).toBe(3);
  });

  it('6. a genuine sendMail failure still propagates normally (only the summary fetch is swallowed, not the send)', async () => {
    sendMailBehavior = 'reject';
    const { sendCampaignEmail } = await import('@/lib/emailCampaign');
    await expect(sendCampaignEmail(4, testUser)).rejects.toThrow('Email send failed');
  });

  it('a successful (non-rejected) summary still personalizes the email as before — the fallback path did not regress the happy path', async () => {
    getTrialValueSummaryBehavior = 'resolve';
    const { sendCampaignEmail } = await import('@/lib/emailCampaign');
    await sendCampaignEmail(4, testUser);
    expect(sendMailCalls[0].html).toContain('GasCap calculations');
  });
});

// ── Fix 2 — TrialExpiryBanner recap-click attribution gating (structural) ──

describe('Fix 2 — TrialExpiryBanner: trial_value_recap_upgrade_clicked fires only when the recap actually rendered', () => {
  const bannerSrc = readFileSync(path.join(repoRoot, 'components/TrialExpiryBanner.tsx'), 'utf8');
  const fnStart = bannerSrc.indexOf('function handleUpgradeClick() {');
  const fnEnd = bannerSrc.indexOf('\n  }\n', fnStart);
  const fnBlock = bannerSrc.slice(fnStart, fnEnd);

  it('7. the click handler returns before tracking when recapLine is falsy', () => {
    expect(fnBlock).toMatch(/if \(!recapLine\) return;/);
    const guardIdx = fnBlock.indexOf('if (!recapLine) return;');
    const trackIdx = fnBlock.indexOf("trackClientEvent('trial_value_recap_upgrade_clicked'");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(trackIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(trackIdx);
  });

  it('8/9. a zero-activity or failed-fetch banner (recapLine null) does not emit the recap-click event — proven by the same guard covering both cases (recapLine is derived from trialValue, which is null in both)', () => {
    expect(bannerSrc).toMatch(/const recapLine = trialValueLine\(trialValue\);/);
    // trialValueLine returns null both when trialValue is null (failed
    // fetch) and when it resolves but every metric is zero — one guard
    // covers both cases identically.
    expect(bannerSrc).toMatch(/function trialValueLine\(summary: TrialValueSummary \| null\): string \| null \{\s*\n\s*if \(!summary\) return null;/);
  });

  it('10. /upgrade navigation is unaffected by the gate — the Link\'s href is unconditional, only the onClick analytics call is guarded', () => {
    const linkIdx = bannerSrc.indexOf('<Link');
    const linkBlock = bannerSrc.slice(linkIdx, linkIdx + 300);
    expect(linkBlock).toMatch(/href="\/upgrade"/);
    expect(linkBlock).toMatch(/onClick=\{handleUpgradeClick\}/);
    // The href itself has no conditional wrapping it.
    expect(bannerSrc).not.toMatch(/recapLine[^\n]*&&[^\n]*href="\/upgrade"/);
  });

  it('11. the trial_value_recap_viewed one-shot dedupe (viewTrackedRef) is unchanged by this fix', () => {
    expect(bannerSrc).toMatch(/const viewTrackedRef = useRef\(false\);/);
    expect(bannerSrc).toMatch(/if \(!recapLineForTracking \|\| viewTrackedRef\.current\) return;/);
    expect(bannerSrc).toMatch(/viewTrackedRef\.current = true;/);
  });

  it('12. exact usage counts still never appear in the click event\'s metadata — only booleans and daysRemaining', () => {
    const trackCallIdx = fnBlock.indexOf("trackClientEvent('trial_value_recap_upgrade_clicked'");
    const trackCallBlock = fnBlock.slice(trackCallIdx, fnBlock.indexOf('});', trackCallIdx));
    expect(trackCallBlock).toMatch(/hasCalculations:\s*!!\(/);
    expect(trackCallBlock).toMatch(/hasVehicles:\s*!!\(/);
    expect(trackCallBlock).not.toMatch(/calculations:\s*trialValue\.calculations,/);
    expect(trackCallBlock).not.toMatch(/vehicles:\s*trialValue\.vehicles,/);
  });
});
