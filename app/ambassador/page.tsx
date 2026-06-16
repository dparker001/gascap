'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import StreakRewards         from '@/components/StreakRewards';
import CompAmbassadorTracker from '@/components/CompAmbassadorTracker';

interface ReferralSummary {
  referralUrl:   string;
  referralCount: number;
}

// Structural styling only — all copy lives in t.ambassadorPage (steps/tiers).
const TIER_STYLE = [
  { icon: '🤝', threshold: 5,  entries: 2, color: 'bg-slate-50 border-slate-200', title: 'text-slate-700', badge: 'bg-slate-200 text-slate-600' },
  { icon: '🏅', threshold: 15, entries: 3, color: 'bg-navy-50 border-navy-200',   title: 'text-navy-700',  badge: 'bg-navy-700 text-white'      },
  { icon: '🏆', threshold: 30, entries: 5, color: 'bg-amber-50 border-amber-200', title: 'text-amber-700', badge: 'bg-amber-500 text-white'     },
];

export default function AmbassadorPage() {
  const { data: session } = useSession();
  const { t } = useTranslation();
  const ap = t.ambassadorPage;
  const [referral, setReferral] = useState<ReferralSummary | null>(null);
  const [copied,   setCopied]   = useState(false);

  useEffect(() => {
    if (!session) return;
    fetch('/api/referral')
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((d: ReferralSummary) => setReferral(d))
      .catch(() => {});
  }, [session]);

  function copyLink() {
    if (!referral) return;
    navigator.clipboard.writeText(referral.referralUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // Merge structural style with translated copy
  const tiers = TIER_STYLE.map((s, i) => ({ ...s, ...ap.tiers[i] }));

  // Determine current tier from referral count
  const count = referral?.referralCount ?? 0;
  const currentTier = count >= 30 ? 2 : count >= 15 ? 1 : count >= 5 ? 0 : null;

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="bg-navy-700 px-4 pt-12 pb-8 text-center">
        <div className="text-4xl mb-3">🏆</div>
        <h1 className="text-2xl font-black text-white leading-tight">
          GasCap™ {ap.programName}
        </h1>
        <p className="mt-2 text-sm text-white/70 max-w-xs mx-auto leading-relaxed">
          {ap.tagline}
        </p>
        <Link
          href="/"
          className="inline-block mt-5 text-xs font-bold text-white/50 hover:text-white/80 transition-colors"
        >
          {ap.backToApp}
        </Link>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">

        {/* ── Current status (logged-in users) ────────────────────── */}
        {session && referral && count > 0 && currentTier !== null && (
          <div className={`rounded-2xl border px-4 py-4 ${tiers[currentTier].color}`}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{tiers[currentTier].icon}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-black ${tiers[currentTier].title}`}>
                    {tiers[currentTier].label}
                  </p>
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${tiers[currentTier].badge}`}>
                    {ap.yourStatus}
                  </span>
                </div>
                <p className={`text-xs mt-0.5 ${tiers[currentTier].title} opacity-70`}>
                  {ap.statusReferrals(count)}
                  {currentTier === 0 && ap.statusToAmbassador(15 - count)}
                  {currentTier === 1 && ap.statusToElite(30 - count)}
                  {currentTier === 2 && ap.statusElite}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── How it works ─────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="bg-navy-700 px-4 py-3">
            <p className="text-xs font-black text-white uppercase tracking-wider">{ap.howItWorksTitle}</p>
            <p className="text-[10px] text-white/50">{ap.howItWorksSub}</p>
          </div>
          <div className="p-4 space-y-4">
            {ap.steps.map((s, i) => (
              <div key={i} className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-navy-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-[10px] font-black text-white">{i + 1}</span>
                </div>
                <div>
                  <p className="text-xs font-black text-slate-700">{s.title}</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed mt-0.5">{s.body}</p>
                </div>
              </div>
            ))}

            {/* Referral link */}
            <div className="pt-1 space-y-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{ap.yourLink}</p>
              {session && referral ? (
                <div className="flex gap-1.5">
                  <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 overflow-hidden">
                    <p className="text-[11px] font-mono text-slate-500 truncate">{referral.referralUrl}</p>
                  </div>
                  <button
                    onClick={copyLink}
                    className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                      copied
                        ? 'bg-green-500 text-white'
                        : 'bg-slate-200 text-slate-600 hover:bg-amber-100 hover:text-amber-700'
                    }`}
                  >
                    {copied ? ap.copied : ap.copy}
                  </button>
                </div>
              ) : (
                <Link
                  href="/signin"
                  className="block w-full text-center py-2.5 rounded-xl bg-navy-700 text-white text-xs font-bold hover:bg-navy-800 transition-colors"
                >
                  {ap.signInForLink}
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* ── Reward tiers ─────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="bg-navy-700 px-4 py-3">
            <p className="text-xs font-black text-white uppercase tracking-wider">{ap.rewardTiersTitle}</p>
            <p className="text-[10px] text-white/50">{ap.rewardTiersSub}</p>
          </div>
          <div className="p-4 space-y-3">
            {tiers.map((tier, i) => (
              <div
                key={tier.label}
                className={`rounded-xl border px-4 py-3 space-y-1 ${tier.color} ${
                  currentTier === i ? 'ring-2 ring-offset-1 ring-navy-400' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>{tier.icon}</span>
                    <p className={`text-xs font-black ${tier.title}`}>{tier.label}</p>
                    {currentTier === i && (
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${tier.badge}`}>{ap.youBadge}</span>
                    )}
                  </div>
                  <p className={`text-[10px] font-bold opacity-60 ${tier.title}`}>{ap.thresholdReferrals(tier.threshold)}</p>
                </div>
                <p className={`text-xs font-bold ${tier.title}`}>{tier.reward}</p>
                <p className={`text-[11px] font-bold ${tier.title} opacity-80`}>
                  {ap.dailyEntries(tier.entries)}
                </p>
                <p className={`text-[11px] opacity-60 ${tier.title} leading-relaxed`}>{tier.sub}</p>
              </div>
            ))}

            <div className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5 text-[11px] text-slate-500 leading-relaxed space-y-1.5">
              <p>💡 <strong>{ap.finePrint1Bold}</strong> {ap.finePrint1Rest}</p>
              <p>⚡ <strong>{ap.finePrint2Bold}</strong> {ap.finePrint2Rest}</p>
              <p>🔒 <strong>{ap.finePrint3Bold}</strong> {ap.finePrint3Rest}</p>
            </div>
          </div>
        </div>

        {/* ── Live rewards (streak + comp tracker — moved here from the Tools share tab) ── */}
        <StreakRewards />
        <CompAmbassadorTracker />

        {/* ── CTA ──────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-3 text-center">
          <p className="text-sm font-black text-slate-700">{ap.ctaTitle}</p>
          <p className="text-xs text-slate-500 leading-relaxed">
            {ap.ctaBody}
          </p>
          <a
            href="mailto:admin@gascap.app?subject=Ambassador%20Program&body=Hi%20there%2C%0A%0AI%27m%20interested%20in%20the%20GasCap%20Ambassador%20Program.%0A%0AName%3A%0ACity%3A%0A%0AThanks!"
            className="block w-full py-3 rounded-2xl text-white text-sm font-black hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#FA7109' }}
          >
            {ap.ctaButton}
          </a>
          <p className="text-[10px] text-slate-400">{ap.ctaReply}</p>
        </div>

        <p className="text-center text-[11px] text-slate-400 pb-4">
          {ap.footer}
        </p>
      </div>
    </div>
  );
}
