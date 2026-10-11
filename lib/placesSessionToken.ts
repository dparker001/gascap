/**
 * GasCap™ — Google Places Autocomplete (New) session-token lifecycle.
 *
 * A session token groups one search's keystroke-by-keystroke Autocomplete
 * calls with the Place Details lookup that follows a user's selection into
 * a single billed "session" instead of Google charging every request
 * separately. Per Google's docs: generate a fresh token when a search
 * starts, reuse it across keystrokes, send the same token on the
 * resulting Place Details call, then discard it — a token is invalid for
 * reuse after a session has closed.
 *
 * CLIENT-SIDE ONLY (uses crypto.randomUUID(), available in the browser and
 * in Capacitor's WebView — not imported by any server-side file).
 */
export function createPlacesSessionToken(): string {
  return crypto.randomUUID();
}
