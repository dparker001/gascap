'use client';

/**
 * TabLockGate — the "sign in to unlock" teaser shown in the native shell for tabs
 * that need an account (History, Tools). The calculator is NEVER gated (it's the
 * core free utility; Apple 5.1.1(v)). Each gate doubles as a sign-up pitch rather
 * than a dead/greyed-out tab.
 *
 * CTAs route to /signup and /signin (both have a back-to-home link, and the shell
 * restores the last tab from localStorage after auth — so no native nav trap).
 */

import Link from 'next/link';

interface Props {
  icon:     string;     // emoji glyph
  title:    string;
  subtitle: string;
  bullets:  string[];
}

export default function TabLockGate({ icon, title, subtitle, bullets }: Props) {
  return (
    <div className="px-5 pt-8 pb-4 max-w-md mx-auto w-full flex flex-col items-center text-center">

      <div className="w-16 h-16 rounded-2xl bg-teal-50 dark:bg-teal-900/30 flex items-center
                      justify-center text-3xl mb-4" aria-hidden="true">
        {icon}
      </div>

      <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">{title}</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">{subtitle}</p>

      <ul className="mt-5 mb-6 space-y-2.5 text-left w-full max-w-xs">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-2.5 text-sm text-slate-600 dark:text-slate-300">
            <span className="text-teal-500 font-bold mt-0.5" aria-hidden="true">✓</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <Link
        href="/signup"
        className="w-full max-w-xs px-5 py-3 rounded-xl bg-[#005F4A] text-white text-sm font-bold
                   text-center active:opacity-90 transition-opacity"
      >
        Create free account →
      </Link>
      <Link
        href="/signin"
        className="mt-3 text-sm font-semibold text-teal-700 dark:text-teal-400"
      >
        Already have an account? Sign in
      </Link>

      <p className="mt-4 text-[11px] text-slate-400">No credit card to start</p>
    </div>
  );
}
