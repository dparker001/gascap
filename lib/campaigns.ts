/**
 * Campaign analytics store — "Know Before You Fill Up" pilot
 *
 * Tracks the full QR → scan → visit → usage → conversion funnel for the
 * gas-station placard marketing campaign.
 *
 * Persistence: JSON file (same pattern as users.ts, vehicles.ts, feedback.ts).
 * For production scale, swap read/write to a real DB later.
 */
import fs   from 'fs';
import path from 'path';

// ── Paths ────────────────────────────────────────────────────────────────
const DATA_DIR       = path.join(process.cwd(), 'data');
const PLACEMENTS_FILE = path.join(DATA_DIR, 'campaign-placements.json');
const EVENTS_FILE     = path.join(DATA_DIR, 'campaign-events.json');

// ── Types ────────────────────────────────────────────────────────────────

/**
 * A single physical placard instance at a station.
 * Each gets its own unique `code` so scans can be attributed precisely.
 *
 * Naming convention: GC-<city>-<stationNum>-<placement>
 *   e.g.  GC-ORL-001-Counter
 */
export interface Placement {
  id:              string;          // internal uuid
  code:            string;          // short code in the QR URL (e.g. "ORL001C")
  campaign:        string;          // e.g. "Know Before You Fill Up"
  station:         string;          // station name
  address?:        string;
  city?:           string;
  contactName?:    string;
  contactEmail?:   string;
  contactPhone?:   string;
  placement:       string;          // 'counter' | 'window' | 'register' | 'pump' | 'flyer'
  headlineVariant: string;          // 'A-KnowBefore' | 'B-DontGuess' | 'C-StretchBudget'
  landingPath:     string;          // '/' or '/campaign/<code>'
  notes?:          string;
  createdAt:       string;
  active:          boolean;
  featured?:       boolean;   // shown in-app as a Partner Station near the user
}

// ── Milestone helpers ────────────────────────────────────────────────────

export interface MilestoneTier {
  tier:    'none' | 'partner' | 'gold' | 'premium';
  label:   string;
  emoji:   string;
  nextAt:  number | null;   // signups needed for next tier (null = max tier)
}

export function getMilestoneTier(signups: number): MilestoneTier {
  if (signups >= 250) return { tier: 'premium', label: 'Premium Partner', emoji: '🏆', nextAt: null  };
  if (signups >= 100) return { tier: 'gold',    label: 'Gold Partner',    emoji: '⭐', nextAt: 250   };
  if (signups >= 25)  return { tier: 'partner', label: 'Partner',         emoji: '🤝', nextAt: 100   };
  return               { tier: 'none',    label: 'Candidate',        emoji: '📋', nextAt: 25    };
}

/**
 * Every trackable user interaction in the campaign funnel.
 */
export type CampaignEventType =
  | 'scan'            // QR code scanned (redirect endpoint hit)
  | 'page_view'       // landing page loaded after redirect
  | 'calc_start'      // user began using the calculator
  | 'calc_complete'   // calculator returned a result
  | 'save_to_phone'   // PWA install prompt shown/accepted, or manual save
  | 'lead_capture'    // email/phone captured
  | 'signup'          // full account created
  | 'return_visit';   // same attribution cookie came back in a new session

export interface CampaignEvent {
  id:          string;
  placementCode: string;            // the QR code this event is attributed to
  type:        CampaignEventType;
  ts:          string;              // ISO timestamp
  sessionId:   string;              // opaque ID to de-dupe / count unique users
  userId?:     string;              // set once user signs up
  path?:       string;              // page path where event fired
  userAgent?:  string;
  referrer?:   string;
  meta?:       Record<string, unknown>;
}

// ── Low-level IO ─────────────────────────────────────────────────────────

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readPlacements(): Placement[] {
  try {
    if (!fs.existsSync(PLACEMENTS_FILE)) return [];
    return JSON.parse(fs.readFileSync(PLACEMENTS_FILE, 'utf8')) as Placement[];
  } catch { return []; }
}

function writePlacements(rows: Placement[]) {
  ensureDir();
  fs.writeFileSync(PLACEMENTS_FILE, JSON.stringify(rows, null, 2));
}

