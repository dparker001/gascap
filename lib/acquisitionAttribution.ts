/**
 * Workstream 01 — first-touch WEB acquisition attribution.
 *
 * Scope, deliberately: web funnel only (QR placards + UTM links). No
 * native install attribution, no RevenueCat subscriber attributes — both
 * explicitly out of scope per this phase's instruction, pending separate
 * verification (see docs/reviews/2026-10-12-workstream01-phase3-response.md
 * Task 4).
 *
 * Independence guarantee: this module never reads or writes plan, trial,
 * Stripe, or RevenueCat state, and nothing downstream of signup depends on
 * it succeeding. captureAcquisitionAttribution() is called fire-and-forget
 * from every new-signup path and must never throw into the caller — same
 * convention as this codebase's existing signup_completed/trial_started
 * emissions (lib/users.ts, lib/auth.ts, app/api/auth/register/route.ts).
 *
 * TRUST BOUNDARY (Phase 4 hardening, concern #2 — OTP client-supplied
 * values). Both source cookies (gc_src, gc_utm) are httpOnly:false BY
 * DESIGN — the existing CampaignTracker component already needs to read
 * gc_src client-side, so this was never a hardenable boundary to begin
 * with. That means a client can already rewrite either cookie's value
 * before ANY signup submission, regardless of transport — the password
 * path (server reads the real Cookie header) is not meaningfully more
 * trustworthy than the OTP path (client reads document.cookie and
 * resubmits the same values as credential fields): in both cases the
 * value the server sees originated from client-controlled storage. OTP's
 * mechanism is a transport difference, not a new trust boundary.
 * What IS enforced, identically for every path: (a) a code can only ever
 * resolve to one already-registered row in CampaignPlacement/
 * AcquisitionCampaignCode — a client can forge a timestamp, but can never
 * invent a campaign that doesn't exist; (b) a timestamp outside a
 * plausible window (see MAX_TOUCH_AGE_MS/MAX_FUTURE_SKEW_MS below) is
 * rejected as unparseable, not trusted. The residual risk — a client
 * forging a plausible-looking timestamp to win precedence over a genuine
 * touch on their OWN account — is accepted and bounded: attribution is a
 * reporting signal only, never an entitlement, price, or security
 * decision, so the worst case is a misattributed row in a marketing
 * report for that one account, never a cross-account or financial
 * consequence.
 *
 * RECOVERY (Phase 4 hardening, concern #3 — ambiguous captures). An
 * ambiguous capture (acqAmbiguous=true, source/campaign null) is
 * permanent under the write-once rule, by design — nothing here retries
 * or reclassifies it automatically. If a later investigation (e.g.
 * reading raw AnalyticsEvent timestamps for that user, where available)
 * establishes the real order, the only correction path today is a manual
 * admin action directly against that one row; no admin tool for this
 * exists yet and none was built in this phase (out of scope — this phase
 * is attribution capture, not an admin UI). This is a known, accepted
 * limitation, not an oversight.
 */
import { prisma } from '@/lib/prisma';
import { getPlacementByCode } from '@/lib/campaigns';

export const QR_COOKIE     = 'gc_src';
export const QR_AT_COOKIE  = 'gc_src_at';
export const UTM_COOKIE    = 'gc_utm';
export const UTM_AT_COOKIE = 'gc_utm_at';

/** Matches the cookie's own maxAge in app/q/[code]/route.ts and
 *  app/go/[code]/route.ts. A timestamp claiming to be older than this
 *  could not have come from a genuine, still-alive cookie — the browser
 *  would have dropped it — so it's treated as tampered/implausible, not
 *  "very early," per the Phase 4 hardening requirement (concern #5:
 *  cookie tampering/replay/timestamp manipulation). */
const MAX_TOUCH_AGE_MS = 90 * 24 * 60 * 60 * 1000;
/** Small, deliberate tolerance for ordinary clock skew — both timestamps
 *  are stamped server-side (Date.now() in the two redirect routes), so a
 *  genuine value should never be meaningfully in the future relative to
 *  the capture server's own clock. Anything beyond this is implausible. */
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

