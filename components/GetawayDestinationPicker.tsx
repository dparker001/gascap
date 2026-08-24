'use client';

/**
 * GetawayDestinationPicker — shown to a Lifetime buyer (after purchase, during
 * the getaway promo) so they choose their complimentary getaway destination.
 *
 * On submit it POSTs to /api/getaway/choose, which atomically claims the
 * destination and sends the certificate via the Marketing Boost API — see
 * that route's header comment for the full fulfillment state machine
 * (pending -> sent | manual_required) and why an automatic retry can never
 * safely re-send once a claim exists.
 *
 * Server-authoritative recovery (2026-08-24, revised after a ChatGPT review
 * finding a residual gap): localStorage is written as a CACHE only, after a
 * server response confirms a choice — it is never read to decide what to
 * render. On mount this always asks the server (GET /api/getaway/choose)
 * what the durable state actually is; while that's in flight, nothing
 * renders (`checking`). If the GET itself fails (network error), there is
 * NO server-confirmed answer — the component shows a distinct "couldn't
 * verify, tap to recheck" state rather than falling back to either the
 * picker (would let an already-Lifetime member resubmit unnecessarily) or a
 * stale confirmed view (could be wrong). Found live in production that a
 * client whose POST never visibly resolved (button stuck on "Loading...")
 * had, in fact, fully succeeded server-side. A POST timeout or an
 * app-resume-while-loading both reconcile against the server the same way,
 * and if that reconciliation also can't get an answer, the UI says
 * "couldn't verify" rather than claiming the request definitely failed —
 * backend idempotency (see the route) makes a later retry safe either way.
 *
 * The catalog is 100+ destinations (lib/getawayPromo.ts), so this includes a
 * search box to filter by city or country rather than one long scroll.
 *
 * Used on the upgrade success page and the standalone /getaway page.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation }      from '@/contexts/LanguageContext';
import { useIsNative }         from '@/hooks/useIsNative';
import { GETAWAY_DESTINATIONS, findGetawayDestination } from '@/lib/getawayPromo';

const STORAGE_KEY = 'gc_getaway_destination';
const POST_TIMEOUT_MS = 15_000;

type ServerStatus = 'pending' | 'sent' | 'manual_required' | 'legacy' | null;

interface GetStatusResponse {
  chosen: boolean;
  destination: string | null;
  fulfillmentStatus: ServerStatus;
}

export default function GetawayDestinationPicker() {
  const { t, locale } = useTranslation();
  const isNative = useIsNative();
  const [selected, setSelected]   = useState<string | null>(null);
  const [chosen,   setChosen]     = useState<string | null>(null);   // confirmed/locked destination id
  const [status,   setStatus]     = useState<ServerStatus>(null);    // fulfillment status for `chosen`
  const [checking, setChecking]   = useState(true);                  // initial GET reconciliation in flight
  const [verifyFailed, setVerifyFailed] = useState(false);           // initial GET could not be completed at all
  const [loading,  setLoading]    = useState(false);
  const [error,    setError]      = useState('');
  const [query,    setQuery]      = useState('');

  const abortRef = useRef<AbortController | null>(null);

  async function reconcile(): Promise<GetStatusResponse | null> {
    try {
      const res = await fetch('/api/getaway/choose');
      if (!res.ok) return null;
      return await res.json() as GetStatusResponse;
    } catch {
      return null;
    }
  }

  function applyServerState(data: GetStatusResponse) {
    if (data.chosen && data.destination) {
      setChosen(data.destination);
      setStatus(data.fulfillmentStatus);
      try { localStorage.setItem(STORAGE_KEY, data.destination); } catch { /* ignore */ }
    } else {
      // The server is authoritative — if it reports no choice, an
      // optimistic localStorage-derived `chosen` from the mount effect
      // must not be left standing (e.g. a stale/incorrect cached value
      // from a different account on a shared device must never render the
      // confirmed state after the server disagrees).
      setChosen(null);
      setStatus(null);
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  // Server-authoritative on mount. localStorage is written as a cache ONLY
  // after a server response confirms a choice (see applyServerState) — it
  // is never read to decide what to render here. `checking` gates all
  // rendering below (nothing paints before this resolves), so an optimistic
  // localStorage-derived render would provide no actual benefit anyway,
  // only the risk of showing a stale/wrong confirmed state if the server
  // later disagrees (2026-08-24 ChatGPT review finding).
  function checkStatus() {
    setChecking(true);
    setVerifyFailed(false);
    reconcile().then((data) => {
      if (data) {
        applyServerState(data);
      } else {
        // The GET itself failed (network error, non-OK response) — we have
        // NO server-confirmed answer. Do not show the picker (which would
        // let a Lifetime member re-submit unnecessarily) and do not show a
        // confirmed state (which could be wrong). Show a distinct
        // "couldn't verify" state with a retry action instead.
        setVerifyFailed(true);
      }
      setChecking(false);
    });
  }

  useEffect(() => {
    checkStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconcile on native resume if a POST is still in flight when the app is
  // backgrounded/foregrounded — a hung request is not a failure, and must
  // never be blindly resubmitted. Same App.addListener('appStateChange')
  // pattern already used in components/NearbyStations.tsx.
  useEffect(() => {
    if (!isNative) return;
    let cleanup: (() => void) | null = null;
    import('@capacitor/app').then(({ App }) => {
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive && loading) {
          reconcile().then((data) => {
            if (data?.chosen) {
              abortRef.current?.abort();
              applyServerState(data);
              setLoading(false);
              setError('');
            }
          });
        }
      }).then((handle) => { cleanup = () => handle.remove(); });
    }).catch(() => {});
    return () => cleanup?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNative, loading]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GETAWAY_DESTINATIONS;
    return GETAWAY_DESTINATIONS.filter((d) => {
      const country = locale === 'es' ? d.countryEs : d.country;
      return d.name.toLowerCase().includes(q) || country.toLowerCase().includes(q);
    });
  }, [query, locale]);

  async function handleConfirm() {
    if (!selected) return;
    setLoading(true);
    setError('');

    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);

    try {
      const res = await fetch('/api/getaway/choose', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ destination: selected }),
        signal:  controller.signal,
      });
      const data = await res.json() as {
        ok?: boolean; error?: string; destination?: string;
        fulfillmentStatus?: ServerStatus; alreadyChosen?: boolean;
      };
      if (res.ok && data.ok && data.destination) {
        // A fresh success and an alreadyChosen reconciliation are treated
        // identically — both mean the server has a durable claim.
        setChosen(data.destination);
        setStatus(data.fulfillmentStatus ?? null);
        try { localStorage.setItem(STORAGE_KEY, data.destination); } catch { /* ignore */ }
      } else if (res.status === 403) {
        // Account not confirmed Lifetime yet — the IAP grant webhook is still
        // catching up. Show a friendly retry instead of the raw "included" error.
        setError(t.pricing.getawayPickerFinalizing);
      } else {
        setError(data.error ?? t.pricing.getawayPickerError);
      }
    } catch (err) {
      // AbortError (our own timeout) does NOT mean the server failed — the
      // request may have completed or still be in flight server-side.
      // Reconcile against durable state instead of assuming failure.
      if ((err as { name?: string })?.name === 'AbortError') {
        const data = await reconcile();
        if (data?.chosen && data.destination) {
          applyServerState(data);
        } else {
          // The follow-up GET also couldn't establish a confirmed choice —
          // that is NOT proof the POST failed (backend idempotency now
          // makes a later retry safe either way), so this must not claim
          // definite failure. Offer a status re-check instead.
          setVerifyFailed(true);
        }
      } else {
        setError(t.pricing.getawayPickerError);
      }
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }

  // ── Locked/confirmed states ──────────────────────────────────────────────
  if (checking) return null; // avoid a flash of the picker before the initial GET resolves

  if (verifyFailed) {
    // No server-confirmed answer exists — never fall back to the picker
    // (would let an already-Lifetime member re-submit unnecessarily) or to
    // a confirmed state (could be wrong). This is the ONLY state where
    // localStorage would previously have been trusted; it no longer is.
    return (
      <div className="rounded-2xl border-2 border-slate-300 bg-slate-50 px-4 py-4 text-left">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
          🏝️ {t.pricing.getawayPill}
        </p>
        <p className="text-sm font-black text-slate-700 leading-snug mb-2">
          {t.pricing.getawayPickerCouldNotVerify}
        </p>
        <button
          type="button"
          onClick={checkStatus}
          className="w-full bg-slate-700 hover:bg-slate-600 text-white text-sm font-black py-2.5 rounded-xl transition-colors"
        >
          {t.pricing.getawayPickerRecheckStatus}
        </button>
      </div>
    );
  }

  if (chosen) {
    const d = findGetawayDestination(chosen);

    if (status === 'manual_required') {
      return (
        <div className="rounded-2xl bg-gradient-to-r from-[#005F4A] to-[#1EB68F] px-4 py-4 text-left">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-300 mb-1">
            🏝️ {t.pricing.getawayPill}
          </p>
          <p className="text-white text-sm font-black leading-snug">
            {d ? `${d.emoji} ${d.name}` : ''} — {t.pricing.getawayPickerManualRequired}
          </p>
        </div>
      );
    }

    if (status === 'pending') {
      return (
        <div className="rounded-2xl bg-gradient-to-r from-[#005F4A] to-[#1EB68F] px-4 py-4 text-left">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-300 mb-1">
            🏝️ {t.pricing.getawayPill}
          </p>
          <p className="text-white text-sm font-black leading-snug">
            {d ? `${d.emoji} ${d.name}` : ''} — {t.pricing.getawayPickerProcessing}
          </p>
        </div>
      );
    }

    // 'sent' or 'legacy' (pre-fix historical row) — both render as confirmed.
    return (
      <div className="rounded-2xl bg-gradient-to-r from-[#005F4A] to-[#1EB68F] px-4 py-4 text-left">
        <p className="text-[10px] font-black uppercase tracking-widest text-amber-300 mb-1">
          🏝️ {t.pricing.getawayPill}
        </p>
        <p className="text-white text-sm font-black leading-snug">
          {d ? `${d.emoji} ${d.name}` : ''} — {t.pricing.getawayPickerConfirmed}
        </p>
        <p className="text-white/60 text-[11px] leading-snug mt-1.5">
          {t.pricing.getawayDisclosure}
        </p>
      </div>
    );
  }

  // ── Picker ─────────────────────────────────────────────────────────────────
  return (
    <div className="rounded-2xl border-2 border-teal-300 bg-[#f0fdf9] px-4 py-4 text-left">
      <p className="text-[10px] font-black uppercase tracking-widest text-[#1EB68F] mb-0.5">
        🏝️ {t.pricing.getawayPill}
      </p>
      <p className="text-sm font-black text-[#005F4A] leading-tight">
        {t.pricing.getawayPickerHeadline}
      </p>
      <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
        {t.pricing.getawayPickerSub}
      </p>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t.pricing.getawayPickerSearchPlaceholder}
        className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700
                   placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400"
      />

      <div className="mt-2 space-y-2 max-h-72 overflow-y-auto pr-0.5">
        {filtered.length === 0 && (
          <p className="text-[11px] text-slate-400 text-center py-4">{t.pricing.getawayPickerNoResults}</p>
        )}
        {filtered.map((d) => {
          const isSel = selected === d.id;
          const country = locale === 'es' ? d.countryEs : d.country;
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => setSelected(d.id)}
              className={`w-full flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition-all ${
                isSel ? 'border-teal-500 bg-white ring-2 ring-teal-400' : 'border-slate-200 bg-white hover:border-teal-300'
              }`}
            >
              <span className="text-xl flex-shrink-0" aria-hidden="true">{d.emoji}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-black text-navy-700 leading-tight">{d.name}</span>
                <span className="block text-[11px] text-slate-500 leading-tight">{country}</span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-[10px] text-slate-400 mt-2 leading-snug">
        {t.pricing.getawayPickerNote}
      </p>

      {error && <p className="text-[11px] text-red-600 font-semibold mt-2">{error}</p>}

      <button
        type="button"
        onClick={handleConfirm}
        disabled={!selected || loading}
        className="mt-3 w-full bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-white text-sm font-black
                   py-3 rounded-xl transition-colors"
      >
        {loading ? t.pricing.loading : t.pricing.getawayPickerConfirm}
      </button>
    </div>
  );
}
