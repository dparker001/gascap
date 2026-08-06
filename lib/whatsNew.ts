/**
 * What's New changelog — shown once per user via WhatsNewModal.tsx, keyed by
 * CURRENT_VERSION against a value stored in localStorage. Bump CURRENT_VERSION
 * and add a new entry whenever there's something worth surfacing to users
 * (not every commit — just real feature launches or notable fixes).
 */

export interface WhatsNewEntry {
  version: string;   // must match CURRENT_VERSION when this is the latest entry
  date:    string;   // e.g. "August 2026" — shown to the user, not machine-parsed
  title:   string;
  items:   string[];
}

export const CURRENT_VERSION = '1.1.0';

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: '1.1.0',
    date:    'August 2026',
    title:   '🚗 New: Rental Car Return Mode',
    items: [
      'Look up your rental by Year/Make/Model or VIN for an exact tank size',
      'Set your return date & time and get a reminder 2 hours before drop-off',
      'Enter the rental company\'s rate to see exactly how much you save by fueling up yourself',
      'Find Gas now shows the closest stations first',
    ],
  },
];
