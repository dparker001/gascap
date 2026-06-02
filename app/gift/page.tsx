'use client';

import { useState } from 'react';
import { PRICING } from '@/lib/stripe';
import BrandBar from '@/components/BrandBar';

const OCCASIONS = [
  { value: 'gift',        label: '🎁 Just because' },
  { value: 'fathers-day', label: "👔 Father's Day" },
  { value: 'birthday',    label: '🎂 Birthday' },
  { value: 'holiday',     label: '🎄 Holiday' },
];

const PERKS = [
  'Unlimited saved vehicles',
  'Fill-up history & MPG tracking',
  'Smart Fill-Up Optimizer & gas price alerts',
  'AI Fuel Advisor',
  'Lifetime — no subscription, ever',
];

export default function GiftPage() {
  const [occasion, setOccasion]               = useState('gift');
  const [deliverToRecipient, setDeliver]       = useState(true);
  const [recipientName, setRecipientName]      = useState('');
  const [recipientEmail, setRecipientEmail]    = useState('');
  const [giftMessage, setGiftMessage]          = useState('');
  const [purchaserEmail, setPurchaserEmail]    = useState('');
  const [loading, setLoading]                  = useState(false);
  const [error, setError]                      = useState('');

  async function handleBuy() {
    setError('');
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(purchaserEmail)) { setError('Please enter a valid email for your receipt.'); return; }
    if (deliverToRecipient && !emailRe.test(recipientEmail)) {
      setError("Please enter the recipient's email, or switch to “I'll give them the code myself.”");
      return;
    }
    setLoading(true);
    try {
      const res  = await fetch('/api/stripe/gift-checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          purchaserEmail, recipientEmail, recipientName, giftMessage, occasion, deliverToRecipient,
        }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) { setError(data.error ?? 'Could not start checkout.'); setLoading(false); return; }
      window.location.href = data.url;
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#eef1f7] flex flex-col">
      <BrandBar />
      <div className="flex-1 flex items-start justify-center px-4 pt-8 pb-16">
        <div className="w-full max-w-md">

          {/* Hero */}
          <div className="text-center mb-6">
            <div className="w-16 h-16 rounded-full bg-teal-100 flex items-center justify-center mx-auto text-3xl mb-3">🎁</div>
            <h1 className="text-2xl font-black text-navy-700">Gift GasCap™ Pro Lifetime</h1>
            <p className="text-slate-500 text-sm mt-1">
              One payment of <span className="font-bold text-navy-700">${PRICING.pro.lifetime}</span> — they get Pro features forever, no subscription.
            </p>
          </div>

          {/* Perks */}
          <div className="bg-white rounded-2xl shadow-sm p-5 mb-5">
            <ul className="space-y-2">
              {PERKS.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-sm text-slate-600">
                  <span className="text-teal-500 font-black">✓</span>{p}
                </li>
              ))}
            </ul>
          </div>

          {/* Form */}
          <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
            <div>
              <label className="field-label">Occasion</label>
              <div className="grid grid-cols-2 gap-2">
                {OCCASIONS.map((o) => (
                  <button key={o.value} type="button" onClick={() => setOccasion(o.value)}
                    className={`py-2.5 rounded-xl text-sm font-semibold border-2 transition-colors ${
                      occasion === o.value ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Delivery toggle */}
            <div>
              <label className="field-label">How should we deliver it?</label>
              <div className="space-y-2">
                <button type="button" onClick={() => setDeliver(true)}
                  className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-colors ${
                    deliverToRecipient ? 'border-teal-400 bg-teal-50' : 'border-slate-200 hover:border-slate-300'
                  }`}>
                  <p className="text-sm font-semibold text-navy-700">📧 Email it to the recipient</p>
                  <p className="text-xs text-slate-500">We'll send them the gift + code right after purchase.</p>
                </button>
                <button type="button" onClick={() => setDeliver(false)}
                  className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-colors ${
                    !deliverToRecipient ? 'border-teal-400 bg-teal-50' : 'border-slate-200 hover:border-slate-300'
                  }`}>
                  <p className="text-sm font-semibold text-navy-700">🎟️ Give me the code</p>
                  <p className="text-xs text-slate-500">We'll email the code to you to hand over or print.</p>
                </button>
              </div>
            </div>

            {deliverToRecipient && (
              <>
                <div>
                  <label className="field-label" htmlFor="rname">Recipient's name <span className="text-slate-400">(optional)</span></label>
                  <input id="rname" type="text" className="input-field" placeholder="Dad" value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)} />
                </div>
                <div>
                  <label className="field-label" htmlFor="remail">Recipient's email</label>
                  <input id="remail" type="email" className="input-field" placeholder="dad@example.com" value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)} />
                </div>
                <div>
                  <label className="field-label" htmlFor="msg">Personal note <span className="text-slate-400">(optional)</span></label>
                  <textarea id="msg" className="input-field" rows={2} maxLength={500} placeholder="Happy Father's Day, Dad! 🎉"
                    value={giftMessage} onChange={(e) => setGiftMessage(e.target.value)} />
                </div>
              </>
            )}

            <div>
              <label className="field-label" htmlFor="bemail">Your email <span className="text-slate-400">(for the receipt)</span></label>
              <input id="bemail" type="email" className="input-field" placeholder="you@example.com" value={purchaserEmail}
                onChange={(e) => setPurchaserEmail(e.target.value)} />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <p className="text-red-600 text-sm font-medium">{error}</p>
              </div>
            )}

            <button onClick={handleBuy} disabled={loading} className="btn-amber w-full">
              {loading ? 'Redirecting to checkout…' : `Give Pro Lifetime — $${PRICING.pro.lifetime}`}
            </button>
            <p className="text-[11px] text-slate-400 text-center">
              Secure checkout by Stripe. The recipient claims their gift with a one-time code — no subscription.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
