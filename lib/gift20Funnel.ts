/**
 * $20 Gift Campaign — per-card funnel (docs/GIFT20_CAMPAIGN_SPEC.md §6).
 *
 * Pure: takes campaign events + the set of userIds that hold Lifetime, and
 * returns one row per GIFTxx card plus a total. Kept free of I/O so the
 * counting rules are testable; the admin route supplies the inputs.
 *
 * Scope note (stated in the dashboard too): only WEB signups are attributed
 * — an app-store install starts with a fresh WebView that never saw the
 * gc_src cookie, so app-only signups/IAP purchases must be reconciled by
 * hand against Don's handout log.
 */
import type { CampaignEvent } from './campaigns';
import { GIFT20_CTAS, GIFT20_SECTIONS, isGift20Code, type Gift20Cta, type Gift20Section } from './gift20';

export interface Gift20FunnelRow {
  code:            string;
  scans:           number;
  /** Distinct gc_ssn sessions with any event — roughly "people" for a single card. */
  sessions:        number;
  pageViews:       number;
  /** Sessions that scrolled each section into view (drop-off = where this falls). */
  reached:         Record<Gift20Section, number>;
  clicks:          Record<Gift20Cta, number>;
  leads:           number;
  signups:         number;
  /** Attributed signups whose account now holds Lifetime (any provider). */
  lifetimeBuyers:  number;
  firstScanAt:     string | null;
  lastEventAt:     string | null;
}

function emptyRow(code: string): Gift20FunnelRow {
  return {
    code,
    scans: 0, sessions: 0, pageViews: 0,
    reached: Object.fromEntries(GIFT20_SECTIONS.map((s) => [s, 0])) as Record<Gift20Section, number>,
    clicks:  Object.fromEntries(GIFT20_CTAS.map((c) => [c, 0])) as Record<Gift20Cta, number>,
    leads: 0, signups: 0, lifetimeBuyers: 0,
    firstScanAt: null, lastEventAt: null,
  };
}

export function buildGift20Funnel(
  events: readonly CampaignEvent[],
  lifetimeUserIds: ReadonlySet<string>,
): { rows: Gift20FunnelRow[]; total: Gift20FunnelRow } {
  const rows     = new Map<string, Gift20FunnelRow>();
  const sessions = new Map<string, Set<string>>();
  const reached  = new Map<string, Set<string>>();   // `${code}|${section}` → sessionIds
  const buyers   = new Map<string, Set<string>>();   // code → userIds (a user counts once)

  for (const e of events) {
    if (!isGift20Code(e.placementCode)) continue;
    const code = e.placementCode.toUpperCase();
    let row = rows.get(code);
    if (!row) { row = emptyRow(code); rows.set(code, row); sessions.set(code, new Set()); buyers.set(code, new Set()); }

    sessions.get(code)!.add(e.sessionId);
    if (!row.lastEventAt || e.ts > row.lastEventAt) row.lastEventAt = e.ts;

    switch (e.type) {
      case 'scan':
        row.scans++;
        if (!row.firstScanAt || e.ts < row.firstScanAt) row.firstScanAt = e.ts;
        break;
      case 'page_view':    row.pageViews++; break;
      case 'lead_capture': row.leads++;     break;
      case 'signup':
        row.signups++;
        if (e.userId && lifetimeUserIds.has(e.userId)) buyers.get(code)!.add(e.userId);
        break;
      case 'cta_click': {
        const cta = e.meta?.cta as Gift20Cta | undefined;
        if (cta && cta in row.clicks) row.clicks[cta]++;
        break;
      }
      case 'section_view': {
        const section = e.meta?.section as Gift20Section | undefined;
        if (section && section in row.reached) {
          const key = `${code}|${section}`;
          if (!reached.has(key)) reached.set(key, new Set());
          reached.get(key)!.add(e.sessionId);
        }
        break;
      }
    }
  }

  for (const [code, row] of Array.from(rows)) {
    row.sessions       = sessions.get(code)!.size;
    row.lifetimeBuyers = buyers.get(code)!.size;
    for (const s of GIFT20_SECTIONS) row.reached[s] = reached.get(`${code}|${s}`)?.size ?? 0;
  }

  const sorted = Array.from(rows.values()).sort((a, b) => a.code.localeCompare(b.code));
  const total  = emptyRow('TOTAL');
  for (const r of sorted) {
    total.scans += r.scans; total.sessions += r.sessions; total.pageViews += r.pageViews;
    total.leads += r.leads; total.signups += r.signups; total.lifetimeBuyers += r.lifetimeBuyers;
    for (const s of GIFT20_SECTIONS) total.reached[s] += r.reached[s];
    for (const c of GIFT20_CTAS)     total.clicks[c]  += r.clicks[c];
    if (r.firstScanAt && (!total.firstScanAt || r.firstScanAt < total.firstScanAt)) total.firstScanAt = r.firstScanAt;
    if (r.lastEventAt && (!total.lastEventAt || r.lastEventAt > total.lastEventAt)) total.lastEventAt = r.lastEventAt;
  }
  return { rows: sorted, total };
}
