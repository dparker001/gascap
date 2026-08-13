import type { Metadata } from 'next';
import Link from 'next/link';
import { GlowIcon, type GlowIconName } from '@/components/marketing/GlowIcon';

export const metadata: Metadata = {
  title: 'Features — GasCap™',
  description:
    'Everything GasCap™ does: fuel calculator, live gas prices, MPG tracking, rewards, rental car mode, gig driver tools, and more — see the full feature list.',
  openGraph: {
    title: 'Every GasCap™ Feature, In One Place',
    description: 'Fuel calculator, Find Gas, fill-up tracking, streak rewards, referral program, rental & gig driver modes, AI advisor, and a free Lifetime vacation getaway.',
  },
};

interface Feature {
  icon: GlowIconName;
  title: string;
  body: string;
  link?: { href: string; label: string };
}

interface Category {
  eyebrow: string;
  heading: string;
  features: Feature[];
}

const CATEGORIES: Category[] = [
  {
    eyebrow: 'At the Pump',
    heading: 'Never overpay for gas again',
    features: [
      {
        icon: 'pump',
        title: 'Fuel Calculator',
        body: 'Set your current fuel level with a drag of the gauge and GasCap™ tells you the exact gallons to pump — no more guessing, no more overfilling.',
      },
      {
        icon: 'pin',
        title: 'Find Gas + Live Prices',
        body: 'See real-time prices at nearby stations, tap to apply instantly, and report prices yourself to earn giveaway entries when Google\'s data is stale.',
      },
      {
        icon: 'bell',
        title: 'Gas Price Alerts',
        body: 'Get notified when prices near you drop, so you always know the right time to fill up.',
      },
    ],
  },
  {
    eyebrow: 'Track & Analyze',
    heading: 'Know your numbers',
    features: [
      {
        icon: 'clipboard',
        title: 'Fill-Up Logging & History',
        body: 'Log gallons, price, odometer, and receipts. History is grouped by month with year filters, and exports to CSV or PDF.',
      },
      {
        icon: 'chart',
        title: 'MPG & Spend Charts',
        body: 'Track MPG over time, total spend, gallons, and price per gallon — with a savings dashboard comparing you to the EIA national average.',
      },
      {
        icon: 'car',
        title: 'Vehicle Garage + VIN Decode',
        body: 'Add a vehicle by VIN (photo scan or manual entry) to auto-fill tank size, engine specs, and estimated fuel type.',
      },
      {
        icon: 'map',
        title: 'Trip Cost Estimator',
        body: 'Enter a route and get an exact fuel cost estimate using real Google Maps data, plus a station comparison tool to see which of two stations actually saves you more.',
      },
    ],
  },
  {
    eyebrow: 'Earn Rewards',
    heading: 'Get paid to use GasCap™',
    features: [
      {
        icon: 'calendar',
        title: 'Streak Rewards',
        body: 'Open GasCap™ daily to build a streak. Milestones at 30/60/120/365 days earn free Pro months (or bonus entries for Lifetime members) plus real rewards — Dining Vouchers and Hotel Savings Cards, sent automatically by email.',
      },
      {
        icon: 'gift',
        title: 'Monthly Gas Card Giveaway',
        body: '$50 drawn every month. Pro users earn entries from daily usage, streaks, plan level, and referrals.',
        link: { href: '/rewards', label: 'See all rewards →' },
      },
      {
        icon: 'handshake',
        title: 'Ambassador Referral Program',
        body: 'Refer friends and climb tiers — Supporter, Ambassador, and Elite tiers earn Dining Vouchers and Hotel Savings Cards worth up to $700, sent the moment you hit each milestone.',
        link: { href: '/rewards', label: 'See all rewards →' },
      },
      {
        icon: 'palm',
        title: 'Free Vacation Getaway (Lifetime)',
        body: 'Purchase Lifetime Pro and get a complimentary resort hotel getaway — choose from destinations across the U.S. and worldwide, including Las Vegas, Miami, Cancún, and Bali.',
        link: { href: '/getaway', label: 'See getaway details →' },
      },
    ],
  },
  {
    eyebrow: 'Built for Every Driver',
    heading: 'One app, however you drive',
    features: [
      {
        icon: 'car',
        title: 'Rental Car Return Mode',
        body: 'Look up your rental by Year/Make/Model or VIN for an exact tank size, enter the rental company\'s rate, and see exactly how much you save by fueling up yourself before drop-off.',
        link: { href: '/rental', label: 'Learn more →' },
      },
      {
        icon: 'briefcase',
        title: 'Gig Driver Mode',
        body: 'Log fuel and mileage by platform (Uber, Lyft, DoorDash, and more), see weekly cost-per-mile summaries, and export a year-end CSV with your IRS mileage deduction already calculated.',
      },
      {
        icon: 'bolt',
        title: 'EV Charge Calculator',
        body: 'Driving electric or a plug-in hybrid? Estimate charging cost and time based on your battery, rate, and target charge level.',
      },
    ],
  },
  {
    eyebrow: 'Ask Anything',
    heading: 'Your AI fuel advisor',
    features: [
      {
        icon: 'bot',
        title: 'AI Fuel Advisor',
        body: 'Ask questions about trip costs, MPG drops, maintenance timing, or anything fuel-related — it knows your vehicle and fill-up history and gives specific, practical answers.',
      },
    ],
  },
];

