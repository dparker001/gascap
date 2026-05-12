'use client';
/**
 * SmartcarConnect
 * Rendered inside SavedVehicles when a Pro user clicks "⚡ Connect Car".
 *
 * Phases:
 *   loading    → fetching /api/smartcar/status
 *   upsell     → add-on not purchased → show $2.99/mo buy card
 *   info       → add-on active, no OAuth yet → "Connect My Car" button
 *   linking    → OAuth returned, matching Smartcar vehicle to garage vehicle
 *   linked     → link saved, show success
 *   error      → something went wrong
 */

import { useState, useEffect, useCallback } from 'react';
import type { Vehicle }                     from '@/components/SavedVehicles';

interface SmartcarVehicleInfo {
  id:    string;
  make?: string;
  model?: string;
  year?: number;
  vin?:  string;
}

interface StatusResponse {
  isPro:         boolean;
  addonActive:   boolean;
  hasOAuthTokens: boolean;
}

interface Props {
  garageVehicles: Vehicle[];
  onDone:         () => void;
}

export default function SmartcarConnect({ garageVehicles, onDone }: Props) {
  type Phase = 'loading' | 'upsell' | 'info' | 'linking' | 'linked' | 'error';

  const [phase,             setPhase]             = useState<Phase>('loading');
  const [status,            setStatus]            = useState<StatusResponse | null>(null);
  const [error,             setError]             = useState('');
  const [connecting,        setConnecting]        = useState(false);
  const [purchasing,        setPurchasing]        = useState(false);
  const [smartcarVehicles,  setSmartcarVehicles]  = useState<SmartcarVehicleInfo[]>([]);
  const [selectedScId,      setSelectedScId]      = useState('');
  const [selectedGcId,      setSelectedGcId]      = useState(garageVehicles[0]?.id ?? '');
  const [saving,            setSaving]            = useState(false);
  const [loadingVehicles,   setLoadingVehicles]   = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res  = await fetch('/api/smartcar/status');
      const data = await res.json() as StatusResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Status check failed');
      setStatus(data);
      // Decide initial phase
      if (!data.addonActive) {
        setPhase('upsell');
      } else if (data.hasOAuthTokens) {
        setPhase('info');   // already connected — can re-link or just use sync
      } else {
        setPhase('info');   // addon active, not yet OAuth'd
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load status');
      setPhase('error');
    }
  }, []);

  // Check for OAuth return or addon success on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.get('smartcarConnected') === '1') {
      const clean = new URL(window.location.href);
      clean.searchParams.delete('smartcarConnected');
      window.history.replaceState({}, '', clean.toString());
      loadSmartcarVehicles();
      return;
    }

    if (params.get('smartcarError')) {
      const msg = params.get('smartcarError') ?? 'Unknown error';
      setError(decodeURIComponent(msg));
      setPhase('error');
      const clean = new URL(window.location.href);
      clean.searchParams.delete('smartcarError');
      window.history.replaceState({}, '', clean.toString());
      return;
    }

    if (params.get('smartcarAddonSuccess') === '1') {
      const clean = new URL(window.location.href);
      clean.searchParams.delete('smartcarAddonSuccess');
      window.history.replaceState({}, '', clean.toString());
      // Reload status — addon should now be active after webhook fired
      // Small delay to let webhook propagate
      setTimeout(() => loadStatus(), 1500);
      return;
    }

    if (params.get('smartcarAddonCancelled') === '1') {
      const clean = new URL(window.location.href);
      clean.searchParams.delete('smartcarAddonCancelled');
      window.history.replaceState({}, '', clean.toString());
      loadStatus();
      return;
    }

    loadStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSmartcarVehicles() {
    setLoadingVehicles(true);
    setPhase('linking');
    setError('');
    try {
      const res  = await fetch('/api/smartcar/vehicles');
      const data = await res.json() as { vehicles?: SmartcarVehicleInfo[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load vehicles');
      setSmartcarVehicles(data.vehicles ?? []);
      if (data.vehicles?.[0]) setSelectedScId(data.vehicles[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to list your vehicles');
      setPhase('error');
    } finally {
      setLoadingVehicles(false);
    }
  }

  async function handlePurchaseAddon() {
    setPurchasing(true);
    setError('');
    try {
      const res  = await fetch('/api/stripe/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tier: 'smartcar-addon' }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Could not start checkout');
      window.location.href = data.url!;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Purchase failed');
      setPurchasing(false);
    }
  }

  async function handleConnect() {
    setConnecting(true);
    setError('');
    try {
      const res  = await fetch('/api/smartcar');
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Could not start OAuth flow');
      window.location.href = data.url!;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed');
      setConnecting(false);
    }
  }

  async function handleLink() {
    if (!selectedScId || !selectedGcId) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/smartcar/link', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ garageVehicleId: selectedGcId, smartcarVehicleId: selectedScId }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Link failed');
      setPhase('linked');
      setTimeout(() => { onDone(); }, 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Link failed');
    } finally {
      setSaving(false);
    }
  }

  // ── Render phases ─────────────────────────────────────────────────────────

  if (phase === 'loading') {
    return (
      <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-4 flex items-center gap-2">
        <span className="animate-spin text-sm">⚙️</span>
        <span className="text-xs text-slate-500">Loading…</span>
      </div>
    );
  }

  if (phase === 'linked') {
    return (
      <div className="rounded-xl bg-teal-50 border border-teal-200 px-4 py-4 text-center space-y-1">
        <div className="text-2xl">⚡</div>
        <p className="text-sm font-bold text-teal-700">Vehicle connected!</p>
        <p className="text-xs text-teal-600">Tap "⚡ Sync from Car" in the fill-up form to pull your odometer automatically.</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-4 space-y-2">
        <p className="text-sm font-bold text-red-600">Something went wrong</p>
        <p className="text-xs text-red-500 leading-relaxed">{error}</p>
        <button
          onClick={() => { setError(''); setPhase('loading'); loadStatus(); }}
          className="text-xs font-bold text-red-600 underline"
        >
          Try again
        </button>
      </div>
    );
  }

  // ── Upsell — add-on not purchased ────────────────────────────────────────
  if (phase === 'upsell') {
    return (
      <div className="rounded-xl bg-gradient-to-br from-[#005F4A] to-[#1EB68F] px-4 py-4 space-y-3">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">⚡</span>
            <p className="text-sm font-black text-white">Vehicle Sync</p>
            <span className="text-[9px] font-black bg-white/20 text-white px-1.5 py-0.5 rounded-full uppercase tracking-wider">
              Add-On
            </span>
          </div>
          <p className="text-xs text-white/80 leading-relaxed">
            Auto-sync your odometer from your car before every fill-up. Works with most 2015+ connected vehicles.
          </p>
        </div>

        {/* What you get */}
        <div className="space-y-1.5">
          {[
            '⚡ One-tap odometer sync',
            '📊 More accurate MPG tracking',
            '🔒 Read-only — no remote control ever',
            '🚗 40+ brands supported (Tesla, Ford, GM…)',
          ].map((item) => (
            <p key={item} className="text-xs text-white/90 flex items-center gap-1.5">
              <span>{item}</span>
            </p>
          ))}
        </div>

        {error && <p className="text-xs text-red-200">{error}</p>}

        {/* Price + CTA */}
        <div>
          <button
            onClick={handlePurchaseAddon}
            disabled={purchasing}
            className="w-full py-3 rounded-xl bg-[#FA7109] text-white text-sm font-black
                       hover:bg-orange-500 disabled:opacity-50 transition-colors"
          >
            {purchasing ? 'Opening checkout…' : 'Add Vehicle Sync — $2.99/mo →'}
          </button>
          <p className="text-[10px] text-white/60 text-center mt-1.5">
            Cancel anytime · Separate from your Pro plan · Powered by Smartcar
          </p>
        </div>
      </div>
    );
  }

  // ── Linking — match Smartcar vehicle to garage vehicle ───────────────────
  if (phase === 'linking') {
    return (
      <div className="rounded-xl bg-teal-50 border border-teal-200 px-4 py-4 space-y-3">
        <div>
          <p className="text-sm font-black text-teal-800">⚡ Link your vehicle</p>
          <p className="text-xs text-teal-600 mt-0.5">Match the car from Smartcar to your GasCap garage.</p>
        </div>

        {loadingVehicles ? (
          <div className="flex items-center gap-2 py-2">
            <span className="animate-spin text-base">⚙️</span>
            <span className="text-xs text-teal-600">Loading your vehicles…</span>
          </div>
        ) : (
          <>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-teal-700 block mb-1">
                Your car (via Smartcar)
              </label>
              <select
                value={selectedScId}
                onChange={(e) => setSelectedScId(e.target.value)}
                className="w-full border border-teal-300 rounded-lg px-2.5 py-1.5 text-sm text-slate-800
                           bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
              >
                {smartcarVehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {[v.year, v.make, v.model].filter(Boolean).join(' ') || v.id.slice(0, 8)}
                    {v.vin ? ` — ${v.vin.slice(-6)}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-teal-700 block mb-1">
                GasCap garage vehicle
              </label>
              <select
                value={selectedGcId}
                onChange={(e) => setSelectedGcId(e.target.value)}
                className="w-full border border-teal-300 rounded-lg px-2.5 py-1.5 text-sm text-slate-800
                           bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
              >
                {garageVehicles.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <div className="flex gap-2">
              <button
                onClick={() => { setPhase('info'); setError(''); }}
                className="flex-1 py-2 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold
                           hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLink}
                disabled={saving || !selectedScId || !selectedGcId}
                className="flex-1 py-2 rounded-lg bg-teal-600 text-white text-xs font-bold
                           hover:bg-teal-500 disabled:opacity-40 transition-colors"
              >
                {saving ? 'Saving…' : 'Link vehicle'}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Info — addon active, ready to connect (or already connected) ─────────
  const isAlreadyConnected = status?.hasOAuthTokens ?? false;

  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-4 space-y-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-base">⚡</span>
          <p className="text-sm font-black text-slate-800">Vehicle Sync</p>
          <span className="text-[9px] font-black bg-teal-600 text-white px-1.5 py-0.5 rounded-full">Active</span>
        </div>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
          {isAlreadyConnected
            ? 'Your car is connected. You can re-link or add another vehicle below.'
            : 'Your add-on is active. Connect your car via Smartcar to start syncing.'}
        </p>
      </div>

      {/* Supported brands */}
      <div className="flex flex-wrap gap-1.5">
        {['Tesla', 'Ford', 'GM', 'Toyota', 'Honda', 'BMW', '+35 more'].map((brand) => (
          <span key={brand}
                className="text-[10px] bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-500 font-medium">
            {brand}
          </span>
        ))}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button
        onClick={handleConnect}
        disabled={connecting}
        className="w-full py-2.5 rounded-xl bg-[#005F4A] text-white text-sm font-black
                   hover:bg-[#004d3b] disabled:opacity-50 transition-colors"
      >
        {connecting
          ? 'Opening Smartcar…'
          : isAlreadyConnected
          ? 'Re-authorize / Add another car →'
          : 'Connect My Car →'}
      </button>
      <p className="text-[10px] text-slate-400 text-center leading-relaxed">
        We read fuel &amp; odometer only — no location, no remote commands.
      </p>
    </div>
  );
}
