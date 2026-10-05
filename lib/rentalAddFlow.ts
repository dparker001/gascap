/**
 * "+ Add Rental" navigation on My Rentals. One primary button opens a chooser
 * with two paths — a future reservation (the existing QuickSaveRentalForm: no
 * vehicle or fuel asked) or "I have the rental vehicle" (the existing
 * RentalSetupFlow). A pure state machine so routing and the Pro rule are
 * tested without rendering. Only STARTING a rental needs Pro (the server
 * enforces it too); going back to the list is always allowed.
 */
export type RentalPageMode = 'list' | 'choose' | 'quick' | 'setup';
export type AddRentalAction = 'add' | 'reservation' | 'vehicle' | 'back';

export function nextRentalPageMode(mode: RentalPageMode, action: AddRentalAction, isPro: boolean): RentalPageMode {
  if (action === 'back') return 'list';
  if (!isPro) return 'list';                                  // starting a rental requires Pro
  if (action === 'add') return mode === 'list' ? 'choose' : mode;
  if (action === 'reservation') return mode === 'choose' ? 'quick' : mode;
  return mode === 'choose' ? 'setup' : mode;                   // 'vehicle'
}

/** What to render: a non-Pro user is never inside a creation flow (it could only 403). */
export function effectiveRentalPageMode(mode: RentalPageMode, isPro: boolean): RentalPageMode {
  return isPro ? mode : 'list';
}
