'use client';
/**
 * SmartcarConnect
 * Rendered inside SavedVehicles when a Pro user clicks "Connect My Car".
 *
 * Flow:
 *   1. Shows info card → "Connect" button → opens Smartcar OAuth popup (or redirect)
 *   2. After OAuth callback sets ?smartcarConnected=1, shows vehicle-linking step
 *   3. User picks which Smartcar vehicle maps to which garage vehicle → save
 *   4. Shows success state
 */

import { useState, useEffect } from 'react';
import type { Vehicle }        from '@/components/SavedVehicles';

interface SmartcarVehicleInfo {
  id:    string;
  make?: string;
  model?: string;
  year?: number;
  vin?:  string;
}

interface Props {
  garageVehicles: Vehicle[];
  onDone:         () => void;  // refreshes the garage after linking
}

export default function SmartcarConnect({ garageVehicles, onDone }: Props) {
  const [phase, setPhase]       = useState<'info' | 'linking' | 'linked' | 'error'>('info');
  const [connecting, setConnecting] = useState(false);
  const [smartcarVehicles, setSmartcarVehicles] = useState<SmartcarVehicleInfo[]>([]);
  const [selectedScId,  setSelectedScId]  = useState('');
  const [selectedGcId,  setSelectedGcId]  = useState(garageVehicles[0]?.id ?? '');
  const [saving, setSaving]     = useState(false);
  const [error,  setError]      = useState('');
  const [loadingVehicles, setLoadingVehicles] = useState(false);

  // Check if we just returned from the OAuth callback
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('smartcarConnected') === '1') {
      // Clean the URL
      const clean = new URL(window.location.href);
      clean.searchParams.delete('smartcarConnected');
      window.history.replaceState({}, '', clean.toString());
      // Load the Smartcar vehicles for linking
      loadSmartcarVehicles();
    }
    if (params.get('smartcarError')) {
      const msg = params.get('smartcarError') ?? 'Unknown error';
      setError(decodeURIComponent(msg));
      setPhase('error');
      const clean = new URL(window.location.href);
      clean.searchParams.delete('smartcarError');
      window.history.replaceState({}, '', clean.toString());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSmartcarVehicles() {
    setLoadingVehicles(true);
    setPhase('linking');
    try {
      const res  = await fetch('/api/smartcar/vehicles');
      const data = await res.json() as { vehicles?: SmartcarVehicleInfo[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load vehicles');
      setSmartcarVehicles(data.vehicles ?? []);
      if (data.vehicles?.[0]) setSelectedScId(data.vehicles[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Smartcar vehicles');
      setPhase('error');
    } finally {
      setLoadingVehicles(false);
    }
  }

  async function handleConnect() {
    setConnecting(true);
    setError('');
    try {
      const res  = await fetch('/api/smartcar');
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Could not start OAuth flow');
      // Redirect to Smartcar Connect (full redirect; callback will return to ?smartcarConnected=1)
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
      setTimeout(() => { onDone(); }, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Link failed');
    } finally {
      setSaving(false);
    }
  }

  // ── Phases ───────────────────────────────────────────────────────────────

  if (phase === 'linked') {
    return (
      <div className="rounded-xl bg-teal-50 border border-teal-200 px-4 py-4 text-center space-y-1">
        <div className="text-2xl">⚡</div>
        <p className="text-sm font-bold text-teal-700">Vehicle connected!</p>
        <p className="text-xs text-teal-600">Your car is now synced. Use "Sync from Car" when logging fill-ups.</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-4 space-y-2">
        <p className="text-sm font-bold text-red-600">Connection error</p>
        <p className="text-xs text-red-500">{error}</p>
        <button
          onClick={() => { setError(''); setPhase('info'); }}
          className="text-xs font-bold text-red-600 underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (phase === 'linking') {
    return (
      <div className="rounded-xl bg-teal-50 border border-teal-200 px-4 py-4 space-y-3">
        <div>
          <p className="text-sm font-black text-teal-800">⚡ Link your vehicle</p>
          <p className="text-xs text-teal-600 mt-0.5">
            Choose which Smartcar vehicle to connect to your garage.
          </p>
        </div>

        {loadingVehicles ? (
          <div className="flex items-center gap-2 py-2">
            <span className="animate-spin text-base">⚙️</span>
            <span className="text-xs text-teal-600">Loading your vehicles…</span>
          </div>
        ) : (
          <>
            {/* Smartcar vehicle selector */}
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
                    {v.vin ? ` (${v.vin.slice(-6)})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* GasCap garage vehicle selector */}
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

  // ── Info / entry phase ────────────────────────────────────────────────────
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-4 space-y-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-base">⚡</span>
          <p className="text-sm font-black text-slate-800">Connect My Car</p>
          <span className="text-[9px] font-black bg-teal-600 text-white px-1.5 py-0.5 rounded-full uppercase tracking-wider">
            Beta
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
          Sync fuel level and odometer directly from your vehicle before logging a fill-up.
          Works with most 2015+ connected cars.
        </p>
      </div>

      {/* Supported brands row */}
      <div className="flex flex-wrap gap-1.5">
        {['Tesla', 'Ford', 'GM', 'Toyota', 'Honda', 'BMW', '+35'].map((brand) => (
          <span key={brand} className="text-[10px] bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-500 font-medium">
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
        {connecting ? 'Opening Smartcar…' : 'Connect My Car →'}
      </button>
      <p className="text-[10px] text-slate-400 text-center leading-relaxed">
        Powered by Smartcar. We read fuel &amp; odometer only — no location, no remote commands.
      </p>
    </div>
  );
}
