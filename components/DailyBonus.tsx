'use client';

import { useEffect, useState } from 'react';
import { useSession }          from 'next-auth/react';
import { usePathname }         from 'next/navigation';
import { useTranslation }      from '@/contexts/LanguageContext';
import { useIsNative }         from '@/hooks/useIsNative';

type Phase =
  | 'loading'    // fetching status from server
  | 'available'  // box is ready to open
  | 'opening'    // user clicked, awaiting API response
  | 'revealed'   // "+N entries" popover visible
  | 'done';      // already claimed today, badge muted

interface StatusResponse {
  available:    boolean;
  claimedToday: boolean;
  totalEarned:  number;
}

interface ClaimResponse {
  awarded:    boolean;
  entriesWon: number;
  totalEarned: number;
}

/** Simple deterministic CSS confetti burst — no external libs */
const CONFETTI_COLORS = ['#FA7109', '#1EB68F', '#005F4A', '#FBBF24', '#3B82F6', '#EC4899'];
const CONFETTI_COUNT  = 12;

function Confetti() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {Array.from({ length: CONFETTI_COUNT }).map((_, i) => {
        const angle  = (360 / CONFETTI_COUNT) * i;
        const dist   = 40 + (i % 3) * 12;
        const color  = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
        const delay  = `${(i * 30)}ms`;
        const size   = i % 2 === 0 ? 6 : 4;
        return (
          <span
            key={i}
            style={{
              position:         'absolute',
              top:              '50%',
              left:             '50%',
              width:            size,
              height:           size,
              borderRadius:     i % 3 === 0 ? '50%' : 2,
              background:       color,
              transform:        `translate(-50%,-50%) rotate(${angle}deg) translateY(-${dist}px) scale(1)`,
              opacity:          0,
              animation:        `confettiBurst 0.6s ease-out ${delay} forwards`,
            }}
          />
        );
      })}
    </div>
  );
}

