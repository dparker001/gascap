'use client';

import { useState } from 'react';

const STEPS = [
  { n: '1', icon: '🚗', title: 'Pick vehicle',    hint: 'Choose from the dropdown or type your tank size in gallons.' },
  { n: '2', icon: '⛽', title: 'Set fuel level',  hint: 'Drag the gauge or type your current gallons.' },
  { n: '3', icon: '🎯', title: 'Choose goal',      hint: 'Set a fill target or enter your budget.' },
  { n: '4', icon: '✅', title: 'Get the answer',  hint: 'See exact gallons and cost — no math needed.' },
];

export default function QuickGuide() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-4 rounded-2xl border border-slate-100 bg-white overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span className="text-amber-500 font-black text-xs uppercase tracking-widest">How to use</span>
          <div className="flex items-center gap-1">
            {STEPS.map((s) => (
              <span key={s.n}
                className="w-5 h-5 rounded-full bg-navy-700 text-white text-[9px] font-black flex items-center justify-center">
                {s.n}
              </span>
            ))}
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-slate-100">
          <div className="flex flex-col mt-3 gap-0">
            {STEPS.map((s, i) => (
              <div key={s.n}>
                {/* Step row */}
                <div className="flex items-start gap-3 bg-slate-50 rounded-xl px-3 py-3">
                  {/* Left: number + connector line */}
                  <div className="flex flex-col items-center flex-shrink-0">
                    <span className="w-7 h-7 rounded-full bg-navy-700 text-white text-[11px] font-black
                                     flex items-center justify-center">
                      {s.n}
                    </span>
                  </div>
                  {/* Right: icon + text */}
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <span className="text-lg leading-none mt-0.5">{s.icon}</span>
                    <div>
                      <p className="text-xs font-bold text-slate-700 leading-snug">{s.title}</p>
                      <p className="text-[10px] text-slate-400 leading-snug mt-0.5">{s.hint}</p>
                    </div>
                  </div>
                </div>
                {/* Connector arrow between steps */}
                {i < STEPS.length - 1 && (
                  <div className="flex justify-start pl-[22px] py-0.5">
                    <div className="flex flex-col items-center">
                      <div className="w-px h-3 bg-slate-200" />
                      <svg viewBox="0 0 8 6" className="w-2 h-1.5 text-slate-300" fill="currentColor">
                        <path d="M4 6L0 0h8z"/>
                      </svg>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
