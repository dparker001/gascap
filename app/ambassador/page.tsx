'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';

interface ReferralSummary {
  referralUrl:   string;
  referralCount: number;
}

const STEPS = [
  {
    n:     '1',
    title: 'Use the app',
    body:  'Log a fill-up, track your MPG, check live prices. The more you use it, the more authentically you can recommend it.',
  },
  {
    n:     '2',
    title: 'Share your link',
    body:  'Grab your personal referral link from Settings → Refer & Earn and share it with friends, family, coworkers, or followers.',
  },
  {
    n:     '3',
    title: 'Earn as they pay',
    body:  'Every person who signs up with your link and subscribes to a paid GasCap™ plan counts as a paying referral. Free trial sign-ups that never pay don\'t count. Credits are issued within 24 hours of your referral\'s first payment — once you cross a tier threshold, that milestone is yours permanently.',
  },
];

const TIERS = [
  {
    icon:      '🤝',
    label:     'Supporter',
    threshold: 5,
    entries:   2,
    reward:    '1 free Pro month per paying referral',
    sub:       'Earn 1 free month of Pro for every person you refer who subscribes to a paid plan — up to 6 free months total. Credited automatically within 24 hours of their first payment. No action needed.',
    color:     'bg-slate-50 border-slate-200',
    title:     'text-slate-700',
    badge:     'bg-slate-200 text-slate-600',
  },
  {
    icon:      '🏅',
    label:     'Ambassador',
    threshold: 15,
    entries:   3,
    reward:    'Free GasCap™ Pro (while 5+ referrals are active)',
    sub:       'Reach 15 cumulative paying referrals and your Pro subscription is complimentary — active while you maintain 5 or more currently active paying referrals.',
    color:     'bg-navy-50 border-navy-200',
    title:     'text-navy-700',
    badge:     'bg-navy-700 text-white',
  },
  {
    icon:      '🏆',
    label:     'Elite Ambassador',
    threshold: 30,
    entries:   5,
    reward:    'Pro (while 5+ active) + personal recognition',
    sub:       'Named on the Top Ambassadors list in the app, early access to new features, and a personal thank-you from the GasCap™ team.',
    color:     'bg-amber-50 border-amber-200',
    title:     'text-amber-700',
    badge:     'bg-amber-500 text-white',
  },
];

