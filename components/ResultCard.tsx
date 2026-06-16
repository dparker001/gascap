'use client';

import { useSession } from 'next-auth/react';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import TankGauge from './TankGauge';
import FillupLogger from './FillupLogger';
import WazeDeepLinkButton          from './WazeDeepLinkButton';
import GoogleMapsHandoffButton      from './GoogleMapsHandoffButton';
import type { TargetFillResult, BudgetResult } from '@/lib/calculations';

// ── Shareable card helper ──────────────────────────────────────────────────────

function ShareButton({ text }: { text: string }) {
  const { data: session } = useSession();
  const { t } = useTranslation();
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
      title: t.resultCard.shareTitle,
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
            <><span>✓</span> {t.resultCard.copied}</>
          ) : (
            <>
              <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M13 4h3a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2h3"/>
                <path d="M7 2h6v4H7z"/>
              </svg>
              {t.resultCard.shareCalculation}
            </>
          )}
        </button>

        {/* QR toggle button */}
        <button
          onClick={() => setShowQR((v) => !v)}
          title={showQR ? t.resultCard.hideQrCode : t.resultCard.showQrCode}
          className={`px-3 py-2.5 rounded-2xl border text-sm font-bold transition-colors ${
            showQR
              ? 'border-amber-400 bg-amber-50 text-amber-700'
              : 'border-slate-200 bg-white text-slate-500 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700'
          }`}
          aria-label={showQR ? t.resultCard.hideQrCode : t.resultCard.showQrCode}
        >
          📱
        </button>
      </div>

      {/* QR panel — expands below */}
      {showQR && (
        <div className="flex flex-col items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-4 animate-fade-in">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{t.resultCard.shareViaQr}</p>
          <div className="bg-white p-2.5 rounded-xl shadow-sm border border-slate-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc} alt={t.resultCard.shareQrAlt} width={180} height={180} className="w-44 h-44 rounded-lg" />
          </div>
          <p className="text-[10px] text-slate-400 text-center leading-relaxed max-w-[200px]">
            {session ? t.resultCard.scanToOpenReferral : t.resultCard.scanToOpen}
          </p>
          <a
            href={`https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=20&color=0f1f34&bgcolor=ffffff&data=${encodeURIComponent(refUrl)}`}
            download="gascap-share-qr.png"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-bold text-amber-600 hover:text-amber-500 transition-colors"
          >
            ⬇ {t.resultCard.downloadQr}
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
  rentalRate?: number;   // rental company's per-gallon rate — enables savings comparison
  isRental?: boolean;    // true when rental mode is on, even if no rate entered
  latitude?: number;     // user's GPS lat from GasPriceLookup
  longitude?: number;    // user's GPS lng from GasPriceLookup
}

export function TargetResultCard({ result, vehicleName, vehicleId, vehicleOdometer, fuelLevelBefore, rentalRate, isRental, latitude, longitude }: TargetResultCardProps) {
  const {
    gallonsNeeded, estimatedCost,
    currentPercent, targetPercent, targetGallons, summary,
  } = result;

  const noFuelNeeded = gallonsNeeded === 0;

  const { data: session } = useSession();
  const { t } = useTranslation();
  const [showLogger, setShowLogger] = useState(false);
  const [logKey, setLogKey] = useState(0);

  // Recover pricePerGallon: estimatedCost / gallonsNeeded, guarded against division by zero
  const pricePerGallon = gallonsNeeded > 0 ? Math.round((estimatedCost / gallonsNeeded) * 100) / 100 : 0;

  return (
    <div className="animate-result mt-4 space-y-3">

      {/* ── Hero stat row ── */}
      <div className="grid grid-cols-2 gap-3">
        <HeroStat
          label={t.resultCard.estGallonsToAdd}
          value={gallonsNeeded.toFixed(2)}
          unit="gal"
          accent={noFuelNeeded ? 'green' : 'amber'}
        />
        <HeroStat
          label={t.resultCard.estCost}
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
        <SecondaryStat label={t.resultCard.targetLevel} value={`${targetPercent}%`} />
        <SecondaryStat label={t.resultCard.tankAfterFill} value={`${targetGallons.toFixed(2)} gal`} />
      </div>

      {/* ── Rental savings comparison ── */}
      {rentalRate && rentalRate > 0 && gallonsNeeded > 0 && (() => {
        const rentalCost = Math.round(gallonsNeeded * rentalRate * 100) / 100;
        const savings    = Math.round((rentalCost - estimatedCost) * 100) / 100;
        return (
          <div className="bg-blue-700 rounded-2xl px-4 py-4 space-y-3">
            {/* Header */}
            <div className="flex items-center gap-2">
              <span className="text-lg" aria-hidden="true">🚗</span>
              <p className="text-xs font-black text-white/80 uppercase tracking-wide">{t.resultCard.rentalReturnComparison}</p>
            </div>

            {/* Two columns: pump vs rental co */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white/10 rounded-xl px-3 py-2.5 text-center">
                <p className="text-[9px] font-bold uppercase tracking-widest text-white/50 mb-1">⛽ {t.resultCard.atThePump}</p>
                <p className="text-2xl font-black text-amber-300 leading-none">${estimatedCost.toFixed(2)}</p>
                <p className="text-[10px] text-white/40 mt-0.5">${pricePerGallon.toFixed(2)}/gal</p>
              </div>
              <div className="bg-white/10 rounded-xl px-3 py-2.5 text-center">
                <p className="text-[9px] font-bold uppercase tracking-widest text-white/50 mb-1">🏢 {t.resultCard.rentalCoFillsIt}</p>
                <p className="text-2xl font-black text-red-300 leading-none">${rentalCost.toFixed(2)}</p>
                <p className="text-[10px] text-white/40 mt-0.5">${rentalRate.toFixed(2)}/gal</p>
              </div>
            </div>

            {/* Savings callout */}
            {savings > 0 ? (
              <div className="bg-emerald-500/20 border border-emerald-400/30 rounded-xl px-3 py-2.5 flex items-center gap-2.5">
                <span className="text-lg flex-shrink-0" aria-hidden="true">💰</span>
                <div>
                  <p className="text-xs font-black text-emerald-300 leading-none">
                    {t.resultCard.youSaveByFilling(savings.toFixed(2))}
                  </p>
                  <p className="text-[10px] text-white/40 mt-0.5">
                    {t.resultCard.percentLessThanRental(Math.round((savings / rentalCost) * 100))}
                  </p>
                </div>
              </div>
            ) : (
              <div className="bg-white/10 rounded-xl px-3 py-2 text-center">
                <p className="text-[11px] text-white/60">{t.resultCard.pumpCompetitive}</p>
              </div>
            )}
          </div>
        );
      })()}

      {/* Rental mode — no rate entered, still show gentle callout */}
      {isRental && !rentalRate && gallonsNeeded > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3 flex items-start gap-2.5">
          <span className="text-base flex-shrink-0 mt-0.5" aria-hidden="true">🚗</span>
          <div>
            <p className="text-xs font-black text-blue-800 leading-none">{t.resultCard.rentalCarDropOff}</p>
            <p className="text-[11px] text-blue-600 mt-1 leading-snug">
              {t.resultCard.rentalNeedLead}{' '}<strong>{gallonsNeeded.toFixed(2)} gal</strong>{' '}{t.resultCard.rentalCostsMid}{' '}<strong>${estimatedCost.toFixed(2)}</strong>{' '}{t.resultCard.rentalAtPumpTrailing}
            </p>
          </div>
        </div>
      )}

      {/* ── Navigation handoffs (Google Maps first, then Waze) ── */}
      <div className="space-y-2">
        <GoogleMapsHandoffButton
          mode={isRental ? 'rental_return' : 'target_fill'}
          calculationData={{
            gallonsNeeded:  gallonsNeeded,
            estimatedCost:  estimatedCost,
            gasPrice:       pricePerGallon,
            targetLevel:    targetPercent,
          }}
        />
        <WazeDeepLinkButton
          latitude={latitude}
          longitude={longitude}
          label={isRental ? t.resultCard.findFuelStopBeforeReturn : t.resultCard.findGasStation}
        />
      </div>

      {/* ── Visual tank gauge ── */}
      <div className="card-bordered">
        <p className="section-eyebrow">{t.resultCard.newTankLevel}</p>
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
          <span>⛽</span> {t.resultCard.signInToLog} →
        </a>
      )}
      {session && !showLogger && (
        <button
          onClick={() => setShowLogger(true)}
          className="mt-4 w-full py-3 rounded-2xl border-2 border-amber-400 bg-amber-50
                     hover:bg-amber-100 text-amber-700 text-sm font-bold transition-colors
                     flex items-center justify-center gap-2 shadow-sm"
        >
          <span>⛽</span> {t.resultCard.logThisFillUp}
        </button>
      )}
      {showLogger && (
        <FillupLogger
          prefill={{
            gallonsPumped:   result.gallonsNeeded,
            pricePerGallon:  pricePerGallon,
            vehicleName:     vehicleName ?? t.resultCard.myVehicle,
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

      {/* ── Disclaimer ── */}
      <p className="text-[10px] text-slate-400 text-center leading-relaxed">
        {t.resultCard.disclaimer}
      </p>

      {/* ── Share this calculation ── */}
      <ShareButton
        text={
          noFuelNeeded
            ? t.resultCard.shareTextNoFuel(currentPercent)
            : t.resultCard.shareTextTarget(gallonsNeeded.toFixed(2), targetPercent, estimatedCost.toFixed(2))
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
  latitude?: number;     // user's GPS lat from GasPriceLookup
  longitude?: number;    // user's GPS lng from GasPriceLookup
}

export function BudgetResultCard({ result, pricePerGallon, vehicleName, vehicleId, vehicleOdometer, fuelLevelBefore, latitude, longitude }: BudgetResultCardProps) {
  const {
    gallonsAffordable, resultingGallons, resultingPercent,
    actualCost, wouldOverfill, currentPercent, summary,
  } = result;

  const { data: session } = useSession();
  const { t } = useTranslation();
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
            {t.resultCard.budgetExceedsCapacity}
          </p>
        </div>
      )}

      {/* ── Hero stat row ── */}
      <div className="grid grid-cols-2 gap-3">
        <HeroStat label={t.resultCard.estGallonsToBuy} value={gallonsAffordable.toFixed(2)} unit="gal" accent="amber" />
        <HeroStat label={t.resultCard.estPumpCost} value={`$${actualCost.toFixed(2)}`} accent="navy" />
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
        <SecondaryStat label={t.resultCard.resultingLevel} value={`${resultingPercent.toFixed(0)}%`} />
        <SecondaryStat label={t.resultCard.gallonsInTank} value={`${resultingGallons.toFixed(2)} gal`} />
      </div>

      {/* ── Navigation handoffs (Google Maps first, then Waze) ── */}
      <div className="space-y-2">
        <GoogleMapsHandoffButton
          mode="budget"
          calculationData={{
            gallonsNeeded: gallonsAffordable,
            estimatedCost: actualCost,
            gasPrice:      resolvedPrice,
          }}
        />
        <WazeDeepLinkButton
          latitude={latitude}
          longitude={longitude}
          label={t.resultCard.findGasStation}
        />
      </div>

      {/* ── Visual tank gauge ── */}
      <div className="card-bordered">
        <p className="section-eyebrow">{t.resultCard.newTankLevel}</p>
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
          <span>⛽</span> {t.resultCard.signInToLog} →
        </a>
      )}
      {session && !showLogger && (
        <button
          onClick={() => setShowLogger(true)}
          className="mt-4 w-full py-3 rounded-2xl border-2 border-amber-400 bg-amber-50
                     hover:bg-amber-100 text-amber-700 text-sm font-bold transition-colors
                     flex items-center justify-center gap-2 shadow-sm"
        >
          <span>⛽</span> {t.resultCard.logThisFillUp}
        </button>
      )}
      {showLogger && (
        <FillupLogger
          prefill={{
            gallonsPumped:   result.gallonsAffordable,
            pricePerGallon:  resolvedPrice,
            vehicleName:     vehicleName ?? t.resultCard.myVehicle,
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

      {/* ── Disclaimer ── */}
      <p className="text-[10px] text-slate-400 text-center leading-relaxed">
        {t.resultCard.disclaimer}
      </p>

      {/* ── Share this calculation ── */}
      <ShareButton
        text={
          wouldOverfill
            ? t.resultCard.shareTextBudgetFull(actualCost.toFixed(2), resultingGallons.toFixed(2))
            : t.resultCard.shareTextBudget(actualCost.toFixed(2), gallonsAffordable.toFixed(2), resultingPercent.toFixed(0))
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