function readEvents(): CampaignEvent[] {
  try {
    if (!fs.existsSync(EVENTS_FILE)) return [];
    return JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8')) as CampaignEvent[];
  } catch { return []; }
}

function writeEvents(rows: CampaignEvent[]) {
  ensureDir();
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(rows, null, 2));
}

// ── ID helpers ───────────────────────────────────────────────────────────

function uuid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Generate a short, human-readable, URL-safe placement code.
 * Format: <city3><num3><placement1> — e.g. ORL001C
 */
function generateCode(city: string | undefined, placement: string, existing: Placement[]): string {
  const cityPart = (city ?? 'LOC').slice(0, 3).toUpperCase().padEnd(3, 'X');
  const placementLetter = (placement[0] ?? 'G').toUpperCase();

  // Find the next sequential number for this city
  const prefix = cityPart;
  const usedNums = new Set<number>();
  for (const p of existing) {
    if (p.code.startsWith(prefix)) {
      const numPart = p.code.slice(3, 6);
      const n = parseInt(numPart, 10);
      if (!isNaN(n)) usedNums.add(n);
    }
  }
  let next = 1;
  while (usedNums.has(next)) next++;

  const numStr = next.toString().padStart(3, '0');
  let code = `${cityPart}${numStr}${placementLetter}`;

  // Safety: ensure uniqueness even if two placements share city+placement at same station
  let suffix = 0;
  while (existing.some((p) => p.code === code)) {
    suffix++;
    code = `${cityPart}${numStr}${placementLetter}${suffix}`;
  }
  return code;
}

// ── Placement CRUD ───────────────────────────────────────────────────────

export function listPlacements(): Placement[] {
  return readPlacements();
}

export function getPlacementByCode(code: string): Placement | undefined {
  return readPlacements().find((p) => p.code.toUpperCase() === code.toUpperCase());
}

export function createPlacement(input: Omit<Placement, 'id' | 'code' | 'createdAt' | 'active'> & {
  code?: string;
  active?: boolean;
}): Placement {
  const all = readPlacements();
  const code = input.code?.trim() || generateCode(input.city, input.placement, all);

  if (all.some((p) => p.code.toUpperCase() === code.toUpperCase())) {
    throw new Error(`Placement code "${code}" already exists`);
  }

  const row: Placement = {
    id:              uuid('plc'),
    code,
    campaign:        input.campaign || 'Know Before You Fill Up',
    station:         input.station,
    address:         input.address,
    city:            input.city,
    contactName:     input.contactName,
    contactEmail:    input.contactEmail,
    contactPhone:    input.contactPhone,
    placement:       input.placement,
    headlineVariant: input.headlineVariant || 'A-KnowBefore',
    landingPath:     input.landingPath || '/',
    notes:           input.notes,
    createdAt:       new Date().toISOString(),
    active:          input.active ?? true,
  };
  all.push(row);
  writePlacements(all);
  return row;
}

export function updatePlacement(id: string, patch: Partial<Omit<Placement, 'id' | 'createdAt'>>): Placement | null {
  const all = readPlacements();
  const idx = all.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...patch };
  writePlacements(all);
  return all[idx];
}

export function deletePlacement(id: string): boolean {
  const all = readPlacements();
  const next = all.filter((p) => p.id !== id);
  if (next.length === all.length) return false;
  writePlacements(next);
  return true;
}

// ── Event logging ────────────────────────────────────────────────────────

export function logEvent(ev: Omit<CampaignEvent, 'id' | 'ts'>): CampaignEvent {
  const all = readEvents();
  const row: CampaignEvent = {
    ...ev,
    id: uuid('evt'),
    ts: new Date().toISOString(),
  };
  all.push(row);
  writeEvents(all);
  return row;
}

/**
 * Wipe the events log. Used by the admin dashboard "Reset events" button
 * to clear test/smoke-test data before a real campaign launch. Placements
 * are left intact so their QR URLs stay valid.
 */
export function clearAllEvents(): number {
  const n = readEvents().length;
  writeEvents([]);
  return n;
}

