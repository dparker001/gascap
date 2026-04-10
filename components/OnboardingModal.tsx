'use client';

import { useState, useEffect } from 'react';
import { createPortal }        from 'react-dom';
import { useTranslation }      from '@/contexts/LanguageContext';

const ONBOARDING_KEY = 'gascap_onboarded';

// ── Step illustrations (inline SVG) ───────────────────────────────────────────

function IllustrationPump() {
  return (
    <svg viewBox="0 0 240 130" className="w-full h-full" aria-hidden="true">
      {/* Road / ground */}
      <rect x="0" y="105" width="240" height="25" fill="rgba(255,255,255,0.06)" rx="4" />
      <line x1="20" y1="117" x2="60" y2="117" stroke="rgba(255,255,255,0.18)" strokeWidth="3" strokeLinecap="round" />
      <line x1="90" y1="117" x2="150" y2="117" stroke="rgba(255,255,255,0.18)" strokeWidth="3" strokeLinecap="round" />
      <line x1="180" y1="117" x2="220" y2="117" stroke="rgba(255,255,255,0.18)" strokeWidth="3" strokeLinecap="round" />

      {/* Gas pump body */}
      <rect x="72" y="28" width="56" height="78" rx="8" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
      {/* Pump screen */}
      <rect x="82" y="40" width="36" height="24" rx="4" fill="rgba(245,158,11,0.5)" />
      {/* Price digits on screen */}
      <text x="100" y="57" textAnchor="middle" fontSize="10" fontWeight="900" fill="white" fontFamily="monospace">$3.49</text>
      {/* Pump base label */}
      <text x="100" y="92" textAnchor="middle" fontSize="7" fontWeight="700" fill="rgba(255,255,255,0.5)" letterSpacing="1">REGULAR</text>

      {/* Nozzle arm */}
      <path d="M128 62 Q148 62 148 78" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="3" />
      {/* Hose */}
      <path d="M148 78 Q150 96 138 104" fill="none" stroke="rgba(245,158,11,0.7)" strokeWidth="4" strokeLinecap="round" />
      {/* Nozzle tip */}
      <rect x="130" y="100" width="16" height="7" rx="3.5" fill="#f59e0b" />
      {/* Fuel droplets */}
      <circle cx="144" cy="115" r="3" fill="rgba(245,158,11,0.5)" />
      <circle cx="150" cy="121" r="2" fill="rgba(245,158,11,0.3)" />

      {/* ⛽ emoji-style star burst */}
      <circle cx="185" cy="42" r="18" fill="rgba(245,158,11,0.15)" />
      <text x="185" y="48" textAnchor="middle" fontSize="20">⛽</text>

      {/* Dollar signs floating */}
      <text x="42" y="52" fontSize="13" fontWeight="900" fill="rgba(245,158,11,0.5)">$</text>
      <text x="52" y="38" fontSize="9" fontWeight="900" fill="rgba(245,158,11,0.3)">$</text>
    </svg>
  );
}

function IllustrationGauge() {
  // Arc from ~195° to ~345° (150° sweep) — same geometry as the app's FuelGauge
  const cx = 120, cy = 82, r = 58;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const arcPoint = (deg: number) => ({
    x: cx + r * Math.cos(toRad(deg)),
    y: cy + r * Math.sin(toRad(deg)),
  });

  const startDeg = 195, endDeg = 345;
  const fillDeg  = 195 + 150 * 0.62; // needle at ~62% full

  const s  = arcPoint(startDeg);
  const e  = arcPoint(endDeg);
  const f  = arcPoint(fillDeg);

  const arcPath = (from: typeof s, to: typeof e, sweep = 0) =>
    `M ${from.x} ${from.y} A ${r} ${r} 0 ${sweep} 1 ${to.x} ${to.y}`;

  const fillSweep = fillDeg - startDeg > 180 ? 1 : 0;

  // Needle tip
  const needleLen = r - 10;
  const nx = cx + needleLen * Math.cos(toRad(fillDeg));
  const ny = cy + needleLen * Math.sin(toRad(fillDeg));

  return (
    <svg viewBox="0 0 240 130" className="w-full h-full" aria-hidden="true">
      {/* Background glow */}
      <circle cx={cx} cy={cy} r="72" fill="rgba(245,158,11,0.06)" />

      {/* Track arc */}
      <path
        d={arcPath(s, e, 1)}
        fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="10" strokeLinecap="round"
      />
      {/* Fill arc */}
      <path
        d={arcPath(s, f, fillSweep)}
        fill="none" stroke="#f59e0b" strokeWidth="10" strokeLinecap="round"
      />

      {/* E / F labels */}
      {(() => {
        const ePos = arcPoint(startDeg - 10);
        const fPos = arcPoint(endDeg + 10);
        return (
          <>
            <text x={ePos.x} y={ePos.y + 4} textAnchor="middle" fontSize="11" fontWeight="900" fill="rgba(255,255,255,0.5)">E</text>
            <text x={fPos.x} y={fPos.y + 4} textAnchor="middle" fontSize="11" fontWeight="900" fill="rgba(255,255,255,0.5)">F</text>
          </>
        );
      })()}

      {/* Needle */}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="white" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="7" fill="#f59e0b" />
      <circle cx={cx} cy={cy} r="3" fill="white" />

      {/* Percent label */}
      <text x={cx} y={cy + 22} textAnchor="middle" fontSize="14" fontWeight="900" fill="rgba(255,255,255,0.85)">62%</text>

      {/* Cost pill */}
      <rect x="153" y="32" width="72" height="26" rx="13" fill="rgba(245,158,11,0.25)" stroke="rgba(245,158,11,0.4)" strokeWidth="1" />
      <text x="189" y="50" textAnchor="middle" fontSize="11" fontWeight="900" fill="#f59e0b">$18.40</text>

      {/* Drag hint */}
      <text x={cx} y="118" textAnchor="middle" fontSize="8.5" fill="rgba(255,255,255,0.35)" fontWeight="600">drag to set fuel level</text>
    </svg>
  );
}

