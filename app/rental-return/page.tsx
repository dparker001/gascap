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
import DeleteRentalButton from '@/components/rental-return/DeleteRentalButton';
import { trackRentalAssistantOpened, trackRentalSessionCreated } from '@/lib/gtag';
import type { RentalSession } from '@/lib/rentalSessions';
import { isUpcomingRental } from '@/lib/rentalCalculations';

export default function RentalReturnPage() {
  const { data: authSession, status } = useSession();
  const plan = (authSession?.user as { plan?: string } | undefined)?.plan ?? 'free';
  const isPro = plan === 'pro' || plan === 'fleet' || plan === 'lifetime';
  const router = useRouter();
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<RentalSession[]>([]);
  const [pastCount, setPastCount] = useState(0);
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
    // Count only — the past list lives on its own page, but the link should
    // say how many are there rather than sending people to a maybe-empty page.
    fetch('/api/rental-sessions?status=completed')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setPastCount(d?.sessions?.length ?? 0))
      .catch(() => {});
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

  const rentalsUpcoming   = sessions.filter((s) => isUpcomingRental(s.pickupDateTime));
  const rentalsInProgress = sessions.filter((s) => !isUpcomingRental(s.pickupDateTime));

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

        {/* Pro gate on STARTING a rental only. Sessions already underway stay
            fully usable below — a lapsed trial must never leave someone with a
            car to return and no numbers. The server enforces the same rule. */}
        {isPro ? (
          <button
            onClick={() => setMode('setup')}
            className="w-full py-3.5 rounded-2xl bg-blue-600 text-white text-sm font-black"
          >
            + {t.rentalReturn.newRental}
          </button>
        ) : (
          <div className="bg-white rounded-2xl border-2 border-amber-200 shadow-sm px-5 py-6 text-center space-y-2.5">
            <p className="text-2xl">⭐</p>
            <p className="text-sm font-black text-slate-700">{t.rentalReturn.proToStartTitle}</p>
            <p className="text-[11px] text-slate-500 leading-relaxed max-w-[280px] mx-auto">
              {t.rentalReturn.proToStartBody}
            </p>
            <a href="/upgrade" className="inline-block mt-1 px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-white text-sm font-black rounded-2xl transition-colors">
              {t.rentalReturn.proToStartCta}
            </a>
          </div>
        )}

        {/* Grouped, because "Active Rentals" over every open session was
            wrong in the way that matters: a rental booked for next week
            appeared under Active, which is the same conflation that had the
            calculator announcing an unstarted booking as active. A car you're
            holding and a car you've reserved need different handling, so they
            get different headings. */}
        {rentalsInProgress.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide px-1">{t.rentalReturn.sectionInProgress}</p>
            {rentalsInProgress.map((s) => (
              <RentalRow key={s.id} s={s} onOpen={() => router.push(`/rental-return/${s.id}`)}
                         onDeleted={() => setSessions((prev) => prev.filter((x) => x.id !== s.id))}
                         hint={t.rentalReturn.inProgressHint} accent="blue" />
            ))}
          </div>
        )}

        {rentalsUpcoming.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide px-1">{t.rentalReturn.sectionUpcoming}</p>
            {rentalsUpcoming.map((s) => (
              <RentalRow key={s.id} s={s} onOpen={() => router.push(`/rental-return/${s.id}`)}
                         onDeleted={() => setSessions((prev) => prev.filter((x) => x.id !== s.id))}
                         hint={s.pickupDateTime
                           ? t.rentalReturn.picksUpOn(new Date(s.pickupDateTime).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))
                           : undefined}
                         accent="slate" />
            ))}
          </div>
        )}

        <div className="pt-2">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide px-1 mb-1">{t.rentalReturn.sectionPast}</p>
          <Link href="/rental-return/history" className="block text-center text-xs font-bold text-blue-600 hover:text-blue-800 py-2">
            {t.rentalReturn.viewPastRentals(pastCount)}
          </Link>
        </div>
      </div>
    </div>
  );
}

/** One rental in the list. Extracted so the In Progress and Upcoming groups
 *  can't drift apart in layout while showing different supporting text. */
function RentalRow({
  s, onOpen, onDeleted, hint, accent,
}: {
  s: RentalSession;
  onOpen: () => void;
  onDeleted: () => void;
  hint?: string;
  accent: 'blue' | 'slate';
}) {
  return (
    <div className={`flex items-center gap-2 flex-wrap bg-white rounded-2xl border shadow-sm px-4 py-3 transition-colors ${
      accent === 'blue' ? 'border-blue-300 hover:border-blue-500' : 'border-slate-200 hover:border-blue-400'
    }`}>
      <button onClick={onOpen} className="flex-1 min-w-0 text-left">
        <p className="text-sm font-bold text-slate-800">{s.rentalCompany}</p>
        <p className="text-xs text-slate-400">{[s.vehicleYear, s.vehicleMake, s.vehicleModel].filter(Boolean).join(' ')}</p>
        {hint && <p className={`text-[10px] mt-0.5 font-semibold ${accent === 'blue' ? 'text-blue-600' : 'text-slate-500'}`}>{hint}</p>}
      </button>
      <DeleteRentalButton sessionId={s.id} onDeleted={onDeleted} />
    </div>
  );
}
