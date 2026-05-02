/**
 * useGarageDoorPrefs
 *
 * Persists the user's garage door style and opening direction to localStorage
 * so their choice survives page reloads. Uses the hydration-safe useLocalStorage
 * hook — server render always uses the defaults, client hydrates from storage.
 *
 * Pro-only feature; non-Pro users render children with no door overlay.
 */

import { useLocalStorage } from './useLocalStorage';

export type DoorStyle     = 'classic' | 'modern' | 'wood' | 'steel';
export type DoorDirection = 'roll-up' | 'slide-left' | 'slide-right';

const STYLE_KEY     = 'gc_garage_door_style';
const DIRECTION_KEY = 'gc_garage_door_direction';

export function useGarageDoorPrefs() {
  const [doorStyle,     setDoorStyle]     = useLocalStorage<DoorStyle>(STYLE_KEY,     'classic');
  const [doorDirection, setDoorDirection] = useLocalStorage<DoorDirection>(DIRECTION_KEY, 'roll-up');

  return { doorStyle, setDoorStyle, doorDirection, setDoorDirection } as const;
}
