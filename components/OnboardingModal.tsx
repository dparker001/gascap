'use client';

import { useState, useEffect } from 'react';

const ONBOARDING_KEY = 'gascap_onboarded';

const STEPS = [
  {
    emoji: '⛽',
    title: 'Welcome to GasCap™',
    body: "The smarter way to fill up. Calculate exactly how many gallons you need — and what it'll cost — before you pull up to the pump.",
    cta: 'Next',
  },
  {
    emoji: '🎯',
    title: 'Set your fuel target',
    body: 'Drag the gauge to your current fuel level, then pick a target fill level. GasCap™ calculates the cost instantly.',
    cta: 'Next',
  },
  {
    emoji: '💾',
    title: 'Save vehicles & track MPG',
    body: 'Create a free account to save your vehicle, log every fillup, track your MPG trend, and see your monthly fuel spend.',
    cta: 'Get Started',
  },
];

export default function OnboardingModal() {
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (!localStorage.getItem(ONBOARDING_KEY)) {
        // Small delay so the page renders first
        const t = setTimeout(() => setShow(true), 600);
        return () => clearTimeout(t);
      }
    } catch {
      // localStorage blocked (private mode, etc.) — skip onboarding
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

  if (!show) return null;

  const s = STEPS[step];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-6 sm:pb-0"
      style={{ backgroundColor: 'rgba(15,31,52,0.72)' }}
      onClick={dismiss}
    >
      <div
        className="w-full max-w-sm bg-white rounded-3xl shadow-lift p-6 space-y-5 animate-result"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        {/* Progress dots */}
        <div className="flex gap-1.5 justify-center" role="progressbar" aria-valuenow={step + 1} aria-valuemax={STEPS.length}>
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step ? 'w-6 bg-amber-500' : i < step ? 'w-1.5 bg-amber-200' : 'w-1.5 bg-slate-200'
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto">
            <span className="text-4xl" aria-hidden="true">{s.emoji}</span>
          </div>
          <h2 id="onboarding-title" className="text-xl font-black text-slate-800">{s.title}</h2>
          <p className="text-sm text-slate-500 leading-relaxed max-w-[280px] mx-auto">{s.body}</p>
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <button
            onClick={next}
            className="w-full py-3.5 bg-amber-500 hover:bg-amber-400 text-white font-black
                       text-sm rounded-2xl transition-colors shadow-amber"
          >
            {s.cta} {step < STEPS.length - 1 ? '→' : ''}
          </button>
          <button
            onClick={dismiss}
            className="w-full py-2 text-xs text-slate-400 hover:text-slate-600 transition-colors"
          >
            Skip intro
          </button>
        </div>
      </div>
    </div>
  );
}
