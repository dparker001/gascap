'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import StaticPageHeader from '@/components/StaticPageHeader';

// ─── Business constants ───────────────────────────────────────────────────────
const LEGAL_NAME    = 'Gas Capacity LLC';
const BUSINESS_EMAIL = 'admin@gascap.app';
const BUSINESS_ADDR  = '7901 4th St N STE 300, St. Petersburg, FL 33702';
const BUSINESS_PHONE = '(321) 513-1321';

const YEAR = new Date().getFullYear();

export default function ContactPage() {
  const [firstName,        setFirstName]        = useState('');
  const [lastName,         setLastName]         = useState('');
  const [email,            setEmail]            = useState('');
  const [phone,            setPhone]            = useState('');
  const [message,          setMessage]          = useState('');
  const [smsConsent,       setSmsConsent]       = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [status,           setStatus]           = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [errorMsg,         setErrorMsg]         = useState('');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus('sending');
    setErrorMsg('');

    try {
      const res = await fetch('/api/contact', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName, lastName, email, phone, message,
          smsConsent, marketingConsent,
        }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? 'Submission failed. Please try again.');
      }

      setStatus('success');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    }
  }

  return (
    <div className="min-h-screen bg-[#eef1f7]">
      <StaticPageHeader active="contact" />

      <div className="max-w-2xl mx-auto px-5 py-10 pb-20">
        {/* Header */}
        <h1 className="text-3xl font-black text-navy-700 mb-1">Contact Us</h1>
        <p className="text-sm text-slate-500 mb-1">
          <span className="font-semibold text-slate-700">{LEGAL_NAME}</span>
        </p>
        <p className="text-xs text-slate-400 mb-8">{BUSINESS_ADDR}</p>

        {status === 'success' ? (
          <div className="bg-white rounded-2xl shadow-sm border border-green-100 p-8 text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center mx-auto">
              <svg viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"
                   strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h2 className="text-xl font-black text-slate-800">Message Sent!</h2>
            <p className="text-sm text-slate-500">
              Thanks for reaching out. We&apos;ll get back to you at <strong>{email}</strong> as soon as possible.
            </p>
            <Link href="/" className="inline-block mt-2 text-sm text-amber-600 hover:underline font-semibold">
              ← Back to GasCap™
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-5">

            {/* Name row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="firstName" className="block text-xs font-semibold text-slate-600 mb-1">
                  First Name
                </label>
                <input
                  id="firstName"
                  type="text"
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm
                             focus:outline-none focus:ring-2 focus:ring-[#1EB68F]/40 focus:border-[#1EB68F]"
                  placeholder="First Name"
                />
              </div>
              <div>
                <label htmlFor="lastName" className="block text-xs font-semibold text-slate-600 mb-1">
                  Last Name
                </label>
                <input
                  id="lastName"
                  type="text"
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm
                             focus:outline-none focus:ring-2 focus:ring-[#1EB68F]/40 focus:border-[#1EB68F]"
                  placeholder="Last Name"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-xs font-semibold text-slate-600 mb-1">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm
                           focus:outline-none focus:ring-2 focus:ring-[#1EB68F]/40 focus:border-[#1EB68F]"
                placeholder="you@example.com"
              />
            </div>

            {/* Phone */}
            <div>
              <label htmlFor="phone" className="block text-xs font-semibold text-slate-600 mb-1">
                Phone
              </label>
              <input
                id="phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm
                           focus:outline-none focus:ring-2 focus:ring-[#1EB68F]/40 focus:border-[#1EB68F]"
                placeholder="(555) 000-0000"
              />
            </div>

            {/* Message */}
            <div>
              <label htmlFor="message" className="block text-xs font-semibold text-slate-600 mb-1">
                Message
              </label>
              <textarea
                id="message"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm
                           focus:outline-none focus:ring-2 focus:ring-[#1EB68F]/40 focus:border-[#1EB68F]
                           resize-none"
                placeholder="How can we help?"
              />
            </div>

            {/* ── SMS Consent Checkbox ──────────────────────────────────────── */}
            <div className={[
              'flex gap-3 rounded-xl border p-3.5 transition-colors',
              smsConsent
                ? 'border-[#1EB68F]/40 bg-[#1EB68F]/5'
                : 'border-slate-100 bg-slate-50',
            ].join(' ')}>
              <div className="pt-0.5 flex-shrink-0">
                <input
                  id="smsConsent"
                  type="checkbox"
                  checked={smsConsent}
                  onChange={(e) => {
                    setSmsConsent(e.target.checked);
                    // If phone is empty and they check SMS, remind them
                  }}
                  disabled={!phone}
                  className="w-4 h-4 rounded border-slate-300 text-[#1EB68F] accent-[#1EB68F]
                             focus:ring-[#1EB68F]/40 disabled:opacity-40 cursor-pointer"
                />
              </div>
              <label
                htmlFor="smsConsent"
                className={[
                  'text-xs leading-relaxed cursor-pointer select-none',
                  !phone ? 'text-slate-400' : 'text-slate-600',
                ].join(' ')}
              >
                I consent to receive SMS notifications and alerts from{' '}
                <strong>{LEGAL_NAME}</strong>. Message frequency varies. Message &amp; data
                rates may apply. Reply <strong>HELP</strong> for help or{' '}
                <strong>STOP</strong> to unsubscribe at any time.
                {!phone && (
                  <span className="ml-1 text-slate-400 italic">(Enter phone number above to enable)</span>
                )}
              </label>
            </div>

            {/* ── Marketing Consent Checkbox ───────────────────────────────── */}
            <div className={[
              'flex gap-3 rounded-xl border p-3.5 transition-colors',
              marketingConsent
                ? 'border-[#1EB68F]/40 bg-[#1EB68F]/5'
                : 'border-slate-100 bg-slate-50',
            ].join(' ')}>
              <div className="pt-0.5 flex-shrink-0">
                <input
                  id="marketingConsent"
                  type="checkbox"
                  checked={marketingConsent}
                  onChange={(e) => setMarketingConsent(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-[#1EB68F] accent-[#1EB68F]
                             focus:ring-[#1EB68F]/40 cursor-pointer"
                />
              </div>
              <label
                htmlFor="marketingConsent"
                className="text-xs leading-relaxed text-slate-600 cursor-pointer select-none"
              >
                By checking this box, I agree to receive occasional marketing
                messages from <strong>{LEGAL_NAME}</strong>. Message frequency varies.
                Message &amp; data rates may apply. Reply <strong>HELP</strong> for help
                or <strong>STOP</strong> to unsubscribe at any time.
              </label>
            </div>

            {/* Legal links */}
            <p className="text-[11px] text-slate-400 text-center">
              By submitting this form you agree to our{' '}
              <Link href="/privacy" className="text-amber-600 hover:underline">Privacy Policy</Link>
              {' '}and{' '}
              <Link href="/terms" className="text-amber-600 hover:underline">Terms &amp; Conditions</Link>.
            </p>

            {/* Error */}
            {status === 'error' && (
              <p className="text-xs text-red-600 text-center font-medium">{errorMsg}</p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={status === 'sending'}
              className="w-full py-3 rounded-xl font-black text-sm text-white
                         bg-[#005F4A] hover:bg-[#006B54] active:bg-[#005040]
                         transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {status === 'sending' ? 'Sending…' : 'Complete & Send'}
            </button>
          </form>
        )}

        {/* Business contact info */}
        <div className="mt-8 text-center text-xs text-slate-400 space-y-1">
          <p className="font-semibold text-slate-500">{LEGAL_NAME}</p>
          <p>{BUSINESS_ADDR}</p>
          <p>
            <a href={`mailto:${BUSINESS_EMAIL}`} className="hover:text-amber-600 transition-colors">
              {BUSINESS_EMAIL}
            </a>
            {BUSINESS_PHONE && (
              <>
                {' · '}
                <a href={`tel:${BUSINESS_PHONE}`} className="hover:text-amber-600 transition-colors">
                  {BUSINESS_PHONE}
                </a>
              </>
            )}
          </p>
        </div>

        {/* Footer */}
        <div className="mt-10 pt-6 border-t border-slate-200 flex items-center justify-between gap-4 text-xs text-slate-400">
          <span>© {YEAR} GasCap™ — All rights reserved.</span>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-amber-600">Privacy Policy</Link>
            <Link href="/terms"   className="hover:text-amber-600">Terms</Link>
            <Link href="/help"    className="hover:text-amber-600">Help</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
