/**
 * Trip Planner's EPA MPG lookups, with only the latest one allowed to win.
 * (WS02 Phase 1, PR #87 review round 2, 2026-10-20.)
 *
 * The race this closes: selecting the active rental starts an
 * `/api/mpg-lookup` request; the renter then picks a generic preset, edits
 * MPG by hand, switches to garage mode, or picks another vehicle; the older
 * request resolves and writes `mpg`, `mpgSourceLabel` and `mpgOptions` over
 * the newer choice. The displayed MPG would then be a different vehicle's
 * than the one the UI says is selected — the same class of bug the Trip
 * Planner routing-integrity audit found in the address-autocomplete path
 * (2026-10-12), which is why `lib/latestWinsGuard.ts` already exists.
 *
 * This reuses that guard rather than inventing a mechanism, and wraps it in a
 * dependency-injected controller so the race is driven directly in tests —
 * delay a lookup, make a newer choice, resolve the old lookup, assert nothing
 * moved. A source-level assertion cannot prove that.
 *
 * `invalidate()` is the other half: a manual edit or a mode switch issues no
 * new request, so there is no newer token to supersede the old one. It has to
 * cancel outstanding work explicitly.
 *
 * Note `setLookingUp(false)` is gated on the token too. An ungated `finally`
 * would let a stale response switch off a NEWER lookup's spinner, which looks
 * like a silent failure.
 */
import type { LatestWinsGuard } from './latestWinsGuard';
import type { EpaEnergyType }   from './epaEnergyType';

/** The subset of /api/mpg-lookup's response this cares about. */
export interface MpgLookupResponse {
  ok:          boolean;
  combMpg?:    number;
  cityMpg?:    number;
  hwyMpg?:     number;
  energyType?: EpaEnergyType;
  reason?:     string;
  error?:      string;
}

export interface MpgOptions { comb: number; city: number; hwy: number }

/** What a completed lookup is allowed to change. */
export interface MpgLookupSinks {
  setMpg:             (v: string) => void;
  setMpgSourceLabel:  (v: string) => void;
  setMpgOptions:      (v: MpgOptions | null) => void;
  setLookingUp:       (v: boolean) => void;
  /**
   * Set when EPA says this vehicle's figures aren't gallons (electric, CNG,
   * hydrogen). The caller explains that rather than leaving an empty MPG box
   * and inviting the user to invent one.
   */
  setUnsupportedEnergy: (v: { energyType: EpaEnergyType; detail: string } | null) => void;
}

export interface MpgLookupDeps {
  guard:   LatestWinsGuard;
  /** Performs the request. Injected so tests can defer resolution. */
  fetchMpg: (query: string) => Promise<MpgLookupResponse>;
  sinks:   MpgLookupSinks;
  /** Source label for a successful gallon-based result. */
  labelFor: (r: MpgLookupResponse) => string;
}

export interface MpgLookup {
  /** Issue a lookup. Only its result may apply, and only if nothing newer happened. */
  run: (query: string) => Promise<void>;
  /**
   * Cancel every outstanding lookup without issuing one — for a manual MPG
   * edit, a preset selection, a vehicle-mode switch, a reset, an account
   * change or unmount.
   */
  invalidate: () => void;
}

export function createMpgLookup(d: MpgLookupDeps): MpgLookup {
  const { guard, fetchMpg, sinks, labelFor } = d;

  return {
    async run(query: string) {
      const token = guard.begin();

      // Clear the field for THIS lookup before awaiting. Safe: begin() has
      // already invalidated anything older, so nothing else may write after.
      sinks.setMpg('');
      sinks.setMpgSourceLabel('');
      sinks.setMpgOptions(null);
      sinks.setUnsupportedEnergy(null);
      sinks.setLookingUp(true);

      let res: MpgLookupResponse | null = null;
      try {
        res = await fetchMpg(query);
      } catch {
        res = null;           // network/parse failure — field stays empty
      }

      // The whole point: a superseded lookup writes nothing at all, not even
      // the spinner state.
      if (!guard.isCurrent(token)) return;

      sinks.setLookingUp(false);

      if (!res) return;

      if (!res.ok) {
        if (res.reason === 'unsupported_energy_type' && res.energyType) {
          sinks.setUnsupportedEnergy({ energyType: res.energyType, detail: res.error ?? '' });
        }
        return;
      }

      if (typeof res.combMpg !== 'number' || res.combMpg <= 0) return;

      sinks.setMpg(String(res.combMpg));
      sinks.setMpgSourceLabel(labelFor(res));
      sinks.setMpgOptions({
        comb: res.combMpg,
        city: res.cityMpg ?? res.combMpg,
        hwy:  res.hwyMpg  ?? res.combMpg,
      });
    },

    invalidate() {
      guard.invalidateAll();
      sinks.setLookingUp(false);
      sinks.setUnsupportedEnergy(null);
    },
  };
}