/** Lowercase letters/digits/hyphen/underscore, 1-64 chars. Syntax only —
 *  registry membership (does this code exist and is it active?) is a
 *  separate, DB-backed check in validateUtmCode() below. */
const UTM_CODE_PATTERN = /^[a-z0-9_-]{1,64}$/;

export interface RawTouch {
  qrCode: string | null;
  qrAt:   string | null;
  utmCode: string | null;
  utmAt:   string | null;
}

export interface ResolvedTouch {
  source:    'qr' | 'utm' | null;
  campaign:  string | null;
  /** True when a QR touch and a UTM touch were both present but their
   *  relative order could not be reliably established — never paired
   *  with a non-null source; see resolveFirstTouch()'s doc comment. */
  ambiguous: boolean;
}

/**
 * Parse a raw `Cookie` request header into a plain key→value map.
 * General-purpose replacement for the ad hoc single-cookie regex this
 * codebase used before (e.g. the gc_src/gc_ssn reads in
 * app/api/auth/register/route.ts) — permissive by design; callers
 * validate the specific values they read, this just splits the header.
 */
export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

export function rawTouchFromCookieHeader(header: string | null | undefined): RawTouch {
  const map = parseCookieHeader(header);
  const qrRaw  = map[QR_COOKIE];
  const utmRaw = map[UTM_COOKIE];
  return {
    qrCode: qrRaw  ? safeDecode(qrRaw)  : null,
    qrAt:   map[QR_AT_COOKIE] ?? null,
    utmCode: utmRaw ? safeDecode(utmRaw) : null,
    utmAt:   map[UTM_AT_COOKIE] ?? null,
  };
}

function safeDecode(v: string): string {
  try { return decodeURIComponent(v); } catch { return v; }
}

/** Syntax-level validation only — length + charset. Pure, so unit-testable
 *  without a DB round trip. Registry membership is checked separately. */
export function isSyntacticallyValidUtmCode(code: string): boolean {
  return UTM_CODE_PATTERN.test(code);
}

/** Never invents a timestamp from a malformed, zero, or negative raw
 *  string — returns null, which resolveFirstTouch() treats as "can't
 *  compare," never as "zero" (which would always lose) or "now" (which
 *  would always win). Also rejects an implausible value outside
 *  [now - MAX_TOUCH_AGE_MS, now + MAX_FUTURE_SKEW_MS] — a cookie claiming
 *  to be older than its own maxAge, or meaningfully in the future,
 *  cannot be genuine (Phase 4 hardening, concern #5). This is a plausible-
 *  range check, not a signature — it cannot detect a forged-but-plausible
 *  timestamp; see the module-level "Trust boundary" doc comment. */
function parseTimestampMs(raw: string | null | undefined, nowMs: number = Date.now()): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < nowMs - MAX_TOUCH_AGE_MS) return null;
  if (n > nowMs + MAX_FUTURE_SKEW_MS) return null;
  return n;
}

/**
 * Pure resolution of first-touch precedence. No DB access — the caller
 * must have already validated each candidate code against its registry
 * (CampaignPlacement for QR, AcquisitionCampaignCode for UTM) and pass
 * `null` for anything that didn't validate; this function never second-
 * guesses that.
 *
 * Rule: whichever valid, timestamped touch is chronologically EARLIER
 * wins — never "QR always wins." If only one channel has a valid
 * candidate, it wins unconditionally (no timestamp needed). If both are
 * present but their timestamps can't be compared (either missing/
 * malformed on either side, or exactly equal — genuinely
 * indistinguishable), this is reported as ambiguous: no winner is
 * invented, source/campaign stay null, and ambiguous=true so the caller
 * can still know a double-touch happened without crediting a channel
 * that can't be shown to deserve it.
 */
