'use client';

import { useSession, signOut } from 'next-auth/react';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { setThemePreference, getThemePreference, isDarkMode, type ThemePreference } from '@/components/DarkModeProvider';
import { DoorMiniPreview, DOOR_STYLE_LABELS, DOOR_DIRECTION_LABELS } from '@/components/GarageDoor';
import { useGarageDoorPrefs, type DoorStyle, type DoorDirection } from '@/hooks/useGarageDoorPrefs';

interface ReferralSummary {
  code:            string;
  referralUrl:     string;
  referralCount:   number;
  activeCredits:   number;
  redeemableMonths:number;
  isPaid:          boolean;
  nextExpiryDate:  string | null;
}

interface GiveawayEntries {
  month:      string;
  entryCount: number;
  eligible:   boolean;
}

const AVATAR_COLORS = [
  { bg: 'bg-amber-500',  label: 'Amber'  },
  { bg: 'bg-navy-700',   label: 'Navy'   },
  { bg: 'bg-emerald-500',label: 'Green'  },
  { bg: 'bg-rose-500',   label: 'Rose'   },
  { bg: 'bg-violet-600', label: 'Purple' },
  { bg: 'bg-sky-500',    label: 'Sky'    },
];

function SectionBanner({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="flex items-center gap-2.5 bg-navy-700 rounded-t-2xl px-4 py-2.5 shadow-sm">
      <span className="text-base leading-none">{icon}</span>
      <h2 className="text-sm font-black text-white tracking-wide">{title}</h2>
    </div>
  );
}

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
    setThemePref(getThemePreference());
  }, []);
  const [displayName,    setDisplayName]    = useState('');
  const [phone,          setPhone]          = useState('');
  const [smsOptIn,       setSmsOptIn]       = useState(false);
  const [saved,          setSaved]          = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [portalLoading,  setPortalLoading]  = useState(false);
  const [referral,       setReferral]       = useState<ReferralSummary | null>(null);
  const [copiedRef,        setCopiedRef]        = useState(false);
  const [showQR,           setShowQR]           = useState(false);
  const [darkMode,         setDarkMode]         = useState(false);   // rendered state
  const [themePref,        setThemePref]        = useState<ThemePreference>('auto');
  const [alertThreshold,   setAlertThreshold]   = useState('');
  const [alertSaved,       setAlertSaved]       = useState(false);
  const [alertSaving,      setAlertSaving]      = useState(false);
  const [livePlan,         setLivePlan]         = useState<string | null>(null);
  const [giveaway,         setGiveaway]         = useState<GiveawayEntries | null>(null);
  const [fleetCompanyName, setFleetCompanyName] = useState('');
  const [fleetLogoUrl,     setFleetLogoUrl]     = useState('');
  const [fleetSaved,       setFleetSaved]       = useState(false);
  const [fleetSaving,      setFleetSaving]      = useState(false);
  const { doorStyle, setDoorStyle, doorDirection, setDoorDirection } = useGarageDoorPrefs();

  useEffect(() => {
    if (!session) return;
    fetch('/api/vehicles')
      .then((r) => r.json())
      .then((d: { plan?: string }) => { if (d.plan) setLivePlan(d.plan); })
      .catch(() => {});
    // Fleet branding is fetched here when session plan is already 'fleet';
    // a second fetch is triggered below when livePlan resolves to 'fleet'.
    if ((session?.user as { plan?: string })?.plan === 'fleet') {
      fetch('/api/fleet/branding')
        .then(r => r.json())
        .then((d: { companyName?: string; logoUrl?: string }) => {
          if (d.companyName) setFleetCompanyName(d.companyName);
          if (d.logoUrl) setFleetLogoUrl(d.logoUrl);
        })
        .catch(() => {});
    }
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
    fetch('/api/user/giveaway-entries')
      .then((r) => r.json())
      .then((d: GiveawayEntries) => { if (d.eligible) setGiveaway(d); })
      .catch(() => {});
    // Pre-populate editable profile fields from the database so they're not
    // blank on every visit and so saving never accidentally wipes saved data.
    fetch('/api/user/profile')
      .then((r) => r.json())
      .then((d: { displayName?: string; phone?: string; smsOptIn?: boolean }) => {
        if (d.displayName)        setDisplayName(d.displayName);
        if (d.phone)              setPhone(d.phone);
        if (d.smsOptIn !== undefined) setSmsOptIn(d.smsOptIn);
      })
      .catch(() => {});
  }, [session]);

  // Fetch fleet branding when livePlan resolves to 'fleet' (in case session plan was stale)
  useEffect(() => {
    if (livePlan !== 'fleet') return;
    if ((session?.user as { plan?: string })?.plan === 'fleet') return; // already fetched above
    fetch('/api/fleet/branding')
      .then(r => r.json())
      .then((d: { companyName?: string; logoUrl?: string }) => {
        if (d.companyName) setFleetCompanyName(d.companyName);
        if (d.logoUrl) setFleetLogoUrl(d.logoUrl);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePlan]);

  /* ── Sticky tab bar ── */
  const ALL_TABS = [
    { id: 'profile',     label: '👤 Profile'     },
    { id: 'account',     label: '🔐 Account'      },
    { id: 'plan',        label: '⭐ Plan'         },
    { id: 'perks',       label: '🎁 Perks'        },
    { id: 'preferences', label: '⚙️ Preferences'  },
    { id: 'fleet',       label: '🚛 Fleet'        },
  ] as const;

  type TabId = (typeof ALL_TABS)[number]['id'];

  // Only show the Fleet tab when the user is on the fleet plan
  const currentPlanForTabs = livePlan ?? (session?.user as { plan?: string })?.plan ?? 'free';
  const TABS = ALL_TABS.filter((t) => t.id !== 'fleet' || currentPlanForTabs === 'fleet');

  const [activeTab, setActiveTab] = useState<TabId>('profile');
  const sectionRefs = useRef<Partial<Record<TabId, HTMLElement | null>>>({});

  function scrollToSection(id: TabId) {
    const el = sectionRefs.current[id];
    if (!el) return;
    const offset = 90; // height of sticky header + tab bar + breathing room
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: 'smooth' });
    setActiveTab(id);
  }

  useEffect(() => {
    function onScroll() {
      const scrollY = window.scrollY + 80;
      let current: TabId = 'profile';
      for (const { id } of TABS) {
        const el = sectionRefs.current[id];
        if (el && el.offsetTop <= scrollY) current = id;
      }
      setActiveTab(current);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

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
  const plan = livePlan ?? session.user?.plan ?? 'free';

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
      else alert(data.error ?? 'Could not open billing portal. Please try again or contact support@gascap.app.');
    } catch {
      alert('Could not reach the billing portal. Please try again or contact support@gascap.app.');
    } finally {
      setPortalLoading(false);
    }
  }

  async function handleUpgrade(tier: 'pro' | 'fleet') {
    setPortalLoading(true);
    try {
      const res  = await fetch('/api/stripe/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tier, billing: 'monthly' }),
        credentials: 'include',
      });
      const data = await res.json() as { url?: string; error?: string };
      if (data.url) window.location.href = data.url;
      else alert(data.error ?? 'Could not open checkout.');
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
        body: JSON.stringify({ displayName, phone, smsOptIn }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  function handleThemeChange(pref: ThemePreference) {
    setThemePreference(pref);
    setThemePref(pref);
    setDarkMode(isDarkMode());
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
      {/* Fixed header + tab bar — position:fixed guarantees it never scrolls away */}
      <div className="fixed inset-x-0 top-0 z-20 shadow-md">
        {/* Header */}
        <div className="bg-navy-700 px-5 pt-4 pb-3">
          <div className="max-w-lg mx-auto flex items-center gap-4">
            <Link href="/" className="text-white/60 hover:text-white transition-colors">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
            </Link>
            <h1 className="text-white font-black text-xl">Settings</h1>
          </div>
        </div>

        {/* Section tab bar */}
        <div className="bg-slate-50/95 backdrop-blur-sm border-b border-slate-200/70">
          <div className="max-w-lg mx-auto px-3 py-2 overflow-x-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            <div className="flex gap-1.5 min-w-max" style={{ WebkitOverflowScrolling: 'touch' }}>
              {TABS.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => scrollToSection(id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                    activeTab === id
                      ? 'bg-navy-700 text-white shadow-sm'
                      : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300 hover:text-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-28 pb-6 space-y-4">

        {/* Profile section */}
        <div ref={(el) => { sectionRefs.current['profile'] = el; }}>
          <SectionBanner icon="👤" title="Profile" />
          <div className="bg-white rounded-b-2xl border border-t-0 border-slate-100 shadow-sm p-5 space-y-5">

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
              autoCapitalize="words"
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
              onChange={(e) => { setPhone(e.target.value); if (!e.target.value.trim()) setSmsOptIn(false); }}
              placeholder="+1 (555) 000-0000"
              maxLength={20}
            />
          </div>

          {/* SMS opt-in */}
          <div className={`rounded-xl border p-3.5 transition-all ${smsOptIn ? 'border-teal-300 bg-teal-50' : 'border-slate-200 bg-slate-50'}`}>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-teal-600 cursor-pointer flex-shrink-0"
                checked={smsOptIn}
                disabled={!phone.trim()}
                onChange={(e) => setSmsOptIn(e.target.checked)}
              />
              <div>
                <p className={`text-sm font-semibold ${smsOptIn ? 'text-teal-800' : 'text-slate-600'}`}>
                  📱 Receive SMS text messages from GasCap™
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  Get gas price alerts, fill-up reminders, and tips by text. Message &amp; data rates may apply.
                  Reply STOP at any time to opt out.
                  {!phone.trim() && (
                    <span className="block mt-0.5 text-amber-600 font-medium">Add a phone number above to enable SMS.</span>
                  )}
                </p>
              </div>
            </label>
            {smsOptIn && (
              <p className="mt-2 text-[11px] text-teal-700 border-t border-teal-200 pt-2">
                ✓ By checking this box you consent to receive recurring automated text messages from
                Gas Capacity LLC at the number provided. Consent is not a condition of purchase.
              </p>
            )}
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 text-white font-bold text-sm transition-colors disabled:opacity-60"
          >
            {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Save Changes'}
          </button>
          </div>{/* end profile card */}
        </div>{/* end profile section */}

        {/* Account section */}
        <div ref={(el) => { sectionRefs.current['account'] = el; }}>
          <SectionBanner icon="🔐" title="Account" />
          <div className="bg-white rounded-b-2xl border border-t-0 border-slate-100 shadow-sm p-5 space-y-4">

            {/* Email + verification status */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500">Email Address</p>
                <p className="text-sm text-slate-800 mt-0.5">{session.user?.email}</p>
              </div>
              {(session.user as { emailVerified?: boolean }).emailVerified ? (
                <span className="text-[10px] font-black bg-green-100 text-green-700 px-2 py-1 rounded-full">✓ Verified</span>
              ) : (
                <span className="text-[10px] font-black bg-amber-100 text-amber-700 px-2 py-1 rounded-full">⚠ Unverified</span>
              )}
            </div>

            {/* Member since */}
            {(session.user as { createdAt?: string | null }).createdAt && (
              <div>
                <p className="text-xs font-semibold text-slate-500">Member Since</p>
                <p className="text-sm text-slate-700 mt-0.5">
                  {new Date((session.user as unknown as { createdAt: string }).createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
            )}

            <div className="border-t border-slate-100 pt-3 space-y-2">
              <Link
                href="/help"
                className="flex items-center justify-between w-full py-2.5 px-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors"
              >
                <span className="text-sm font-semibold text-slate-700">❓ Help & FAQ</span>
                <span className="text-slate-400 text-xs">→</span>
              </Link>
              <Link
                href="/contact"
                className="flex items-center justify-between w-full py-2.5 px-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors"
              >
                <span className="text-sm font-semibold text-slate-700">✉️ Contact Support</span>
                <span className="text-slate-400 text-xs">→</span>
              </Link>
              <div className="flex gap-2">
                <Link href="/privacy" className="flex-1 text-center text-[11px] font-bold text-slate-400 hover:text-slate-600 py-2">
                  Privacy Policy
                </Link>
                <Link href="/terms" className="flex-1 text-center text-[11px] font-bold text-slate-400 hover:text-slate-600 py-2">
                  Terms of Use
                </Link>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-3">
              <button
                onClick={() => signOut({ callbackUrl: '/' })}
                className="w-full py-3 rounded-2xl border-2 border-red-100 text-sm font-bold
                           text-red-500 hover:bg-red-50 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>

        {/* Plan section */}
        <div ref={(el) => { sectionRefs.current['plan'] = el; }}>
          <SectionBanner icon="⭐" title="Plan" />
          <div className={`bg-white rounded-b-2xl border border-t-0 shadow-sm p-5 space-y-4 ${planConfig.border}`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-black px-2.5 py-1 rounded-full ${planConfig.bg} ${planConfig.text}`}>
              {planConfig.label.toUpperCase()}
            </span>
          </div>

          {plan === 'free' && (
            <>
              <p className="text-sm text-slate-500">
                You&apos;re on the free plan — 1 vehicle slot, basic calculator.
              </p>
              <button
                onClick={() => handleUpgrade('pro')}
                disabled={portalLoading}
                className="flex items-center justify-between w-full py-3 px-4 rounded-2xl
                           bg-amber-500 hover:bg-amber-400 text-white font-bold text-sm transition-colors disabled:opacity-50"
              >
                <span>⭐ Upgrade to Pro</span>
                <span>$4.99/mo →</span>
              </button>
              <button
                onClick={() => handleUpgrade('fleet')}
                disabled={portalLoading}
                className="flex items-center justify-between w-full py-3 px-4 rounded-2xl
                           bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm transition-colors disabled:opacity-50"
              >
                <span>🚛 Upgrade to Fleet</span>
                <span>$19.99/mo →</span>
              </button>
            </>
          )}

          {plan === 'pro' && (
            <>
              <p className="text-sm text-slate-500">
                GasCap™ Pro — up to 3 vehicles, manual entry, spec lookup &amp; more.
              </p>
              <button
                onClick={() => handleUpgrade('fleet')}
                disabled={portalLoading}
                className="flex items-center justify-between w-full py-3 px-4 rounded-2xl
                           bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm transition-colors disabled:opacity-50"
              >
                <span>🚛 Upgrade to Fleet</span>
                <span>$19.99/mo →</span>
              </button>
              <button
                onClick={openPortal}
                disabled={portalLoading}
                className="w-full py-3 rounded-2xl border-2 border-slate-200 text-sm font-bold
                           text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                {portalLoading ? 'Opening…' : 'Manage Billing & Subscription →'}
              </button>
              <p className="text-center text-[11px] text-slate-400">
                Update payment method, view invoices, or cancel anytime.
              </p>
            </>
          )}

          {plan === 'fleet' && (
            <>
              <p className="text-sm text-slate-500">
                GasCap™ Fleet — unlimited vehicles, multi-driver, fleet reporting &amp; more.
              </p>
              <Link
                href="/fleet"
                className="flex items-center justify-between w-full py-3 px-4 rounded-2xl
                           bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm transition-colors"
              >
                <span>🚛 Fleet Dashboard</span>
                <span>Drivers &amp; Reports →</span>
              </Link>
              <button
                onClick={openPortal}
                disabled={portalLoading}
                className="w-full py-3 rounded-2xl border-2 border-slate-200 text-sm font-bold
                           text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                {portalLoading ? 'Opening…' : 'Manage Billing & Subscription →'}
              </button>
              <p className="text-center text-[11px] text-slate-400">
                Update payment method, view invoices, or cancel anytime.
              </p>
            </>
          )}
          </div>{/* end plan card */}
        </div>{/* end plan section */}

        {/* Perks section — wraps Referral + Giveaway */}
        <div ref={(el) => { sectionRefs.current['perks'] = el; }} className="space-y-4">
          <SectionBanner icon="🎁" title="Perks" />

        {/* Referral summary */}
        {referral && (
          <div className="bg-white rounded-b-2xl border border-t-0 border-slate-100 shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <Link href="/?tab=referral" className="text-[11px] text-amber-500 font-bold hover:underline">
                Full details →
              </Link>
            </div>

            {/* How credits are earned */}
            <p className="text-[11px] text-slate-500 leading-relaxed bg-slate-50 rounded-xl px-3 py-2.5">
              💡 You earn <strong>1 free month</strong> for every friend who subscribes to a paid GasCap™ plan using your link — up to <strong>6 free months</strong> total. Trial sign-ups that never pay don&apos;t count. Credits are issued within 24 hours of their first payment.
            </p>

          {/* Stats */}
            <div className="flex gap-3">
              <div className="flex-1 bg-slate-50 rounded-xl px-3 py-2 text-center">
                <p className="text-lg font-black text-slate-700">{referral.referralCount}</p>
                <p className="text-[10px] text-slate-400">Paid Referrals</p>
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

            {/* Ambassador program link */}
            <Link
              href="/ambassador"
              className="flex items-center justify-between text-xs font-bold text-slate-500 hover:text-navy-700 transition-colors py-1"
            >
              <span>🏆 Become a GasCap™ Ambassador</span>
              <span className="text-slate-300">→</span>
            </Link>

            {/* GasCaptains™ community link */}
            <a
              href={process.env.NEXT_PUBLIC_GASCAPTAINS_URL ?? 'https://www.facebook.com/groups/gascaptains'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between text-xs font-bold text-slate-500 hover:text-[#005F4A] transition-colors py-1"
            >
              <span>🏴 Join GasCaptains™ — Members Community</span>
              <span className="text-slate-300">→</span>
            </a>

            {/* QR code share */}
            <div>
              <button
                type="button"
                onClick={() => setShowQR((v) => !v)}
                className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-amber-600 transition-colors"
              >
                <span className="text-base">📱</span>
                <span>{showQR ? 'Hide QR Code' : 'Show QR Code'}</span>
                <svg viewBox="0 0 16 16" className={`w-3 h-3 transition-transform ${showQR ? 'rotate-180' : ''}`} fill="currentColor" aria-hidden="true">
                  <path d="M8 10.5L2.5 5h11L8 10.5z" />
                </svg>
              </button>

              {showQR && (
                <div className="mt-3 flex flex-col items-center gap-3 bg-slate-50 border border-slate-200 rounded-2xl p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Scan to join GasCap™</p>

                  {/* QR code image — generated by free api.qrserver.com */}
                  <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=4&color=0f1f34&bgcolor=ffffff&data=${encodeURIComponent(referral.referralUrl)}`}
                      alt="Referral QR code"
                      width={200}
                      height={200}
                      className="w-48 h-48 rounded-lg"
                    />
                  </div>

                  <p className="text-[10px] text-slate-400 text-center leading-relaxed max-w-[200px]">
                    Anyone who scans this gets credit to your account when they sign up.
                  </p>

                  {/* Actions */}
                  <div className="flex gap-2 w-full max-w-xs">
                    {/* Download */}
                    <a
                      href={`https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=20&color=0f1f34&bgcolor=ffffff&data=${encodeURIComponent(referral.referralUrl)}`}
                      download="gascap-referral-qr.png"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-300 transition-colors"
                    >
                      <span>⬇️</span>
                      <span>Download</span>
                    </a>

                    {/* Share */}
                    <button
                      type="button"
                      onClick={async () => {
                        const shareData = {
                          title: 'GasCap™ — Know before you pull up',
                          text:  'Track your gas spend, calculate fill costs, and never overpay at the pump. Free app:',
                          url:   referral.referralUrl,
                        };
                        if (navigator.share && navigator.canShare?.(shareData)) {
                          await navigator.share(shareData);
                        } else {
                          await copyToClipboard(referral.referralUrl, setCopiedRef);
                        }
                      }}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold transition-colors"
                    >
                      <span>🔗</span>
                      <span>Share Link</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>
        )}

        {/* Monthly Gas Card Giveaway — Pro/Fleet only */}
        {giveaway && (
          <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">Monthly Gas Card</h2>
              <span className="text-[10px] font-black bg-amber-400 text-white px-2 py-0.5 rounded-full">GIVEAWAY</span>
            </div>

            {/* Entry count */}
            <div className="flex items-center gap-4 bg-amber-50 rounded-2xl px-4 py-3">
              <div className="text-center min-w-[48px]">
                <p className="text-3xl font-black text-amber-600">{giveaway.entryCount}</p>
                <p className="text-[10px] text-amber-500 font-bold leading-tight">
                  {giveaway.entryCount === 1 ? 'entry' : 'entries'}
                </p>
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-slate-700">
                  {giveaway.entryCount === 0
                    ? 'No entries yet this month'
                    : `You have ${giveaway.entryCount} entr${giveaway.entryCount === 1 ? 'y' : 'ies'} this month`}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                  Each day you use GasCap™ earns 1 entry — up to 31 per month.
                </p>
              </div>
            </div>

            {/* Progress bar */}
            <div>
              <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                <span>This month&apos;s progress</span>
                <span>{giveaway.entryCount} / 31 days</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (giveaway.entryCount / 31) * 100)}%` }}
                />
              </div>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              🎁 One winner drawn each month wins a <strong>$25 Visa prepaid card</strong>.
              More active days = better odds!
            </p>

            <Link
              href="/sweepstakes-rules"
              className="block text-center text-[11px] text-[#1EB68F] font-bold hover:underline"
            >
              Official Rules &amp; No-Purchase Entry →
            </Link>
          </div>
        )}

        </div>{/* end perks anchor */}

        {/* Preferences section */}
        <div ref={(el) => { sectionRefs.current['preferences'] = el; }}>
          <SectionBanner icon="⚙️" title="Preferences" />
          <div className="bg-white rounded-b-2xl border border-t-0 border-slate-100 shadow-sm p-5 space-y-4">
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

            {/* Dark mode — 3-way: Auto / Light / Dark */}
            <div className="pt-1 border-t border-slate-100 space-y-2">
              <div>
                <p className="text-sm font-semibold text-slate-700">
                  Appearance
                  {darkMode && <span className="ml-2 text-[10px] font-bold text-navy-700 bg-navy-50 px-1.5 py-0.5 rounded-full">🌙 Dark</span>}
                  {!darkMode && <span className="ml-2 text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">☀️ Light</span>}
                </p>
                <p className="text-xs text-slate-400">
                  {themePref === 'auto'
                    ? 'Auto — follows your device (sunrise/sunset)'
                    : themePref === 'dark'
                      ? 'Always dark'
                      : 'Always light'}
                </p>
              </div>
              <div className="flex rounded-xl overflow-hidden border border-slate-200">
                {(['auto', 'light', 'dark'] as ThemePreference[]).map((pref) => {
                  const labels: Record<ThemePreference, string> = { auto: '🌓 Auto', light: '☀️ Light', dark: '🌙 Dark' };
                  const isActive = themePref === pref;
                  return (
                    <button
                      key={pref}
                      onClick={() => handleThemeChange(pref)}
                      className={`flex-1 py-2 text-xs font-bold transition-colors ${
                        isActive
                          ? 'bg-navy-700 text-white'
                          : 'bg-white text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {labels[pref]}
                    </button>
                  );
                })}
              </div>
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
          </div>{/* end Gas Price Alert card */}

        {/* Garage Door — Pro only */}
        <div className={`bg-white rounded-2xl border shadow-sm p-5 space-y-4 ${
          plan === 'pro' || plan === 'fleet' ? 'border-slate-100' : 'border-slate-100 opacity-80'
        }`}>
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">
              Garage Door
            </h2>
            {plan === 'free' && (
              <span className="text-[9px] font-black bg-amber-400 text-white px-2 py-0.5 rounded-full">PRO</span>
            )}
          </div>

          {plan === 'free' ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 leading-relaxed">
                Unlock an animated garage door that opens when you scroll to your
                saved vehicles. Choose your door style and opening direction.
              </p>
              <Link
                href="/upgrade"
                className="inline-block text-xs font-bold text-amber-600 hover:text-amber-700 transition-colors"
              >
                Upgrade to Pro to unlock →
              </Link>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Door style grid */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-600">Door Style</p>
                <div className="grid grid-cols-4 gap-2">
                  {(['classic', 'modern', 'wood', 'steel'] as DoorStyle[]).map((style) => (
                    <button
                      key={style}
                      onClick={() => setDoorStyle(style)}
                      className="flex flex-col items-center gap-1.5 group"
                    >
                      <div className="relative w-full">
                        <DoorMiniPreview style={style} active={doorStyle === style} />
                      </div>
                      <span className={`text-[10px] font-bold transition-colors ${
                        doorStyle === style ? 'text-amber-600' : 'text-slate-400 group-hover:text-slate-600'
                      }`}>
                        {DOOR_STYLE_LABELS[style]}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Opening direction toggle */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-600">Opening Direction</p>
                <div className="flex rounded-xl overflow-hidden border border-slate-200">
                  {(['roll-up', 'slide-left', 'slide-right'] as DoorDirection[]).map((dir) => (
                    <button
                      key={dir}
                      onClick={() => setDoorDirection(dir)}
                      className={`flex-1 py-2 text-[10px] font-bold transition-colors ${
                        doorDirection === dir
                          ? 'bg-navy-700 text-white'
                          : 'bg-white text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {DOOR_DIRECTION_LABELS[dir]}
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                The door opens the first time you scroll to your garage each visit,
                then stays open until you leave or sign out.
              </p>
            </div>
          )}
        </div>{/* end Garage Door card */}

        </div>{/* end preferences section */}

        {/* Fleet branding section */}
        {(livePlan === 'fleet' || (session?.user as { plan?: string })?.plan === 'fleet') && (
          <section id="fleet" ref={(el) => { sectionRefs.current.fleet = el; }} className="space-y-3">
            <SectionBanner icon="🚛" title="Fleet Branding" />
            <div className="bg-white dark:bg-slate-800 rounded-b-2xl border border-t-0 border-slate-100 dark:border-slate-700 p-5 space-y-4">
              <p className="text-xs text-slate-500 leading-relaxed">
                White-label the GasCap™ dashboard for your fleet. Your company logo and name appear in the desktop header for all fleet users.
              </p>

              {/* Company name */}
              <div>
                <label className="field-label">Company Name</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Acme Logistics LLC"
                  value={fleetCompanyName}
                  onChange={(e) => setFleetCompanyName(e.target.value)}
                  maxLength={60}
                />
              </div>

              {/* Logo URL */}
              <div>
                <label className="field-label">Logo URL <span className="text-slate-400 font-normal">(must start with https://)</span></label>
                <input
                  type="url"
                  className="input-field"
                  placeholder="https://yourcompany.com/logo.png"
                  value={fleetLogoUrl}
                  onChange={(e) => setFleetLogoUrl(e.target.value)}
                />
                <p className="field-hint">Use a PNG or SVG on a transparent or dark background for best results. Recommended size: 160×40px or similar.</p>
              </div>

              {/* Logo preview */}
              {fleetLogoUrl && fleetLogoUrl.startsWith('https://') && (
                <div>
                  <p className="field-label">Preview</p>
                  <div className="rounded-xl bg-[#1E2D4A] p-4 inline-flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={fleetLogoUrl}
                      alt="Logo preview"
                      className="h-8 w-auto object-contain"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    <div>
                      <p className="text-white text-sm font-black">{fleetCompanyName || 'Your Company'}</p>
                      <p className="text-white/40 text-[10px]">Powered by GasCap™ Fleet</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Save button */}
              <button
                onClick={async () => {
                  setFleetSaving(true);
                  try {
                    const res = await fetch('/api/fleet/branding', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ companyName: fleetCompanyName, logoUrl: fleetLogoUrl }),
                    });
                    if (res.ok) { setFleetSaved(true); setTimeout(() => setFleetSaved(false), 3000); }
                  } finally {
                    setFleetSaving(false);
                  }
                }}
                disabled={fleetSaving}
                className="btn-amber"
              >
                {fleetSaving ? 'Saving…' : fleetSaved ? '✓ Saved!' : 'Save Fleet Branding'}
              </button>
            </div>
          </section>
        )}

        <p className="text-center text-[11px] text-slate-300 pb-4">GasCap™ v0.1 · Gas Capacity</p>
      </div>
    </div>
  );
}
