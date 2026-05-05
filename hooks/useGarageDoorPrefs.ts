/**
 * useGarageDoorPrefs
 *
 * Persists the user's garage door style and opening direction to localStorage
 * so their choice survives page reloads. Uses the hydration-safe useLocalStorage
 * hook — server render always uses the defaults, client hydrates from storage.
 *
 * Pro-only feature; non-Pro users render children with no door overlay.
 *
 * Direction options: 'roll-up' | 'center' (split open from middle)
 * Legacy 'slide-left' / 'slide-right' values are migrated to 'roll-up'.
 */

import { useEffect } from 'react';
import { useLocalStorage } from './useLocalStorage';

export type DoorStyle     = 'classic' | 'modern' | 'wood' | 'steel';
export type DoorDirection = 'roll-up' | 'center';

const STYLE_KEY     = 'gc_garage_door_style';
const DIRECTION_KEY = 'gc_garage_door_direction';

export function useGarageDoorPrefs() {
  const [doorStyle,     setDoorStyle]     = useLocalStorage<DoorStyle>(STYLE_KEY,     'classic');
  const [doorDirection, setDoorDirection] = useLocalStorage<DoorDirection>(DIRECTION_KEY, 'roll-up');

  // Migrate legacy slide-left / slide-right → roll-up on first load
  useEffect(() => {
    const stored = localStorage.getItem(DIRECTION_KEY);
    if (stored === 'slide-left' || stored === 'slide-right') {
      setDoorDirection('roll-up');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { doorStyle, setDoorStyle, doorDirection, setDoorDirection } as const;
}
