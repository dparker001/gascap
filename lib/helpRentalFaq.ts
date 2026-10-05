/**
 * Help-page FAQ for Rental Car Mode (CURRENT). The six answers below are the
 * owner-approved copy, verbatim (2026-10-05): paragraphs are separated by a
 * blank line and **double asterisks** mark bold (rendered by parseHelpAnswer /
 * FaqItem in app/help/page.tsx). The auto-open entry is the product's own
 * addition for the opt-in "Open my rental at pickup time" setting.
 */
export interface HelpFaq { q: string; a: string }

export const RENTAL_FAQ_BEFORE_AUTO_OPEN: HelpFaq[] = [
  {
    q: 'What is Rental Car Mode?',
    a: `Rental Car Mode helps you manage rentals separately from your personal vehicles. Tap the **Rental Car Mode** banner or go to **Tools → Trip → Rental Return** to view upcoming, active, and past rentals. Your regular fuel calculator remains available.

Starting a rental requires Pro or an active Pro trial, but existing rentals remain usable if Pro expires. For electric rentals, use **EV Charge → Rental Mode** to calculate the charge level, electricity, cost, and charging time needed before return.`,
  },
  {
    q: 'What is the Rental Return Assistant?',
    a: `The Rental Return Assistant, found under **My Rentals**, helps you avoid unnecessary rental-company refueling charges.

Enter your rental details, vehicle, pickup fuel level, required return level, and return location and time. Before calculating fuel needs, GasCap™ asks you to confirm or update your last-reported fuel reading. Manual gauge readings and fuel calculations are estimates, not exact measurements.

GasCap™ then estimates how many gallons to add, the cost, potential savings, and possible rental-company refueling charges. You can find stations near your return location, track multiple fill-ups, and update your rental details.

You can also scan an agreement to prefill information (Pro feature), save pickup and return photos, and document possible fuel-fee disputes. Photos are available on every plan and are compressed within storage limits.

When you complete a rental, its history preserves fuel records, costs, photos, notes, and any reported fees. Deleting a rental permanently removes its associated fuel records and photos.

Existing rentals remain accessible if Pro expires, including Find Gas Near Return until 24 hours after the scheduled return time.`,
  },
  {
    q: 'How does Rental Mode handle time zones and one-way rentals?',
    a: `Pickup and return locations can have different time zones. GasCap™ uses each location's local time when available, making one-way rentals across time zones easy to manage.

The app shows the selected time zone and whether it came from your location, your selection, or your device. You can correct an assumed zone before saving.

Saved times remain accurate when you travel between time zones. GasCap™ also detects daylight-saving conflicts, asking you to correct nonexistent times or choose between repeated times.`,
  },
  {
    q: 'Can I save a rental I booked ahead before I know the car or fuel level?',
    a: `Yes! Open **My Rentals → Booked ahead? Save it as upcoming**. Enter the rental company, pickup and return locations and times, and an optional confirmation number. A pickup time is required.

When collecting the vehicle, use **Finish setup** to add the vehicle, tank capacity, and actual pickup fuel level.

Until that information is available, GasCap™ keeps fuel quantities unknown and disables calculations rather than guessing. Gauge and percentage inputs require a known tank capacity. You can still log a fill-up, but you must provide a reading before calculating remaining fuel.

Saving an upcoming rental requires Pro or an active Pro trial.`,
  },
  {
    q: 'How does Rental Mode know where my rental stands?',
    a: `GasCap™ uses your saved pickup and return times to identify each rental's stage.

Around pickup (3 hours before through 6 hours after), it prompts you to finish any missing setup. After the return deadline, it asks whether you've returned the vehicle. After another 72 hours, unresolved rentals move to **Needs your attention**.

You can complete, cancel, update, or delete rentals yourself. GasCap™ never makes those decisions automatically. Invalid schedules require correction, and possible duplicate bookings trigger a confirmation.`,
  },
];

/** Product-authored (not part of the owner-approved verbatim copy above). */
export const RENTAL_FAQ_AUTO_OPEN: HelpFaq = {
  q: 'Can GasCap open my rental for me at pickup time?',
  a: 'Yes, if you turn it on. In Settings, switch on “Open my rental at pickup time”. It’s off by default and applies to this device and your account only. When you start GasCap at pickup time and exactly one rental is at pickup, it opens that rental once; with two or more at pickup it just tells you and lets you choose. It only runs from the home screen, never while you’re typing, and never changes any rental details or fuel readings.',
};

export const RENTAL_FAQ_AFTER_AUTO_OPEN: HelpFaq[] = [
  {
    q: 'What rental reminders will I get?',
    a: `GasCap™ sends rental reminders by email and, when enabled, push notifications.

For upcoming rentals, reminders are scheduled approximately **24 hours and 2 hours before pickup**. The 24-hour reminder applies only when the booking was saved sufficiently early.

Before returning the vehicle, you'll receive a fuel-check reminder and another reminder approximately 2 hours before return.

Supported iPhone and Android devices without usable push notifications may schedule a local return reminder if permissions allow. There is no local pickup-reminder backup. Multiple devices may receive their own alerts.

Delivery depends on your notification settings and connectivity, so always verify your scheduled return time.`,
  },
];

export const RENTAL_FAQ: HelpFaq[] = [
  ...RENTAL_FAQ_BEFORE_AUTO_OPEN, RENTAL_FAQ_AUTO_OPEN, ...RENTAL_FAQ_AFTER_AUTO_OPEN,
];

// ── answer text → safe render model (no HTML injection) ─────────────────────
export interface HelpSegment { text: string; bold: boolean }

/** Paragraphs split on blank lines; `**bold**` spans become bold segments. Plain text otherwise. */
export function parseHelpAnswer(answer: string): HelpSegment[][] {
  return answer.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const segs: HelpSegment[] = [];
    p.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
      if (!part) return;
      const m = /^\*\*([^*]+)\*\*$/.exec(part);
      segs.push(m ? { text: m[1], bold: true } : { text: part, bold: false });
    });
    return segs;
  });
}