function IllustrationRoad() {
  return (
    <svg viewBox="0 0 240 130" className="w-full h-full" aria-hidden="true">
      {/* Sky */}
      <defs>
        <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.04)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="240" height="80" fill="url(#skyGrad)" />

      {/* Road */}
      <path d="M0 90 L240 90 L240 130 L0 130 Z" fill="rgba(255,255,255,0.08)" />
      {/* Lane dashes */}
      {[20, 60, 100, 140, 180].map((x) => (
        <rect key={x} x={x} y="106" width="25" height="4" rx="2" fill="rgba(255,255,255,0.2)" />
      ))}

      {/* Perspective lines */}
      <line x1="120" y1="50" x2="0" y2="90" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      <line x1="120" y1="50" x2="240" y2="90" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />

      {/* Car silhouette */}
      <g transform="translate(72, 60)">
        {/* Body */}
        <rect x="0" y="14" width="96" height="22" rx="4" fill="rgba(255,255,255,0.25)" />
        {/* Cabin */}
        <path d="M18 14 L28 2 L68 2 L78 14 Z" fill="rgba(255,255,255,0.3)" />
        {/* Windshield */}
        <path d="M30 13 L36 3 L64 3 L70 13 Z" fill="rgba(245,158,11,0.3)" />
        {/* Wheels */}
        <circle cx="22" cy="36" r="9" fill="rgba(30,58,95,0.8)" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
        <circle cx="74" cy="36" r="9" fill="rgba(30,58,95,0.8)" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
        <circle cx="22" cy="36" r="4" fill="rgba(255,255,255,0.15)" />
        <circle cx="74" cy="36" r="4" fill="rgba(255,255,255,0.15)" />
        {/* Headlight */}
        <rect x="88" y="18" width="7" height="5" rx="2" fill="#f59e0b" opacity="0.8" />
      </g>

      {/* Stars / checkmarks floating */}
      <text x="30" y="35" fontSize="15">✓</text>
      <text x="198" y="42" fontSize="13">✓</text>
      <circle cx="32" cy="22" r="8" fill="rgba(245,158,11,0.15)" />
      <circle cx="200" cy="30" r="7" fill="rgba(245,158,11,0.15)" />

      {/* "FREE" badge */}
      <rect x="95" y="6" width="50" height="20" rx="10" fill="rgba(245,158,11,0.3)" stroke="rgba(245,158,11,0.5)" strokeWidth="1" />
      <text x="120" y="20" textAnchor="middle" fontSize="9" fontWeight="900" fill="#f59e0b" letterSpacing="1">FREE</text>
    </svg>
  );
}

// ── Step config ───────────────────────────────────────────────────────────────

