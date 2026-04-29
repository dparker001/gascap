'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

type AmbassadorTier = 'supporter' | 'ambassador' | 'elite' | null;
interface Thresholds { SUPPORTER: number; AMBASSADOR: number; ELITE: number }

interface ReferralData {
  referralCount:        number;
  ambassadorTier:       AmbassadorTier;
  entryMultiplier:      number;
  ambassadorProForLife: boolean;
  thresholds:           Thresholds;
  activeCredits:        number;
}

interface TierDef {
  key:      AmbassadorTier;
  icon:     string;
  label:    string;
  perks:    string[];
  color:    string;
  bg:       string;
  border:   string;
  headBg:   string;
  headText: string;
}

const TIERS: TierDef[] = [
  {
    key:      'supporter',
    icon:     '⭐',
    label:    'Supporter',
    perks:    ['2× daily drawing entries', 'Always eligible to win', 'Free Pro month per paid referral'],
    color:    'text-amber-700',
    bg:       'bg-amber-50',
    border:   'border-amber-200',
    headBg:   'bg-amber-100',
    headText: 'text-amber-700',
  },
  {
    key:      'ambassador',
    icon:     '🏆',
    label:    'Ambassador',
    perks:    ['3× daily drawing entries', 'Always eligible to win', 'Pro for Life — free forever'],
    color:    'text-teal-700',
    bg:       'bg-teal-50',
    border:   'border-teal-200',
    headBg:   'bg-teal-100',
    headText: 'text-teal-700',
  },
  {
    key:      'elite',
    icon:     '👑',
    label:    'Elite',
    perks:    ['5× daily drawing entries', 'Always eligible to win', 'Elite recognition & top status'],
    color:    'text-purple-700',
    bg:       'bg-purple-50',
    border:   'border-purple-200',
    headBg:   'bg-purple-100',
    headText: 'text-purple-700',
  },
];

export default function ReferralLeaderboard() {
  const { data: session } = useSession();
  const [data,    setData]    = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    fetch('/api/referral', { credentials: 'include' })
      .then((r) => r.json())
      .then((d: ReferralData) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [session]);

  if (!session || loading || !data) return null;

  const count = data.referralCount ?? 0;
  const { SUPPORTER, AMBASSADOR, ELITE } = data.thresholds;

  // Resolve progress bar toward next tier
  let progressPct = 0;
  let toNext      = 0;
  let nextLabel   = '';
  const atMax     = count >= ELITE;

  if (!atMax) {
    if (count >= AMBASSADOR) {
      progressPct = Math.round(((count - AMBASSADOR) / (ELITE      - AMBASSADOR)) * 100);
      toNext      = ELITE - count;
      nextLabel   = 'Elite';
    } else if (count >= SUPPORTER) {
      progressPct = Math.round(((count - SUPPORTER)  / (AMBASSADOR - SUPPORTER))  * 100);
      toNext      = AMBASSADOR - count;
      nextLabel   = 'Ambassador';
    } else {
      progressPct = Math.round((count / SUPPORTER) * 100);
      toNext      = SUPPORTER - count;
      nextLabel   = 'Supporter';
    }
  }

  return (
    <div className="rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Navy header strip */}
      <div className="flex items-center justify-between py-2.5 px-4 bg-navy-700">
        <div className="flex items-center gap-2">
          <span className="text-sm" aria-hidden="true">🌟</span>
          <p className="text-xs font-black text-white uppercase tracking-wider">Ambassador Program</p>
        </div>
        <span className="text-xs font-black text-amber-300 bg-white/10 px-2 py-0.5 rounded-full">
          {count} paying referral{count !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="bg-white p-4 space-y-4">

        {/* Progress bar */}
        {atMax ? (
          <p className="text-xs font-black text-purple-700 text-center bg-purple-50 rounded-xl py-2 px-3">
            👑 Elite Ambassador — you&apos;ve reached the highest tier!
          </p>
        ) : (
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <p className="text-[11px] text-slate-500">
                <span className="font-bold text-slate-700">{toNext} more</span> paying referral{toNext !== 1 ? 's' : ''} to unlock {nextLabel}
              </p>
              <p className="text-[11px] text-slate-400">{progressPct}%</p>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Tier cards */}
        <div className="space-y-2">
          {TIERS.map((tier) => {
            const threshold = tier.key === 'supporter' ? SUPPORTER : tier.key === 'ambassador' ? AMBASSADOR : ELITE;
            const earned    = count >= threshold;
            const isCurrent = data.ambassadorTier === tier.key;

            return (
              <div
                key={tier.key}
                className={[
                  'rounded-xl border overflow-hidden transition-all',
                  earned ? `${tier.bg} ${tier.border}` : 'bg-slate-50 border-slate-100 opacity-50',
                ].join(' ')}
              >
                {/* Tier header row */}
                <div className={[
                  'flex items-center justify-between px-3 py-2',
                  earned ? tier.headBg : 'bg-slate-100',
                ].join(' ')}>
                  <div className="flex items-center gap-2">
                    <span className="text-base">{tier.icon}</span>
                    <p className={`text-xs font-black ${earned ? tier.headText : 'text-slate-400'}`}>
                      {tier.label}
                      {isCurrent && (
                        <span className="ml-1.5 text-[9px] font-bold bg-white/70 px-1.5 py-0.5 rounded-full">
                          Current
                        </span>
                      )}
                      {tier.key === 'ambassador' && earned && data.ambassadorProForLife && (
                        <span className="ml-1.5 text-[9px] font-bold bg-white/70 px-1.5 py-0.5 rounded-full">
                          Pro for Life ✓
                        </span>
                      )}
                    </p>
                  </div>
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                    earned ? 'bg-white/60 text-slate-600' : 'bg-slate-200 text-slate-400'
                  }`}>
                    {threshold}+ referrals
                  </span>
                </div>

                {/* Perks list */}
                <ul className="px-3 py-2 space-y-0.5">
                  {tier.perks.map((perk) => (
                    <li
                      key={perk}
                      className={`text-[10px] flex items-center gap-1.5 ${earned ? tier.color : 'text-slate-400'}`}
                    >
                      <span className="text-[8px] flex-shrink-0">✦</span>
                      {perk}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {/* Banked credits callout */}
        {data.activeCredits > 0 && (
          <p className="text-[11px] text-center text-green-600 font-semibold bg-green-50 rounded-xl py-2 px-3">
            🎁 You have {data.activeCredits} free month{data.activeCredits !== 1 ? 's' : ''} banked — redeem in billing settings
          </p>
        )}

        <p className="text-[9px] text-slate-300 text-center leading-relaxed">
          Tier status based on cumulative paying referrals · tallied at month-end
        </p>
      </div>
    </div>
  );
}
