'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

interface NudgeData {
  plan:               string;
  isTrialUser:        boolean;
  trialDaysLeft:      number;
  daysSinceCreation:  number;
  fillupCount:        number;
  daysSinceLastFillup: number | null;
  hasOdometer:        boolean;
  hasMpgData:         boolean;
}

// ── Nudge definitions (priority order — first match wins) ────────────────────

interface NudgeDef {
  id:         string;
  dismissTtl: number | 'permanent'; // days to suppress after dismiss, or forever
  match:      (d: NudgeData) => boolean;
  icon:       string;
  headline:   string;
  body:       (d: NudgeData) => string;
  cta?:       { label: string; href: string };
  color:      {
    bg:     string;
    border: string;
    title:  string;
    body:   string;
    btn:    string;
    dismiss:string;
  };
}

const NUDGES: NudgeDef[] = [
  // ── 1. Mid-trial check-in (6–14 days) — TrialExpiryBanner covers ≤5 days
  {
    id:         'trial_midpoint',
    dismissTtl: 4,
    match:      (d) => d.isTrialUser && d.trialDaysLeft >= 6 && d.trialDaysLeft <= 14,
    icon:       '📅',
    headline:   'Making the most of your Pro trial?',
    body:       (d) => `${d.trialDaysLeft} days left. Log fill-ups, add your odometer, and check the Charts tab — that's where Pro really shines.`,
    cta:        { label: 'See what Pro includes →', href: '/upgrade' },
    color: {
      bg:      'bg-amber-50',
      border:  'border-amber-200',
      title:   'text-amber-700',
      body:    'text-amber-600',
      btn:     'bg-amber-500 hover:bg-amber-400 text-white',
      dismiss: 'text-amber-300 hover:text-amber-500',
    },
  },

  // ── 2. Trial — nudge to log fill-ups if none yet ───────────────────────
  {
    id:         'trial_no_fillups',
    dismissTtl: 3,
    match:      (d) => d.isTrialUser && d.daysSinceCreation >= 3 && d.fillupCount === 0,
    icon:       '⛽',
    headline:   'Log your first fill-up',
    body:       () => `You're on Pro trial but haven't logged a fill-up yet. Log one now and GasCap starts tracking your real cost-per-mile.`,
    cta:        { label: 'Log a fill-up →', href: '/#log' },
    color: {
      bg:      'bg-blue-50',
      border:  'border-blue-200',
      title:   'text-blue-700',
      body:    'text-blue-600',
      btn:     'bg-blue-600 hover:bg-blue-500 text-white',
      dismiss: 'text-blue-300 hover:text-blue-500',
    },
  },

  // ── 4. Gone quiet — no fill-up in 10+ days ─────────────────────────────
  {
    id:         'inactive_fillup',
    dismissTtl: 3,
    match:      (d) => d.isTrialUser && d.fillupCount > 0 && (d.daysSinceLastFillup ?? 0) >= 10,
    icon:       '📊',
    headline:   'Your data is getting stale',
    body:       (d) => `It's been ${d.daysSinceLastFillup} days since your last fill-up. Log your next one to keep your spending and MPG trends accurate.`,
    cta:        { label: 'Log a fill-up →', href: '/#log' },
    color: {
      bg:      'bg-slate-50',
      border:  'border-slate-200',
      title:   'text-slate-700',
      body:    'text-slate-500',
      btn:     'bg-navy-700 hover:bg-navy-800 text-white',
      dismiss: 'text-slate-300 hover:text-slate-500',
    },
  },

  // ── 5. Has fill-ups but no odometer = MPG locked ───────────────────────
  {
    id:         'unlock_mpg',
    dismissTtl: 'permanent',
    match:      (d) => d.fillupCount >= 2 && !d.hasOdometer,
    icon:       '🛣️',
    headline:   'Unlock MPG tracking',
    body:       () => `You have fill-ups logged but no odometer readings. Add a mileage reading next time you fill up and your MPG trend chart unlocks automatically.`,
    color: {
      bg:      'bg-green-50',
      border:  'border-green-200',
      title:   'text-green-700',
      body:    'text-green-600',
      btn:     'bg-green-600 hover:bg-green-500 text-white',
      dismiss: 'text-green-300 hover:text-green-500',
    },
  },
];

// ── Dismissal helpers ────────────────────────────────────────────────────────

function dismissKey(id: string) { return `gascap_nudge_${id}`; }

function isDismissed(id: string): boolean {
  if (typeof window === 'undefined') return false;
  const raw = localStorage.getItem(dismissKey(id));
  if (!raw) return false;
  if (raw === 'permanent') return true;
  const until = new Date(raw);
  return until > new Date();
}

function dismiss(id: string, ttl: number | 'permanent') {
  if (ttl === 'permanent') {
    localStorage.setItem(dismissKey(id), 'permanent');
  } else {
    const until = new Date(Date.now() + ttl * 86_400_000);
    localStorage.setItem(dismissKey(id), until.toISOString());
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export default function EngagementNudge() {
  const { data: session, status } = useSession();
  const [nudgeData,   setNudgeData]   = useState<NudgeData | null>(null);
  const [dismissed,   setDismissed]   = useState(false);
  const [activeNudge, setActiveNudge] = useState<NudgeDef | null>(null);

  useEffect(() => {
    if (!session) return;
    fetch('/api/nudge', { credentials: 'include' })
      .then((r) => r.ok ? r.json() as Promise<NudgeData> : Promise.reject())
      .then((d) => setNudgeData(d))
      .catch(() => {});
  }, [session]);

  // Re-evaluate which nudge to show whenever data or dismissal state changes
  useEffect(() => {
    if (!nudgeData) return;
    const match = NUDGES.find((n) => n.match(nudgeData) && !isDismissed(n.id));
    setActiveNudge(match ?? null);
  }, [nudgeData, dismissed]);

  if (status === 'loading' || !session || !activeNudge || dismissed) return null;

  const d   = nudgeData!;
  const c   = activeNudge.color;

  function handleDismiss() {
    dismiss(activeNudge!.id, activeNudge!.dismissTtl);
    setDismissed(true);
    // Re-check for next nudge after a tick
    setTimeout(() => setDismissed(false), 50);
  }

  return (
    <div className={`mx-4 mb-3 rounded-2xl border ${c.bg} ${c.border} px-4 py-3 shadow-sm`}>
      <div className="flex items-start gap-3">
        {/* Icon */}
        <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">{activeNudge.icon}</span>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-black ${c.title} leading-tight`}>{activeNudge.headline}</p>
          <p className={`text-xs ${c.body} mt-0.5 leading-relaxed`}>{activeNudge.body(d)}</p>

          {activeNudge.cta && (
            <a
              href={activeNudge.cta.href}
              className={`inline-block mt-2 px-4 py-1.5 rounded-xl text-xs font-bold transition-colors ${c.btn}`}
            >
              {activeNudge.cta.label}
            </a>
          )}
        </div>

        {/* Dismiss */}
        <button
          onClick={handleDismiss}
          className={`flex-shrink-0 mt-0.5 ${c.dismiss} transition-colors`}
          aria-label="Dismiss"
        >
          <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  );
}
