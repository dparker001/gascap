'use client';

/**
 * AdminAnalytics — usage charts for the admin panel.
 *
 * Pure client-side: computes everything from the `users` array the admin page
 * already loads. Custom inline SVG (no charting library), matching the rest of
 * the app. Internal-only — not translated, not native-gated.
 */

interface AnalyticsUser {
  createdAt:       string;
  plan:            'free' | 'pro' | 'fleet';
  isProTrial:      boolean;
  stripeInterval:  string | null;
  emailVerified:   boolean;
  lastLoginAt:     string | null;
  loginCount:      number;
  fillupCount:     number;
  streak:          number;
  pushSubscribed?: boolean;
}

const PRO_MONTHLY = 2.99;

const COLORS = {
  free:     '#94A3B8',
  trial:    '#F59E0B',
  paidPro:  '#16A34A',
  lifetime: '#1EB68F',
  fleet:    '#2563EB',
  area:     '#1EB68F',
  bar:      '#1E2D4A',
};

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function AdminAnalytics({ users }: { users: AnalyticsUser[] }) {
  const total = users.length;
  if (total === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-5 text-center text-sm text-slate-400">
        No user data yet — analytics will appear once you have sign-ups.
      </div>
    );
  }

  // ── Aggregates ──────────────────────────────────────────────────────────
  const todayStr   = new Date().toLocaleDateString();
  const free       = users.filter((u) => u.plan === 'free').length;
  const trial      = users.filter((u) => u.plan === 'pro' &&  u.isProTrial).length;
  const paidPro    = users.filter((u) => u.plan === 'pro' && !u.isProTrial && u.stripeInterval !== 'lifetime').length;
  const lifetime   = users.filter((u) => u.plan === 'pro' && !u.isProTrial && u.stripeInterval === 'lifetime').length;
  const fleet      = users.filter((u) => u.plan === 'fleet').length;

  const verified   = users.filter((u) => u.emailVerified).length;
  const activeToday= users.filter((u) => u.lastLoginAt && new Date(u.lastLoginAt).toLocaleDateString() === todayStr).length;
  const hasFillups = users.filter((u) => u.fillupCount > 0).length;
  const hasStreak  = users.filter((u) => u.streak > 0).length;
  const push       = users.filter((u) => u.pushSubscribed).length;

  const mrr = paidPro * PRO_MONTHLY;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  // ── Monthly buckets (last 12 months) ────────────────────────────────────
  const now = new Date();
  const newByMonth: Record<string, number> = {};
  for (const u of users) {
    const d = new Date(u.createdAt);
    if (!isNaN(d.getTime())) {
      const k = monthKey(d);
      newByMonth[k] = (newByMonth[k] ?? 0) + 1;
    }
  }
  const buckets = Array.from({ length: 12 }, (_, idx) => {
    const i = 11 - idx;
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    const endMs = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    const cum = users.filter((u) => {
      const t = new Date(u.createdAt).getTime();
      return !isNaN(t) && t < endMs;
    }).length;
    return {
      key,
      label: MONTHS_SHORT[d.getMonth()],
      isJan: d.getMonth() === 0,
      year:  String(d.getFullYear()).slice(2),
      count: newByMonth[key] ?? 0,
      cum,
    };
  });

  const maxCum = Math.max(1, ...buckets.map((b) => b.cum));
  const maxNew = Math.max(1, ...buckets.map((b) => b.count));

  // ── Cumulative area chart geometry ──────────────────────────────────────
  const W = 600, H = 150, P = { t: 12, r: 12, b: 24, l: 34 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const cx = (i: number) => P.l + (buckets.length === 1 ? iw / 2 : (i / (buckets.length - 1)) * iw);
  const cy = (v: number) => P.t + ih - (v / maxCum) * ih;
  const linePts = buckets.map((b, i) => `${cx(i).toFixed(1)},${cy(b.cum).toFixed(1)}`).join(' ');
  const areaPath =
    `M ${cx(0).toFixed(1)},${(P.t + ih).toFixed(1)} ` +
    buckets.map((b, i) => `L ${cx(i).toFixed(1)},${cy(b.cum).toFixed(1)}`).join(' ') +
    ` L ${cx(buckets.length - 1).toFixed(1)},${(P.t + ih).toFixed(1)} Z`;

  // ── Plan mix segments ───────────────────────────────────────────────────
  const planSegs = [
    { label: 'Free',     value: free,     color: COLORS.free     },
    { label: 'Trial',    value: trial,    color: COLORS.trial    },
    { label: 'Pro paid', value: paidPro,  color: COLORS.paidPro  },
    { label: 'Lifetime', value: lifetime, color: COLORS.lifetime },
    { label: 'Fleet',    value: fleet,    color: COLORS.fleet    },
  ].filter((s) => s.value > 0);

  // ── Engagement bars ─────────────────────────────────────────────────────
  const engagement = [
    { label: 'Active today',  value: activeToday },
    { label: 'Logged a fill-up', value: hasFillups },
    { label: 'On a streak',   value: hasStreak },
    { label: 'Email verified', value: verified },
    { label: 'Push enabled',  value: push },
  ];

  const card = 'bg-white rounded-2xl shadow-sm p-4';
  const headCls = 'text-xs font-black text-navy-700 uppercase tracking-wider mb-3';

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center gap-2 px-1 pt-1">
        <span className="text-base">📊</span>
        <h2 className="text-sm font-black text-navy-700 uppercase tracking-wider">Analytics</h2>
        <div className="flex-1 h-px bg-slate-200" />
      </div>

      {/* Derived KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Est. MRR (Pro)', value: `$${mrr.toFixed(2)}`, color: 'text-green-600' },
          { label: 'Verified',       value: `${pct(verified)}%`,  color: 'text-navy-700'  },
          { label: 'Logged a fill-up', value: `${pct(hasFillups)}%`, color: 'text-amber-700' },
          { label: 'Active today',   value: `${pct(activeToday)}%`, color: 'text-green-600' },
        ].map((k) => (
          <div key={k.label} className="bg-white rounded-xl p-3 text-center shadow-sm">
            <p className={`text-xl font-black ${k.color}`}>{k.value}</p>
            <p className="text-[10px] text-slate-600 uppercase tracking-wider">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Cumulative growth area chart */}
      <div className={card}>
        <p className={headCls}>User growth · last 12 months</p>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {/* y gridlines + labels */}
          {[0, 0.5, 1].map((f) => {
            const v = Math.round(maxCum * f);
            const y = cy(v);
            return (
              <g key={f}>
                <line x1={P.l} y1={y} x2={W - P.r} y2={y} stroke="#E2E8F0" strokeWidth="1" />
                <text x={P.l - 6} y={y + 3} textAnchor="end" fontSize="9" fill="#94A3B8">{v}</text>
              </g>
            );
          })}
          {/* area + line */}
          <path d={areaPath} fill={COLORS.area} fillOpacity="0.15" />
          <polyline points={linePts} fill="none" stroke={COLORS.area} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {/* x labels */}
          {buckets.map((b, i) => (
            <text key={b.key} x={cx(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#94A3B8">
              {b.isJan ? `${b.label} '${b.year}` : b.label}
            </text>
          ))}
        </svg>
      </div>

      {/* New signups per month bar chart */}
      <div className={card}>
        <p className={headCls}>New sign-ups per month</p>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {[0, 0.5, 1].map((f) => {
            const v = Math.round(maxNew * f);
            const y = P.t + ih - (v / maxNew) * ih;
            return (
              <g key={f}>
                <line x1={P.l} y1={y} x2={W - P.r} y2={y} stroke="#E2E8F0" strokeWidth="1" />
                <text x={P.l - 6} y={y + 3} textAnchor="end" fontSize="9" fill="#94A3B8">{v}</text>
              </g>
            );
          })}
          {buckets.map((b, i) => {
            const bw = (iw / buckets.length) * 0.6;
            const x = P.l + (i + 0.5) * (iw / buckets.length) - bw / 2;
            const h = (b.count / maxNew) * ih;
            const y = P.t + ih - h;
            return (
              <g key={b.key}>
                <rect x={x} y={y} width={bw} height={Math.max(0, h)} rx="2" fill={COLORS.bar} />
                {b.count > 0 && <text x={x + bw / 2} y={y - 3} textAnchor="middle" fontSize="8" fill="#64748B">{b.count}</text>}
                <text x={P.l + (i + 0.5) * (iw / buckets.length)} y={H - 8} textAnchor="middle" fontSize="9" fill="#94A3B8">
                  {b.isJan ? `${b.label} '${b.year}` : b.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Plan mix */}
      <div className={card}>
        <p className={headCls}>Plan mix · {total} users</p>
        <div className="flex h-5 w-full rounded-lg overflow-hidden">
          {planSegs.map((s) => (
            <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }} title={`${s.label}: ${s.value}`} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
          {planSegs.map((s) => (
            <div key={s.label} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
              <span className="text-[11px] text-slate-600">
                {s.label} <span className="font-bold text-slate-800">{s.value}</span>
                <span className="text-slate-400"> ({pct(s.value)}%)</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Engagement */}
      <div className={card}>
        <p className={headCls}>Engagement · share of all users</p>
        <div className="space-y-2.5">
          {engagement.map((e) => (
            <div key={e.label} className="flex items-center gap-3">
              <span className="text-[11px] text-slate-600 w-28 flex-shrink-0">{e.label}</span>
              <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct(e.value)}%`, backgroundColor: COLORS.area }} />
              </div>
              <span className="text-[11px] font-bold text-slate-700 w-16 text-right flex-shrink-0">
                {e.value} <span className="text-slate-400 font-normal">({pct(e.value)}%)</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
