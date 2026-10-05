'use client';

/** "Opened automatically at pickup · Turn off" — shown only on a rental page
 *  that the opt-in auto-open just routed to (?auto=pickup). */
import { useEffect, useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import { AUTO_OPEN_QUERY, setAutoOpenEnabled } from '@/lib/rentalAutoOpen';

export default function AutoOpenedBanner() {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { setShow(window.location.search.replace(/^\?/, '').split('&').includes(AUTO_OPEN_QUERY)); } catch { /* hidden */ }
  }, []);
  if (!show) return null;
  return (
    <div data-testid="auto-opened-banner" className="flex items-center justify-between gap-2 rounded-xl bg-slate-100 border border-slate-200 px-3 py-2 text-[11px] text-slate-600">
      <span>{t.rentalReturn.autoOpenedNotice}</span>
      <button type="button" className="font-bold text-blue-600" onClick={() => { setAutoOpenEnabled(false); setShow(false); }}>
        {t.rentalReturn.autoOpenedTurnOff}
      </button>
    </div>
  );
}