export function listEvents(filter?: { placementCode?: string; type?: CampaignEventType; since?: string }): CampaignEvent[] {
  let rows = readEvents();
  if (filter?.placementCode) {
    rows = rows.filter((e) => e.placementCode.toUpperCase() === filter.placementCode!.toUpperCase());
  }
  if (filter?.type) {
    rows = rows.filter((e) => e.type === filter.type);
  }
  if (filter?.since) {
    const sinceMs = Date.parse(filter.since);
    if (!isNaN(sinceMs)) rows = rows.filter((e) => Date.parse(e.ts) >= sinceMs);
  }
  return rows;
}

// ── Aggregations ─────────────────────────────────────────────────────────

export interface PlacementStats {
  code:           string;
  scans:          number;
  uniqueScans:    number;
  pageViews:      number;
  calcStarts:     number;
  calcCompletes:  number;
  saveToPhone:    number;
  leadCaptures:   number;
  signups:        number;
  returnVisits:   number;
  // Funnel conversion rates (0..1)
  scanToVisit:    number;
  visitToCalc:    number;
  calcToComplete: number;
  visitToSignup:  number;
  lastEventAt?:   string;
  // Bilingual QR pilot — EN vs ES split read from event.meta.locale.
  // scansEn + scansEs should equal scans (unknown-locale events from before
  // the bilingual rollout are counted as EN). signupsEn + signupsEs likewise.
  // Used by the admin dashboard to A/B test Spanish placards against English
  // ones at the same station.
  scansEn:        number;
  scansEs:        number;
  signupsEn:      number;
  signupsEs:      number;
}

function emptyStats(code: string): PlacementStats {
  return {
    code,
    scans: 0,
    uniqueScans: 0,
    pageViews: 0,
    calcStarts: 0,
    calcCompletes: 0,
    saveToPhone: 0,
    leadCaptures: 0,
    signups: 0,
    returnVisits: 0,
    scanToVisit: 0,
    visitToCalc: 0,
    calcToComplete: 0,
    visitToSignup: 0,
    scansEn: 0,
    scansEs: 0,
    signupsEn: 0,
    signupsEs: 0,
  };
}

/** Read the locale recorded in event.meta, defaulting to 'en' for backfill. */
function eventLocale(e: CampaignEvent): 'en' | 'es' {
  const raw = (e.meta?.locale as string | undefined)?.toLowerCase();
  return raw === 'es' ? 'es' : 'en';
}

function computeStats(events: CampaignEvent[], code: string): PlacementStats {
  const s = emptyStats(code);
  const uniqueScanSessions = new Set<string>();

  for (const e of events) {
    switch (e.type) {
      case 'scan': {
        s.scans++;
        uniqueScanSessions.add(e.sessionId);
        if (eventLocale(e) === 'es') s.scansEs++; else s.scansEn++;
        break;
      }
      case 'page_view':       s.pageViews++;     break;
      case 'calc_start':      s.calcStarts++;    break;
      case 'calc_complete':   s.calcCompletes++; break;
      case 'save_to_phone':   s.saveToPhone++;   break;
      case 'lead_capture':    s.leadCaptures++;  break;
      case 'signup': {
        s.signups++;
        if (eventLocale(e) === 'es') s.signupsEs++; else s.signupsEn++;
        break;
      }
      case 'return_visit':    s.returnVisits++;  break;
    }
    if (!s.lastEventAt || e.ts > s.lastEventAt) s.lastEventAt = e.ts;
  }

  s.uniqueScans    = uniqueScanSessions.size;
  s.scanToVisit    = s.scans      > 0 ? s.pageViews     / s.scans      : 0;
  s.visitToCalc    = s.pageViews  > 0 ? s.calcStarts    / s.pageViews  : 0;
  s.calcToComplete = s.calcStarts > 0 ? s.calcCompletes / s.calcStarts : 0;
  s.visitToSignup  = s.pageViews  > 0 ? s.signups       / s.pageViews  : 0;

  return s;
}

export function getStatsForPlacement(code: string): PlacementStats {
  const events = readEvents().filter((e) => e.placementCode.toUpperCase() === code.toUpperCase());
  return computeStats(events, code);
}

export function getStatsForAllPlacements(): PlacementStats[] {
  const placements = readPlacements();
  const events     = readEvents();
  const byCode = new Map<string, CampaignEvent[]>();

  for (const e of events) {
    const key = e.placementCode.toUpperCase();
    if (!byCode.has(key)) byCode.set(key, []);
    byCode.get(key)!.push(e);
  }

  return placements.map((p) => computeStats(byCode.get(p.code.toUpperCase()) ?? [], p.code));
}

