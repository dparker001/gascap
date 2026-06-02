'use client';

import { Suspense } from 'react';
import { useRouter } from 'next/navigation';

function GiftSuccessContent() {
  const router = useRouter();
  return (
    <div className="bg-white rounded-3xl shadow-card p-8 max-w-sm w-full text-center space-y-5">
      <div className="w-20 h-20 rounded-full bg-teal-100 flex items-center justify-center mx-auto text-4xl">🎁</div>
      <h1 className="text-2xl font-black text-navy-700">Gift sent!</h1>
      <p className="text-slate-500 text-sm leading-relaxed">
        Thank you! Your <span className="font-bold text-teal-600">GasCap™ Pro Lifetime</span> gift is on its way.
        We've emailed the gift code and a claim link — check your inbox (and the recipient's, if you chose to email them directly).
      </p>
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left">
        <p className="text-xs font-bold text-slate-600 mb-1">What happens next</p>
        <ul className="text-xs text-slate-500 space-y-1.5 leading-relaxed list-disc pl-4">
          <li>The recipient opens the claim link and signs in (or creates a free account).</li>
          <li>They enter the gift code — Pro Lifetime activates instantly.</li>
          <li>Didn't get the email? Check spam, or contact support@gascap.app.</li>
        </ul>
      </div>
      <button onClick={() => router.push('/')}
        className="block w-full py-3.5 rounded-2xl bg-teal-500 hover:bg-teal-400 text-white font-black text-base transition-colors">
        Back to GasCap™ →
      </button>
    </div>
  );
}

export default function GiftSuccessPage() {
  return (
    <div className="min-h-screen bg-[#eef1f7] flex flex-col items-center justify-center px-4 py-12">
      <Suspense fallback={<div className="bg-white rounded-3xl shadow-card p-8 max-w-sm w-full text-center"><p className="text-slate-400 text-sm">Loading…</p></div>}>
        <GiftSuccessContent />
      </Suspense>
    </div>
  );
}
