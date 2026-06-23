// ── BrandBar ──────────────────────────────────────────────────────────────────
// Consistent top brand bar used on all standalone pages (signup, signin,
// upgrade, etc.). Matches the icon + wordmark treatment of the main Header.

import Link from 'next/link';
import LanguageToggle from './LanguageToggle';

export default function BrandBar() {
  return (
    <>
      {/* Fixed so the green brand bar stays static (covering the phone status area)
          while the page scrolls — matches the native shell's pinned title bar. The
          top padding absorbs the iOS status-bar safe area. */}
      <div
        className="fixed top-0 left-0 right-0 z-50 bg-brand-dark px-5 pb-4 flex items-center justify-between"
        style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}
      >
        <Link href="/" className="flex items-center gap-1.5 w-fit">
          <img
            src="/gascap-icon-raw.png"
            alt=""
            className="h-9 w-auto object-contain drop-shadow-sm"
            aria-hidden="true"
          />
          <span className="text-white font-black text-xl leading-none tracking-tight">
            GasCap<sup className="text-xs font-bold" style={{ verticalAlign: '0.6em' }}>™</sup>
          </span>
        </Link>
        {/* Language switch — lets Spanish speakers flip to ES right at the entry point */}
        <LanguageToggle />
      </div>
      {/* Spacer matching the fixed bar's height (pt 1rem + safe-area + logo 2.25rem + pb 1rem)
          so page content starts below it. */}
      <div aria-hidden="true" style={{ height: 'calc(4.25rem + env(safe-area-inset-top))' }} />
    </>
  );
}
