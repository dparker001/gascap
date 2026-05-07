/**
 * Campaign analytics store — "Know Before You Go" pilot
 *
 * Tracks the full QR → scan → visit → usage → conversion funnel for the
 * gas-station placard marketing campaign.
 *
 * Placements: persisted in PostgreSQL via Prisma (Railway-safe, survives deploys).
 * Events:     persisted in campaign-events.json (append-only, lower stakes).
 */
import fs   from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';

// ── Paths (events only) ────────────────────────────────────────────────────
const DATA_DIR    = path.join(process.cwd(), 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'campaign-events.json');

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
  campaign:        string;          // e.g. "Know Before You Go"
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

// ── DB → interface mapping ────────────────────────────────────────────────

type DbPlacement = {
  id: string; code: string; campaign: string; station: string;
  address: string | null; city: string | null; contactName: string | null;
  contactEmail: string | null; contactPhone: string | null; placement: string;
  headlineVariant: string; landingPath: string; notes: string | null;
  createdAt: string; active: boolean; featured: boolean;
};

function dbToPlacement(row: DbPlacement): Placement {
  return {
    id:              row.id,
    code:            row.code,
    campaign:        row.campaign,
    station:         row.station,
    address:         row.address      ?? undefined,
    city:            row.city         ?? undefined,
    contactName:     row.contactName  ?? undefined,
    contactEmail:    row.contactEmail ?? undefined,
    contactPhone:    row.contactPhone ?? undefined,
    placement:       row.placement,
    headlineVariant: row.headlineVariant,
    landingPath:     row.landingPath,
    notes:           row.notes ?? undefined,
    createdAt:       row.createdAt,
    active:          row.active,
    featured:        row.featured,
  };
}

// ── Low-level IO (events only) ─────────────────────────────────────────────

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
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
function generateCode(city: string | undefined, placement: string, existing: { code: string }[]): string {
  const cityPart = (city ?? 'LOC').slice(0, 3).toUpperCase().padEnd(3, 'X');
  const placementLetter = (placement[0] ?? 'G').toUpperCase();

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

  let suffix = 0;
  while (existing.some((p) => p.code === code)) {
    suffix++;
    code = `${cityPart}${numStr}${placementLetter}${suffix}`;
  }
  return code;
}

// ── Placement CRUD (Prisma) ───────────────────────────────────────────────

export async function listPlacements(): Promise<Placement[]> {
  const rows = await prisma.campaignPlacement.findMany({ orderBy: { createdAt: 'asc' } });
  return rows.map(dbToPlacement);
}

export async function getPlacementByCode(code: string): Promise<Placement | undefined> {
  const row = await prisma.campaignPlacement.findFirst({
    where: { code: { equals: code, mode: 'insensitive' } },
  });
  return row ? dbToPlacement(row) : undefined;
}

export async function createPlacement(input: Omit<Placement, 'id' | 'code' | 'createdAt' | 'active'> & {
  code?: string;
  active?: boolean;
}): Promise<Placement> {
  const existingCodes = await prisma.campaignPlacement.findMany({ select: { code: true } });
  const code = input.code?.trim() || generateCode(input.city, input.placement, existingCodes);

  if (existingCodes.some((r) => r.code.toUpperCase() === code.toUpperCase())) {
    throw new Error(`Placement code "${code}" already exists`);
  }

  const row = await prisma.campaignPlacement.create({
    data: {
      id:              uuid('plc'),
      code,
      campaign:        input.campaign        || 'Know Before You Go',
      station:         input.station         || '',
      address:         input.address         || null,
      city:            input.city            || null,
      contactName:     input.contactName     || null,
      contactEmail:    input.contactEmail    || null,
      contactPhone:    input.contactPhone    || null,
      placement:       input.placement,
      headlineVariant: input.headlineVariant || 'A-KnowBefore',
      landingPath:     input.landingPath     || '/',
      notes:           input.notes           || null,
      createdAt:       new Date().toISOString(),
      active:          input.active          ?? true,
      featured:        input.featured        ?? false,
    },
  });
  return dbToPlacement(row);
}

export async function updatePlacement(id: string, patch: Partial<Omit<Placement, 'id' | 'createdAt'>>): Promise<Placement | null> {
  const data: Record<string, unknown> = {};
  if (patch.code            !== undefined) data.code            = patch.code;
  if (patch.campaign        !== undefined) data.campaign        = patch.campaign;
  if (patch.station         !== undefined) data.station         = patch.station;
  if (patch.address         !== undefined) data.address         = patch.address         || null;
  if (patch.city            !== undefined) data.city            = patch.city            || null;
  if (patch.contactName     !== undefined) data.contactName     = patch.contactName     || null;
  if (patch.contactEmail    !== undefined) data.contactEmail    = patch.contactEmail    || null;
  if (patch.contactPhone    !== undefined) data.contactPhone    = patch.contactPhone    || null;
  if (patch.placement       !== undefined) data.placement       = patch.placement;
  if (patch.headlineVariant !== undefined) data.headlineVariant = patch.headlineVariant;
  if (patch.landingPath     !== undefined) data.landingPath     = patch.landingPath;
  if (patch.notes           !== undefined) data.notes           = patch.notes           || null;
  if (patch.active          !== undefined) data.active          = patch.active;
  if (patch.featured        !== undefined) data.featured        = patch.featured;

  try {
    const row = await prisma.campaignPlacement.update({ where: { id }, data });
    return dbToPlacement(row);
  } catch { return null; }
}

export async function deletePlacement(id: string): Promise<boolean> {
  try {
    await prisma.campaignPlacement.delete({ where: { id } });
    return true;
  } catch { return false; }
}

// ── Event logging (JSON file) ─────────────────────────────────────────────

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

export function clearEventsForPlacement(code: string): number {
  const all = readEvents();
  const keep = all.filter((e) => e.placementCode.toUpperCase() !== code.toUpperCase());
  writeEvents(keep);
  return all.length - keep.length;
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

export async function getStatsForPlacement(code: string): Promise<PlacementStats> {
  const events = readEvents().filter((e) => e.placementCode.toUpperCase() === code.toUpperCase());
  return computeStats(events, code);
}

export async function getStatsForAllPlacements(): Promise<PlacementStats[]> {
  const placements = await listPlacements();
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

export async function groupStatsBy(dimension: 'station' | 'placement' | 'headlineVariant' | 'city'): Promise<GroupedStats[]> {
  const placements = await listPlacements();
  const events     = readEvents();

  const codeToGroup = new Map<string, { key: string; label: string }>();
  for (const p of placements) {
    let key = '';
    switch (dimension) {
      case 'station':         key = p.station;             break;
      case 'placement':       key = p.placement;           break;
      case 'headlineVariant': key = p.headlineVariant;     break;
      case 'city':            key = (p.city ?? 'Unknown'); break;
    }
    codeToGroup.set(p.code.toUpperCase(), { key, label: key });
  }

  const eventsByGroup = new Map<string, CampaignEvent[]>();
  for (const e of events) {
    const g = codeToGroup.get(e.placementCode.toUpperCase());
    if (!g) continue;
    if (!eventsByGroup.has(g.key)) eventsByGroup.set(g.key, []);
    eventsByGroup.get(g.key)!.push(e);
  }

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

export async function getOverview(): Promise<CampaignOverview> {
  const placements   = await listPlacements();
  const events       = readEvents();
  const totals       = computeStats(events, '__ALL__');
  const perPlacement = await getStatsForAllPlacements();

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
