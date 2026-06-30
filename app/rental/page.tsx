import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Rental Car Return Mode — GasCap™',
  description:
    'Avoid surprise refueling fees at rental car drop-off. GasCap™ calculates exactly how many gallons you need to return your rental — and finds the cheapest nearby gas station.',
  openGraph: {
    title: 'Return Your Rental with Confidence — GasCap™',
    description: 'Calculate exactly how much gas you need before returning your rental car. Find the cheapest nearby gas and avoid per-gallon fees up to $12/gal.',
  },
};

const CHECKLIST = [
  { icon: '⛽', text: 'Refill vehicle to required level' },
  { icon: '📸', text: 'Take a photo of the fuel gauge' },
  { icon: '🚗', text: 'Take exterior vehicle photos' },
  { icon: '🧹', text: 'Remove personal belongings' },
  { icon: '📍', text: 'Confirm return address' },
  { icon: '🧾', text: 'Save receipt or pump photo' },
];

const STEPS = [
  { n: '1', title: 'Enter your rental details', body: 'Vehicle class, current fuel level, and required return level.' },
  { n: '2', title: 'See exactly what you need', body: 'GasCap™ calculates gallons and estimates total refill cost.' },
  { n: '3', title: 'Find cheap nearby gas', body: 'Live prices from stations near you — tap to navigate.' },
  { n: '4', title: 'Return with confidence', body: 'No surprise fees. No guessing at the pump.' },
];

export default function RentalPage() {
  return (
    <main className="min-h-screen bg-slate-50">

      {/* Hero */}
      <section className="bg-slate-900 text-white px-4 pt-14 pb-12 text-center">
        <div className="max-w-lg mx-auto">
          <p className="text-[11px] font-bold tracking-widest text-brand-orange uppercase mb-3">
            GasCap™ Rental Mode
          </p>
          <h1 className="text-3xl font-black leading-tight mb-3">
            Return your rental{' '}
            <span className="text-brand-orange">with confidence.</span>
          </h1>
          <p className="text-slate-300 text-sm leading-relaxed mb-6 max-w-sm mx-auto">
            Rental companies charge up to <strong className="text-white">$12/gallon</strong> if you return
            with less fuel than required. GasCap™ tells you exactly how many gallons you need — and
            finds the cheapest station nearby.
          </p>
          <Link
            href="/signup?mode=rental"
            className="inline-block bg-brand-orange text-white font-black text-sm
                       px-8 py-3.5 rounded-xl hover:bg-orange-600 active:scale-[0.98] transition-all"
          >
            Estimate My Rental Return Fuel
          </Link>
          <p className="text-slate-500 text-[11px] mt-3">Free — no credit card required</p>
        </div>
      </section>

      {/* Example output */}
      <section className="bg-white border-b border-slate-100 px-4 py-8">
        <div className="max-w-sm mx-auto">
          <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase text-center mb-4">
            Example Output
          </p>
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 text-center space-y-1">
            <p className="text-2xl font-black text-blue-900">7.8 gal needed</p>
            <p className="text-sm text-blue-700 font-semibold">Estimated cost: <strong>$26.41</strong></p>
            <p className="text-[11px] text-blue-600 mt-2">
              Lowest nearby: <strong>$3.38/gal</strong> · Station 1.4 mi away
            </p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-4 py-10 max-w-lg mx-auto">
        <h2 className="text-xl font-black text-slate-800 text-center mb-6">How it works</h2>
        <div className="space-y-4">
          {STEPS.map((s) => (
            <div key={s.n} className="flex items-start gap-4">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-orange text-white
                               flex items-center justify-center font-black text-sm">
                {s.n}
              </span>
              <div>
                <p className="font-black text-slate-800 text-sm">{s.title}</p>
                <p className="text-[12px] text-slate-500 mt-0.5">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Return checklist */}
      <section className="bg-white border-y border-slate-100 px-4 py-10">
        <div className="max-w-lg mx-auto">
          <h2 className="text-xl font-black text-slate-800 text-center mb-2">Rental Return Checklist</h2>
          <p className="text-[12px] text-slate-500 text-center mb-6">
            Run through this before you drop off the keys.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {CHECKLIST.map((item) => (
              <div
                key={item.text}
                className="flex items-center gap-2.5 bg-slate-50 border border-slate-200
                           rounded-xl px-3 py-2.5"
              >
                <span className="text-lg">{item.icon}</span>
                <p className="text-[11px] font-semibold text-slate-700 leading-snug">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 py-12 text-center max-w-sm mx-auto">
        <h2 className="text-xl font-black text-slate-800 mb-2">Ready to avoid fuel fees?</h2>
        <p className="text-sm text-slate-500 mb-6">
          GasCap™ is free. Get started in seconds — no account required to calculate.
        </p>
        <Link
          href="/signup?mode=rental"
          className="inline-block bg-brand-orange text-white font-black text-sm
                     px-8 py-3.5 rounded-xl hover:bg-orange-600 active:scale-[0.98] transition-all"
        >
          Estimate My Rental Return Fuel
        </Link>
        <p className="mt-4 text-[11px] text-slate-400">
          Already have GasCap™?{' '}
          <Link href="/signin" className="text-brand-orange font-bold hover:underline">Sign in</Link>
        </p>
      </section>

      {/* Rental partner pitch */}
      <section className="bg-slate-800 text-white px-4 py-10 text-center">
        <div className="max-w-lg mx-auto">
          <p className="text-[11px] font-bold tracking-widest text-brand-orange uppercase mb-2">
            For Rental Companies
          </p>
          <h2 className="text-xl font-black leading-tight mb-3">
            Help renters avoid fuel confusion before vehicle return.
          </h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-6 max-w-sm mx-auto">
            GasCap™ helps your customers estimate how many gallons they need, calculate refill cost,
            find nearby gas prices, and return vehicles with more confidence — at no cost to you.
          </p>
          <div className="grid grid-cols-2 gap-3 text-left mb-6">
            {[
              'Reduces fuel-related customer confusion',
              'Helps customers avoid unexpected refueling fees',
              'Improves renter experience',
              'QR-based self-service support',
              'No operational change required',
              'Place QR codes on key tags or checkout',
            ].map((b) => (
              <div key={b} className="flex items-start gap-2">
                <span className="text-brand-orange font-black text-sm mt-0.5">✓</span>
                <p className="text-[11px] text-slate-300 leading-snug">{b}</p>
              </div>
            ))}
          </div>
          <Link
            href="/contact?subject=Rental+Partner+QR+Code"
            className="inline-block bg-white text-slate-900 font-black text-sm
                       px-6 py-3 rounded-xl hover:bg-slate-100 active:scale-[0.98] transition-all"
          >
            Request a Rental Partner QR Code
          </Link>
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
