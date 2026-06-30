/**
 * Biometric auth wrapper — Face ID / Touch ID via @aparajita/capacitor-biometric-auth.
 * Session token persisted in native Keychain/Keystore via @capacitor/preferences.
 * All functions silently no-op / return null on web.
 */

const BIOMETRIC_TOKEN_KEY = 'gc_biometric_token';
const BIOMETRIC_EMAIL_KEY = 'gc_biometric_email';

function isNative(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as Record<string, unknown>).Capacitor;
}

async function getPreferences() {
  if (!isNative()) return null;
  try {
    const { Preferences } = await import('@capacitor/preferences');
    return Preferences;
  } catch {
    return null;
  }
}

async function getBiometricPlugin() {
  if (!isNative()) return null;
  try {
    const mod = await import('@aparajita/capacitor-biometric-auth');
    return mod;
  } catch {
    return null;
  }
}

export type BiometricType = 'faceId' | 'touchId' | 'biometrics' | null;

/** Returns the type of biometric available on this device, or null if unavailable/unenrolled */
export async function getBiometricType(): Promise<BiometricType> {
  const mod = await getBiometricPlugin();
  if (!mod) return null;
  try {
    const info = await mod.BiometricAuth.checkBiometry();
    if (!info.isAvailable) return null;
    // BiometryType enum: faceId=1, touchId=2, others=3+
    if (info.biometryType === mod.BiometryType.faceId) return 'faceId';
    if (info.biometryType === mod.BiometryType.touchId) return 'touchId';
    return 'biometrics';
  } catch {
    return null;
  }
}

export async function isBiometricAvailable(): Promise<boolean> {
  return (await getBiometricType()) !== null;
}

/** Prompts biometric verification; returns true if user authenticated */
async function verifyBiometric(reason: string): Promise<boolean> {
  const mod = await getBiometricPlugin();
  if (!mod) return false;
  try {
    await mod.BiometricAuth.authenticate({ reason, cancelTitle: 'Cancel' });
    return true;
  } catch {
    return false;
  }
}

/** Saves session token + email behind biometric — call after successful sign-in */
export async function saveBiometricSession(token: string, email: string): Promise<void> {
  const prefs = await getPreferences();
  if (!prefs) return;
  await prefs.set({ key: BIOMETRIC_TOKEN_KEY, value: token });
  await prefs.set({ key: BIOMETRIC_EMAIL_KEY, value: email });
}

/** Returns true if a biometric session token is saved on this device */
export async function hasBiometricSession(): Promise<boolean> {
  const prefs = await getPreferences();
  if (!prefs) return false;
  const { value } = await prefs.get({ key: BIOMETRIC_TOKEN_KEY });
  return !!value;
}

/**
 * Prompts biometric, then returns the saved { token, email } if authenticated.
 * Returns null if cancelled, failed, or no session saved.
 */
export async function loadBiometricSession(): Promise<{ token: string; email: string } | null> {
  const prefs = await getPreferences();
  if (!prefs) return null;
  const { value: token } = await prefs.get({ key: BIOMETRIC_TOKEN_KEY });
  const { value: email } = await prefs.get({ key: BIOMETRIC_EMAIL_KEY });
  if (!token || !email) return null;

  const ok = await verifyBiometric('Sign in to GasCap');
  if (!ok) return null;
  return { token, email };
}

/** Clears saved biometric session — call on sign-out or when user disables it */
export async function clearBiometricSession(): Promise<void> {
  const prefs = await getPreferences();
  if (!prefs) return;
  await prefs.remove({ key: BIOMETRIC_TOKEN_KEY });
  await prefs.remove({ key: BIOMETRIC_EMAIL_KEY });
}
