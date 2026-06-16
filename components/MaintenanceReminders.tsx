'use client';

import { useSession }        from 'next-auth/react';
import { useEffect, useState, useCallback } from 'react';
import { SERVICE_PRESETS, type ServiceType, type ReminderWithStatus } from '@/lib/maintenance-shared';
import { useTranslation } from '@/contexts/LanguageContext';
import type { Vehicle } from './SavedVehicles';

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  overdue:  { bg: 'bg-red-50',   border: 'border-red-200',   text: 'text-red-700',   dot: 'bg-red-500',   badge: 'bg-red-100 text-red-700'   },
  due_soon: { bg: 'bg-amber-50',  border: 'border-amber-200', text: 'text-amber-700', dot: 'bg-amber-400', badge: 'bg-amber-100 text-amber-700' },
  ok:       { bg: 'bg-green-50',  border: 'border-green-100', text: 'text-green-700', dot: 'bg-green-500', badge: 'bg-green-100 text-green-700' },
  unknown:  { bg: 'bg-slate-50',  border: 'border-slate-200', text: 'text-slate-500', dot: 'bg-slate-300', badge: 'bg-slate-100 text-slate-500' },
};

const SERVICE_TYPES = Object.entries(SERVICE_PRESETS) as [ServiceType, typeof SERVICE_PRESETS[ServiceType]][];

// ── Component ─────────────────────────────────────────────────────────────────