export function resolveFirstTouch(input: {
  qrValid: string | null;
  qrAt:    string | null;
  utmValid: string | null;
  utmAt:    string | null;
}, nowMs: number = Date.now()): ResolvedTouch {
  const hasQr  = input.qrValid !== null;
  const hasUtm = input.utmValid !== null;

  if (!hasQr && !hasUtm) return { source: null, campaign: null, ambiguous: false };
  if (hasQr && !hasUtm)  return { source: 'qr',  campaign: input.qrValid,  ambiguous: false };
  if (hasUtm && !hasQr)  return { source: 'utm', campaign: input.utmValid, ambiguous: false };

  const qrTs  = parseTimestampMs(input.qrAt, nowMs);
  const utmTs = parseTimestampMs(input.utmAt, nowMs);

  if (qrTs === null || utmTs === null || qrTs === utmTs) {
    return { source: null, campaign: null, ambiguous: true };
  }
  return qrTs < utmTs
    ? { source: 'qr',  campaign: input.qrValid,  ambiguous: false }
    : { source: 'utm', campaign: input.utmValid, ambiguous: false };
}

async function validateQrCode(code: string): Promise<string | null> {
  const placement = await getPlacementByCode(code);
  return placement ? placement.code : null;
}

async function validateUtmCode(code: string): Promise<string | null> {
  if (!isSyntacticallyValidUtmCode(code)) return null;
  const row = await prisma.acquisitionCampaignCode.findUnique({ where: { code } });
  return row?.active ? row.code : null;
}

/**
 * The one DB-touching function in this module. Fire-and-forget — every
 * call site wraps this in try/catch and never awaits it in a way that
 * blocks account creation or trial enrollment, matching the existing
 * signup_completed/trial_started convention.
 *
 * Validates both candidate codes against their respective registries
 * before resolveFirstTouch() ever sees them — both source cookies are
 * httpOnly:false by design (client needs to read gc_src for the existing
 * QR-attribution tracker), which also means they're client-WRITABLE; a
 * tampered or stale cookie value can never reach a User row unvalidated.
 *
 * Write-once: the UPDATE only ever matches a row where acqCapturedAt IS
 * NULL — a single atomic statement, not a read-then-write — so a second
 * call for the same user (there should only ever be one, but this makes
 * a double-call provably harmless rather than relying on call-site
 * discipline) can never overwrite a genuine first capture.
 */
export async function captureAcquisitionAttributionFromRawTouch(
  userId: string,
  raw: RawTouch,
): Promise<void> {
  if (!raw.qrCode && !raw.utmCode) return; // nothing to capture — skip the DB round trip entirely

  const [qrValid, utmValid] = await Promise.all([
    raw.qrCode  ? validateQrCode(raw.qrCode)   : Promise.resolve(null),
    raw.utmCode ? validateUtmCode(raw.utmCode) : Promise.resolve(null),
  ]);

  const resolved = resolveFirstTouch({ qrValid, qrAt: raw.qrAt, utmValid, utmAt: raw.utmAt });
  if (!resolved.ambiguous && resolved.source === null) return; // neither candidate validated — nothing to record

  await prisma.user.updateMany({
    where: { id: userId, acqCapturedAt: null },
    data: {
      acqSource:     resolved.source,
      acqCampaign:   resolved.campaign,
      acqCapturedAt: new Date().toISOString(),
      acqAmbiguous:  resolved.ambiguous,
    },
  });
}

/** Convenience wrapper for the password-signup path, which has a real
 *  `Cookie` request header available. OTP (no `req` in that provider's
 *  authorize signature) and Google (read via next/headers — see
 *  lib/auth.ts) call captureAcquisitionAttributionFromRawTouch() directly
 *  with their own raw values instead. */
export async function captureAcquisitionAttribution(
  userId: string,
  cookieHeader: string | null | undefined,
): Promise<void> {
  return captureAcquisitionAttributionFromRawTouch(userId, rawTouchFromCookieHeader(cookieHeader));
}
