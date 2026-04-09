'use client';

import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';

const AVATAR_COLOR_KEY = 'gascap_avatar_color';
const DEFAULT_COLOR    = 'bg-brand-orange';

/** Initials avatar from a display name */
function Avatar({ name, color }: { name: string; color: string }) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className={`w-8 h-8 rounded-full ${color} flex items-center justify-center flex-shrink-0`}>
      <span className="text-white text-xs font-black">{initials}</span>
    </div>
  );
}

export default function AuthButton() {
  const { data: session, status } = useSession();
  const { t } = useTranslation();
  const [menuOpen,     setMenuOpen]     = useState(false);
  const [avatarColor,  setAvatarColor]  = useState(DEFAULT_COLOR);

  useEffect(() => {
    const saved = localStorage.getItem(AVATAR_COLOR_KEY);
    if (saved) setAvatarColor(saved);

    // Listen for color changes saved from Settings page
    const handler = (e: StorageEvent) => {
      if (e.key === AVATAR_COLOR_KEY && e.newValue) setAvatarColor(e.newValue);
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  if (status === 'loading') {
    return <div className="w-20 h-8 rounded-xl bg-white/20 animate-pulse" />;
  }

  /* ── Signed out ── */
  if (!session) {
    return (
      <div className="flex gap-2">
        <Link
          href="/signin"
          className="px-3.5 py-1.5 rounded-xl text-xs font-bold text-white
                     border border-white/30 hover:bg-white/10 transition-colors"
        >
          {t.nav.signIn}
        </Link>
        <Link
          href="/signup"
          className="px-3.5 py-1.5 rounded-xl text-xs font-black text-white
                     bg-brand-orange hover:bg-[#FF9A1A] transition-colors"
        >
          {t.nav.signUp}
        </Link>
      </div>
    );
  }

  /* ── Signed in ── */
  const name = session.user?.name ?? session.user?.email ?? 'User';
  const plan = (session.user as { plan?: string })?.plan ?? 'free';

  const planLabel =
    plan === 'pro'   ? { text: 'Pro',   bg: 'bg-brand-orange' } :
    plan === 'fleet' ? { text: 'Fleet', bg: 'bg-blue-600'     } :
    null;

  return (
    <div className="relative">
      <button
        className="flex items-center gap-2 focus:outline-none focus-visible:ring-2
                   focus-visible:ring-brand-teal rounded-xl p-1"
        onClick={() => setMenuOpen((v) => !v)}
        aria-expanded={menuOpen}
        aria-label={t.nav.userMenu}
      >
        <Avatar name={name} color={avatarColor} />
        <div className="hidden sm:flex items-center gap-1.5">
          <span className="text-white text-xs font-semibold max-w-[90px] truncate">
            {name}
          </span>
          {planLabel && (
            <span className={`text-[9px] font-black text-white px-1.5 py-0.5 rounded-full ${planLabel.bg}`}>
              {planLabel.text.toUpperCase()}
            </span>
          )}
        </div>
        <svg className="w-3 h-3 text-white/60" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <path d="M6 8L1 3h10z" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {menuOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 top-full mt-2 z-20 bg-white rounded-2xl shadow-lift
                          border border-slate-100 py-2 min-w-[180px] animate-fade-in">
            <div className="px-4 py-2 border-b border-slate-100 mb-1">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-xs font-bold text-slate-800 truncate">{name}</p>
                {planLabel && (
                  <span className={`text-[9px] font-black text-white px-1.5 py-0.5 rounded-full flex-shrink-0 ${planLabel.bg}`}>
                    {planLabel.text.toUpperCase()}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-400 truncate">{session.user?.email}</p>
              {!planLabel && (
                <a href="/upgrade"
                   className="mt-1.5 inline-block text-[10px] font-bold text-brand-dark hover:text-brand-teal">
                  {t.nav.upgradeToPro}
                </a>
              )}
            </div>
            <Link
              href="/settings"
              onClick={() => setMenuOpen(false)}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-600 font-medium
                         hover:bg-slate-50 transition-colors"
            >
              <svg viewBox="0 0 20 20" className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <circle cx="10" cy="10" r="3"/>
                <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42"/>
              </svg>
              {t.nav.settings}
            </Link>
            <button
              onClick={() => { setMenuOpen(false); signOut({ callbackUrl: '/' }); }}
              className="w-full text-left px-4 py-2 text-sm text-red-500 font-medium
                         hover:bg-red-50 transition-colors"
            >
              {t.nav.signOut}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