export default function MaintenanceReminders() {
  const { data: session, status } = useSession();
  const { t } = useTranslation();
  const [reminders,   setReminders]   = useState<ReminderWithStatus[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [open,        setOpen]        = useState(false);
  const [showForm,    setShowForm]    = useState(false);
  const [vehicles,    setVehicles]    = useState<Vehicle[]>([]);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const res = await fetch('/api/maintenance');
      if (res.ok) {
        const d = await res.json() as { reminders: ReminderWithStatus[] };
        setReminders(d.reminders ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [session]);

  // Eager-load on mount
  useEffect(() => {
    if (session) {
      load();
      // Load garage vehicles for the form
      fetch('/api/vehicles')
        .then((r) => r.ok ? r.json() : null)
        .then((d) => { if (d?.vehicles) setVehicles(d.vehicles); })
        .catch(() => {});
    }
  }, [session, load]);

  if (status === 'loading' || !session) return null;

  const overdueCount  = reminders.filter((r) => r.status === 'overdue').length;
  const dueSoonCount  = reminders.filter((r) => r.status === 'due_soon').length;
  const alertCount    = overdueCount + dueSoonCount;

  // ── Mark as serviced ──────────────────────────────────────────────────────
  async function markServiced(r: ReminderWithStatus) {
    setActioningId(r.id);
    const today = new Date().toISOString().split('T')[0];
    // Optimistically update
    const currentMiles = r.dueMiles != null && r.milesUntilDue != null
      ? r.dueMiles - r.milesUntilDue
      : undefined;

    await fetch(`/api/maintenance/${r.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        lastServiceDate:  today,
        lastServiceMiles: currentMiles,
      }),
    });
    setActioningId(null);
    load();
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function deleteReminder(id: string) {
    setActioningId(id);
    await fetch(`/api/maintenance/${id}`, { method: 'DELETE' });
    setActioningId(null);
    load();
  }

  return (
    <div className="mt-4 rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between py-2.5 px-4 bg-navy-700
                   hover:bg-navy-800 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm" aria-hidden="true">🔧</span>
          <div className="text-left">
            <p className="text-xs font-black text-white uppercase tracking-wider">{t.maintenanceReminders.headerTitle}</p>
            {loading
              ? <p className="text-[10px] text-white/50">{t.maintenanceReminders.loading}</p>
              : reminders.length === 0
                ? <p className="text-[10px] text-white/50">{t.maintenanceReminders.headerSubtitle}</p>
                : alertCount > 0
                  ? <p className="text-[10px] text-red-300 font-bold">
                      {overdueCount > 0 && t.maintenanceReminders.overdueCount(overdueCount)}
                      {overdueCount > 0 && dueSoonCount > 0 && ' · '}
                      {dueSoonCount > 0 && t.maintenanceReminders.dueSoonCount(dueSoonCount)}
                    </p>
                  : <p className="text-[10px] text-green-300 font-semibold">
                      {t.maintenanceReminders.allUpToDate(reminders.length)}
                    </p>
            }
          </div>
        </div>
        <div className="flex items-center gap-2">
          {alertCount > 0 && (
            <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center">
              {alertCount}
            </span>
          )}
          <svg
            className={`w-4 h-4 text-white/60 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 bg-white overflow-hidden">

          {/* Header bar inside panel */}
          <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-100">
            <p className="text-xs font-black text-slate-600 uppercase tracking-wide">
              {t.maintenanceReminders.reminderCount(reminders.length)}
            </p>
            <button
              onClick={() => setShowForm((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400
                         text-white text-[11px] font-bold transition-colors"
            >
              <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 2v8M2 6h8"/>
              </svg>
              {t.maintenanceReminders.addReminder}
            </button>
          </div>

          {/* Add form */}
          {showForm && (
            <div className="px-4 py-3 bg-amber-50 border-b border-amber-100">
              <AddReminderForm
                vehicles={vehicles}
                onSaved={() => { setShowForm(false); load(); }}
                onCancel={() => setShowForm(false)}
              />
            </div>
          )}

          {loading && (
            <p className="text-xs text-slate-400 text-center py-8">{t.maintenanceReminders.loading}</p>
          )}

          {!loading && reminders.length === 0 && !showForm && (
            <div className="text-center py-8 px-6 space-y-2">
              <p className="text-3xl">🔧</p>
              <p className="text-sm font-bold text-slate-600">{t.maintenanceReminders.emptyTitle}</p>
              <p className="text-xs text-slate-400 leading-relaxed max-w-[260px] mx-auto">
                {t.maintenanceReminders.emptyBody}
              </p>
            </div>
          )}

          {!loading && reminders.length > 0 && (
            <div className="divide-y divide-slate-100">
              {reminders.map((r) => (
                <ReminderCard
                  key={r.id}
                  reminder={r}
                  actioning={actioningId === r.id}
                  onMarkServiced={() => markServiced(r)}
                  onDelete={() => deleteReminder(r.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Reminder Card ─────────────────────────────────────────────────────────────

function ReminderCard({
  reminder: r,
  actioning,
  onMarkServiced,
  onDelete,
}: {
  reminder:       ReminderWithStatus;
  actioning:      boolean;
  onMarkServiced: () => void;
  onDelete:       () => void;
}) {
  const { t } = useTranslation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cfg     = STATUS_CONFIG[r.status];
  const preset  = SERVICE_PRESETS[r.serviceType];
  const label   = r.serviceType === 'custom' ? (r.customLabel ?? t.maintenanceReminders.customService) : preset.label;
  const statusLabel = t.maintenanceReminders.statusLabel(r.status);

  // Build status detail line
  let statusDetail = '';
  if (r.status === 'overdue') {
    const parts: string[] = [];
    if (r.milesUntilDue != null && r.milesUntilDue < 0)
      parts.push(t.maintenanceReminders.milesOverdue(Math.abs(r.milesUntilDue).toLocaleString()));
    if (r.daysUntilDue != null && r.daysUntilDue < 0)
      parts.push(t.maintenanceReminders.daysOverdue(Math.abs(r.daysUntilDue)));
    statusDetail = parts.join(' · ') || t.maintenanceReminders.statusLabel('overdue');
  } else if (r.status === 'due_soon') {
    const parts: string[] = [];
    if (r.milesUntilDue != null && r.milesUntilDue > 0)
      parts.push(t.maintenanceReminders.milesToGo(r.milesUntilDue.toLocaleString()));
    if (r.daysUntilDue != null && r.daysUntilDue > 0)
      parts.push(t.maintenanceReminders.daysCount(r.daysUntilDue));
    statusDetail = parts.join(' · ') || t.maintenanceReminders.statusLabel('due_soon');
  } else if (r.status === 'ok') {
    const parts: string[] = [];
    if (r.milesUntilDue != null) parts.push(t.maintenanceReminders.milesRemaining(r.milesUntilDue.toLocaleString()));
    if (r.daysUntilDue != null)  parts.push(t.maintenanceReminders.daysCount(r.daysUntilDue));
    statusDetail = parts.join(' · ');
  }

  // Format last service info
  let lastServiceStr = '';
  if (r.lastServiceDate) {
    const d = new Date(r.lastServiceDate + 'T12:00:00');
    lastServiceStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  }
  if (r.lastServiceMiles) {
    lastServiceStr += (lastServiceStr ? ' · ' : '') + `${r.lastServiceMiles.toLocaleString()} mi`;
  }

  return (
    <div className={`px-4 py-3 ${cfg.bg} transition-colors`}>
      <div className="flex items-start gap-3">
        {/* Status dot + emoji */}
        <div className="flex-shrink-0 mt-0.5 relative">
          <span className="text-xl">{preset.emoji}</span>
          <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${cfg.dot}`} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-black text-slate-800">{label}</p>
            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full ${cfg.badge}`}>
              {statusLabel}
            </span>
          </div>

          <p className="text-[11px] text-slate-500 mt-0.5">{r.vehicleName}</p>

          {statusDetail && (
            <p className={`text-[11px] font-semibold mt-0.5 ${cfg.text}`}>{statusDetail}</p>
          )}

          {/* Interval chips */}
          <div className="flex gap-2 mt-1.5 flex-wrap">
            {r.intervalMiles && (
              <span className="text-[10px] bg-white border border-slate-200 rounded-full px-2 py-0.5 text-slate-500 font-medium">
                {t.maintenanceReminders.everyMiles(r.intervalMiles.toLocaleString())}
              </span>
            )}
            {r.intervalMonths && (
              <span className="text-[10px] bg-white border border-slate-200 rounded-full px-2 py-0.5 text-slate-500 font-medium">
                {t.maintenanceReminders.everyMonths(r.intervalMonths)}
              </span>
            )}
            {r.dueMiles != null && (
              <span className="text-[10px] bg-white border border-slate-200 rounded-full px-2 py-0.5 text-slate-500 font-medium">
                {t.maintenanceReminders.dueAtMiles(r.dueMiles.toLocaleString())}
              </span>
            )}
          </div>

          {lastServiceStr && (
            <p className="text-[10px] text-slate-400 mt-1">{t.maintenanceReminders.lastLabel(lastServiceStr)}</p>
          )}
          {r.notes && (
            <p className="text-[10px] text-slate-400 mt-0.5 italic">{r.notes}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1.5 flex-shrink-0">
          <button
            onClick={onMarkServiced}
            disabled={actioning}
            className="px-2.5 py-1.5 rounded-xl bg-green-500 hover:bg-green-400 disabled:opacity-50
                       text-white text-[10px] font-bold transition-colors whitespace-nowrap"
            title={t.maintenanceReminders.markServicedTitle}
          >
            {actioning ? '…' : t.maintenanceReminders.doneButton}
          </button>
          {confirmDelete ? (
            <div className="flex gap-1">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 py-1 rounded-lg border border-slate-200 text-[10px] text-slate-500 font-semibold"
              >
                {t.maintenanceReminders.no}
              </button>
              <button
                onClick={onDelete}
                disabled={actioning}
                className="flex-1 py-1 rounded-lg bg-red-500 text-white text-[10px] font-bold"
              >
                {t.maintenanceReminders.yes}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="px-2.5 py-1.5 rounded-xl border border-slate-200 text-[10px] text-slate-400
                         hover:border-red-200 hover:text-red-400 transition-colors font-medium"
            >
              {t.maintenanceReminders.remove}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Add Reminder Form ─────────────────────────────────────────────────────────

function AddReminderForm({
  vehicles,
  onSaved,
  onCancel,
}: {
  vehicles: Vehicle[];
  onSaved:  () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [serviceType,      setServiceType]      = useState<ServiceType>('oil_change');
  const [customLabel,      setCustomLabel]      = useState('');
  const [vehicleName,      setVehicleName]      = useState(vehicles[0]?.name ?? '');
  const [vehicleId,        setVehicleId]        = useState(vehicles[0]?.id ?? '');
  const [intervalMiles,    setIntervalMiles]    = useState<string>('');
  const [intervalMonths,   setIntervalMonths]   = useState<string>('');
  const [lastServiceMiles, setLastServiceMiles] = useState<string>('');
  const [lastServiceDate,  setLastServiceDate]  = useState<string>('');
  const [notes,            setNotes]            = useState('');
  const [saving,           setSaving]           = useState(false);
  const [error,            setError]            = useState('');

  // Auto-fill interval from preset when service type changes
  const preset = SERVICE_PRESETS[serviceType];
  useEffect(() => {
    setIntervalMiles(preset.defaultMiles  ? String(preset.defaultMiles)  : '');
    setIntervalMonths(preset.defaultMonths ? String(preset.defaultMonths) : '');
  }, [serviceType, preset.defaultMiles, preset.defaultMonths]);

  function selectVehicle(v: Vehicle) {
    setVehicleName(v.name);
    setVehicleId(v.id);
  }

  async function handleSave() {
    if (!vehicleName.trim()) { setError(t.maintenanceReminders.errVehicle); return; }
    if (!intervalMiles && !intervalMonths) { setError(t.maintenanceReminders.errInterval); return; }
    if (serviceType === 'custom' && !customLabel.trim()) { setError(t.maintenanceReminders.errCustomLabel); return; }

    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/maintenance', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          vehicleName:      vehicleName.trim(),
          vehicleId:        vehicleId || undefined,
          serviceType,
          customLabel:      customLabel.trim() || undefined,
          intervalMiles:    intervalMiles  ? Number(intervalMiles)  : undefined,
          intervalMonths:   intervalMonths ? Number(intervalMonths) : undefined,
          lastServiceMiles: lastServiceMiles ? Number(lastServiceMiles) : undefined,
          lastServiceDate:  lastServiceDate  || undefined,
          notes:            notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setError(d.error ?? t.maintenanceReminders.errSaveFailed);
        return;
      }
      onSaved();
    } catch {
      setError(t.maintenanceReminders.errNetwork);
    } finally {
      setSaving(false);
    }
  }

  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="space-y-3">
      <p className="text-xs font-black text-amber-700 uppercase tracking-wide">{t.maintenanceReminders.newReminder}</p>

      {/* Vehicle selector */}
      {vehicles.length > 0 && (
        <div>
          <label className="field-label">{t.maintenanceReminders.vehicleLabel}</label>
          <div className="flex gap-2 flex-wrap">
            {vehicles.map((v) => (
              <button
                key={v.id}
                onClick={() => selectVehicle(v)}
                className={[
                  'px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition-all',
                  v.id === vehicleId
                    ? 'border-amber-500 bg-amber-50 text-amber-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-amber-300',
                ].join(' ')}
              >
                {v.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {vehicles.length === 0 && (
        <div>
          <label className="field-label">{t.maintenanceReminders.vehicleNameLabel}</label>
          <input
            type="text"
            className="input-field text-sm"
            placeholder={t.maintenanceReminders.vehicleNamePlaceholder}
            value={vehicleName}
            onChange={(e) => setVehicleName(e.target.value)}
          />
        </div>
      )}

      {/* Service type */}
      <div>
        <label className="field-label">{t.maintenanceReminders.serviceTypeLabel}</label>
        <div className="grid grid-cols-2 gap-1.5 max-h-52 overflow-y-auto pr-0.5">
          {SERVICE_TYPES.map(([type, info]) => (
            <button
              key={type}
              onClick={() => setServiceType(type)}
              className={[
                'flex items-center gap-2 px-2.5 py-2 rounded-xl text-left border-2 transition-all',
                serviceType === type
                  ? 'border-amber-500 bg-amber-50'
                  : 'border-slate-200 bg-white hover:border-amber-300',
              ].join(' ')}
            >
              <span className="text-base flex-shrink-0">{info.emoji}</span>
              <span className={`text-[11px] font-bold leading-tight ${serviceType === type ? 'text-amber-700' : 'text-slate-600'}`}>
                {info.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Custom label */}
      {serviceType === 'custom' && (
        <div>
          <label className="field-label">{t.maintenanceReminders.customLabelLabel}</label>
          <input
            type="text"
            className="input-field text-sm"
            placeholder={t.maintenanceReminders.customLabelPlaceholder}
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            maxLength={60}
          />
        </div>
      )}

      {/* Interval */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">{t.maintenanceReminders.everyMilesLabel}</label>
          <div className="relative">
            <input
              type="number" inputMode="numeric"
              className="input-field text-sm pr-10"
              placeholder={t.maintenanceReminders.everyMilesPlaceholder}
              value={intervalMiles}
              min="1" step="500"
              onChange={(e) => setIntervalMiles(e.target.value)}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">mi</span>
          </div>
        </div>
        <div>
          <label className="field-label">{t.maintenanceReminders.everyMonthsLabel}</label>
          <div className="relative">
            <input
              type="number" inputMode="numeric"
              className="input-field text-sm pr-10"
              placeholder={t.maintenanceReminders.everyMonthsPlaceholder}
              value={intervalMonths}
              min="1" max="120"
              onChange={(e) => setIntervalMonths(e.target.value)}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">mo</span>
          </div>
        </div>
      </div>

      {/* Last service */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">{t.maintenanceReminders.lastServiceDateLabel}</label>
          <input
            type="date"
            className="input-field text-sm"
            value={lastServiceDate}
            max={today}
            onChange={(e) => setLastServiceDate(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label">{t.maintenanceReminders.atOdometerLabel}</label>
          <div className="relative">
            <input
              type="number" inputMode="numeric"
              className="input-field text-sm pr-10"
              placeholder={t.maintenanceReminders.atOdometerPlaceholder}
              value={lastServiceMiles}
              min="0" step="100"
              onChange={(e) => setLastServiceMiles(e.target.value)}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">mi</span>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="field-label">{t.maintenanceReminders.notesLabel} <span className="text-slate-400 font-normal">{t.maintenanceReminders.optional}</span></label>
        <input
          type="text"
          className="input-field text-sm"
          placeholder={t.maintenanceReminders.notesPlaceholder}
          value={notes}
          maxLength={100}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {error && <p className="text-xs text-red-500 font-medium">{error}</p>}

      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border-2 border-slate-200 text-sm font-semibold text-slate-500 hover:border-slate-300 transition-colors bg-white">
          {t.maintenanceReminders.cancel}
        </button>
        <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-sm font-bold disabled:opacity-50 transition-colors">
          {saving ? t.maintenanceReminders.saving : t.maintenanceReminders.saveReminder}
        </button>
      </div>
    </div>
  );
}
