/**
 * Biometric sign-in — Face ID / Touch ID via @aparajita/capacitor-biometric-auth.
 * Credentials stored in native Keychain (iOS) / Keystore (Android) via @capacitor/preferences.
 *
 * Design rules:
 *  - Preferences.get() is safe to call on mount (no native UI).
 *  - BiometricAuth.authenticate() must ONLY be called from a user-initiated tap.
 *  - All functions silently no-op / return null on web.
 */

const KEY_EMAIL = 'gc_bio_email';
const KEY_PWD   = 'gc_bio_pwd';

function isNative(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as Record<string, unknown>).Capacitor;
}

async function getPreferences() {
  if (!isNative()) return null;
  try {
    const { Preferences } = await import('@capacitor/preferences');
    return Preferences;
  } catch { return null; }
}

async function getBioPlugin() {
  if (!isNative()) return null;
  try {
    return await import('@aparajita/capacitor-biometric-auth');
  } catch { return null; }
}

export type BiometricType = 'faceId' | 'touchId' | 'biometrics' | null;

/**
 * Safe to call on mount — reads from Preferences (Keychain), no native UI.
 * Returns true if the user has previously saved credentials for biometric sign-in.
 */
export async function hasBiometricCredentials(): Promise<boolean> {
  const prefs = await getPreferences();
  if (!prefs) return false;
  const { value } = await prefs.get({ key: KEY_EMAIL });
  return !!value;
}

/**
 * Returns what biometric type is available, or null if unavailable.
 * Safe to call on mount — checkBiometry() only reads device capability, no prompt.
 */
export async function getBiometricType(): Promise<BiometricType> {
  const mod = await getBioPlugin();
  if (!mod) return null;
  try {
    const info = await mod.BiometricAuth.checkBiometry();
    if (!info.isAvailable) return null;
    if (info.biometryType === mod.BiometryType.faceId)   return 'faceId';
    if (info.biometryType === mod.BiometryType.touchId)  return 'touchId';
    return 'biometrics';
  } catch { return null; }
}

/**
 * Call ONLY from a button tap.
 * Shows the Face ID / Touch ID prompt, then returns stored { email, password } on success.
 * Returns null if cancelled, failed, or no credentials saved.
 */
export async function authenticateAndLoad(): Promise<{ email: string; password: string } | null> {
  const [prefs, mod] = await Promise.all([getPreferences(), getBioPlugin()]);
  if (!prefs || !mod) return null;

  const [{ value: email }, { value: password }] = await Promise.all([
    prefs.get({ key: KEY_EMAIL }),
    prefs.get({ key: KEY_PWD }),
  ]);
  if (!email || !password) return null;

  try {
    await mod.BiometricAuth.authenticate({ reason: 'Sign in to GasCap', cancelTitle: 'Cancel' });
    return { email, password };
  } catch { return null; }
}

/**
 * Save credentials to Keychain after a successful password sign-in.
 * Call only when the user explicitly enables biometric sign-in.
 */
export async function saveBiometricCredentials(email: string, password: string): Promise<void> {
  const prefs = await getPreferences();
  if (!prefs) return;
  await Promise.all([
    prefs.set({ key: KEY_EMAIL, value: email }),
    prefs.set({ key: KEY_PWD,   value: password }),
  ]);
}

/** Clears saved credentials — call on sign-out or when user disables biometric sign-in */
export async function clearBiometricCredentials(): Promise<void> {
  const prefs = await getPreferences();
  if (!prefs) return;
  await Promise.all([
    prefs.remove({ key: KEY_EMAIL }),
    prefs.remove({ key: KEY_PWD }),
  ]);
}
