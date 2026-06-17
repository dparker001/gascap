'use client';

/**
 * NativeIapInit
 *
 * Runs only inside the native iOS (Capacitor) wrapper. Once the user is signed
 * in, it configures RevenueCat with the GasCap user id (so the StoreKit
 * entitlement maps to the account, not an anonymous device). After this runs,
 * the /upgrade page's IAP buttons (purchasePro) can fetch offerings + purchase.
 *
 * On web (and Android) initIap() is a no-op, so this is safe to mount globally.
 * See lib/iap.ts + docs/IOS_IAP_PLAN.md.
 */

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { initIap } from '@/lib/iap';

export default function NativeIapInit() {
  const { data: session } = useSession();

  useEffect(() => {
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) return;
    initIap(userId).catch(() => { /* logged inside initIap; retry on next session change */ });
  }, [session]);

  return null;
}
