'use client';

/**
 * Settings toggle for "open my rental at pickup time". Device-local AND
 * per account (keyed by the signed-in user id), saved the moment it is
 * toggled — it is not part of the profile Save, because it never leaves the
 * device.
 */
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useTranslation } from '@/contexts/LanguageContext';
import { isAutoOpenEnabled, setAutoOpenEnabled } from '@/lib/rentalAutoOpen';

export default function RentalAutoOpenSetting() {
  const { t } = useTranslation();
  const userId = (useSession().data?.user as { id?: string } | undefined)?.id ?? null;
  const [on, setOn] = useState(false);
  useEffect(() => { setOn(isAutoOpenEnabled(userId)); }, [userId]);
  if (!userId) return null;   // consent belongs to an account
  return (
    <label className="flex items-start gap-3 cursor-pointer" data-testid="rental-autoopen-setting">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 accent-blue-600"
        checked={on}
        onChange={(e) => { setOn(e.target.checked); setAutoOpenEnabled(userId, e.target.checked); }}
      />
      <span>
        <span className="block text-xs font-semibold text-slate-600">{t.rentalReturn.autoOpenSettingTitle}</span>
        <span className="block text-[11px] text-slate-400 leading-snug mt-0.5">{t.rentalReturn.autoOpenSettingBody}</span>
      </span>
    </label>
  );
}
