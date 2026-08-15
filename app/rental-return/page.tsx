'use client';

/**
 * GasCap™ Rental Return Assistant — entry point.
 * Lists active sessions, offers "New Rental," links to history.
 */

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/contexts/LanguageContext';
import BrandBar from '@/components/BrandBar';
import RentalModeHeader from '@/components/rental-return/RentalModeHeader';
import RentalSetupFlow from '@/components/rental-return/RentalSetupFlow';
import { trackRentalAssistantOpened, trackRentalSessionCreated } from '@/lib/gtag';
import type { RentalSession } from '@/lib/rentalSessions';

export default function RentalReturnPage() {
  const { data: authSession, status } = useSession();
  const router = useRouter();
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<RentalSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'list' | 'setup'>('list');

  useEffect(() => { trackRentalAssistantOpened(); }, []);

  useEffect(() => {
    // Guests never fire the sessions fetch, so loading must resolve for
    // them here too — otherwise the skeleton spins forever (the fetch's
    // own .finally() only runs when authSession exists).
    if (status !== 'authenticated') { setLoading(false); return; }
    fetch('/api/rental-sessions?status=active')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.sessions) setSessions(d.sessions); })
      .finally(() => setLoading(false));
  }, [status]);

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-[#eef1f7]">
        <BrandBar />
        <RentalModeHeader />
        <div className="px-4"><div className="h-32 bg-white rounded-2xl animate-pulse max-w-lg mx-auto" /></div>
      </div>
    );
  }

  if (!authSession) {
    return (
      <div className="min-h-screen bg-[#eef1f7]">
        <BrandBar />
        <RentalModeHeader />
        <div className="px-4 text-center max-w-sm mx-auto">
          <p className="text-sm text-slate-500 mb-4">{t.rentalReturn.signInRequired}</p>
          <Link href="/signin?next=/rental-return" className="inline-block px-6 py-3 rounded-2xl bg-blue-600 text-white font-black text-sm">
            {t.rentalReturn.signIn}
          </Link>
        </div>
      </div>
    );
  }

  if (mode === 'setup') {
    return (
      <div className="min-h-screen bg-[#eef1f7]">
        <BrandBar />
        <RentalModeHeader />
        <div>
          <RentalSetupFlow
            onCreated={(id) => { trackRentalSessionCreated(); router.push(`/rental-return/${id}`); }}
            onCancel={() => setMode('list')}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#eef1f7]">
      <BrandBar />
      <RentalModeHeader />
      <div className="px-4 max-w-lg mx-auto pb-8 space-y-4">
        <div className="text-center mb-2">
          <h1 className="text-xl font-black text-navy-700">{t.rentalReturn.pageTitle}</h1>
          <p className="text-sm text-slate-500 mt-1">{t.rentalReturn.pageSubtitle}</p>
        </div>

        <button
          onClick={() => setMode('setup')}
          className="w-full py-3.5 rounded-2xl bg-blue-600 text-white text-sm font-black"
        >
          + {t.rentalReturn.newRental}
        </button>

        {sessions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide px-1">{t.rentalReturn.activeSessions}</p>
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => router.push(`/rental-return/${s.id}`)}
                className="w-full text-left bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-3 hover:border-blue-500 transition-colors"
              >
                <p className="text-sm font-bold text-slate-800">{s.rentalCompany}</p>
                <p className="text-xs text-slate-400">{[s.vehicleYear, s.vehicleMake, s.vehicleModel].filter(Boolean).join(' ')}</p>
              </button>
            ))}
          </div>
        )}

        <Link href="/rental-return/history" className="block text-center text-xs font-bold text-blue-600 hover:text-blue-800 pt-2">
          {t.rentalReturn.viewHistory}
        </Link>
      </div>
    </div>
  );
}