export default function FeaturesPage() {
  return (
    <main className="min-h-screen bg-slate-50">

      {/* Hero */}
      <section className="bg-slate-900 text-white px-4 pt-14 pb-12 text-center overflow-hidden relative">
        <div
          className="absolute -top-16 -left-10 w-56 h-56 rounded-full opacity-20 blur-3xl pointer-events-none"
          style={{ background: '#FF8300' }}
          aria-hidden="true"
        />
        <div
          className="absolute -bottom-20 -right-10 w-56 h-56 rounded-full opacity-20 blur-3xl pointer-events-none"
          style={{ background: '#1EB68F' }}
          aria-hidden="true"
        />
        <div className="max-w-lg mx-auto relative">
          <div className="flex justify-center mb-4">
            <GlowIcon name="pump" size={72} />
          </div>
          <p className="text-[11px] font-bold tracking-widest text-brand-orange uppercase mb-3">
            GasCap™ Features
          </p>
          <h1 className="text-3xl font-black leading-tight mb-3">
            Everything GasCap™{' '}
            <span className="text-brand-orange">does for you.</span>
          </h1>
          <p className="text-slate-300 text-sm leading-relaxed mb-6 max-w-sm mx-auto">
            One app to stop overpaying at the pump, track your real fuel costs, and get rewarded
            for driving smarter — however you drive.
          </p>
          <Link
            href="/signup"
            className="inline-block bg-brand-orange text-white font-black text-sm
                       px-8 py-3.5 rounded-xl hover:bg-orange-600 active:scale-[0.98] transition-all"
          >
            Try GasCap™ Free
          </Link>
          <p className="text-slate-500 text-[11px] mt-3">Free to start — no credit card required</p>
        </div>
      </section>

      {/* Feature categories */}
      {CATEGORIES.map((cat, i) => (
        <section
          key={cat.heading}
          className={`px-4 py-10 ${i % 2 === 1 ? 'bg-white border-y border-slate-100' : ''}`}
        >
          <div className="max-w-lg mx-auto">
            <p className="text-[10px] font-bold tracking-widest text-brand-orange uppercase text-center mb-1.5">
              {cat.eyebrow}
            </p>
            <h2 className="text-xl font-black text-slate-800 text-center mb-6">{cat.heading}</h2>
            <div className="space-y-4">
              {cat.features.map((f) => (
                <div
                  key={f.title}
                  className="flex items-start gap-3.5 bg-slate-50 border border-slate-200 rounded-2xl p-4"
                >
                  <GlowIcon name={f.icon} size={44} className="mt-0.5" />
                  <div>
                    <p className="font-black text-slate-800 text-sm mb-1">{f.title}</p>
                    <p className="text-[12px] text-slate-500 leading-relaxed">{f.body}</p>
                    {f.link && (
                      <Link
                        href={f.link.href}
                        className="inline-block mt-1.5 text-[11px] font-bold text-brand-orange hover:underline"
                      >
                        {f.link.label}
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}

      {/* CTA */}
      <section className="px-4 py-12 text-center max-w-sm mx-auto">
        <h2 className="text-xl font-black text-slate-800 mb-2">Ready to stop guessing at the pump?</h2>
        <p className="text-sm text-slate-500 mb-6">
          GasCap™ is free to start. See your plan options or jump right in.
        </p>
        <div className="flex flex-col gap-3 items-center">
          <Link
            href="/signup"
            className="inline-block bg-brand-orange text-white font-black text-sm
                       px-8 py-3.5 rounded-xl hover:bg-orange-600 active:scale-[0.98] transition-all"
          >
            Try GasCap™ Free
          </Link>
          <Link href="/#pricing" className="text-[12px] text-slate-500 hover:text-slate-700 font-semibold">
            See all plans →
          </Link>
        </div>
        <p className="mt-4 text-[11px] text-slate-400">
          Already have GasCap™?{' '}
          <Link href="/signin" className="text-brand-orange font-bold hover:underline">Sign in</Link>
        </p>
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
