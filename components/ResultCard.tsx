'use client';

import { useSession } from 'next-auth/react';
import { useState, useCallback, useEffect, useRef } from 'react';
import TankGauge from './TankGauge';
import FillupLogger from './FillupLogger';
import type { TargetFillResult, BudgetResult } from '@/lib/calculations';

// ── Shareable card helper ──────────────────────────────────────────────────────

function ShareButton({ text }: { text: string }) {
  const { data: session } = useSession();
  const [copied,  setCopied]  = useState(false);
  const [showQR,  setShowQR]  = useState(false);
  const [refUrl,  setRefUrl]  = useState('https://gascap.app');
  const fetched = useRef(false);

  // Fetch the user's personal referral URL once — appended to all shares
  useEffect(() => {
    if (!session || fetched.current) return;
    fetched.current = true;
    fetch('/api/referral')
      .then((r) => r.json())
      .then((d: { referralUrl?: string }) => { if (d.referralUrl) setRefUrl(d.referralUrl); })
      .catch(() => {});
  }, [session]);

  const handleShare = useCallback(async () => {
    const shareData = {
      title: 'GasCap™ — My Fill Calculation',
      text,
      url: refUrl,
    };
    try {
      if (navigator.share && navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(`${text}\n\n${refUrl}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } catch {
      // User cancelled or clipboard failed — silently ignore
    }
  }, [text, refUrl]);

  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=4&color=0f1f34&bgcolor=ffffff&data=${encodeURIComponent(refUrl)}`;

  return (
    <div className="mt-2 space-y-2">
      {/* Share row — share button + QR toggle */}
      <div className="flex gap-2">
        <button
          onClick={handleShare}
          className="flex-1 py-2.5 rounded-2xl border border-slate-200 bg-white
                     hover:border-amber-300 hover:bg-amber-50 text-slate-500 hover:text-amber-700
                     text-xs font-bold transition-colors flex items-center justify-center gap-2"
        >
          {copied ? (
            <><span>✓</span> Copied!</>
          ) : (
            <>
              <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M13 4h3a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2h3"/>
                <path d="M7 2h6v4H7z"/>
              </svg>
              Share this calculation
            </>
          )}
        </button>

        {/* QR toggle button */}
        <button
          onClick={() => setShowQR((v) => !v)}
          title={showQR ? 'Hide QR code' : 'Show QR code'}
          className={`px-3 py-2.5 rounded-2xl border text-sm font-bold transition-colors ${
            showQR
              ? 'border-amber-400 bg-amber-50 text-amber-700'
              : 'border-slate-200 bg-white text-slate-500 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700'
          }`}
          aria-label={showQR ? 'Hide QR code' : 'Show QR code'}
        >
          📱
        </button>
      </div>

      {/* QR panel — expands below */}
      {showQR && (
        <div className="flex flex-col items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-4 animate-fade-in">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Share via QR</p>
          <div className="bg-white p-2.5 rounded-xl shadow-sm border border-slate-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc} alt="Share QR code" width={180} height={180} className="w-44 h-44 rounded-lg" />
          </div>
          <p className="text-[10px] text-slate-400 text-center leading-relaxed max-w-[200px]">
            Scan to open GasCap™{session ? ' — your referral link is embedded' : ''}
          </p>
          <a
            href={`https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=20&color=0f1f34&bgcolor=ffffff&data=${encodeURIComponent(refUrl)}`}
            download="gascap-share-qr.png"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-bold text-amber-600 hover:text-amber-500 transition-colors"
          >
            ⬇ Download QR
          </a>
        </div>
      )}
    </div>
  );
}

// ── Target Fill Result ─────────────────────────────────────────────────

interface TargetResultCardProps {
  result: TargetFillResult;
  vehicleName?: string;
  vehicleId?: string;
  vehicleOdometer?: number;
  fuelLevelBefore?: number;
}

export function TargetResultCard({ result, vehicleName, vehicleId, vehicleOdometer, fuelLevelBefore }: TargetResultCardProps) {
  const {
    gallonsNeeded, estimatedCost,
    currentPercent, targetPercent, targetGallons, summary,
  } = result;

  const noFuelNeeded = gallonsNeeded === 0;

  const { data: session } = useSession();
  const [showLogger, setShowLogger] = useState(false);
  const [logKey, setLogKey] = useState(0);

  // Recover pricePerGallon: estimatedCost / gallonsNeeded, guarded against division by zero
  const pricePerGallon = gallonsNeeded > 0 ? Math.round((estimatedCost / gallonsNeeded) * 100) / 100 : 0;

  return (
    <div className="animate-result mt-4 space-y-3">

      {/* ── Hero stat row ── */}
      <div className="grid grid-cols-2 gap-3">
        <HeroStat
          label="Gallons to add"
          value={gallonsNeeded.toFixed(2)}
          unit="gal"
          accent={noFuelNeeded ? 'green' : 'amber'}
        />
        <HeroStat
          label="Estimated cost"
          value={`$${estimatedCost.toFixed(2)}`}
          accent={noFuelNeeded ? 'green' : 'navy'}
        />
      </div>

      {/* ── Summary card ── */}
      <div className="bg-white rounded-2xl shadow-card px-4 py-4 flex items-start gap-3">
        <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center">
          <span className="text-base" aria-hidden="true">{noFuelNeeded ? '✅' : '⛽'}</span>
        </div>
        <p className="text-slate-700 text-sm font-medium leading-relaxed pt-0.5">{summary}</p>
      </div>

      {/* ── Secondary stats ── */}
      <div className="grid grid-cols-2 gap-3">
        <SecondaryStat label="Target level" value={`${targetPercent}%`} />
        <SecondaryStat label="Tank after fill" value={`${targetGallons.toFixed(2)} gal`} />
      </div>

      {/* ── Visual tank gauge ── */}
      <div className="card-bordered">
        <p className="section-eyebrow">Tank Level</p>
        <TankGauge currentPercent={currentPercent} targetPercent={targetPercent} />
      </div>

      {/* ── Log This Fillup ── */}
      {!session && (
        <a
          href="/signin"
          className="mt-4 w-full py-3 rounded-2xl border-2 border-slate-200 bg-white
                     hover:border-amber-300 text-slate-500 text-sm font-semibold transition-colors
                     flex items-center justify-center gap-2"
        >
          <span>⛽</span> Sign in to log this fillup →
        </a>
      )}
      {session && !showLogger && (
        <button
          onClick={() => setShowLogger(true)}
          className="mt-4 w-full py-3 rounded-2xl border-2 border-amber-400 bg-amber-50
                     hover:bg-amber-100 text-amber-700 text-sm font-bold transition-colors
                     flex items-center justify-center gap-2 shadow-sm"
        >
          <span>⛽</span> Log This Fillup
        </button>
      )}
      {showLogger && (
        <FillupLogger
          prefill={{
            gallonsPumped:   result.gallonsNeeded,
            pricePerGallon:  pricePerGallon,
            vehicleName:     vehicleName ?? 'My Vehicle',
            vehicleId,
            vehicleOdometer,
            fuelLevelBefore,
          }}
          onSaved={() => { setShowLogger(false); setLogKey((k) => k + 1); }}
          onCancel={() => setShowLogger(false)}
        />
      )}
      {/* logKey drives external refresh if a parent listens; suppress unused warning */}
      {logKey > 0 && null}

      {/* ── Share this calculation ── */}
      <ShareButton
        text={
          noFuelNeeded
            ? `My tank is already at ${currentPercent}% — no fuel needed! 🎉 Calculated with GasCap™`
            : `I need ${gallonsNeeded.toFixed(2)} gal to fill up to ${targetPercent}% — that's $${estimatedCost.toFixed(2)} at the pump. Calculated with GasCap™`
        }
      />
    </div>
  );
}

// ── Budget Result ──────────────────────────────────────────────────────

interface BudgetResultCardProps {
  result: BudgetResult;
  pricePerGallon?: number;
  vehicleName?: string;
  vehicleId?: string;
  vehicleOdometer?: number;
  fuelLevelBefore?: number;
}

export function BudgetResultCard({ result, pricePerGallon, vehicleName, vehicleId, vehicleOdometer, fuelLevelBefore }: BudgetResultCardProps) {
  const {
    gallonsAffordable, resultingGallons, resultingPercent,
    actualCost, wouldOverfill, currentPercent, summary,
  } = result;

  const { data: session } = useSession();
  const [showLogger, setShowLogger] = useState(false);
  const [logKey, setLogKey] = useState(0);

  // Derive pricePerGallon from prop or fall back to actualCost / gallonsAffordable
  const resolvedPrice = pricePerGallon
    ?? (gallonsAffordable > 0 ? Math.round((actualCost / gallonsAffordable) * 100) / 100 : 0);

  return (
    <div className="animate-result mt-4 space-y-3">

      {/* ── Overfill warning ── */}
      {wouldOverfill && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3.5">
          <span className="text-lg flex-shrink-0 mt-0.5" aria-hidden="true">⚠️</span>
          <p className="text-amber-800 text-sm font-semibold leading-snug">
            Budget exceeds tank capacity — capped at full.
          </p>
        </div>
      )}

      {/* ── Hero stat row ── */}
      <div className="grid grid-cols-2 gap-3">
        <HeroStat label="Gallons you can buy" value={gallonsAffordable.toFixed(2)} unit="gal" accent="amber" />
        <HeroStat label="Actual pump cost" value={`$${actualCost.toFixed(2)}`} accent="navy" />
      </div>

      {/* ── Summary card ── */}
      <div className="bg-white rounded-2xl shadow-card px-4 py-4 flex items-start gap-3">
        <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center">
          <span className="text-base" aria-hidden="true">💵</span>
        </div>
        <p className="text-slate-700 text-sm font-medium leading-relaxed pt-0.5">{summary}</p>
      </div>

      {/* ── Secondary stats ── */}
      <div className="grid grid-cols-2 gap-3">
        <SecondaryStat label="Resulting level" value={`${resultingPercent.toFixed(0)}%`} />
        <SecondaryStat label="Gallons in tank" value={`${resultingGallons.toFixed(2)} gal`} />
      </div>

      {/* ── Visual tank gauge ── */}
      <div className="card-bordered">
        <p className="section-eyebrow">Tank Level</p>
        <TankGauge currentPercent={currentPercent} targetPercent={resultingPercent} />
      </div>

      {/* ── Log This Fillup ── */}
      {!session && (
        <a
          href="/signin"
          className="mt-4 w-full py-3 rounded-2xl border-2 border-slate-200 bg-white
                     hover:border-amber-300 text-slate-500 text-sm font-semibold transition-colors
                     flex items-center justify-center gap-2"
        >
          <span>⛽</span> Sign in to log this fillup →
        </a>
      )}
      {session && !showLogger && (
        <button
          onClick={() => setShowLogger(true)}
          className="mt-4 w-full py-3 rounded-2xl border-2 border-amber-400 bg-amber-50
                     hover:bg-amber-100 text-amber-700 text-sm font-bold transition-colors
                     flex items-center justify-center gap-2 shadow-sm"
        >
          <span>⛽</span> Log This Fillup
        </button>
      )}
      {showLogger && (
        <FillupLogger
          prefill={{
            gallonsPumped:   result.gallonsAffordable,
            pricePerGallon:  resolvedPrice,
            vehicleName:     vehicleName ?? 'My Vehicle',
            vehicleId,
            vehicleOdometer,
            fuelLevelBefore,
          }}
          onSaved={() => { setShowLogger(false); setLogKey((k) => k + 1); }}
          onCancel={() => setShowLogger(false)}
        />
      )}
      {/* logKey drives external refresh if a parent listens; suppress unused warning */}
      {logKey > 0 && null}

      {/* ── Share this calculation ── */}
      <ShareButton
        text={
          wouldOverfill
            ? `With $${actualCost.toFixed(2)} I can fill my tank to 100% (${resultingGallons.toFixed(2)} gal). Calculated with GasCap™`
            : `With $${actualCost.toFixed(2)} I can buy ${gallonsAffordable.toFixed(2)} gal — that puts my tank at ${resultingPercent.toFixed(0)}%. Calculated with GasCap™`
        }
      />
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

type Accent = 'amber' | 'navy' | 'green';

function HeroStat({
  label, value, unit, accent = 'navy',
}: { label: string; value: string; unit?: string; accent?: Accent }) {
  const bg: Record<Accent, string> = {
    amber: 'bg-amber-500',
    navy:  'bg-navy-700',
    green: 'bg-emerald-600',
  };

  return (
    <div className={`${bg[accent]} rounded-2xl p-4 flex flex-col gap-1`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">{label}</p>
      <p className="text-3xl font-black text-white leading-none tracking-tight">
        {value}
        {unit && <span className="text-base font-semibold text-white/60 ml-1">{unit}</span>}
      </p>
    </div>
  );
}

function SecondaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-2xl shadow-card p-4 flex flex-col gap-0.5 border border-slate-100">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="text-xl font-bold text-navy-700 leading-tight">{value}</p>
    </div>
  );
}
