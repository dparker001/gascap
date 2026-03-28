'use client';

import Link from 'next/link';

interface UpgradeNudgeProps {
  emoji:    string;
  headline: string;
  body:     string;
  ctaText?: string;
  ctaHref?: string;
}

export default function UpgradeNudge({
  emoji, headline, body,
  ctaText = 'Upgrade to Pro →',
  ctaHref = '/#pricing',
}: UpgradeNudgeProps) {
  return (
    <div data-nudge className="mt-3 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200
                    rounded-2xl px-4 py-3.5 flex items-start gap-3">
      <span className="text-2xl flex-shrink-0">{emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-black text-amber-900">{headline}</p>
        <p className="text-xs text-amber-700 leading-relaxed mt-0.5">{body}</p>
        <Link
          href={ctaHref}
          className="inline-block mt-2 px-4 py-1.5 bg-amber-500 hover:bg-amber-400
                     text-white text-xs font-black rounded-xl transition-colors"
        >
          {ctaText}
        </Link>
      </div>
      <button
        onClick={(e) => (e.currentTarget.closest('[data-nudge]') as HTMLElement | null)?.remove()}
        className="flex-shrink-0 text-amber-400 hover:text-amber-600 transition-colors text-lg leading-none mt-0.5"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