export default function AmbassadorPage() {
  const { data: session } = useSession();
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

  // Determine current tier from referral count
  const count = referral?.referralCount ?? 0;
  const currentTier = count >= 30 ? 2 : count >= 15 ? 1 : count >= 5 ? 0 : null;

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="bg-navy-700 px-4 pt-12 pb-8 text-center">
        <div className="text-4xl mb-3">🏆</div>
        <h1 className="text-2xl font-black text-white leading-tight">
          GasCap™ Ambassador<br />Program
        </h1>
        <p className="mt-2 text-sm text-white/70 max-w-xs mx-auto leading-relaxed">
          Share your link. Earn Pro. Help drivers save money.
        </p>
        <Link
          href="/"
          className="inline-block mt-5 text-xs font-bold text-white/50 hover:text-white/80 transition-colors"
        >
          ← Back to app
        </Link>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">

        {/* ── Current status (logged-in users) ────────────────────── */}
        {session && referral && count > 0 && currentTier !== null && (
          <div className={`rounded-2xl border px-4 py-4 ${TIERS[currentTier].color}`}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{TIERS[currentTier].icon}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-black ${TIERS[currentTier].title}`}>
                    {TIERS[currentTier].label}
                  </p>
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${TIERS[currentTier].badge}`}>
                    YOUR STATUS
                  </span>
                </div>
                <p className={`text-xs mt-0.5 ${TIERS[currentTier].title} opacity-70`}>
                  {count} paying referral{count !== 1 ? 's' : ''} so far
                  {currentTier === 0 && ` — ${15 - count} more to unlock Ambassador`}
                  {currentTier === 1 && ` — ${30 - count} more to reach Elite`}
                  {currentTier === 2 && ' — Elite Ambassador 🎉'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── How it works ─────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="bg-navy-700 px-4 py-3">
            <p className="text-xs font-black text-white uppercase tracking-wider">How It Works</p>
            <p className="text-[10px] text-white/50">Three steps. Fully automatic.</p>
          </div>
          <div className="p-4 space-y-4">
            {STEPS.map((s) => (
              <div key={s.n} className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-navy-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-[10px] font-black text-white">{s.n}</span>
                </div>
                <div>
                  <p className="text-xs font-black text-slate-700">{s.title}</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed mt-0.5">{s.body}</p>
                </div>
              </div>
            ))}

            {/* Referral link */}
            <div className="pt-1 space-y-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Your referral link</p>
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
                    {copied ? '✓ Copied' : '📋 Copy'}
                  </button>
                </div>
              ) : (
                <Link
                  href="/signin"
                  className="block w-full text-center py-2.5 rounded-xl bg-navy-700 text-white text-xs font-bold hover:bg-navy-800 transition-colors"
                >
                  Sign in to get your link →
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* ── Reward tiers ─────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="bg-navy-700 px-4 py-3">
            <p className="text-xs font-black text-white uppercase tracking-wider">Reward Tiers</p>
            <p className="text-[10px] text-white/50">Based on paying referrals only — credited automatically</p>
          </div>
          <div className="p-4 space-y-3">
            {TIERS.map((t, i) => (
              <div
                key={t.label}
                className={`rounded-xl border px-4 py-3 space-y-1 ${t.color} ${
                  currentTier === i ? 'ring-2 ring-offset-1 ring-navy-400' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>{t.icon}</span>
                    <p className={`text-xs font-black ${t.title}`}>{t.label}</p>
                    {currentTier === i && (
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${t.badge}`}>YOU</span>
                    )}
                  </div>
                  <p className={`text-[10px] font-bold opacity-60 ${t.title}`}>{t.threshold}+ referrals</p>
                </div>
                <p className={`text-xs font-bold ${t.title}`}>{t.reward}</p>
                <p className={`text-[11px] font-bold ${t.title} opacity-80`}>
                  🎟️ {t.entries}× daily drawing entries · always eligible to win
                </p>
                <p className={`text-[11px] opacity-60 ${t.title} leading-relaxed`}>{t.sub}</p>
              </div>
            ))}

            <div className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5 text-[11px] text-slate-500 leading-relaxed space-y-1.5">
              <p>💡 <strong>Only paying conversions count.</strong> Free trial sign-ups that never subscribe don&apos;t qualify — this keeps the program sustainable and fraud-proof.</p>
              <p>⚡ <strong>Credited within 24 hours.</strong> Your referral count updates within 24 hours of your referral&apos;s first payment. Your tier status is based on cumulative all-time referrals and is never revoked.</p>
              <p>🔒 <strong>Up to 6 free months, then Pro while you stay active.</strong> Free month credits are capped at 6 lifetime. Once you hit 15 paying referrals, GasCap™ Pro is complimentary while you maintain 5+ active paying referrals.</p>
            </div>
          </div>
        </div>

        {/* ── CTA ──────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-3 text-center">
          <p className="text-sm font-black text-slate-700">Questions or want to go deeper?</p>
          <p className="text-xs text-slate-500 leading-relaxed">
            If you want to coordinate, run a campaign, or talk about growing your
            referral network — reach out directly.
          </p>
          <a
            href="mailto:admin@gascap.app?subject=Ambassador%20Program&body=Hi%20there%2C%0A%0AI%27m%20interested%20in%20the%20GasCap%20Ambassador%20Program.%0A%0AName%3A%0ACity%3A%0A%0AThanks!"
            className="block w-full py-3 rounded-2xl text-white text-sm font-black hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#FA7109' }}
          >
            Email us → admin@gascap.app
          </a>
          <p className="text-[10px] text-slate-400">We reply within 24 hours.</p>
        </div>

        <p className="text-center text-[11px] text-slate-300 pb-4">
          GasCap™ Ambassador Program · Gas Capacity LLC
        </p>
      </div>
    </div>
  );
}
