'use client';

/**
 * RentalLocationInput — address autocomplete for EITHER rental event
 * (pickup or return). Generalizes the former ReturnLocationInput
 * (2026-10-02 event-timezone model).
 *
 * Selecting a Google suggestion resolves it via /api/maps/place-location
 * with includeTimeZone:true (signed-in only; Place Details Pro field) into
 * { text, lat, lng, timeZone, timeZoneSource: 'place' }. Free-typed text
 * that wasn't picked from the list carries NO coordinates and NO zone — it
 * never pretends to be authoritative; the setup/edit UI then falls back to
 * an explicit zone picker or a clearly-labelled device assumption.
 * Degrades to a plain text field when Maps isn't configured.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';

interface Suggestion { text: string; placeId: string }

export interface RentalLocationValue {
  text:           string;
  lat:            number | null;
  lng:            number | null;
  timeZone:       string | null;
  timeZoneSource: 'place' | null;
}

export const emptyRentalLocation = (text = ''): RentalLocationValue =>
  ({ text, lat: null, lng: null, timeZone: null, timeZoneSource: null });

interface Props {
  kind:         'pickup' | 'return';
  value:        RentalLocationValue;
  onChange:     (v: RentalLocationValue) => void;
  placeholder?: string;
}

export default function RentalLocationInput({ kind, value, onChange, placeholder }: Props) {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value.text.length < 3 || value.lat != null) { setSuggestions([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetch('/api/maps/autocomplete', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ input: value.text }),
      })
        .then((r) => r.json() as Promise<{ ok: boolean; results?: Suggestion[] }>)
        .then((d) => { if (d.ok) setSuggestions(d.results ?? []); })
        .catch(() => {});
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value.text, value.lat]);

  async function handleSelect(s: Suggestion) {
    setOpen(false);
    setSuggestions([]);
    setResolving(true);
    try {
      const res = await fetch('/api/maps/place-location', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ placeId: s.placeId, includeTimeZone: true }),
      });
      const data = await res.json() as { ok: boolean; lat?: number; lng?: number; timeZone?: string };
      const hasCoords = data.ok && data.lat != null && data.lng != null;
      onChange({
        text:           s.text,
        lat:            hasCoords ? data.lat! : null,
        lng:            hasCoords ? data.lng! : null,
        timeZone:       hasCoords && data.timeZone ? data.timeZone : null,
        timeZoneSource: hasCoords && data.timeZone ? 'place' : null,
      });
    } catch {
      onChange(emptyRentalLocation(s.text));
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="relative" data-rental-location={kind}>
      <input
        type="text"
        value={value.text}
        placeholder={placeholder}
        // Typing invalidates any previously resolved place: coordinates and
        // zone belonged to the OLD selection, not to this free text.
        onChange={(e) => { onChange(emptyRentalLocation(e.target.value)); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="input-field"
      />
      {resolving && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">{t.rentalReturn.locating}</span>
      )}
      {open && suggestions.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
          {suggestions.map((s) => (
            <button
              key={s.placeId}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(s)}
              className="w-full text-left px-3 py-2.5 text-xs text-slate-700 hover:bg-amber-50 hover:text-amber-800 border-b border-slate-50 last:border-0 transition-colors"
            >
              {s.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
