/**
 * Haptic feedback wrapper — silently no-ops on web/desktop.
 * All calls are fire-and-forget; never await these in UI handlers.
 */

let _haptics: typeof import('@capacitor/haptics') | null = null;

async function getPlugin() {
  if (_haptics) return _haptics;
  try {
    _haptics = await import('@capacitor/haptics');
    return _haptics;
  } catch {
    return null;
  }
}

/** Light tap — gauge snap, chip select, nav tap */
export async function hapticLight() {
  const h = await getPlugin();
  h?.Haptics.impact({ style: h.ImpactStyle.Light }).catch(() => {});
}

/** Medium impact — nudge buttons, toggle switches */
export async function hapticMedium() {
  const h = await getPlugin();
  h?.Haptics.impact({ style: h.ImpactStyle.Medium }).catch(() => {});
}

/** Heavy impact — form submit, major action confirm */
export async function hapticHeavy() {
  const h = await getPlugin();
  h?.Haptics.impact({ style: h.ImpactStyle.Heavy }).catch(() => {});
}

/** Success notification — fill-up logged, giveaway entry, purchase */
export async function hapticSuccess() {
  const h = await getPlugin();
  h?.Haptics.notification({ type: h.NotificationType.Success }).catch(() => {});
}

/** Warning notification — validation error, low fuel warning */
export async function hapticWarning() {
  const h = await getPlugin();
  h?.Haptics.notification({ type: h.NotificationType.Warning }).catch(() => {});
}

/** Error notification — failed action */
export async function hapticError() {
  const h = await getPlugin();
  h?.Haptics.notification({ type: h.NotificationType.Error }).catch(() => {});
}

/** Subtle tick — used during continuous drag (throttle calls externally) */
export async function hapticSelection() {
  const h = await getPlugin();
  h?.Haptics.selectionStart().catch(() => {});
  h?.Haptics.selectionChanged().catch(() => {});
}
