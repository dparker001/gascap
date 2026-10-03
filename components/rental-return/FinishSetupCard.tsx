'use client';

/**
 * Finish setup — Part A (2026-10-02). Shown on an open rental while the
 * vehicle, tank size or pickup fuel is missing (typically a rental quick-saved
 * ahead of time). Enforced order: vehicle → tank → pickup fuel; pickup fuel
 * stays locked until a tank exists, because a gauge/percent reading means
 * nothing without one. Fuel numbers elsewhere stay "unknown" until done —
 * this card says what unlocks them instead of showing a guess.
 */
import { useTranslation } from '@/contexts/LanguageContext';
import { rentalSetupSteps, type SetupStateInput, type SetupStepKey } from '@/lib/rentalSetupState';

export default function FinishSetupCard({ session, onEditRental, onSetPickupFuel }: {
  session:         SetupStateInput;
  onEditRental:    () => void;
  onSetPickupFuel: () => void;
}) {
  const { t } = useTranslation();
  const r = t.rentalReturn;
  const steps = rentalSetupSteps(session);
  const next = steps.find((s) => !s.done && !s.locked)?.key ?? null;

  const copy: Record<SetupStepKey, { title: string; hint: string; cta: string; action: () => void }> = {
    vehicle:    { title: r.setupStepVehicle,    hint: r.setupStepVehicleHint,    cta: r.setupStepVehicleCta,    action: onEditRental },
    tank:       { title: r.setupStepTank,       hint: r.setupStepTankHint,       cta: r.setupStepTankCta,       action: onEditRental },
    pickupFuel: { title: r.setupStepPickupFuel, hint: r.setupStepPickupFuelHint, cta: r.setupStepPickupFuelCta, action: onSetPickupFuel },
  };

  return (
    <div data-testid="finish-setup-card" className="bg-white rounded-2xl border-2 border-amber-200 shadow-sm p-4 space-y-3">
      <div>
        <p className="text-xs font-black text-amber-800">🧾 {r.finishSetupTitle}</p>
        <p className="text-[11px] text-slate-500 leading-snug">{r.finishSetupHint}</p>
      </div>
      <ol className="space-y-2">
        {steps.map((s, i) => {
          const c = copy[s.key];
          return (
            <li key={s.key} data-setup-step={s.key} className="flex items-start gap-2">
              <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-full text-[10px] font-black flex items-center justify-center ${
                s.done ? 'bg-emerald-100 text-emerald-700' : s.locked ? 'bg-slate-100 text-slate-400' : 'bg-amber-100 text-amber-800'
              }`}>
                {s.done ? '✓' : i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-bold ${s.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{c.title}</p>
                {!s.done && (
                  <p className="text-[11px] text-slate-500 leading-snug">{s.locked ? r.setupStepLockedHint : c.hint}</p>
                )}
              </div>
              {!s.done && !s.locked && (
                <button
                  type="button"
                  onClick={c.action}
                  className={`shrink-0 text-[11px] font-bold rounded-lg px-2.5 py-1 ${
                    next === s.key ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {c.cta}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
