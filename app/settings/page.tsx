'use client';

import { useSession, signOut } from 'next-auth/react';
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { setThemePreference, getThemePreference, isDarkMode, type ThemePreference } from '@/components/DarkModeProvider';
import { DoorMiniPreview, DOOR_STYLE_LABELS, DOOR_DIRECTION_LABELS } from '@/components/GarageDoor';
import { useGarageDoorPrefs, type DoorStyle, type DoorDirection } from '@/hooks/useGarageDoorPrefs';
import { useTranslation } from '@/contexts/LanguageContext';

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

const AVATAR_URL_KEY = 'gascap_avatar_url';

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
  const { t, locale } = useTranslation();
  const intlLocale = locale === 'es' ? 'es-ES' : 'en-US';
  const AVATAR_COLOR_KEY = 'gascap_avatar_color';
  const [avatarColor,    setAvatarColor]    = useState('bg-amber-500');

  useEffect(() => {
    const saved = localStorage.getItem(AVATAR_COLOR_KEY);
    if (saved) setAvatarColor(saved);
    setDarkMode(isDarkMode());
    setThemePref(getThemePreference());
  }, []);
  const [avatarUrl,      setAvatarUrl]      = useState('');
  const fileInputRef     = useRef<HTMLInputElement>(null);

  // ── Crop modal state ─────────────────────────────────────────────────────
  const [cropSrc,       setCropSrc]       = useState('');
  const [cropScale,     setCropScale]     = useState(1);
  const [cropOffset,    setCropOffset]    = useState({ x: 0, y: 0 });
  const [cropImgSize,   setCropImgSize]   = useState({ w: 1, h: 1 });
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const cropContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef    = useRef(false);
  const dragStartRef     = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const lastPinchRef     = useRef<number | null>(null);
  // ─────────────────────────────────────────────────────────────────────────

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
  const [liveInterval,     setLiveInterval]     = useState<string | null>(null);
  const [giveaway,         setGiveaway]         = useState<GiveawayEntries | null>(null);
  const [preferredFillLevel, setPreferredFillLevel] = useState<number | null>(null);
  const [monthlyFuelBudget,  setMonthlyFuelBudget]  = useState('');
  const [budgetHighlight,    setBudgetHighlight]    = useState(false);
  const budgetSectionRef = useRef<HTMLDivElement>(null);
  const [fleetCompanyName, setFleetCompanyName] = useState('');
  const [fleetLogoUrl,     setFleetLogoUrl]     = useState('');
  const [fleetSaved,       setFleetSaved]       = useState(false);
  const [fleetSaving,      setFleetSaving]      = useState(false);
  const { doorStyle, setDoorStyle, doorDirection, setDoorDirection } = useGarageDoorPrefs();

  useEffect(() => {
    if (!session) return;
    fetch('/api/vehicles')
      .then((r) => r.json())
      .then((d: { plan?: string; stripeInterval?: string | null }) => {
        if (d.plan) setLivePlan(d.plan);
        setLiveInterval(d.stripeInterval ?? null);
      })
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
      .then((d: { displayName?: string; phone?: string; smsOptIn?: boolean; avatarUrl?: string; preferredFillLevel?: number | null; monthlyFuelBudget?: number | null }) => {
        if (d.displayName)            setDisplayName(d.displayName);
        if (d.phone)                  setPhone(d.phone);
        if (d.smsOptIn !== undefined) setSmsOptIn(d.smsOptIn);
        if (d.preferredFillLevel != null) {
          setPreferredFillLevel(d.preferredFillLevel);
          localStorage.setItem('gascap_fill_pref', String(d.preferredFillLevel));
        }
        if (d.monthlyFuelBudget  != null) setMonthlyFuelBudget(String(d.monthlyFuelBudget));
        // Seed localStorage from DB so AuthButton picks it up without its own fetch
        if (d.avatarUrl) {
          setAvatarUrl(d.avatarUrl);
          localStorage.setItem(AVATAR_URL_KEY, d.avatarUrl);
        } else {
          // Clear stale localStorage if DB has no photo
          localStorage.removeItem(AVATAR_URL_KEY);
        }
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
    { id: 'profile',     label: t.settings.tabProfile     },
    { id: 'account',     label: t.settings.tabAccount     },
    { id: 'plan',        label: t.settings.tabPlan        },
    { id: 'perks',       label: t.settings.tabPerks       },
    { id: 'preferences', label: t.settings.tabPreferences },
    { id: 'fleet',       label: t.settings.tabFleet       },
  ] as const;

  type TabId = (typeof ALL_TABS)[number]['id'];

  // Only show the Fleet tab when the user is on the fleet plan
  const currentPlanForTabs = livePlan ?? (session?.user as { plan?: string })?.plan ?? 'free';
  const TABS = ALL_TABS.filter((t) => t.id !== 'fleet' || currentPlanForTabs === 'fleet');

  const [activeTab, setActiveTab] = useState<TabId>('profile');
  const sectionRefs             = useRef<Partial<Record<TabId, HTMLElement | null>>>({});
  const fixedHeaderRef          = useRef<HTMLDivElement>(null);
  // Prevents the scroll listener from overriding activeTab during a programmatic scroll
  const isProgrammaticScrollRef = useRef(false);

  function scrollToSection(id: TabId) {
    const el      = sectionRefs.current[id];
    if (!el) return;
    const headerH = (fixedHeaderRef.current?.offsetHeight ?? 112) + 8;
    const top     = el.getBoundingClientRect().top + window.scrollY - headerH;
    isProgrammaticScrollRef.current = true;
    window.scrollTo({ top, behavior: 'smooth' });
    setActiveTab(id);
    // Release lock after smooth scroll completes (~600 ms typical)
    setTimeout(() => { isProgrammaticScrollRef.current = false; }, 800);
  }

  useEffect(() => {
    function onScroll() {
      // Don't let user-scroll events clobber a tab we just set programmatically
      if (isProgrammaticScrollRef.current) return;
      const headerH = (fixedHeaderRef.current?.offsetHeight ?? 112) + 8;
      const scrollY = window.scrollY + headerH;
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

  // Auto-scroll to preferences + flash the budget section when arriving via ?tab=preferences
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') !== 'preferences') return;

    // Wait for session + refs to settle before scrolling.
    // 800 ms gives mobile browsers time to fully paint the layout before
    // we read getBoundingClientRect — 300 ms was too short on mobile.
    const scrollTimer = setTimeout(() => {
      // rAF ensures we read element positions after the browser's next paint
      requestAnimationFrame(() => {
        // Use the same function as clicking the Preferences tab — identical position
        scrollToSection('preferences');

        // Flash the budget section 3× after the scroll lands
        const flashTimer = setTimeout(() => {
          let count = 0;
          const interval = setInterval(() => {
            setBudgetHighlight((v) => !v);
            count++;
            if (count >= 6) clearInterval(interval); // 3 on + 3 off = 6 toggles
          }, 380);
        }, 700);
        // Note: flashTimer cleanup is best-effort; the component will unmount cleanly
        void flashTimer;
      });
    }, 800);

    return () => clearTimeout(scrollTimer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Render the positioned image to a 128×128 canvas and save. */
  const handleCropConfirm = useCallback(() => {
    if (!cropSrc) return;
    const CONTAINER = 280;
    const OUTPUT    = 128;
    const img = new Image();
    img.onload = () => {
      const imgLeft = CONTAINER / 2 + cropOffset.x - img.width  * cropScale / 2;
      const imgTop  = CONTAINER / 2 + cropOffset.y - img.height * cropScale / 2;
      const sx    = -imgLeft / cropScale;
      const sy    = -imgTop  / cropScale;
      const sSize = CONTAINER / cropScale;
      const canvas = document.createElement('canvas');
      canvas.width  = OUTPUT;
      canvas.height = OUTPUT;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUTPUT, OUTPUT);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      setAvatarUrl(dataUrl);
      localStorage.setItem(AVATAR_URL_KEY, dataUrl);
      window.dispatchEvent(new StorageEvent('storage', { key: AVATAR_URL_KEY, newValue: dataUrl }));
      setCropModalOpen(false);
    };
    img.src = cropSrc;
  }, [cropSrc, cropOffset, cropScale]);

  // Non-passive wheel listener so we can preventDefault inside the crop modal
  useEffect(() => {
    const el = cropContainerRef.current;
    if (!el) return;
    const CONTAINER = 280;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const minScale = Math.max(CONTAINER / cropImgSize.w, CONTAINER / cropImgSize.h);
      const delta    = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(minScale, Math.min(cropScale * delta, minScale * 5));
      // Inline clamp — image must always cover the 280px container
      const maxX = Math.max(0, (cropImgSize.w * newScale - CONTAINER) / 2);
      const maxY = Math.max(0, (cropImgSize.h * newScale - CONTAINER) / 2);
      setCropScale(newScale);
      setCropOffset({
        x: Math.max(-maxX, Math.min(maxX, cropOffset.x)),
        y: Math.max(-maxY, Math.min(maxY, cropOffset.y)),
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [cropModalOpen, cropScale, cropOffset, cropImgSize]);

  /** Open crop modal instead of auto-cropping. */
  const handlePhotoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const CONTAINER = 280;
        const minScale  = Math.max(CONTAINER / img.width, CONTAINER / img.height);
        setCropSrc(src);
        setCropImgSize({ w: img.width, h: img.height });
        setCropScale(minScale);
        setCropOffset({ x: 0, y: 0 });
        setCropModalOpen(true);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }, []);

  if (status === 'loading') {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
    </div>;
  }

  if (!session) {
    return <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4 px-6">
      <p className="text-slate-600 font-semibold">{t.settings.signInPrompt}</p>
      <Link href="/signin" className="px-6 py-3 bg-amber-500 text-white font-bold rounded-2xl">{t.settings.signInBtn}</Link>
    </div>;
  }

  const name         = displayName || session.user?.name || t.settings.defaultName;
  const plan         = livePlan ?? session.user?.plan ?? 'free';
  const isProTrial   = (session.user as { isProTrial?: boolean })?.isProTrial ?? false;
  const stripeInterval = liveInterval ?? (session.user as { stripeInterval?: string | null })?.stripeInterval ?? null;
  const isProLifetime  = plan === 'pro' && !isProTrial && stripeInterval === 'lifetime';
  const canUploadPhoto = plan === 'pro' || plan === 'fleet' || isProTrial;

  const planConfig = isProLifetime
    ? { label: t.settings.planProLifetimeLabel, bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200' }
    : ({
        free:  { label: t.settings.planFreeLabel,  bg: 'bg-slate-100',   text: 'text-slate-600', border: 'border-slate-200' },
        pro:   { label: t.settings.planProLabel,   bg: 'bg-amber-50',    text: 'text-amber-700', border: 'border-amber-200' },
        fleet: { label: t.settings.planFleetLabel, bg: 'bg-blue-50',     text: 'text-blue-700',  border: 'border-blue-200'  },
      }[plan] ?? { label: t.settings.planFreeLabel, bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200' });

  async function openPortal() {
    setPortalLoading(true);
    try {
      const res  = await fetch('/api/stripe/portal', { method: 'POST' });
      const data = await res.json() as { url?: string; error?: string };
      if (data.url) window.location.href = data.url;
      else alert(data.error ?? t.settings.portalError);
    } catch {
      alert(t.settings.portalReachError);
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
      else alert(data.error ?? t.settings.checkoutError);
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
        body: JSON.stringify({
          displayName,
          phone,
          smsOptIn,
          avatarUrl:          avatarUrl || null,
          preferredFillLevel: preferredFillLevel ?? null,
          monthlyFuelBudget:  monthlyFuelBudget ? parseFloat(monthlyFuelBudget) : null,
        }),
      });
      // Keep fill preference in localStorage so calculators can read it without an API call
      if (preferredFillLevel != null) {
        localStorage.setItem('gascap_fill_pref', String(preferredFillLevel));
      } else {
        localStorage.removeItem('gascap_fill_pref');
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  /** Clamp crop pan offset so the image always covers the full 280×280 container. */
  function clampCropOffset(ox: number, oy: number, scale: number, imgW: number, imgH: number) {
    const CONTAINER = 280;
    const maxX = Math.max(0, (imgW * scale - CONTAINER) / 2);
    const maxY = Math.max(0, (imgH * scale - CONTAINER) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, ox)),
      y: Math.max(-maxY, Math.min(maxY, oy)),
    };
  }


  function removePhoto() {
    setAvatarUrl('');
    localStorage.removeItem(AVATAR_URL_KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: AVATAR_URL_KEY, newValue: null }));
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

      {/* ── Photo Crop Modal ──────────────────────────────────────────────── */}
      {cropModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden">

            {/* Modal header */}
            <div className="px-5 pt-5 pb-3 flex items-center justify-between">
              <h3 className="text-base font-black text-slate-800 dark:text-slate-100">{t.settings.cropTitle}</h3>
              <button
                onClick={() => setCropModalOpen(false)}
                className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center
                           text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors text-sm"
                aria-label={t.settings.cropCancelAria}
              >✕</button>
            </div>

            {/* Hint text */}
            <p className="text-center text-[11px] text-slate-400 -mt-1 mb-2">
              {t.settings.cropHint}
            </p>

            {/* 280×280 crop canvas */}
            <div className="flex justify-center px-5">
              <div
                ref={cropContainerRef}
                className="relative overflow-hidden rounded-full cursor-grab active:cursor-grabbing select-none touch-none"
                style={{ width: 280, height: 280 }}
                onPointerDown={(e) => {
                  // Ignore if it's a second finger (handled by touch handlers)
                  isDraggingRef.current = true;
                  dragStartRef.current = {
                    x: e.clientX, y: e.clientY,
                    ox: cropOffset.x, oy: cropOffset.y,
                  };
                  (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (!isDraggingRef.current) return;
                  const dx = e.clientX - dragStartRef.current.x;
                  const dy = e.clientY - dragStartRef.current.y;
                  const clamped = clampCropOffset(
                    dragStartRef.current.ox + dx,
                    dragStartRef.current.oy + dy,
                    cropScale, cropImgSize.w, cropImgSize.h,
                  );
                  setCropOffset(clamped);
                }}
                onPointerUp={() => { isDraggingRef.current = false; }}
                onPointerCancel={() => { isDraggingRef.current = false; }}
                onTouchStart={(e) => {
                  if (e.touches.length === 2) {
                    isDraggingRef.current = false; // disable pan during pinch
                    const dx = e.touches[0].clientX - e.touches[1].clientX;
                    const dy = e.touches[0].clientY - e.touches[1].clientY;
                    lastPinchRef.current = Math.sqrt(dx * dx + dy * dy);
                  }
                }}
                onTouchMove={(e) => {
                  if (e.touches.length !== 2 || lastPinchRef.current === null) return;
                  const dx   = e.touches[0].clientX - e.touches[1].clientX;
                  const dy   = e.touches[0].clientY - e.touches[1].clientY;
                  const dist = Math.sqrt(dx * dx + dy * dy);
                  const CONTAINER = 280;
                  const minScale  = Math.max(CONTAINER / cropImgSize.w, CONTAINER / cropImgSize.h);
                  const ratio     = dist / lastPinchRef.current;
                  const newScale  = Math.max(minScale, Math.min(cropScale * ratio, minScale * 5));
                  const clamped   = clampCropOffset(cropOffset.x, cropOffset.y, newScale, cropImgSize.w, cropImgSize.h);
                  setCropScale(newScale);
                  setCropOffset(clamped);
                  lastPinchRef.current = dist;
                }}
                onTouchEnd={() => { lastPinchRef.current = null; }}
              >
                {/* The source image — positioned by scale + offset */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cropSrc}
                  alt=""
                  draggable={false}
                  style={{
                    position:  'absolute',
                    width:     cropImgSize.w * cropScale,
                    height:    cropImgSize.h * cropScale,
                    left:      140 + cropOffset.x - (cropImgSize.w * cropScale) / 2,
                    top:       140 + cropOffset.y - (cropImgSize.h * cropScale) / 2,
                    userSelect: 'none',
                    pointerEvents: 'none',
                  }}
                />
              </div>
            </div>

            {/* Zoom slider */}
            <div className="px-8 pt-4 pb-1">
              <div className="flex items-center gap-3">
                <svg viewBox="0 0 20 20" className="w-4 h-4 flex-shrink-0 text-slate-400" fill="currentColor">
                  <path fillRule="evenodd" d="M9 3a6 6 0 100 12A6 6 0 009 3zM1 9a8 8 0 1114.32 4.906l3.387 3.387a1 1 0 01-1.414 1.414l-3.387-3.387A8 8 0 011 9z" clipRule="evenodd"/>
                </svg>
                <input
                  type="range"
                  className="flex-1 accent-brand-teal"
                  min={Math.max(280 / cropImgSize.w, 280 / cropImgSize.h)}
                  max={Math.max(280 / cropImgSize.w, 280 / cropImgSize.h) * 5}
                  step={0.01}
                  value={cropScale}
                  onChange={(e) => {
                    const newScale = parseFloat(e.target.value);
                    const clamped  = clampCropOffset(cropOffset.x, cropOffset.y, newScale, cropImgSize.w, cropImgSize.h);
                    setCropScale(newScale);
                    setCropOffset(clamped);
                  }}
                />
                <svg viewBox="0 0 20 20" className="w-5 h-5 flex-shrink-0 text-slate-400" fill="currentColor">
                  <path fillRule="evenodd" d="M9 3a6 6 0 100 12A6 6 0 009 3zM1 9a8 8 0 1114.32 4.906l3.387 3.387a1 1 0 01-1.414 1.414l-3.387-3.387A8 8 0 011 9z" clipRule="evenodd"/>
                </svg>
              </div>
            </div>

            {/* Action buttons */}
            <div className="px-5 pt-3 pb-5 flex gap-3">
              <button
                onClick={() => setCropModalOpen(false)}
                className="flex-1 py-3 rounded-2xl border border-slate-200 text-sm font-bold
                           text-slate-500 hover:bg-slate-50 transition-colors"
              >
                {t.settings.cropCancel}
              </button>
              <button
                onClick={handleCropConfirm}
                className="flex-1 py-3 rounded-2xl bg-brand-teal text-white text-sm font-black
                           hover:bg-brand-dark transition-colors shadow-sm"
              >
                {t.settings.cropUse}
              </button>
            </div>

          </div>
        </div>
      )}
      {/* ─────────────────────────────────────────────────────────────────── */}

      {/* Fixed header + tab bar — position:fixed guarantees it never scrolls away */}
      <div ref={fixedHeaderRef} className="fixed inset-x-0 top-0 z-20 shadow-md">
        {/* Header */}
        <div className="bg-navy-700 px-5 pt-4 pb-3">
          <div className="max-w-lg mx-auto flex items-center gap-4">
            <Link href="/" className="text-white/60 hover:text-white transition-colors">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
            </Link>
            <h1 className="text-white font-black text-xl">{t.settings.title}</h1>
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
          <SectionBanner icon="👤" title={t.settings.profileTitle} />
          <div className="bg-white rounded-b-2xl border border-t-0 border-slate-100 shadow-sm p-5 space-y-5">

          {/* Avatar preview + photo upload + color picker */}
          <div className="flex flex-col items-center gap-3">

            {/* Photo or initials */}
            <div className="relative group">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={t.settings.profilePhotoAlt}
                  className="w-20 h-20 rounded-full object-cover shadow-md ring-2 ring-white"
                />
              ) : (
                <Avatar name={name} color={avatarColor} />
              )}
              {/* Remove-photo X — Pro/Fleet only, appears on hover when photo is set */}
              {avatarUrl && canUploadPhoto && (
                <button
                  onClick={removePhoto}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 hover:bg-red-600
                             rounded-full text-white text-[10px] flex items-center justify-center
                             opacity-0 group-hover:opacity-100 transition-opacity shadow"
                  aria-label={t.settings.removePhotoAria}
                >
                  ✕
                </button>
              )}
            </div>

            {canUploadPhoto ? (
              <>
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={handlePhotoUpload}
                />
                {/* Upload / change button */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs font-semibold text-brand-teal hover:text-brand-dark
                             transition-colors flex items-center gap-1"
                >
                  <span aria-hidden="true">📷</span>
                  {avatarUrl ? t.settings.changePhoto : t.settings.uploadPhoto}
                </button>
                <p className="text-[10px] text-slate-400 -mt-1">{t.settings.photoHint}</p>
              </>
            ) : (
              /* Free-user locked nudge */
              <a
                href="/upgrade"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full
                           bg-amber-50 border border-amber-200 hover:border-amber-300
                           transition-colors group/photo"
              >
                <span className="text-[11px]" aria-hidden="true">🔒</span>
                <span className="text-[11px] font-bold text-amber-700 group-hover/photo:text-amber-800">
                  {t.settings.photoLocked}
                </span>
                <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-amber-500 flex-shrink-0"
                     fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M2 6h8M6 2l4 4-4 4"/>
                </svg>
              </a>
            )}

            {/* Color picker — only shown when no photo is set */}
            {!avatarUrl && (
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
            )}
          </div>

          {/* Display name */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t.settings.displayNameLabel}</label>
            <input
              type="text"
              autoCapitalize="words"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800
                         focus:outline-none focus:ring-2 focus:ring-amber-400"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={session.user?.name ?? t.settings.displayNamePlaceholder}
              maxLength={50}
            />
          </div>

          {/* Email (read-only) */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t.settings.emailLabel}</label>
            <div className="w-full border border-slate-100 rounded-xl px-3 py-2.5 text-sm text-slate-400 bg-slate-50">
              {session.user?.email}
            </div>
          </div>

          {/* Phone (optional) */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">
              {t.settings.phoneLabel} <span className="text-slate-300 font-normal">{t.settings.phoneOptional}</span>
            </label>
            <input
              type="tel"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800
                         focus:outline-none focus:ring-2 focus:ring-amber-400"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); if (!e.target.value.trim()) setSmsOptIn(false); }}
              placeholder={t.settings.phonePlaceholder}
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
                  {t.settings.smsTitle}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  {t.settings.smsBody}
                  {!phone.trim() && (
                    <span className="block mt-0.5 text-amber-600 font-medium">{t.settings.smsAddPhone}</span>
                  )}
                </p>
              </div>
            </label>
            {smsOptIn && (
              <p className="mt-2 text-[11px] text-teal-700 border-t border-teal-200 pt-2">
                {t.settings.smsConsent}
              </p>
            )}
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 text-white font-bold text-sm transition-colors disabled:opacity-60"
          >
            {saved ? t.settings.saved : saving ? t.settings.saving : t.settings.saveChanges}
          </button>
          </div>{/* end profile card */}
        </div>{/* end profile section */}

        {/* Account section */}
        <div ref={(el) => { sectionRefs.current['account'] = el; }}>
          <SectionBanner icon="🔐" title={t.settings.accountTitle} />
          <div className="bg-white rounded-b-2xl border border-t-0 border-slate-100 shadow-sm p-5 space-y-4">

            {/* Email + verification status */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500">{t.settings.emailAddress}</p>
                <p className="text-sm text-slate-800 mt-0.5">{session.user?.email}</p>
              </div>
              {(session.user as { emailVerified?: boolean }).emailVerified ? (
                <span className="text-[10px] font-black bg-green-100 text-green-700 px-2 py-1 rounded-full">{t.settings.verified}</span>
              ) : (
                <span className="text-[10px] font-black bg-amber-100 text-amber-700 px-2 py-1 rounded-full">{t.settings.unverified}</span>
              )}
            </div>

            {/* Member since */}
            {(session.user as { createdAt?: string | null }).createdAt && (
              <div>
                <p className="text-xs font-semibold text-slate-500">{t.settings.memberSince}</p>
                <p className="text-sm text-slate-700 mt-0.5">
                  {new Date((session.user as unknown as { createdAt: string }).createdAt).toLocaleDateString(intlLocale, { month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
            )}

            <div className="border-t border-slate-100 pt-3 space-y-2">
              <Link
                href="/help"
                className="flex items-center justify-between w-full py-2.5 px-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors"
              >
                <span className="text-sm font-semibold text-slate-700">{t.settings.helpFaq}</span>
                <span className="text-slate-400 text-xs">→</span>
              </Link>
              <Link
                href="/contact"
                className="flex items-center justify-between w-full py-2.5 px-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors"
              >
                <span className="text-sm font-semibold text-slate-700">{t.settings.contactSupport}</span>
                <span className="text-slate-400 text-xs">→</span>
              </Link>
              <div className="flex gap-2">
                <Link href="/privacy" className="flex-1 text-center text-[11px] font-bold text-slate-400 hover:text-slate-600 py-2">
                  {t.settings.privacyPolicy}
                </Link>
                <Link href="/terms" className="flex-1 text-center text-[11px] font-bold text-slate-400 hover:text-slate-600 py-2">
                  {t.settings.termsOfUse}
                </Link>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-3">
              <button
                onClick={() => signOut({ callbackUrl: '/' })}
                className="w-full py-3 rounded-2xl border-2 border-red-100 text-sm font-bold
                           text-red-500 hover:bg-red-50 transition-colors"
              >
                {t.settings.signOut}
              </button>
            </div>
          </div>
        </div>

        {/* Plan section */}
        <div ref={(el) => { sectionRefs.current['plan'] = el; }}>
          <SectionBanner icon="⭐" title={t.settings.planTitle} />
          <div className={`bg-white rounded-b-2xl border border-t-0 shadow-sm p-5 space-y-4 ${planConfig.border}`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-black px-2.5 py-1 rounded-full ${planConfig.bg} ${planConfig.text}`}>
              {isProLifetime && '🏅 '}{planConfig.label.toUpperCase()}
            </span>
          </div>

          {plan === 'free' && (
            <>
              <p className="text-sm text-slate-500">
                {t.settings.freePlanDesc}
              </p>
              <button
                onClick={() => handleUpgrade('pro')}
                disabled={portalLoading}
                className="flex items-center justify-between w-full py-3 px-4 rounded-2xl
                           bg-amber-500 hover:bg-amber-400 text-white font-bold text-sm transition-colors disabled:opacity-50"
              >
                <span>{t.settings.upgradeToProBtn}</span>
                <span>{t.settings.proPriceArrow}</span>
              </button>
            </>
          )}

          {isProLifetime && (
            <>
              <p className="text-sm text-slate-500">
                {t.settings.lifetimeDesc1Pre}<strong className="text-teal-700">{t.settings.lifetimeMember}</strong>{t.settings.lifetimeDesc1Post}
              </p>
              <p className="text-sm text-slate-500">
                {t.settings.lifetimeDesc2}
              </p>
            </>
          )}

          {plan === 'pro' && !isProLifetime && (
            <>
              <p className="text-sm text-slate-500">
                {t.settings.proDesc}
              </p>
              <button
                onClick={openPortal}
                disabled={portalLoading}
                className="w-full py-3 rounded-2xl border-2 border-slate-200 text-sm font-bold
                           text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                {portalLoading ? t.settings.opening : t.settings.manageBilling}
              </button>
              <p className="text-center text-[11px] text-slate-400">
                {t.settings.manageBillingHint}
              </p>
            </>
          )}

          {plan === 'fleet' && (
            <>
              <p className="text-sm text-slate-500">
                {t.settings.fleetDesc}
              </p>
              <Link
                href="/fleet"
                className="flex items-center justify-between w-full py-3 px-4 rounded-2xl
                           bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm transition-colors"
              >
                <span>{t.settings.fleetDashboardBtn}</span>
                <span>{t.settings.fleetDashboardArrow}</span>
              </Link>
              <button
                onClick={openPortal}
                disabled={portalLoading}
                className="w-full py-3 rounded-2xl border-2 border-slate-200 text-sm font-bold
                           text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                {portalLoading ? t.settings.opening : t.settings.manageBilling}
              </button>
              <p className="text-center text-[11px] text-slate-400">
                {t.settings.manageBillingHint}
              </p>
            </>
          )}
          </div>{/* end plan card */}
        </div>{/* end plan section */}

        {/* Perks section — wraps Referral + Giveaway */}
        <div ref={(el) => { sectionRefs.current['perks'] = el; }} className="space-y-4">
          <SectionBanner icon="🎁" title={t.settings.perksTitle} />

        {/* Referral summary */}
        {referral && (
          <div className="bg-white rounded-b-2xl border border-t-0 border-slate-100 shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <Link href="/?tab=referral" className="text-[11px] text-amber-500 font-bold hover:underline">
                {t.settings.fullDetails}
              </Link>
            </div>

            {/* How credits are earned */}
            <p className="text-[11px] text-slate-500 leading-relaxed bg-slate-50 rounded-xl px-3 py-2.5">
              {t.settings.referralExplain1}<strong>{t.settings.referralExplainBold1}</strong>{t.settings.referralExplain2}<strong>{t.settings.referralExplainBold2}</strong>{t.settings.referralExplain3}
            </p>

          {/* Stats */}
            <div className="flex gap-3">
              <div className="flex-1 bg-slate-50 rounded-xl px-3 py-2 text-center">
                <p className="text-lg font-black text-slate-700">{referral.referralCount}</p>
                <p className="text-[10px] text-slate-400">{t.settings.paidReferrals}</p>
              </div>
              <div className={`flex-1 rounded-xl px-3 py-2 text-center ${referral.activeCredits > 0 ? 'bg-amber-50' : 'bg-slate-50'}`}>
                <p className={`text-lg font-black ${referral.activeCredits > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                  {referral.activeCredits}
                </p>
                <p className="text-[10px] text-slate-400">{t.settings.creditsBanked}</p>
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
                  ? t.settings.creditsReady(referral.redeemableMonths)
                  : t.settings.creditsBankedMsg(referral.activeCredits)}
                {referral.nextExpiryDate && (
                  <span className="block text-[10px] text-slate-400 mt-0.5">
                    {t.settings.earliestExpiry(new Date(referral.nextExpiryDate).toLocaleDateString(intlLocale, { month: 'short', day: 'numeric', year: 'numeric' }))}
                  </span>
                )}
              </p>
            )}

            {/* Referral link */}
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">{t.settings.yourReferralLink}</p>
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

            {/* QR code share — moved here so it sits right next to the referral link */}
            <div>
              <button
                type="button"
                onClick={() => setShowQR((v) => !v)}
                className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-amber-600 transition-colors"
              >
                <span className="text-base">📱</span>
                <span>{showQR ? t.settings.hideQr : t.settings.showQr}</span>
                <svg viewBox="0 0 16 16" className={`w-3 h-3 transition-transform ${showQR ? 'rotate-180' : ''}`} fill="currentColor" aria-hidden="true">
                  <path d="M8 10.5L2.5 5h11L8 10.5z" />
                </svg>
              </button>

              {showQR && (
                <div className="mt-3 flex flex-col items-center gap-3 bg-slate-50 border border-slate-200 rounded-2xl p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{t.settings.scanToJoin}</p>

                  {/* QR code image — generated by free api.qrserver.com */}
                  <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=4&color=0f1f34&bgcolor=ffffff&data=${encodeURIComponent(referral.referralUrl)}`}
                      alt={t.settings.qrAlt}
                      width={200}
                      height={200}
                      className="w-48 h-48 rounded-lg"
                    />
                  </div>

                  <p className="text-[10px] text-slate-400 text-center leading-relaxed max-w-[200px]">
                    {t.settings.qrExplain}
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
                      <span>{t.settings.download}</span>
                    </a>

                    {/* Share */}
                    <button
                      type="button"
                      onClick={async () => {
                        const shareData = {
                          title: t.settings.shareTitle,
                          text:  t.settings.shareText,
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
                      <span>{t.settings.shareLink}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Ambassador program link */}
            <Link
              href="/ambassador"
              className="flex items-center justify-between text-xs font-bold text-slate-500 hover:text-navy-700 transition-colors py-1"
            >
              <span>{t.settings.becomeAmbassador}</span>
              <span className="text-slate-300">→</span>
            </Link>

            {/* GasCaptains™ community link — paid Pro & Fleet only (trial excluded) */}
            {((plan === 'pro' && !isProTrial) || plan === 'fleet') ? (
              <div className="space-y-1">
                <a
                  href={process.env.NEXT_PUBLIC_GASCAPTAINS_URL ?? 'https://www.facebook.com/groups/gascaptains'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between text-xs font-bold text-slate-500 hover:text-[#005F4A] transition-colors py-1"
                >
                  <span>{t.settings.joinGascaptains}</span>
                  <span className="text-slate-300">→</span>
                </a>
                <p className="text-[10px] text-amber-600 font-semibold">{t.settings.gascaptainsBuilding}</p>
              </div>
            ) : (
              <div className="flex items-center justify-between py-1 pointer-events-none select-none opacity-60">
                <div>
                  <p className="text-xs font-bold text-slate-400">{t.settings.gascaptainsLocked}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{t.settings.gascaptainsLockedSub}</p>
                </div>
                <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full whitespace-nowrap ml-2">{t.settings.gascaptainsBadge}</span>
              </div>
            )}

          </div>
        )}

        {/* Monthly Gas Card Giveaway — Pro/Fleet only */}
        {giveaway && (
          <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">{t.settings.monthlyGasCard}</h2>
              <span className="text-[10px] font-black bg-amber-400 text-white px-2 py-0.5 rounded-full">{t.settings.giveawayBadge}</span>
            </div>

            {/* Entry count */}
            <div className="flex items-center gap-4 bg-amber-50 rounded-2xl px-4 py-3">
              <div className="text-center min-w-[48px]">
                <p className="text-3xl font-black text-amber-600">{giveaway.entryCount}</p>
                <p className="text-[10px] text-amber-500 font-bold leading-tight">
                  {giveaway.entryCount === 1 ? t.settings.entrySingular : t.settings.entryPlural}
                </p>
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-slate-700">
                  {giveaway.entryCount === 0
                    ? t.settings.noEntriesYet
                    : t.settings.entriesThisMonth(giveaway.entryCount)}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                  {t.settings.dailyEntryNote}
                </p>
              </div>
            </div>

            {/* Progress bar */}
            <div>
              <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                <span>{t.settings.monthProgress}</span>
                <span>{t.settings.daysProgress(giveaway.entryCount)}</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (giveaway.entryCount / 31) * 100)}%` }}
                />
              </div>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              {t.settings.giveawayPrizeNote1}<strong>{t.settings.giveawayPrizeBold}</strong>{t.settings.giveawayPrizeNote2}
            </p>

            <Link
              href="/sweepstakes-rules"
              className="block text-center text-[11px] text-[#1EB68F] font-bold hover:underline"
            >
              {t.settings.officialRules}
            </Link>
          </div>
        )}

        </div>{/* end perks anchor */}

        {/* Preferences section */}
        <div ref={(el) => { sectionRefs.current['preferences'] = el; }}>
          <SectionBanner icon="⚙️" title={t.settings.preferencesTitle} />
          <div className="bg-white rounded-b-2xl border border-t-0 border-slate-100 shadow-sm p-5 space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-700">{t.settings.defaultFuelUnit}</p>
                <p className="text-xs text-slate-400">{t.settings.fuelUnitSub}</p>
              </div>
              <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">{t.settings.gallonsLabel}</span>
            </div>
            {/* Dark mode — 3-way: Auto / Light / Dark */}
            <div className="pt-1 border-t border-slate-100 space-y-2">
              <div>
                <p className="text-sm font-semibold text-slate-700">
                  {t.settings.appearance}
                  {darkMode && <span className="ml-2 text-[10px] font-bold text-navy-700 bg-navy-50 px-1.5 py-0.5 rounded-full">{t.settings.darkBadge}</span>}
                  {!darkMode && <span className="ml-2 text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">{t.settings.lightBadge}</span>}
                </p>
                <p className="text-xs text-slate-400">
                  {themePref === 'auto'
                    ? t.settings.appearanceAuto
                    : themePref === 'dark'
                      ? t.settings.appearanceDark
                      : t.settings.appearanceLight}
                </p>
              </div>
              <div className="flex rounded-xl overflow-hidden border border-slate-200">
                {(['auto', 'light', 'dark'] as ThemePreference[]).map((pref) => {
                  const labels: Record<ThemePreference, string> = { auto: t.settings.themeAuto, light: t.settings.themeLight, dark: t.settings.themeDark };
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

        {/* ── Calculator defaults ── */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm p-5 space-y-5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">{t.settings.calcDefaults}</h2>

          {/* Preferred fill level */}
          <div className="space-y-2">
            <div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t.settings.defaultFillLevel}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {t.settings.defaultFillSub}
              </p>
            </div>
            <div className="flex rounded-xl overflow-hidden border border-slate-200 dark:border-slate-600">
              {([
                { label: t.settings.quarterTank,      value: 25  },
                { label: t.settings.halfTank,         value: 50  },
                { label: t.settings.threeQuarterTank, value: 75  },
                { label: t.settings.fullTank,         value: 100 },
              ] as const).map(({ label, value }) => {
                const active = preferredFillLevel === value;
                return (
                  <button
                    key={value}
                    onClick={() => setPreferredFillLevel(active ? null : value)}
                    className={`flex-1 py-2 text-xs font-bold transition-colors
                      ${active
                        ? 'bg-brand-dark text-white'
                        : 'bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600'
                      }`}
                    aria-pressed={active}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {preferredFillLevel !== null && (
              <p className="text-[10px] text-brand-teal font-semibold">
                {t.settings.fillDefaultNote(preferredFillLevel)}
              </p>
            )}
          </div>

          {/* Monthly fuel budget */}
          <div
            ref={budgetSectionRef}
            className={`space-y-2 pt-3 border-t border-slate-100 dark:border-slate-700 rounded-xl
                        transition-all duration-300
                        ${budgetHighlight ? 'bg-teal-50 dark:bg-teal-900/20 ring-2 ring-brand-teal ring-offset-2 px-3 -mx-3' : ''}`}
          >
            <div>
              <p className={`text-sm font-semibold transition-colors duration-300
                             ${budgetHighlight ? 'text-brand-teal' : 'text-slate-700 dark:text-slate-200'}`}>
                {t.settings.monthlyFuelBudget}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {t.settings.budgetSub}
              </p>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400 pointer-events-none">$</span>
              <input
                type="number"
                inputMode="decimal"
                value={monthlyFuelBudget}
                onChange={(e) => setMonthlyFuelBudget(e.target.value)}
                placeholder={t.settings.budgetPlaceholder}
                min="0" max="10000" step="5"
                className="w-full pl-7 pr-4 py-2.5 border border-slate-200 dark:border-slate-600
                           rounded-xl text-sm text-slate-800 dark:text-slate-100
                           bg-white dark:bg-slate-700
                           focus:outline-none focus:ring-2 focus:ring-brand-teal/40"
              />
            </div>
            <p className="text-[10px] text-slate-400">{t.settings.budgetDisableNote}</p>
          </div>

          {/* Save — reuses the same profile save handler */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-2.5 rounded-xl bg-brand-dark hover:bg-[#1a3a5c] text-white font-bold text-sm transition-colors disabled:opacity-60"
          >
            {saved ? t.settings.saved : saving ? t.settings.saving : t.settings.saveDefaults}
          </button>
        </div>

        {/* Gas price alert — Pro only */}
        <div className={`bg-white rounded-2xl border shadow-sm p-5 space-y-4 ${
          plan === 'pro' || plan === 'fleet' ? 'border-slate-100' : 'border-slate-100 opacity-80'
        }`}>
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">
              {t.settings.gasPriceAlert}
            </h2>
            {plan === 'free' && (
              <span className="text-[9px] font-black bg-amber-400 text-white px-2 py-0.5 rounded-full">{t.settings.proBadge}</span>
            )}
          </div>

          {plan === 'free' ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 leading-relaxed">
                {t.settings.alertFreeBody}
              </p>
              <Link
                href="/upgrade"
                className="inline-block text-xs font-bold text-amber-600 hover:text-amber-700 transition-colors"
              >
                {t.settings.upgradeUnlock}
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 leading-relaxed">
                {t.settings.alertProBody}
              </p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={alertThreshold}
                    onChange={(e) => setAlertThreshold(e.target.value)}
                    placeholder={t.settings.alertPlaceholder}
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
                  {alertSaved ? t.settings.alertSaved : alertSaving ? '…' : t.settings.saveBtn}
                </button>
              </div>
              {alertThreshold && (
                <p className="text-[11px] text-slate-400">
                  {t.settings.alertActive(parseFloat(alertThreshold).toFixed(2))}
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
              {t.settings.garageDoor}
            </h2>
            {plan === 'free' && (
              <span className="text-[9px] font-black bg-amber-400 text-white px-2 py-0.5 rounded-full">{t.settings.proBadge}</span>
            )}
          </div>

          {plan === 'free' ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 leading-relaxed">
                {t.settings.garageFreeBody}
              </p>
              <Link
                href="/upgrade"
                className="inline-block text-xs font-bold text-amber-600 hover:text-amber-700 transition-colors"
              >
                {t.settings.upgradeUnlock}
              </Link>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Door style grid */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-600">{t.settings.doorStyle}</p>
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
                <p className="text-xs font-semibold text-slate-600">{t.settings.openingDirection}</p>
                <div className="flex rounded-xl overflow-hidden border border-slate-200">
                  {(['roll-up', 'center'] as DoorDirection[]).map((dir) => (
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
                {t.settings.garageDoorNote}
              </p>
            </div>
          )}
        </div>{/* end Garage Door card */}

        </div>{/* end preferences section */}

        {/* Fleet branding section */}
        {(livePlan === 'fleet' || (session?.user as { plan?: string })?.plan === 'fleet') && (
          <section id="fleet" ref={(el) => { sectionRefs.current.fleet = el; }} className="space-y-3">
            <SectionBanner icon="🚛" title={t.settings.fleetBranding} />
            <div className="bg-white dark:bg-slate-800 rounded-b-2xl border border-t-0 border-slate-100 dark:border-slate-700 p-5 space-y-4">
              <p className="text-xs text-slate-500 leading-relaxed">
                {t.settings.fleetBrandingBody}
              </p>

              {/* Company name */}
              <div>
                <label className="field-label">{t.settings.companyName}</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder={t.settings.companyNamePlaceholder}
                  value={fleetCompanyName}
                  onChange={(e) => setFleetCompanyName(e.target.value)}
                  maxLength={60}
                />
              </div>

              {/* Logo URL */}
              <div>
                <label className="field-label">{t.settings.logoUrlLabel} <span className="text-slate-400 font-normal">{t.settings.logoUrlHttps}</span></label>
                <input
                  type="url"
                  className="input-field"
                  placeholder={t.settings.logoUrlPlaceholder}
                  value={fleetLogoUrl}
                  onChange={(e) => setFleetLogoUrl(e.target.value)}
                />
                <p className="field-hint">{t.settings.logoUrlHint}</p>
              </div>

              {/* Logo preview */}
              {fleetLogoUrl && fleetLogoUrl.startsWith('https://') && (
                <div>
                  <p className="field-label">{t.settings.preview}</p>
                  <div className="rounded-xl bg-[#1E2D4A] p-4 inline-flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={fleetLogoUrl}
                      alt={t.settings.logoPreviewAlt}
                      className="h-8 w-auto object-contain"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    <div>
                      <p className="text-white text-sm font-black">{fleetCompanyName || t.settings.yourCompany}</p>
                      <p className="text-white/40 text-[10px]">{t.settings.poweredByFleet}</p>
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
                {fleetSaving ? t.settings.saving : fleetSaved ? t.settings.saved : t.settings.saveFleetBranding}
              </button>
            </div>
          </section>
        )}

        <p className="text-center text-[11px] text-slate-300 pb-4">{t.settings.versionLine}</p>
      </div>
    </div>
  );
}
