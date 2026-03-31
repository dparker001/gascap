'use client';

import { useSession, signOut } from 'next-auth/react';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import PushNotificationToggle from '@/components/PushNotificationToggle';
import { toggleDarkMode, isDarkMode } from '@/components/DarkModeProvider';

interface ReferralSummary {
  code:            string;
  referralUrl:     string;
  betaReferralUrl: string | null;
  isBeta:          boolean;
  referralCount:   number;
  activeCredits:   number;
  redeemableMonths:number;
  isPaid:          boolean;
  nextExpiryDate:  string | null;
}

const AVATAR_COLORS = [
  { bg: 'bg-amber-500',  label: 'Amber'  },
  { bg: 'bg-navy-700',   label: 'Navy'   },
  { bg: 'bg-emerald-500',label: 'Green'  },
  { bg: 'bg-rose-500',   label: 'Rose'   },
  { bg: 'bg-violet-600', label: 'Purple' },
  { bg: 'bg-sky-500',    label: 'Sky'    },
];

function Avatar({ name, color }: { name: string; color: string }) {
  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className={`w-20 h-20 rounded-full ${color} flex items-center justify-center shadow-md`}>
      <span className="text-white text-3xl font-black">{initials}</span>
    </div>
  );
}

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const AVATAR_COLOR_KEY = 'gascap_avatar_color';
  const [avatarColor,    setAvatarColor]    = useState('bg-amber-500');

  useEffect(() => {
    const saved = localStorage.getItem(AVATAR_COLOR_KEY);
    if (saved) setAvatarColor(saved);
    setDarkMode(isDarkMode());
  }, []);
  const [displayName,    setDisplayName]    = useState('');
  const [phone,          setPhone]          = useState('');
  const [saved,          setSaved]          = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [portalLoading,  setPortalLoading]  = useState(false);
  const [referral,       setReferral]       = useState<ReferralSummary | null>(null);
  const [copiedRef,        setCopiedRef]        = useState(false);
  const [copiedBeta,       setCopiedBeta]       = useState(false);
  const [darkMode,         setDarkMode]         = useState(false);
  const [alertThreshold,   setAlertThreshold]   = useState('');
  const [alertSaved,       setAlertSaved]       = useState(false);
  const [alertSaving,      setAlertSaving]      = useState(false);

  useEffect(() => {
    if (!session) return;
    fetch('/api/referral')
      .then((r) => r.json())
      .then((d: ReferralSummary) => setReferral(d))
      .catch(() => {});
    fetch('/api/user/price-alert')
      .then((r) => r.json())
      .then((d: { threshold?: number | null }) => {
        if (d.threshold) setAlertThreshold(String(d.threshold));
      })
      .catch(() => {});
  }, [session]);

  if (status === 'loading') {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
    </div>;
  }

  if (!session) {
    return <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4 px-6">
      <p className="text-slate-600 font-semibold">Sign in to access settings</p>
      <Link href="/signin" className="px-6 py-3 bg-amber-500 text-white font-bold rounded-2xl">Sign In</Link>
    </div>;
  }

  const name = displayName || session.user?.name || 'User';
  const plan = (session.user as { plan?: string })?.plan ?? 'free';

  const planConfig = {
    free:  { label: 'Free',  bg: 'bg-slate-100',   text: 'text-slate-600', border: 'border-slate-200' },
    pro:   { label: 'Pro',   bg: 'bg-amber-50',    text: 'text-amber-700', border: 'border-amber-200' },
    fleet: { label: 'Fleet', bg: 'bg-blue-50',     text: 'text-blue-700',  border: 'border-blue-200'  },
  }[plan] ?? { label: 'Free', bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200' };

  async function openPortal() {
    setPortalLoading(true);
    try {
      const res  = await fetch('/api/stripe/portal', { method: 'POST' });
      const data = await res.json() as { url?: string; error?: string };
      if (data.url) window.location.href = data.url;
      else alert(data.error ?? 'Could not open billing portal.');
    } finally {
      setPortalLoading(false);
    }
  }

  async function copyToClipboard(text: string, setter: (v: boolean) => void) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement('input');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setter(true);
    setTimeout(() => setter(false), 2000);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, phone }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  function handleDarkModeToggle() {
    const next = toggleDarkMode();
    setDarkMode(next);
  }

  async function handleSaveAlert() {
    setAlertSaving(true);
    try {
      const threshold = alertThreshold ? parseFloat(alertThreshold) : null;
      await fetch('/api/user/price-alert', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold }),
      });
      setAlertSaved(true);
      setTimeout(() => setAlertSaved(false), 2000);
    } finally {
      setAlertSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-navy-700 pt-12 pb-8 px-5">
        <div className="max-w-lg mx-auto flex items-center gap-4">
          <Link href="/" className="text-white/60 hover:text-white transition-colors">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
          </Link>
          <h1 className="text-white font-black text-xl">Settings</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">

        {/* Profile card */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">Profile</h2>

          {/* Avatar preview + color picker */}
          <div className="flex flex-col items-center gap-4">
            <Avatar name={name} color={avatarColor} />
            <div className="flex gap-2">
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c.bg}
                  onClick={() => { setAvatarColor(c.bg); localStorage.setItem(AVATAR_COLOR_KEY, c.bg); }}
                  className={`w-7 h-7 rounded-full ${c.bg} transition-all ${
                    avatarColor === c.bg ? 'ring-2 ring-offset-2 ring-slate-400 scale-110' : 'opacity-70 hover:opacity-100'
                  }`}
                  aria-label={c.label}
                />
              ))}
            </div>
          </div>

          {/* Display name */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Display Name</label>
            <input
              type="text"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800
                         focus:outline-none focus:ring-2 focus:ring-amber-400"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={session.user?.name ?? 'Your name'}
              maxLength={50}
            />
          </div>

          {/* Email (read-only) */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Email</label>
            <div className="w-full border border-slate-100 rounded-xl px-3 py-2.5 text-sm text-slate-400 bg-slate-50">
              {session.user?.email}
            </div>
          </div>

          {/* Phone (optional) */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">
              Phone <span className="text-slate-300 font-normal">(optional)</span>
            </label>
            <input
              type="tel"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800
                         focus:outline-none focus:ring-2 focus:ring-amber-400"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 (555) 000-0000"
              maxLength={20}
            />
            <p className="text-[11px] text-slate-400 mt-1">Used for SMS alerts when available.</p>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 text-white font-bold text-sm transition-colors disabled:opacity-60"
          >
            {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>

        {/* Plan card */}
        <div className={`bg-white rounded-2xl border shadow-sm p-5 space-y-4 ${planConfig.border}`}>
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">Plan</h2>
            <span className={`text-xs font-black px-2.5 py-1 rounded-full ${planConfig.bg} ${planConfig.text}`}>
              {planConfig.label.toUpperCase()}
            </span>
          </div>

          {plan === 'free' && (
            <>
              <p className="text-sm text-slate-500">
                You're on the free plan — 1 vehicle slot, basic calculator.
              </p>
              <Link
                href="/upgrade"
                className="flex items-center justify-between w-full py-3 px-4 rounded-2xl
                           bg-amber-500 hover:bg-amber-400 text-white font-bold text-sm transition-colors"
              >
                <span>Upgrade to Pro</span>
                <span>$4.99/mo →</span>
              </Link>
            </>
          )}

          {(plan === 'pro' || plan === 'fleet') && (
            <>
              <p className="text-sm text-slate-500">
                {plan === 'pro'
                  ? 'GasCap™ Pro — up to 3 vehicles, manual entry, spec lookup & more.'
                  : 'GasCap™ Fleet — unlimited vehicles, multi-driver, fleet reporting & more.'}
              </p>
              <button
                onClick={openPortal}
                disabled={portalLoading}
                className="w-full py-3 rounded-2xl border-2 border-slate-200 text-sm font-bold
                           text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                {portalLoading ? 'Opening…' : 'Manage Billing & Subscription →'}
              </button>
            </>
          )}
        </div>

        {/* Referral summary */}
        {referral && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">Refer &amp; Earn</h2>
              <Link href="/?tab=referral" className="text-[11px] text-amber-500 font-bold hover:underline">
                Full details →
              </Link>
            </div>

            {/* Stats */}
            <div className="flex gap-3">
              <div className="flex-1 bg-slate-50 rounded-xl px-3 py-2 text-center">
                <p className="text-lg font-black text-slate-700">{referral.referralCount}</p>
                <p className="text-[10px] text-slate-400">Friends Joined</p>
              </div>
              <div className={`flex-1 rounded-xl px-3 py-2 text-center ${referral.activeCredits > 0 ? 'bg-amber-50' : 'bg-slate-50'}`}>
                <p className={`text-lg font-black ${referral.activeCredits > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                  {referral.activeCredits}
                </p>
                <p className="text-[10px] text-slate-400">Credits Banked</p>
              </div>
            </div>

            {/* Credit status */}
            {referral.activeCredits > 0 && (
              <p className={`text-[11px] font-semibold px-3 py-2 rounded-xl ${
                referral.isPaid
                  ? 'bg-green-50 text-green-700'
                  : 'bg-amber-50 text-amber-700'
              }`}>
                {referral.isPaid
                  ? `✅ ${referral.redeemableMonths} month${referral.redeemableMonths !== 1 ? 's' : ''} ready to redeem on next billing cycle`
                  : `⏳ ${referral.activeCredits} month${referral.activeCredits !== 1 ? 's' : ''} banked — upgrade to Pro to redeem`}
                {referral.nextExpiryDate && (
                  <span className="block text-[10px] text-slate-400 mt-0.5">
                    Earliest expiry: {new Date(referral.nextExpiryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                )}
              </p>
            )}

            {/* Referral link */}
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Your referral link</p>
              <div className="flex gap-1.5">
                <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 overflow-hidden">
                  <p className="text-[11px] font-mono text-slate-500 truncate">{referral.referralUrl}</p>
                </div>
                <button
                  onClick={() => copyToClipboard(referral.referralUrl, setCopiedRef)}
                  className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                    copiedRef ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-600 hover:bg-amber-100 hover:text-amber-700'
                  }`}
                >
                  {copiedRef ? '✓' : '📋'}
                </button>
              </div>
            </div>

            {/* Beta invite link — only for beta testers */}
            {referral.isBeta && referral.betaReferralUrl && (
              <div>
                <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wide mb-1">🧪 Beta invite link</p>
                <div className="flex gap-1.5">
                  <div className="flex-1 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 overflow-hidden">
                    <p className="text-[11px] font-mono text-slate-500 truncate">{referral.betaReferralUrl}</p>
                  </div>
                  <button
                    onClick={() => copyToClipboard(referral.betaReferralUrl!, setCopiedBeta)}
                    className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                      copiedBeta ? 'bg-green-500 text-white' : 'bg-amber-500 text-white hover:bg-amber-400'
                    }`}
                  >
                    {copiedBeta ? '✓' : '📋'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* App preferences */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">Preferences</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-700">Default fuel unit</p>
                <p className="text-xs text-slate-400">Gallons (US) — more options coming soon</p>
              </div>
              <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">Gallons</span>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-700">Rotating tips</p>
                <p className="text-xs text-slate-400">Fuel & maintenance tips in the header</p>
              </div>
              <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-lg">On</span>
            </div>

            {/* Dark mode toggle */}
            <div className="flex items-center justify-between pt-1 border-t border-slate-100">
              <div>
                <p className="text-sm font-semibold text-slate-700">Dark mode</p>
                <p className="text-xs text-slate-400">Easy on the eyes at night</p>
              </div>
              <button
                onClick={handleDarkModeToggle}
                className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-1 ${
                  darkMode ? 'bg-amber-500' : 'bg-slate-200'
                }`}
                role="switch"
                aria-checked={darkMode}
                aria-label="Toggle dark mode"
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  darkMode ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </button>
            </div>
          </div>
        </div>

        {/* Gas price alert — Pro only */}
        <div className={`bg-white rounded-2xl border shadow-sm p-5 space-y-4 ${
          plan === 'pro' || plan === 'fleet' ? 'border-slate-100' : 'border-slate-100 opacity-80'
        }`}>
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">
              Gas Price Alert
            </h2>
            {plan === 'free' && (
              <span className="text-[9px] font-black bg-amber-400 text-white px-2 py-0.5 rounded-full">PRO</span>
            )}
          </div>

          {plan === 'free' ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 leading-relaxed">
                Get notified in-app when the national average gas price drops below your target threshold.
              </p>
              <Link
                href="/upgrade"
                className="inline-block text-xs font-bold text-amber-600 hover:text-amber-700 transition-colors"
              >
                Upgrade to Pro to unlock →
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 leading-relaxed">
                Show an alert when the national average drops below this price.
                Leave blank to disable.
              </p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={alertThreshold}
                    onChange={(e) => setAlertThreshold(e.target.value)}
                    placeholder="e.g. 3.50"
                    className="w-full pl-7 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm
                               focus:outline-none focus:ring-2 focus:ring-amber-400 text-slate-800"
                  />
                </div>
                <button
                  onClick={handleSaveAlert}
                  disabled={alertSaving}
                  className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50
                             text-white font-bold text-xs rounded-xl transition-colors"
                >
                  {alertSaved ? '✓ Saved' : alertSaving ? '…' : 'Save'}
                </button>
              </div>
              {alertThreshold && (
                <p className="text-[11px] text-slate-400">
                  Alert active at <span className="font-bold text-slate-600">${parseFloat(alertThreshold).toFixed(2)}/gal</span>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Notifications */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-3">
            <h2 className="text-sm font-black text-slate-700 uppercase tracking-widest">Notifications</h2>
            <PushNotificationToggle />
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Weekly digests are sent every Sunday and include your monthly spending, MPG trend, and fillup count.
            </p>
          </div>

        {/* Danger zone */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">Account</h2>
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="w-full py-3 rounded-2xl border-2 border-red-100 text-sm font-bold
                       text-red-500 hover:bg-red-50 transition-colors"
          >
            Sign Out
          </button>
        </div>

        <p className="text-center text-[11px] text-slate-300 pb-4">GasCap™ v0.1 · Gas Capacity</p>
      </div>
    </div>
  );
}
