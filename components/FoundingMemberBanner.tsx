'use client';

/**
 * FoundingMemberBanner — launch scarcity bar: "Pro Lifetime $9.99 — X of 100 spots
 * left." Drives early signups. The $9.99 itself is the existing 7-day new-member
 * offer (applied at checkout); this just adds urgency + a live counter.
 *
 * Web only (hidden on native — the discounted $9.99 needs a separate Apple IAP
 * product, and anti-steering forbids pointing the app at web checkout). Hidden for
 * Lifetime members, once the 100 spots are gone, and — via showBanner — until real
 * redemptions clear FOUNDING_DISPLAY_FLOOR (lib/foundingPromo.ts). A live "100 of
 * 100 spots left" counter (i.e. zero real purchases) reads as "nobody wants this"
 * rather than urgency, so the banner stays hidden pre-marketing-launch and
 * auto-reveals once there's enough real momentum — no manual toggle to remember.
 * Dismissible.
 */

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useIsNative } from '@/hooks/useIsNative';

const DISMISS_KEY = 'gc_founding_dismissed';

interface Status { active: boolean; cap: number; spotsLeft: number; price: number; showBanner: boolean }

export default function FoundingMemberBanner() {
  const { data: session } = useSession();
  const isNative = useIsNative();
  const [status, setStatus] = useState<Status | null>(null);
  const [dismissed, setDismissed] = useState(true);

  const isLifetime = (session?.user as { stripeInterval?: string | null } | undefined)?.stripeInterval === 'lifetime';

  useEffect(() => {
    try { setDismissed(localStorage.getItem(DISMISS_KEY) === '1'); } catch { /* ignore */ }
    fetch('/api/founding/status').then((r) => r.json()).then(setStatus).catch(() => { /* ignore */ });
  }, []);

  if (isNative || isLifetime || dismissed) return null;
  if (!status?.showBanner) return null;

  const href = session ? '/upgrade?founding=1' : '/signup?ref=founding';
  const cta  = session ? 'Claim $9.99 Lifetime →' : 'Claim your spot →';

  return (
    <div className="bg-gradient-to-r from-amber-500 to-orange-600 text-white">
      <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center gap-3">
        <span className="text-lg flex-shrink-0" aria-hidden="true">🏆</span>
        <p className="text-[13px] sm:text-sm font-semibold flex-1 leading-tight">
          <span className="font-black">Founding offer:</span> Pro Lifetime{' '}
          <span className="font-black">${status.price.toFixed(2)}</span>{' '}
          <span className="opacity-75 line-through">$19.99</span>{' '}
          <span className="font-black">+ a free vacation getaway 🏝️</span>{' '}
          — <span className="font-black">{status.spotsLeft}</span> of {status.cap} spots left.
        </p>
        <Link
          href={href}
          className="whitespace-nowrap bg-white text-orange-700 text-xs font-black px-3.5 py-1.5
                     rounded-full hover:bg-orange-50 transition-colors flex-shrink-0"
        >
          {cta}
        </Link>
        <button
          type="button"
          onClick={() => { setDismissed(true); try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ } }}
          aria-label="Dismiss"
          className="text-white/80 hover:text-white text-xl leading-none flex-shrink-0 px-1"
        >
          ×
        </button>
      </div>
    </div>
  );
}
