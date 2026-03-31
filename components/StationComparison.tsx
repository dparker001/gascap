'use client';

import { useState } from 'react';

interface CompareResult {
  savings:  number;
  cheaper:  1 | 2;
  pctDiff:  number;
  cost1:    number;
  cost2:    number;
  annual:   number;
}

export default function StationComparison({ embedded }: { embedded?: boolean }) {
  const [tankSize, setTankSize] = useState('');
  const [price1,   setPrice1]   = useState('');
  const [price2,   setPrice2]   = useState('');
  const [result,   setResult]   = useState<CompareResult | null>(null);

  function compare() {
    const t  = parseFloat(tankSize);
    const p1 = parseFloat(price1);
    const p2 = parseFloat(price2);
    if (!t || !p1 || !p2 || t <= 0 || p1 <= 0 || p2 <= 0) return;
    const cost1   = t * p1;
    const cost2   = t * p2;
    const savings = Math.abs(cost1 - cost2);
    const pctDiff = (Math.abs(p1 - p2) / Math.max(p1, p2)) * 100;
    const cheaper = cost1 < cost2 ? 1 : 2;
    setResult({ savings, cheaper, pctDiff, cost1, cost2, annual: savings * 52 });
  }

  return (
    <div className={embedded ? '' : 'max-w-lg mx-auto px-4 py-6'}>
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
            <span className="text-lg">🏪</span>
          </div>
          <div>
            <p className="text-sm font-black text-slate-700">Station Price Comparison</p>
            <p className="text-[10px] text-slate-400">See exactly how much you save per tank</p>
          </div>
        </div>

        {/* Tank size */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1.5">
            Tank Size <span className="text-slate-400 font-normal">(gallons)</span>
          </label>
          <input
            type="number"
            inputMode="decimal"
            value={tankSize}
            onChange={(e) => { setTankSize(e.target.value); setResult(null); }}
            placeholder="e.g. 14.5"
            className="input-field"
          />
        </div>

        {/* Price inputs */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">
              Station A <span className="text-slate-400 font-normal">($/gal)</span>
            </label>
            <input
              type="number"
              inputMode="decimal"
              value={price1}
              onChange={(e) => { setPrice1(e.target.value); setResult(null); }}
              placeholder="3.49"
              className="input-field"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">
              Station B <span className="text-slate-400 font-normal">($/gal)</span>
            </label>
            <input
              type="number"
              inputMode="decimal"
              value={price2}
              onChange={(e) => { setPrice2(e.target.value); setResult(null); }}
              placeholder="3.39"
              className="input-field"
            />
          </div>
        </div>

        {/* Compare button */}
        <button
          onClick={compare}
          disabled={!tankSize || !price1 || !price2}
          className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-40
                     text-white font-bold text-sm rounded-2xl transition-colors"
        >
          Compare Stations
        </button>

        {/* Result */}
        {result && (
          <div className="animate-result space-y-3 pt-1">
            {/* Savings hero */}
            <div className={`rounded-2xl p-4 text-center border ${
              result.savings < 0.01
                ? 'bg-slate-50 border-slate-100'
                : 'bg-amber-50 border-amber-200'
            }`}>
              {result.savings < 0.01 ? (
                <>
                  <p className="text-sm font-black text-slate-600">Same price!</p>
                  <p className="text-xs text-slate-400 mt-1">Both stations cost the same per fill.</p>
                </>
              ) : (
                <>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                    Station {result.cheaper} saves you
                  </p>
                  <p className="text-4xl font-black text-amber-600">${result.savings.toFixed(2)}</p>
                  <p className="text-xs text-slate-500 mt-1">per full tank</p>
                </>
              )}
            </div>

            {/* Per-station costs */}
            <div className="grid grid-cols-2 gap-3">
              {([1, 2] as const).map((n) => {
                const cost = n === 1 ? result.cost1 : result.cost2;
                const win  = result.cheaper === n && result.savings >= 0.01;
                return (
                  <div
                    key={n}
                    className={`rounded-xl p-3 text-center border ${
                      win ? 'border-amber-300 bg-amber-50' : 'border-slate-100 bg-white'
                    }`}
                  >
                    <p className="text-[10px] font-bold uppercase text-slate-400 mb-0.5">Station {n}</p>
                    <p className="text-xl font-black text-navy-700">${cost.toFixed(2)}</p>
                    <p className="text-[10px] text-slate-400">full tank</p>
                    {win && (
                      <p className="text-[9px] font-black text-amber-600 mt-1">✓ CHEAPER</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Annual projection */}
            {result.savings >= 0.01 && (
              <div className="text-center space-y-0.5">
                <p className="text-[11px] text-slate-500">
                  That's{' '}
                  <span className="font-black text-navy-700">{result.pctDiff.toFixed(1)}%</span> cheaper
                </p>
                <p className="text-[11px] text-slate-400">
                  ≈{' '}
                  <span className="font-bold text-slate-600">${result.annual.toFixed(0)}</span> saved/year
                  <span className="text-slate-300 ml-0.5">(filling up weekly)</span>
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
