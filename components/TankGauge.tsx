'use client';

// Result-card tank level bar — upgraded to match new design system

function levelColor(pct: number): { bar: string; text: string } {
  if (pct >= 75) return { bar: 'bg-emerald-500', text: 'text-emerald-600' };
  if (pct >= 35) return { bar: 'bg-amber-400',   text: 'text-amber-600' };
  return             { bar: 'bg-red-400',         text: 'text-red-500' };
}

interface TankGaugeProps {
  currentPercent: number;
  targetPercent:  number;
  showTarget?:    boolean;
}

export default function TankGauge({
  currentPercent,
  targetPercent,
  showTarget = true,
}: TankGaugeProps) {
  const cur = Math.min(100, Math.max(0, currentPercent));
  const tgt = Math.min(100, Math.max(0, targetPercent));
  const tgtColors = levelColor(tgt);

  return (
    <div className="mt-1">
      {/* Tick labels */}
      <div className="flex justify-between text-[10px] text-slate-400 font-medium mb-2 px-0.5">
        <span>E</span><span>¼</span><span>½</span><span>¾</span><span>F</span>
      </div>

      {/* Track */}
      <div className="relative h-4 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
        {/* Current (ghost, muted) */}
        <div
          className={`absolute inset-y-0 left-0 rounded-full opacity-30 ${levelColor(cur).bar}`}
          style={{ width: `${cur}%` }}
          aria-hidden="true"
        />
        {/* Target */}
        {showTarget && (
          <div
            className={`gauge-fill absolute inset-y-0 left-0 rounded-full ${tgtColors.bar}`}
            style={{ width: `${tgt}%` }}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Percentage labels */}
      <div className="flex justify-between mt-2 text-xs font-medium">
        <span className="text-slate-400">
          Before <span className="text-slate-600 font-bold">{cur.toFixed(0)}%</span>
        </span>
        {showTarget && (
          <span className="text-slate-400">
            After{' '}
            <span className={`font-black ${tgtColors.text}`}>{tgt.toFixed(0)}%</span>
          </span>
        )}
      </div>
    </div>
  );
}
