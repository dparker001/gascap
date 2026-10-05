'use client';

/**
 * QuickSaveRentalForm — save a rental booked ahead with only what the booking
 * knows (Part A, 2026-10-02). A second entry point beside RentalSetupFlow,
 * which is unchanged. Company, optional confirmation number, and pickup +
 * return each as location / date-time / its own time zone via the same
 * RentalEventScheduleField the wizard uses (per-event zones, DST gap block,
 * explicit fall-back choice). The car, tank and fuel are added at the counter
 * through the dashboard's Finish setup card — never guessed here.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useTranslation } from '@/contexts/LanguageContext';
import { RENTAL_COMPANIES } from '@/lib/rentalProvider';
import { detectBrowserTimeZone, describeEventTime, type TimeDisambiguation } from '@/lib/rentalTimezone';
import { resyncRentalFallbacks } from '@/lib/rentalReminderSync';
import { newClientRentalId, postCreateRental } from '@/lib/rentalCreateClient';
import DuplicateRentalNotice from './DuplicateRentalNotice';
import { activeDuplicateWarning, duplicateConfirmationKey, mayConfirmDuplicate, type DuplicateWarning } from '@/lib/rentalDuplicateConfirm';
import { buildQuickSavePayload, quickSaveCanSubmit, type QuickSaveEvent } from '@/lib/rentalQuickSave';
import { emptyRentalLocation, type RentalLocationValue } from './RentalLocationInput';
import RentalEventScheduleField, { effectiveEventZone, type EventZone } from './RentalEventScheduleField';

export default function QuickSaveRentalForm({ onCreated, onCancel }: {
  onCreated: (sessionId: string) => void;
  onCancel:  () => void;
}) {
  const { t } = useTranslation();
  const r = t.rentalReturn;
  const router = useRouter();
  // One id per form instance, reused by every retry (lost response, duplicate
  // confirmation) so the server can recognise the same request.
  const [clientRentalId, setClientRentalId] = useState(() => newClientRentalId());
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateWarning | null>(null);
  const authUserId = (useSession().data?.user as { id?: string } | undefined)?.id;
  const deviceZone = useMemo(() => detectBrowserTimeZone() ?? null, []);

  const [rentalCompany, setRentalCompany] = useState('');
  const [customCompany, setCustomCompany] = useState('');
  const [confirmationNumber, setConfirmationNumber] = useState('');
  const [pickupDateTime, setPickupDateTime] = useState('');
  const [returnDateTime, setReturnDateTime] = useState('');
  const [pickupLoc, setPickupLoc] = useState<RentalLocationValue>(emptyRentalLocation());
  const [returnLoc, setReturnLoc] = useState<RentalLocationValue>(emptyRentalLocation());
  const [pickedPickupZone, setPickedPickupZone] = useState<EventZone | null>(null);
  const [pickedReturnZone, setPickedReturnZone] = useState<EventZone | null>(null);
  const [pickupChoice, setPickupChoice] = useState<TimeDisambiguation | null>(null);
  const [returnChoice, setReturnChoice] = useState<TimeDisambiguation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const company = rentalCompany === 'Other' ? customCompany.trim() : rentalCompany;
  const pickupZone = effectiveEventZone(pickupLoc, pickedPickupZone, deviceZone);
  const returnZone = effectiveEventZone(returnLoc, pickedReturnZone, deviceZone);
  const pickup: QuickSaveEvent = { dateTime: pickupDateTime, location: pickupLoc, zone: pickupZone, status: describeEventTime(pickupDateTime, pickupZone.zone), choice: pickupChoice };
  const ret: QuickSaveEvent    = { dateTime: returnDateTime, location: returnLoc, zone: returnZone, status: describeEventTime(returnDateTime, returnZone.zone), choice: returnChoice };
  const canSubmit = quickSaveCanSubmit({ company, pickup, ret });
  // The duplicate confirmation is bound to THIS reservation: any change to the
  // fields that identify it voids the warning (lib/rentalDuplicateConfirm.ts).
  const reservationKey = duplicateConfirmationKey({
    company, confirmationNumber, pickupDateTime, returnDateTime,
    pickupLocation: pickupLoc.text, returnLocation: returnLoc.text,
    pickupLat: pickupLoc.lat ?? null, pickupLng: pickupLoc.lng ?? null, returnLat: returnLoc.lat ?? null, returnLng: returnLoc.lng ?? null,
    pickupZone: pickupZone.zone ?? null, returnZone: returnZone.zone ?? null,
    pickupChoice, returnChoice,
  });
  const activeDuplicate = activeDuplicateWarning(duplicateWarning, reservationKey);

  async function handleSubmit(confirmDuplicate = false) {
    // Honoured only for the exact reservation that was warned about.
    const confirm = confirmDuplicate && mayConfirmDuplicate(duplicateWarning, reservationKey);
    const submittedKey = reservationKey;   // the key of the payload actually sent
    setSubmitting(true);
    setError('');
    try {
      const out = await postCreateRental(
        buildQuickSavePayload({ company, confirmationNumber, pickup, ret, deviceZone }), clientRentalId, confirm,
      );
      // Bind the warning to what was SUBMITTED: if the form changed while the
      // request was in flight, it is already void and never shown.
      if (out.kind === 'duplicate') { setDuplicateWarning({ rentalId: out.rentalId, key: submittedKey }); return; }
      if (out.kind === 'error') {
        const scheduleCodes = ['invalid_time_zone', 'invalid_local_datetime', 'nonexistent_local_time', 'ambiguous_local_time'];
        // The id clashed with a different request: start a fresh one.
        if (out.code === 'client_rental_id_conflict') setClientRentalId(newClientRentalId());
        setError(out.code && scheduleCodes.includes(out.code) ? r.tzScheduleError : (out.message ?? r.setupError));
        return;
      }
      // Same as the wizard: server push primary; a local return fallback only
      // on a device without usable push, from the server-derived instant.
      void resyncRentalFallbacks(authUserId);
      onCreated(out.sessionId);
    } catch {
      setError(r.setupError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">{r.quickSaveTitle}</p>
        <button onClick={onCancel} className="text-xs font-bold text-slate-400 hover:text-slate-600">{r.cancel}</button>
      </div>
      <p className="text-[11px] text-slate-500 leading-snug">{r.quickSaveIntro}</p>

      {error && <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
      {activeDuplicate && (
        <DuplicateRentalNotice
          busy={submitting}
          onOpenExisting={() => router.push(`/rental-return/${activeDuplicate.rentalId}`)}
          onSaveAnyway={() => { void handleSubmit(true); }}
        />
      )}

      <div className="space-y-2">
        <label className="field-label">{r.stepCompany}</label>
        <div className="grid grid-cols-2 gap-2">
          {RENTAL_COMPANIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setRentalCompany(c)}
              className={`py-2.5 rounded-xl text-sm font-bold border transition-colors ${
                rentalCompany === c ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200 text-slate-700 hover:border-blue-500'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        {rentalCompany === 'Other' && (
          <input type="text" placeholder={r.otherCompanyPlaceholder} value={customCompany}
                 onChange={(e) => setCustomCompany(e.target.value)} className="input-field" />
        )}
        <label className="field-label">{r.confirmationNumberLabel}</label>
        <input type="text" placeholder={r.confirmationNumberPlaceholder} value={confirmationNumber}
               onChange={(e) => setConfirmationNumber(e.target.value)} className="input-field" />
      </div>

      <RentalEventScheduleField
        kind="pickup"
        label={r.quickSavePickupLabel}
        dateTime={pickupDateTime}
        onDateTime={setPickupDateTime}
        location={pickupLoc}
        onLocation={setPickupLoc}
        locationLabel={r.pickupLocationLabel}
        locationPlaceholder={r.pickupLocationPlaceholder}
        zone={pickupZone}
        onPickZone={(z) => setPickedPickupZone({ zone: z, source: 'user' })}
        choice={pickupChoice}
        onChoice={setPickupChoice}
        deviceZone={deviceZone}
      />
      <RentalEventScheduleField
        kind="return"
        label={r.returnDateTimeLabel}
        dateTime={returnDateTime}
        onDateTime={setReturnDateTime}
        location={returnLoc}
        onLocation={setReturnLoc}
        locationLabel={r.returnLocationLabel}
        locationPlaceholder={r.returnLocationPlaceholder}
        zone={returnZone}
        onPickZone={(z) => setPickedReturnZone({ zone: z, source: 'user' })}
        choice={returnChoice}
        onChoice={setReturnChoice}
        deviceZone={deviceZone}
      />

      <p className="text-[11px] text-slate-400 leading-snug">{r.quickSaveLaterNote}</p>

      <button
        type="button"
        onClick={() => { void handleSubmit(); }}
        disabled={!canSubmit || submitting}
        className="w-full py-3 rounded-2xl bg-blue-600 text-white text-sm font-bold disabled:opacity-40"
      >
        {submitting ? r.creating : r.quickSaveSubmit}
      </button>
    </div>
  );
}