export interface GroupedStats {
  key:    string;
  label:  string;
  stats:  PlacementStats;
  placementCount: number;
}

/** Aggregate stats across placements grouped by a dimension. */
export function groupStatsBy(dimension: 'station' | 'placement' | 'headlineVariant' | 'city'): GroupedStats[] {
  const placements = readPlacements();
  const events     = readEvents();

  // code -> group key
  const codeToGroup = new Map<string, { key: string; label: string }>();
  for (const p of placements) {
    let key = '';
    let label = '';
    switch (dimension) {
      case 'station':         key = p.station;                    label = p.station;                    break;
      case 'placement':       key = p.placement;                  label = p.placement;                  break;
      case 'headlineVariant': key = p.headlineVariant;            label = p.headlineVariant;            break;
      case 'city':            key = (p.city ?? 'Unknown');        label = (p.city ?? 'Unknown');        break;
    }
    codeToGroup.set(p.code.toUpperCase(), { key, label });
  }

  // Group events
  const eventsByGroup = new Map<string, CampaignEvent[]>();
  for (const e of events) {
    const g = codeToGroup.get(e.placementCode.toUpperCase());
    if (!g) continue;
    if (!eventsByGroup.has(g.key)) eventsByGroup.set(g.key, []);
    eventsByGroup.get(g.key)!.push(e);
  }

  // Count placements per group
  const placementCountByGroup = new Map<string, number>();
  for (const p of placements) {
    const g = codeToGroup.get(p.code.toUpperCase())!;
    placementCountByGroup.set(g.key, (placementCountByGroup.get(g.key) ?? 0) + 1);
  }

  const results: GroupedStats[] = [];
  for (const [key, groupEvents] of eventsByGroup.entries()) {
    results.push({
      key,
      label: key,
      stats: computeStats(groupEvents, key),
      placementCount: placementCountByGroup.get(key) ?? 0,
    });
  }

  // Also include groups with zero events
  for (const [key, count] of placementCountByGroup.entries()) {
    if (!eventsByGroup.has(key)) {
      results.push({ key, label: key, stats: emptyStats(key), placementCount: count });
    }
  }

  return results.sort((a, b) => b.stats.scans - a.stats.scans);
}

export interface CampaignOverview {
  totalPlacements: number;
  activePlacements: number;
  totals:          PlacementStats;
  topPlacements:   { code: string; station: string; scans: number; signups: number }[];
}

export function getOverview(): CampaignOverview {
  const placements = readPlacements();
  const events     = readEvents();
  const totals     = computeStats(events, '__ALL__');

  const perPlacement = getStatsForAllPlacements();
  const top = [...perPlacement]
    .sort((a, b) => b.scans - a.scans)
    .slice(0, 5)
    .map((s) => {
      const p = placements.find((pp) => pp.code.toUpperCase() === s.code.toUpperCase());
      return { code: s.code, station: p?.station ?? s.code, scans: s.scans, signups: s.signups };
    });

  return {
    totalPlacements:  placements.length,
    activePlacements: placements.filter((p) => p.active).length,
    totals,
    topPlacements: top,
  };
}

// ── Time-series (for charts) ─────────────────────────────────────────────

export interface DailyBucket {
  date: string; // YYYY-MM-DD
  scans: number;
  pageViews: number;
  signups: number;
}

export function getDailyBuckets(days: number = 30, placementCode?: string): DailyBucket[] {
  const events = readEvents().filter((e) => {
    if (!placementCode) return true;
    return e.placementCode.toUpperCase() === placementCode.toUpperCase();
  });

  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);

  const buckets = new Map<string, DailyBucket>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, { date: key, scans: 0, pageViews: 0, signups: 0 });
  }

  for (const e of events) {
    const key = e.ts.slice(0, 10);
    const b = buckets.get(key);
    if (!b) continue;
    if (e.type === 'scan')      b.scans++;
    if (e.type === 'page_view') b.pageViews++;
    if (e.type === 'signup')    b.signups++;
  }

  return Array.from(buckets.values());
}
