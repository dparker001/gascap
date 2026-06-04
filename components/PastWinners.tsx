import Link from 'next/link';

interface Winner {
  name:   string;   // First name + last initial only
  month:  string;
  prize:  string;
}

// Add new winners here each month — newest first
const WINNERS: Winner[] = [
  { name: 'Luis L.', month: 'April 2026', prize: '$25 Visa Prepaid Card' },
];

/**
 * Next drawing = the next occurrence of the 5th of a month. The 5th-of-month
 * draw is for the PRIOR month's entries (e.g. June 5 draws May). Auto-advances
 * each month: before the 5th → this month's 5th; on/after the 5th → next month's.
 */
function nextDrawing(): { dateLabel: string; forLabel: string } {
  const now    = new Date();
  const offset = now.getDate() < 5 ? 0 : 1;
  const draw   = new Date(now.getFullYear(), now.getMonth() + offset, 5);
  const entry  = new Date(draw.getFullYear(), draw.getMonth() - 1, 1);
  return {
    dateLabel: draw.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    forLabel:  `$25 Visa · for ${entry.toLocaleDateString('en-US', { month: 'long' })}'s entries`,
  };
}

/** Past giveaway winners — displayed on the landing page guest section. */
export default function PastWinners() {
  if (WINNERS.length === 0) return null;

  const nd = nextDrawing();

  return (
    <section className="px-4 pb-5 max-w-lg mx-auto w-full">
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-4">

        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 h-px bg-amber-200" />
          <span className="text-[10px] font-black text-amber-700 uppercase tracking-widest whitespace-nowrap">
            🎁 Recent Giveaway Winners
          </span>
          <div className="flex-1 h-px bg-amber-200" />
        </div>

        {/* Next drawing announcement — auto-updates to the next 5th-of-month */}
        <div className="mb-3 rounded-xl bg-gradient-to-r from-amber-500 to-[#FA7109] px-3.5 py-2.5 text-center shadow-sm">
          <p className="text-[10px] font-black text-white/90 uppercase tracking-widest">📅 Next Drawing</p>
          <p className="text-sm font-black text-white mt-0.5">{nd.dateLabel}</p>
          <p className="text-[11px] text-white/85 mt-0.5">{nd.forLabel}</p>
        </div>

        <div className="space-y-2">
          {WINNERS.map((w) => (
            <div
              key={`${w.name}-${w.month}`}
              className="flex items-center justify-between gap-3
                         bg-white rounded-xl border border-amber-100 px-3 py-2.5"
            >
              <div className="flex items-center gap-2.5">
                <span className="text-lg flex-shrink-0" aria-hidden="true">🏆</span>
                <div>
                  <p className="text-xs font-black text-slate-800">{w.name}</p>
                  <p className="text-[10px] text-slate-400">{w.month}</p>
                </div>
              </div>
              <span className="text-[11px] font-bold text-amber-700 whitespace-nowrap">
                {w.prize}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-3 text-center text-[11px] text-amber-700 leading-relaxed">
          A new winner is drawn every month.{' '}
          <Link href="/signup" className="font-bold underline hover:text-amber-800">
            Create a free account
          </Link>{' '}
          to enter automatically.
        </p>
      </div>
    </section>
  );
}