export default function DailyBonus() {
  const { data: session, status: authStatus } = useSession();
  const pathname = usePathname();
  const { t } = useTranslation();
  const isNative = useIsNative();   // lift the FAB above the native bottom tab bar

  const [phase,      setPhase]      = useState<Phase>('loading');
  const [entriesWon, setEntriesWon] = useState(0);
  const [popover,    setPopover]    = useState(false);

  // Don't render on admin pages or auth pages
  const hidden = pathname.startsWith('/admin') ||
                 pathname.startsWith('/signin') ||
                 pathname.startsWith('/signup') ||
                 pathname.startsWith('/verify');

  useEffect(() => {
    if (authStatus === 'loading' || !session?.user) return;
    fetch('/api/giveaway/daily-bonus')
      .then((r) => r.json())
      .then((d: StatusResponse) => {
        setPhase(d.claimedToday ? 'done' : 'available');
      })
      .catch(() => setPhase('done')); // fail silently
  }, [session, authStatus]);

  if (hidden || !session?.user) return null;
  if (phase === 'loading') return null;

  async function handleClaim() {
    if (phase !== 'available') {
      // Show "come back tomorrow" popover briefly on done state click
      setPopover(true);
      setTimeout(() => setPopover(false), 2500);
      return;
    }
    setPhase('opening');
    setPopover(true);
    try {
      const res  = await fetch('/api/giveaway/daily-bonus', { method: 'POST' });
      const data = await res.json() as ClaimResponse;
      const won  = data.entriesWon ?? 0;
      setEntriesWon(won);
      // Broadcast so the "entries this month" banner(s) tick up in real time
      if (won > 0 && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('gascap:entries-earned', { detail: { entriesWon: won } }));
      }
      setPhase('revealed');
      // Auto-dismiss popover after 4 s, leave badge in muted "done" state
      setTimeout(() => {
        setPopover(false);
        setPhase('done');
      }, 4000);
    } catch {
      setPhase('available');
      setPopover(false);
    }
  }

  const isAvailable = phase === 'available';
  const isRevealed  = phase === 'revealed';
  const isOpening   = phase === 'opening';

  // ── Popover content ────────────────────────────────────────────────────────
  const PopoverCard = () => (
    <div
      className={[
        // Mobile (bottom-right): anchor to right edge of button → popover opens leftward ✓
        // Desktop (bottom-left): anchor to left edge of button → popover opens rightward ✓
        'absolute w-52 rounded-2xl shadow-xl border',
        'right-0 md:right-auto md:left-0',
        'bg-white p-4 text-center animate-fade-in-up z-50',
        isRevealed
          ? 'border-green-200'
          : isOpening
          ? 'border-slate-100'
          : 'border-slate-100',
      ].join(' ')}
      style={{ bottom: '60px' }}
    >
      {isOpening && (
        <div className="space-y-2 py-1">
          <p className="text-2xl animate-spin inline-block">⚙️</p>
          <p className="text-xs font-bold text-slate-500">{t.dailyBonus.openingGift}</p>
        </div>
      )}

      {isRevealed && (
        <div className="relative space-y-1.5 py-1">
          <Confetti />
          <p className="text-3xl">🎉</p>
          <p className="text-base font-black text-[#005F4A] leading-tight">
            {t.dailyBonus.entriesWon(entriesWon)}
          </p>
          <p className="text-[10px] text-slate-500 leading-snug">
            {t.dailyBonus.addedToDrawing}
            <br />{t.dailyBonus.seeYouTomorrow}
          </p>
        </div>
      )}

      {phase === 'done' && !isOpening && !isRevealed && (
        <div className="space-y-1.5 py-1">
          <p className="text-2xl">✅</p>
          <p className="text-xs font-black text-slate-600">{t.dailyBonus.alreadyClaimed}</p>
          <p className="text-[10px] text-slate-400">{t.dailyBonus.comeBackTomorrow}</p>
        </div>
      )}

      {/* Caret pointing down to the button.
          Mobile (right-anchored): caret on the right side of the popover.
          Desktop (left-anchored): caret on the left side of the popover. */}
      <div
        className="absolute -bottom-2 w-4 h-4 rotate-45 bg-white border-r border-b border-slate-100
                   right-4 md:right-auto md:left-4"
        style={{ borderColor: isRevealed ? '#bbf7d0' : '#f1f5f9' }}
      />
    </div>
  );

  return (
    <>
      {/* Keyframe for confetti burst + fade-in-up — injected once */}
      <style>{`
        @keyframes confettiBurst {
          0%   { opacity: 1; transform: translate(-50%,-50%) rotate(var(--a,0deg)) translateY(0)     scale(1); }
          100% { opacity: 0; transform: translate(-50%,-50%) rotate(var(--a,0deg)) translateY(-55px) scale(0.5); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        .animate-fade-in-up { animation: fadeInUp 0.2s ease-out forwards; }
      `}</style>

      {/*
        Mobile  : bottom-right (sole floating button now that Feedback is removed)
        Desktop : bottom-left  (GHL chat widget occupies bottom-right on ≥1024px)
      */}
      <div
        className={[
          'fixed right-4 z-50',
          'md:right-auto md:left-4',
        ].join(' ')}
        // On native, sit above the bottom tab bar (~tab-bar height + safe area)
        // so the gift button never overlaps the Settings/Calculator tabs.
        style={{ bottom: isNative ? 'calc(92px + env(safe-area-inset-bottom))' : '1.25rem' }}
      >
        <div className="relative">

          {/* Pulse beacon ring — only when available */}
          {isAvailable && (
            <span
              className="absolute inset-0 rounded-full animate-ping"
              style={{ background: '#FA7109', opacity: 0.45 }}
              aria-hidden="true"
            />
          )}

          {/* Main button */}
          <button
            onClick={handleClaim}
            aria-label={isAvailable ? t.dailyBonus.ariaClaim : t.dailyBonus.ariaClaimed}
            className={[
              'relative flex items-center justify-center rounded-full shadow-lg',
              'transition-all duration-200 select-none',
              'w-12 h-12',
              isAvailable
                ? 'hover:scale-110 active:scale-95 cursor-pointer'
                : 'cursor-default opacity-60',
            ].join(' ')}
            style={{
              background: isAvailable
                ? 'linear-gradient(135deg, #FA7109 0%, #e56000 100%)'
                : '#cbd5e1',
            }}
          >
            {isAvailable || isOpening || isRevealed ? (
              /* Gift box icon */
              <svg
                viewBox="0 0 24 24" className="w-6 h-6" fill="none"
                stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true"
              >
                {/* Box body */}
                <rect x="3" y="10" width="18" height="11" rx="1.5" />
                {/* Lid */}
                <rect x="2" y="6"  width="20" height="4"  rx="1"   />
                {/* Ribbon vertical */}
                <line x1="12" y1="6"  x2="12" y2="21" />
                {/* Ribbon bow left */}
                <path d="M12 6 C10 4 7 4 7 6.5 C7 9 12 6 12 6Z" fill="white" stroke="white" strokeWidth="0.5" />
                {/* Ribbon bow right */}
                <path d="M12 6 C14 4 17 4 17 6.5 C17 9 12 6 12 6Z" fill="white" stroke="white" strokeWidth="0.5" />
              </svg>
            ) : (
              /* Checkmark when done */
              <svg viewBox="0 0 20 20" className="w-5 h-5" fill="none"
                   stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                   aria-hidden="true">
                <path d="M4 10l4.5 4.5 7.5-8" />
              </svg>
            )}
          </button>

          {/* Popover */}
          {popover && <PopoverCard />}
        </div>
      </div>
    </>
  );
}