interface Step {
  title:      string;
  body:       string;
  cta:        string;
  skipLabel:  string;
  bg:         string;           // gradient CSS for the illustration header
  Illustration: () => JSX.Element;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export default function OnboardingModal() {
  const { t } = useTranslation();
  const [show,    setShow]    = useState(false);
  const [step,    setStep]    = useState(0);
  const [mounted, setMounted] = useState(false);  // true only in the browser

  // Build steps with localized copy. Gradients + illustrations stay constant;
  // only the title/body/cta/skip labels flip when the locale changes.
  const STEPS: Step[] = [
    {
      title:     t.onboarding.step1Title,
      body:      t.onboarding.step1Body,
      cta:       t.onboarding.step1Cta,
      skipLabel: t.onboarding.skipIntro,
      bg:        'linear-gradient(135deg, #1e3a5f 0%, #2c5491 100%)',
      Illustration: IllustrationPump,
    },
    {
      title:     t.onboarding.step2Title,
      body:      t.onboarding.step2Body,
      cta:       t.onboarding.step2Cta,
      skipLabel: t.onboarding.skipIntro,
      bg:        'linear-gradient(135deg, #172d4a 0%, #1e3a5f 60%, #b45309 100%)',
      Illustration: IllustrationGauge,
    },
    {
      title:     t.onboarding.step3Title,
      body:      t.onboarding.step3Body,
      cta:       t.onboarding.step3Cta,
      skipLabel: t.onboarding.closeIntro,
      bg:        'linear-gradient(135deg, #0f1f34 0%, #1e3a5f 60%, #2c5491 100%)',
      Illustration: IllustrationRoad,
    },
  ];

  useEffect(() => {
    setMounted(true);  // mark as client-rendered
    try {
      if (!localStorage.getItem(ONBOARDING_KEY)) {
        const t = setTimeout(() => setShow(true), 700);
        return () => clearTimeout(t);
      }
    } catch {
      // localStorage blocked (private mode, etc.) — skip silently
    }
  }, []);

  function dismiss() {
    try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch {}
    setShow(false);
  }

  function next() {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      dismiss();
    }
  }

  // Nothing to render until the browser confirms localStorage is clear
  if (!mounted || !show) return null;

  const s      = STEPS[step];
  const isLast = step === STEPS.length - 1;

  // ── Portal — renders directly under <body> so no ancestor stacking
  //    context (transforms, overflow, etc.) can trap position:fixed.
  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center px-4"
      style={{ zIndex: 9999, backgroundColor: 'rgba(10,20,40,0.82)', backdropFilter: 'blur(6px)' }}
      onClick={dismiss}
    >
      <div
        className="w-full max-w-sm rounded-3xl shadow-lift overflow-hidden animate-result"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        {/* ── Illustrated header ── */}
        <div
          className="relative w-full"
          style={{ background: s.bg, height: '148px' }}
        >
          {/* Decorative arc */}
          <svg
            className="absolute inset-0 w-full h-full opacity-[0.06] pointer-events-none"
            viewBox="0 0 320 148" preserveAspectRatio="xMidYMid slice" aria-hidden="true"
          >
            <circle cx="160" cy="220" r="190" fill="none" stroke="white" strokeWidth="60" />
          </svg>

          {/* Step illustration */}
          <div className="absolute inset-0 flex items-center justify-center px-4 pt-2">
            <s.Illustration />
          </div>

          {/* Brand tag — top-left */}
          <div className="absolute top-4 left-4 flex items-center gap-1.5">
            <span className="text-white font-black text-sm tracking-tight">
              GasCap<sup className="text-amber-400 text-[9px]">™</sup>
            </span>
          </div>

          {/* Close ×  — top-right */}
          <button
            onClick={dismiss}
            className="absolute top-3 right-3 w-7 h-7 rounded-full bg-white/10 hover:bg-white/20
                       transition-colors flex items-center justify-center"
            aria-label={t.onboarding.closeAria}
          >
            <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none"
                 stroke="white" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>

        {/* ── Content area ── */}
        <div className="bg-white px-6 pt-5 pb-6 space-y-4">
          {/* Progress dots */}
          <div className="flex gap-1.5 justify-center">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === step ? 'w-6 bg-amber-500' : i < step ? 'w-1.5 bg-amber-200' : 'w-1.5 bg-slate-200'
                }`}
              />
            ))}
          </div>

          {/* Text */}
          <div className="text-center space-y-2">
            <h2 id="onboarding-title" className="text-lg font-black text-slate-800 leading-tight">
              {s.title}
            </h2>
            <p className="text-sm text-slate-500 leading-relaxed max-w-[280px] mx-auto">
              {s.body}
            </p>
          </div>

          {/* Actions */}
          <div className="space-y-2 pt-1">
            <button
              onClick={next}
              className={`w-full py-3.5 font-black text-sm rounded-2xl transition-colors shadow-amber ${
                isLast
                  ? 'bg-amber-500 hover:bg-amber-400 text-white'
                  : 'bg-navy-700 hover:bg-navy-800 text-white'
              }`}
            >
              {s.cta}
            </button>
            <button
              onClick={dismiss}
              className="w-full py-2 text-xs text-slate-400 hover:text-slate-600 transition-colors"
            >
              {s.skipLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
