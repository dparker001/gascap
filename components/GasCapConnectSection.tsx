'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface ConnectedVehicle {
  id:        string;
  name:      string;
  make?:     string;
  model?:    string;
  year?:     string;
  fuelLevel?: number;
  fuelRange?: number;
  fuelLevelAt?: string;
  smartcarId?: string;
}

interface ConnectStatus {
  connected:       boolean;
  addonStatus:     string | null;  // 'trial' | 'active' | 'expired' | null
  trialEndsAt:     string | null;
  vehicleCount:    number;
  vehicles:        ConnectedVehicle[];
}

function FuelBar({ level }: { level: number }) {
  const pct = Math.round(level * 100);
  const color = level < 0.15 ? 'bg-red-500' : level < 0.3 ? 'bg-amber-400' : 'bg-green-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-bold w-8 text-right ${level < 0.15 ? 'text-red-500' : level < 0.3 ? 'text-amber-600' : 'text-green-600'}`}>
        {pct}%
      </span>
    </div>
  );
}

function TrialBadge({ endsAt }: { endsAt: string }) {
  const days = Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86400000));
  return (
    <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
      Trial — {days}d left
    </span>
  );
}

export default function GasCapConnectSection() {
  const router = useRouter();
  const [status,   setStatus]   = useState<ConnectStatus | null>(null);
  const [syncing,  setSyncing]  = useState(false);
  const [syncMsg,  setSyncMsg]  = useState<string | null>(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    fetch('/api/smartcar/status')
      .then(r => r.json())
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  // Handle ?smartcar= redirect from callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('smartcar');
    if (result === 'connected') {
      setSyncMsg('Vehicle connected successfully!');
      // Re-fetch status
      fetch('/api/smartcar/status').then(r => r.json()).then(setStatus);
      // Clean URL
      router.replace('/settings', { scroll: false });
    } else if (result === 'denied') {
      setSyncMsg('Connection cancelled.');
      router.replace('/settings', { scroll: false });
    } else if (result === 'error') {
      setSyncMsg('Connection failed — please try again.');
      router.replace('/settings', { scroll: false });
    }
  }, [router]);

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res  = await fetch('/api/smartcar/sync', { method: 'POST' });
      const data = await res.json() as { synced?: unknown[]; error?: string; code?: string };
      if (data.code === 'SUBSCRIPTION_REQUIRED') {
        setSyncMsg('Your trial has expired — subscribe to continue syncing.');
      } else if (data.synced) {
        setSyncMsg(`Synced ${data.synced.length} vehicle${data.synced.length !== 1 ? 's' : ''}`);
        fetch('/api/smartcar/status').then(r => r.json()).then(setStatus);
      }
    } catch {
      setSyncMsg('Sync failed — please try again.');
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect(vehicleId: string) {
    if (!confirm('Disconnect this vehicle from GasCap Connect?')) return;
    await fetch(`/api/smartcar/disconnect?vehicleId=${vehicleId}`, { method: 'POST' });
    fetch('/api/smartcar/status').then(r => r.json()).then(setStatus);
  }

  if (loading) return null;

  const isConnected  = status?.connected && (status?.vehicleCount ?? 0) > 0;
  const isExpired    = status?.addonStatus === 'expired';

  return (
    <section className="space-y-3">
      {/* Banner */}
      <div className="bg-gradient-to-r from-orange-500 to-amber-500 rounded-2xl px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🚗</span>
          <div>
            <p className="text-white font-black text-sm leading-tight">GasCap Connect™</p>
            <p className="text-orange-100 text-[11px] leading-tight">Live fuel & odometer sync</p>
          </div>
        </div>
        {status?.addonStatus === 'trial' && status.trialEndsAt && (
          <TrialBadge endsAt={status.trialEndsAt} />
        )}
        {status?.addonStatus === 'active' && (
          <span className="text-[10px] font-bold bg-white/20 text-white px-2 py-0.5 rounded-full">Active</span>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">

        {/* Not connected */}
        {!isConnected && !isExpired && (
          <div className="p-5 space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Connect your vehicle to automatically sync your fuel level and odometer — no manual entry needed.
            </p>
            <ul className="space-y-1.5 text-xs text-slate-500 dark:text-slate-400">
              {[
                'Live fuel level monitoring',
                'Automatic odometer sync on fill-ups',
                'Smarter price-aware fill-up reminders',
                'Works with 30+ brands — no hardware needed',
              ].map(f => (
                <li key={f} className="flex items-start gap-1.5">
                  <span className="text-green-500 mt-0.5">✓</span>{f}
                </li>
              ))}
            </ul>
            <a
              href="/api/smartcar/connect"
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-black text-sm transition-colors"
            >
              <span>🚗</span> Connect Your Vehicle — Free 14-Day Trial
            </a>
            <p className="text-center text-[11px] text-slate-400">
              $4.99/mo after trial · Up to 5 vehicles · Cancel anytime
            </p>
          </div>
        )}

        {/* Expired */}
        {isExpired && (
          <div className="p-5 space-y-3">
            <p className="text-sm font-semibold text-red-600">Your GasCap Connect trial has ended.</p>
            <p className="text-xs text-slate-500">Subscribe to keep your vehicles connected and resume live fuel syncing.</p>
            <a
              href="/api/smartcar/connect"
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-black text-sm transition-colors"
            >
              Subscribe — $4.99/mo
            </a>
          </div>
        )}

        {/* Connected vehicles */}
        {isConnected && (status?.vehicles ?? []).map(v => (
          <div key={v.id} className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{v.name}</p>
                <p className="text-xs text-slate-400">
                  {[v.year, v.make, v.model].filter(Boolean).join(' ')}
                </p>
              </div>
              <button
                onClick={() => handleDisconnect(v.id)}
                className="text-[11px] text-slate-400 hover:text-red-500 transition-colors"
              >
                Disconnect
              </button>
            </div>
            {typeof v.fuelLevel === 'number' && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">Fuel Level</span>
                  {v.fuelRange && v.fuelRange > 0 && (
                    <span className="text-[11px] text-slate-400">~{Math.round(v.fuelRange)} mi range</span>
                  )}
                </div>
                <FuelBar level={v.fuelLevel} />
                {v.fuelLevelAt && (
                  <p className="text-[10px] text-slate-400">
                    Updated {new Date(v.fuelLevelAt).toLocaleString()}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Actions */}
        {isConnected && (
          <div className="p-4 flex items-center justify-between gap-3">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex-1 py-2.5 rounded-xl bg-orange-50 hover:bg-orange-100 text-orange-600 font-bold text-sm transition-colors disabled:opacity-50"
            >
              {syncing ? 'Syncing…' : '↻ Sync Now'}
            </button>
            <a
              href="/api/smartcar/connect"
              className="flex-1 py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold text-sm text-center transition-colors"
            >
              + Add Vehicle
            </a>
          </div>
        )}

        {syncMsg && (
          <div className="px-4 pb-3">
            <p className="text-xs text-center text-slate-500">{syncMsg}</p>
          </div>
        )}
      </div>
    </section>
  );
}
