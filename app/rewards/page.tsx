import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Earn Rewards — Dining Vouchers & Hotel Savings Cards | GasCap™',
  description:
    'Earn real Dining Vouchers and Hotel Savings Cards just for using GasCap™ every day or referring friends. Free, automatic, no purchase necessary.',
  openGraph: {
    title: 'Earn Real Rewards with GasCap™',
    description:
      'Daily streaks and referrals earn you real Dining Vouchers and Hotel Savings Cards — sent automatically by email, no purchase necessary.',
  },
};

const STREAK_MILESTONES = [
  { days: 30, emoji: '⭐', reward: '$25 Dining Voucher' },
  { days: 60, emoji: '🏆', reward: '$50 Dining Voucher' },
  { days: 120, emoji: '💎', reward: '$100 Hotel Savings Card' },
  { days: 365, emoji: '👑', reward: '$500 Hotel Savings Card' },
];

const AMBASSADOR_TIERS = [
  {
    name: 'Supporter',
    threshold: '5+ paying referrals',
    perks: [
      '1 free Pro month per referral, up to 6 free months',
      '2× daily giveaway entries',
      '$50 Dining Voucher',
    ],
  },
  {
    name: 'Ambassador',
    threshold: '15+ paying referrals',
    perks: [
      'Free Pro for life',
      '3× daily giveaway entries',
      '$100 Hotel Savings Card',
    ],
  },
  {
    name: 'Elite Ambassador',
    threshold: '30+ paying referrals',
    perks: [
      'Free Pro for life',
      '5× daily giveaway entries',
      'Top Ambassadors recognition',
      '$500 Hotel Savings Card',
    ],
  },
];

export default function RewardsPage() {
  return (
    <main className="min-h-screen bg-slate-50">

      {/* Hero */}
      <section className="bg-slate-900 text-white px-4 pt-14 pb-12 text-center">
        <div className="max-w-lg mx-auto">
          <p className="text-[11px] font-bold tracking-widest text-brand-orange uppercase mb-3">
            GasCap™ Rewards
          </p>
          <h1 className="text-3xl font-black leading-tight mb-3">
            Earn real rewards{' '}
            <span className="text-brand-orange">just for using GasCap™.</span>
          </h1>
          <p className="text-slate-300 text-sm leading-relaxed mb-6 max-w-sm mx-auto">
            Keep a daily streak or refer friends and earn real{' '}
            <strong className="text-white">Dining Vouchers</strong> and{' '}
            <strong className="text-white">Hotel Savings Cards</strong> — up to $500 in value.
          </p>
          <Link
            href="/signup"
            className="inline-block bg-brand-orange text-white font-black text-sm
                       px-8 py-3.5 rounded-xl hover:bg-orange-600 active:scale-[0.98] transition-all"
          >
            Start Earning Rewards
          </Link>
          <p className="text-slate-500 text-[11px] mt-3">Free — no purchase necessary — sent automatically</p>
        </div>
      </section>

      {/* Streak Rewards */}
      <section className="px-4 py-10 max-w-lg mx-auto">
        <h2 className="text-xl font-black text-slate-800 text-center mb-2">Streak Rewards</h2>
        <p className="text-[12px] text-slate-500 text-center mb-6 max-w-sm mx-auto">
          Open GasCap™ every day to build your streak. Miss a day and it resets to zero — so keep
          showing up.
        </p>
        <div className="space-y-3">
          {STREAK_MILESTONES.map((m) => (
            <div
              key={m.days}
              className="flex items-center gap-4 bg-white border border-slate-100 shadow-sm
                         rounded-2xl px-4 py-3.5"
            >
              <span className="flex-shrink-0 w-11 h-11 rounded-full bg-navy-700
                               flex items-center justify-center text-xl">
                {m.emoji}
              </span>
              <div className="flex-1">
                <p className="font-black text-slate-800 text-sm">
                  {m.days === 365 ? '1-Year Streak' : `${m.days}-Day Streak`}
                </p>
                <p className="text-[12px] text-slate-500 mt-0.5">{m.reward}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 text-center mt-5 max-w-sm mx-auto">
          Monthly and Annual Pro members also bank a free Pro month at every milestone. Lifetime
          members earn bonus giveaway entries instead.
        </p>
      </section>

      {/* Ambassador Program */}
      <section className="bg-white border-y border-slate-100 px-4 py-10">
        <div className="max-w-lg mx-auto">
          <h2 className="text-xl font-black text-slate-800 text-center mb-2">Ambassador Program</h2>
          <p className="text-[12px] text-slate-500 text-center mb-6 max-w-sm mx-auto">
            Refer friends and earn real rewards. A referral only counts once the person you referred
            upgrades to a paid GasCap™ plan.
          </p>
          <div className="space-y-4">
            {AMBASSADOR_TIERS.map((tier) => (
              <div
                key={tier.name}
                className="bg-slate-50 border border-slate-200 rounded-2xl p-4"
              >
                <div className="flex items-baseline justify-between mb-2">
                  <p className="font-black text-slate-800 text-sm">{tier.name}</p>
                  <p className="text-[11px] font-bold text-brand-orange uppercase tracking-wide">
                    {tier.threshold}
                  </p>
                </div>
                <div className="space-y-1">
                  {tier.perks.map((p) => (
                    <div key={p} className="flex items-start gap-2">
                      <span className="text-brand-orange font-black text-sm mt-0.5">✓</span>
                      <p className="text-[12px] text-slate-600 leading-snug">{p}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How rewards are delivered */}
      <section className="px-4 py-10 max-w-lg mx-auto text-center">
        <h2 className="text-xl font-black text-slate-800 mb-3">How rewards are delivered</h2>
        <p className="text-sm text-slate-500 leading-relaxed max-w-sm mx-auto">
          Every Dining Voucher and Hotel Savings Card is a real reward, fulfilled automatically by
          Parker Select Rewards and sent straight to your inbox within about 24 hours of hitting a
          milestone. No purchase, no credit card, and no extra steps required to earn them.
        </p>
      </section>

      {/* CTA */}
      <section className="bg-slate-800 text-white px-4 py-12 text-center">
        <div className="max-w-sm mx-auto">
          <h2 className="text-xl font-black mb-2">Ready to start earning?</h2>
          <p className="text-slate-300 text-sm mb-6">
            Sign up free and your first streak reward is just 30 days away.
          </p>
          <Link
            href="/signup"
            className="inline-block bg-brand-orange text-white font-black text-sm
                       px-8 py-3.5 rounded-xl hover:bg-orange-600 active:scale-[0.98] transition-all"
          >
            Start Earning Rewards
          </Link>
          <p className="mt-4 text-[11px] text-slate-400">
            Already have GasCap™?{' '}
            <Link href="/signin" className="text-brand-orange font-bold hover:underline">Sign in</Link>
          </p>
        </div>
      </section>

      {/* Footer nav */}
      <div className="bg-slate-900 px-4 py-6 text-center">
        <Link href="/" className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
          ← Back to GasCap™
        </Link>
      </div>
    </main>
  );
}
