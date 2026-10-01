'use client';

/**
 * Gift20ThankYou — the $20 Gift Campaign's personal note on the Lifetime
 * success page (docs/GIFT20_CAMPAIGN_SPEC.md §3.9).
 *
 * Display-only: renders nothing unless this browser carries a GIFTxx card
 * code in the gc_src attribution cookie (set by /q/GIFTxx). It never reads
 * or asserts entitlement — the success page's own gating decides whether a
 * success screen is shown at all. No upsell; just thanks, the app, and share.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import { ANDROID_APP_URL, IOS_APP_URL, isGift20Code, type Gift20Cta } from '@/lib/gift20';

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[2]) : null;
}

function trackCta(cta: Gift20Cta) {
  void fetch('/api/campaign/track', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'cta_click', meta: { cta }, path: window.location.pathname }),
    keepalive: true,
  }).catch(() => {});
}

const SHARE_URL = 'https://www.gascap.app';

export default function Gift20ThankYou() {
  const { t } = useTranslation();
  const g = t.gift20;
  const [show, setShow]     = useState(false);
  const [device, setDevice] = useState<'ios' | 'android' | 'other'>('other');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setShow(isGift20Code(readCookie('gc_src')));
    const ua = navigator.userAgent || '';
    setDevice(/iPhone|iPad|iPod/i.test(ua) ? 'ios' : /Android/i.test(ua) ? 'android' : 'other');
  }, []);

  if (!show) return null;

  async function share() {
    trackCta('share');
    const text = `${g.thankYouShareText} ${SHARE_URL}`;
    try {
      if (navigator.share) { await navigator.share({ text, url: SHARE_URL }); return; }
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch { /* user cancelled the share sheet */ }
  }

  const stores = device === 'ios' ? (['ios'] as const) : device === 'android' ? (['android'] as const) : (['ios', 'android'] as const);

  return (
    <div className="rounded-2xl bg-[#f0fdf9] border border-brand-teal/30 p-4 text-left space-y-3">
      <p className="text-base font-black text-brand-dark">{g.thankYouTitle}</p>
      <p className="text-sm text-slate-700 leading-relaxed">
        {g.thankYouBody} <span className="font-bold">{g.thankYouSign}</span>
      </p>
      {stores.map((s) => (
        <a key={s} href={s === 'ios' ? IOS_APP_URL : ANDROID_APP_URL} target="_blank" rel="noopener noreferrer"
           onClick={() => trackCta(s === 'ios' ? 'app_store' : 'google_play')}
           className="block w-full rounded-xl bg-black py-3 text-center text-sm font-bold text-white">
          {g.thankYouOpenApp}{stores.length > 1 ? (s === 'ios' ? ' (iPhone)' : ' (Android)') : ''}
        </a>
      ))}
      <p className="text-xs text-slate-500">{g.thankYouSameAccount}</p>
      <button type="button" onClick={share}
              className="w-full rounded-xl border-2 border-brand-teal/50 py-2.5 text-sm font-bold text-brand-dark">
        {copied ? g.thankYouCopied : g.thankYouShare}
      </button>
    </div>
  );
}
