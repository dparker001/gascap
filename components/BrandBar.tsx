// ── BrandBar ──────────────────────────────────────────────────────────────────
// Consistent top brand bar used on all standalone pages (signup, signin,
// upgrade, etc.). Matches the icon + wordmark treatment of the main Header.

import Link from 'next/link';

export default function BrandBar() {
  return (
    <div className="bg-brand-dark px-5 py-4">
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
    </div>
  );
}
