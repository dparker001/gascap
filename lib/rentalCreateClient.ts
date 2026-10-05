/**
 * Client side of C1 create-idempotency: one POST helper shared by the wizard
 * and quick-save. The caller keeps ONE clientRentalId per form instance and
 * reuses it for every retry, so a lost response can never create a second
 * rental; a duplicate warning is a normal outcome, not an error.
 */
export function newClientRentalId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type CreateRentalOutcome =
  | { kind: 'created'; sessionId: string }
  /** The server already had this exact request; same as created for the UI. */
  | { kind: 'replayed'; sessionId: string }
  | { kind: 'duplicate'; rentalId: string; matchedOn: 'confirmation' | 'pickup_window' }
  | { kind: 'error'; status: number; code?: string; message?: string };

export async function postCreateRental(
  body: Record<string, unknown>, clientRentalId: string, confirmDuplicate = false,
): Promise<CreateRentalOutcome> {
  const res = await fetch('/api/rental-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, clientRentalId, ...(confirmDuplicate ? { confirmDuplicate: true } : {}) }),
  });
  const data = await res.json().catch(() => ({})) as {
    session?: { id: string }; replayed?: boolean; error?: string; rentalId?: string; matchedOn?: 'confirmation' | 'pickup_window';
  };
  if (res.ok && data.session) return { kind: data.replayed ? 'replayed' : 'created', sessionId: data.session.id };
  if (res.status === 409 && data.error === 'possible_duplicate' && data.rentalId) {
    return { kind: 'duplicate', rentalId: data.rentalId, matchedOn: data.matchedOn ?? 'confirmation' };
  }
  return { kind: 'error', status: res.status, code: data.error, message: data.error };
}
