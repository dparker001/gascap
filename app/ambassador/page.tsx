'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';

interface ReferralSummary {
  referralUrl: string;
  referralCount: number;
}

// ── Incentive tiers ───────────────────────────────────────────────────────────
const TIERS = [
  { label: 'Starter',  range: '1–5 placements',  reward: '$25 gas card / mo',  color: 'bg-slate-50   border-slate-200  text-slate-700' },
  { label: 'Builder',  range: '6–15 placements', reward: '$50 gas card / mo',  color: 'bg-teal-50    border-teal-200   text-teal-700'  },
  { label: 'Elite',    range: '16+ placements',  reward: '$100 gas card / mo', color: 'bg-amber-50   border-amber-200  text-amber-700' },
];

// ── Steps ─────────────────────────────────────────────────────────────────────
const USER_STEPS = [
  { n: '1', title: 'Use the app',        body: 'Log a fill-up, track your MPG, check live prices. The more you use it, the more authentically you can recommend it.' },
  { n: '2', title: 'Share your link',    body: 'Grab your personal referral link from Settings → Refer & Earn and send it to friends, family, or customers.' },
  { n: '3', title: 'Earn rewards',       body: 'Every friend who signs up and pays earns you a free month of Pro. Track progress in Settings.' },
];

const PARTNER_STEPS = [
  { n: '1', title: 'Express interest',   body: "Email us at admin@gascap.app with your name, business type, and city. We'll send a free placard kit." },
  { n: '2', title: 'Place a display',    body: 'Put the QR code display at your counter, pump, or waiting room. Takes 30 seconds.' },
  { n: '3', title: 'Earn gas cards',     body: 'Every active placement earns monthly gas card rewards. More placements = higher tier = bigger card.' },
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

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="bg-navy-700 px-4 pt-12 pb-8 text-center">
        <div className="text-4xl mb-3">🏆</div>
        <h1 className="text-2xl font-black text-white leading-tight">
          GasCap™ Ambassador<br />Program
        </h1>
        <p className="mt-2 text-sm text-white/70 max-w-xs mx-auto leading-relaxed">
          Spread the word. Earn gas cards. Drive the movement.
        </p>
        <Link
          href="/"
          className="inline-block mt-5 text-xs font-bold text-white/50 hover:text-white/80 transition-colors"
        >
          ← Back to app
        </Link>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">

        {/* ── Track 1: User Referral ───────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="bg-navy-700 px-4 py-3 flex items-center gap-2">
            <span className="text-base">🔗</span>
            <div>
              <p className="text-xs font-black text-white uppercase tracking-wider">Track 1 — User Referral</p>
              <p className="text-[10px] text-white/50">For GasCap users who share with their network</p>
            </div>
          </div>
          <div className="p-4 space-y-4">
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 text-xs text-amber-800 leading-relaxed">
              💡 Every friend who signs up <strong>and pays</strong> earns you{' '}
              <strong>1 free month of Pro</strong>. No limit on referrals.
              Giveaway entries also stack with each referral.
            </div>

            {/* Steps */}
            <div className="space-y-3">
              {USER_STEPS.map((s) => (
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
            </div>

            {/* Referral link — shown if logged in */}
            {session && referral ? (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Your referral link</p>
                <div className="flex gap-1.5">
                  <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 overflow-hidden">
                    <p className="text-[11px] font-mono text-slate-500 truncate">{referral.referralUrl}</p>
                  </div>
                  <button
                    onClick={copyLink}
                    className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                      copied ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-600 hover:bg-amber-100 hover:text-amber-700'
                    }`}
                  >
                    {copied ? '✓' : '📋'}
                  </button>
                </div>
                {referral.referralCount > 0 && (
                  <p className="text-[11px] text-green-700 font-semibold">
                    ✅ You've already referred {referral.referralCount} user{referral.referralCount !== 1 ? 's' : ''}!
                  </p>
                )}
              </div>
            ) : !session ? (
              <Link
                href="/auth/signin"
                className="block w-full text-center py-2.5 rounded-xl bg-navy-700 text-white text-xs font-bold hover:bg-navy-800 transition-colors"
              >
                Sign in to get your referral link →
              </Link>
            ) : null}
          </div>
        </div>

        {/* ── Track 2: Business Partner ────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="bg-navy-700 px-4 py-3 flex items-center gap-2">
            <span className="text-base">🤝</span>
            <div>
              <p className="text-xs font-black text-white uppercase tracking-wider">Track 2 — Business Partner</p>
              <p className="text-[10px] text-white/50">For mechanics, gas stations, oil shops &amp; more</p>
            </div>
          </div>
          <div className="p-4 space-y-4">
            <p className="text-xs text-slate-600 leading-relaxed">
              Place a free QR code display at your business. Customers scan it, download GasCap™,
              and you earn monthly gas card rewards based on how many active placements you maintain.
              No cost, no obligation — remove it any time.
            </p>

            {/* Steps */}
            <div className="space-y-3">
              {PARTNER_STEPS.map((s) => (
                <div key={s.n} className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-brand-teal flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-[10px] font-black text-white">{s.n}</span>
                  </div>
                  <div>
                    <p className="text-xs font-black text-slate-700">{s.title}</p>
                    <p className="text-[11px] text-slate-500 leading-relaxed mt-0.5">{s.body}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Location types */}
            <div className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Great for</p>
              <div className="flex flex-wrap gap-1.5">
                {['⛽ Gas Stations', '🔧 Mechanic Shops', '🛞 Tire Shops', '🚿 Car Washes', '🛢️ Oil Change Shops', '🚗 Used Car Lots', '🚚 Fleet Companies'].map((loc) => (
                  <span key={loc} className="text-[11px] bg-white border border-slate-200 rounded-lg px-2 py-0.5 text-slate-600 font-medium">
                    {loc}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Reward Tiers ─────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="bg-navy-700 px-4 py-3">
            <p className="text-xs font-black text-white uppercase tracking-wider">Monthly Reward Tiers</p>
            <p className="text-[10px] text-white/50">Business Partner track · Paid via gas gift card</p>
          </div>
          <div className="p-4 space-y-2">
            {TIERS.map((t) => (
              <div key={t.label} className={`flex items-center justify-between rounded-xl border px-4 py-3 ${t.color}`}>
                <div>
                  <p className="text-xs font-black">{t.label}</p>
                  <p className="text-[10px] opacity-70">{t.range}</p>
                </div>
                <p className="text-xs font-bold">{t.reward}</p>
              </div>
            ))}
            <p className="text-[10px] text-slate-400 leading-relaxed pt-1">
              + Free GasCap™ Pro for life while active · $25 bonus when a location hits 10 sign-ups/mo
            </p>
          </div>
        </div>

        {/* ── CTA ──────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-3 text-center">
          <p className="text-sm font-black text-slate-700">Ready to join?</p>
          <p className="text-xs text-slate-500 leading-relaxed">
            Email us with your name, city, and whether you're interested in the
            User Referral or Business Partner track. We'll send you everything you need.
          </p>
          <a
            href="mailto:admin@gascap.app?subject=Ambassador%20Program%20Interest&body=Hi%20Don%2C%0A%0AI%27m%20interested%20in%20the%20GasCap%20Ambassador%20Program.%0A%0AName%3A%0ACity%3A%0ATrack%20interested%20in%20(User%20Referral%20%2F%20Business%20Partner)%3A%0A%0AThanks!"
            className="block w-full py-3 rounded-2xl bg-brand-orange text-white text-sm font-black hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#FA7109' }}
          >
            Email to Apply → admin@gascap.app
          </a>
          <p className="text-[10px] text-slate-400">
            Questions? We typically reply within 24 hours.
          </p>
        </div>

        <p className="text-center text-[11px] text-slate-300 pb-4">
          GasCap™ Ambassador Program · Gas Capacity LLC
        </p>
      </div>
    </div>
  );
}
