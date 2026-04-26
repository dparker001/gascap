/**
 * GasCap™ — GA4 Data API client
 * Uses a Google Cloud service account (GOOGLE_SERVICE_ACCOUNT_KEY) to
 * query the GA4 property (GA4_PROPERTY_ID) server-side.
 *
 * All functions are server-only — never imported by client components.
 */

import { BetaAnalyticsDataClient } from '@google-analytics/data';

// ── Auth ──────────────────────────────────────────────────────────────────────

function getClient(): BetaAnalyticsDataClient {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not set');
  const credentials = JSON.parse(raw);
  return new BetaAnalyticsDataClient({ credentials });
}

function propertyId(): string {
  const id = process.env.GA4_PROPERTY_ID;
  if (!id) throw new Error('GA4_PROPERTY_ID not set');
  return `properties/${id}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DailyStat {
  date:     string; // "Apr 22"
  sessions: number;
  users:    number;
}

export interface TrafficSource {
  source:   string;
  medium:   string;
  sessions: number;
}

export interface TopEvent {
  name:  string;
  count: number;
}

export interface TopPage {
  path:     string;
  views:    number;
  avgSecs:  number;
}

export interface AnalyticsSummary {
  totalSessions:  number;
  totalUsers:     number;
  newUsers:       number;
  calcEvents:     number;
  signupEvents:   number;
  activeUsers:    number; // realtime
  daily:          DailyStat[];
  sources:        TrafficSource[];
  topEvents:      TopEvent[];
  topPages:       TopPage[];
  periodDays:     number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function metricVal(row: { metricValues?: { value?: string }[] }, idx: number): number {
  return parseInt(row.metricValues?.[idx]?.value ?? '0', 10);
}
function dimVal(row: { dimensionValues?: { value?: string }[] }, idx: number): string {
  return row.dimensionValues?.[idx]?.value ?? '';
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function fetchAnalyticsSummary(days = 30): Promise<AnalyticsSummary> {
  const client   = getClient();
  const property = propertyId();
  const dateRange = { startDate: `${days}daysAgo`, endDate: 'today' };

  // Run all queries in parallel
  const [summaryRes, dailyRes, sourcesRes, eventsRes, pagesRes, realtimeRes] =
    await Promise.all([

      // 1. Overall totals
      client.runReport({
        property,
        dateRanges: [dateRange],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'newUsers' },
        ],
      }),

      // 2. Daily sessions + users
      client.runReport({
        property,
        dateRanges: [dateRange],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
        orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
      }),

      // 3. Traffic sources
      client.runReport({
        property,
        dateRanges: [dateRange],
        dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 8,
      }),

      // 4. Top events
      client.runReport({
        property,
        dateRanges: [dateRange],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: 10,
      }),

      // 5. Top pages
      client.runReport({
        property,
        dateRanges: [dateRange],
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'averageSessionDuration' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 8,
      }),

      // 6. Realtime active users
      client.runRealtimeReport({
        property,
        metrics: [{ name: 'activeUsers' }],
      }),

    ]);

  // Parse totals
  const summaryRow   = summaryRes[0].rows?.[0];
  const totalSessions = summaryRow ? metricVal(summaryRow, 0) : 0;
  const totalUsers    = summaryRow ? metricVal(summaryRow, 1) : 0;
  const newUsers      = summaryRow ? metricVal(summaryRow, 2) : 0;

  // Parse daily
  const daily: DailyStat[] = (dailyRes[0].rows ?? []).map((row) => {
    const raw  = dimVal(row, 0); // "20260422"
    const d    = new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`);
    const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { date, sessions: metricVal(row, 0), users: metricVal(row, 1) };
  });

  // Parse sources
  const sources: TrafficSource[] = (sourcesRes[0].rows ?? []).map((row) => ({
    source:   dimVal(row, 0),
    medium:   dimVal(row, 1),
    sessions: metricVal(row, 0),
  }));

  // Parse events — extract calculate + signup separately
  const topEvents: TopEvent[] = (eventsRes[0].rows ?? []).map((row) => ({
    name:  dimVal(row, 0),
    count: metricVal(row, 0),
  }));
  const calcEvents   = topEvents.filter(e => e.name === 'calculate').reduce((s, e) => s + e.count, 0);
  const signupEvents = topEvents.filter(e => e.name === 'sign_up').reduce((s, e) => s + e.count, 0);

  // Parse pages
  const topPages: TopPage[] = (pagesRes[0].rows ?? []).map((row) => ({
    path:    dimVal(row, 0),
    views:   metricVal(row, 0),
    avgSecs: Math.round(metricVal(row, 1)),
  }));

  // Realtime
  const activeUsers = parseInt(realtimeRes[0].rows?.[0]?.metricValues?.[0]?.value ?? '0', 10);

  return {
    totalSessions,
    totalUsers,
    newUsers,
    calcEvents,
    signupEvents,
    activeUsers,
    daily,
    sources,
    topEvents,
    topPages,
    periodDays: days,
  };
}
