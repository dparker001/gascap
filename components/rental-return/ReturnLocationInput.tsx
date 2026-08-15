'use client';

/**
 * Address-autocomplete input that resolves the selected suggestion to real
 * lat/lng via /api/maps/place-location — without this, returnLatitude/
 * returnLongitude on the RentalSession never get populated, and "Find Gas
 * Near Return" has nothing to search around. Falls back to a plain text
 * field (no coordinates captured) if Google Maps isn't configured — same
 * graceful-degradation pattern as TripCostEstimator's route planner.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';

interface Suggestion { text: string; placeId: string }

interface Props {
  value:    string;
  onChange: (text: string, coords: { lat: number; lng: number } | null) => void;
  placeholder?: string;
}

export default function ReturnLocationInput({ value, onChange, placeholder }: Props) {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value.length < 3) { setSuggestions([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetch('/api/maps/autocomplete', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ input: value }),
      })
        .then((r) => r.json() as Promise<{ ok: boolean; results?: Suggestion[] }>)
        .then((d) => { if (d.ok) setSuggestions(d.results ?? []); })
        .catch(() => {});
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value]);

  async function handleSelect(s: Suggestion) {
    setOpen(false);
    setSuggestions([]);
    setResolving(true);
    try {
      const res = await fetch('/api/maps/place-location', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ placeId: s.placeId }),
      });
      const data = await res.json() as { ok: boolean; lat?: number; lng?: number };
      onChange(s.text, data.ok && data.lat != null && data.lng != null ? { lat: data.lat, lng: data.lng } : null);
    } catch {
      onChange(s.text, null);
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value, null); setOpen(true); }}
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
