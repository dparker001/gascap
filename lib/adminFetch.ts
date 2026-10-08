/**
 * Client-side helper for admin panels that load data from /api/admin/*.
 *
 * WHY THIS EXISTS (2026-10-08). The admin page signs in silently on mount with an
 * EMPTY password when the browser already holds an admin-role session
 * (app/admin/page.tsx → load('', silent)). The server accepts that: lib/adminAuth
 * authorizes a valid admin session independently of the x-admin-password header,
 * and the session cookie rides along on every same-origin fetch. But two panels
 * began with `if (!savedPw) return;`, so for a role-based admin (no saved legacy
 * password) they never fetched and sat in their loading skeleton forever.
 *
 * Contract:
 *   - savedPw present  → send the legacy x-admin-password header (unchanged behaviour);
 *   - savedPw empty    → send NO legacy header and still make the request;
 *   - the SERVER is the only authority: this helper never decides who is an admin.
 *     A non-admin session / no session gets the server's 401/403/503, surfaced as an error.
 */

export function adminHeaders(
  savedPw: string | null | undefined,
  extra: Record<string, string> = {},
): Record<string, string> {
  return savedPw ? { ...extra, 'x-admin-password': savedPw } : { ...extra };
}

export type AdminLoad<T> =
  | { ok: true; data: T }
  | { ok: false; status: number | null };   // null = network failure / unparseable body

/** GET `url` as an admin. Never throws; the caller maps `ok:false` to its error state. */
export async function fetchAdminJson<T>(
  url: string,
  savedPw: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<AdminLoad<T>> {
  try {
    const res = await fetchImpl(url, { headers: adminHeaders(savedPw) });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: null };
  }
}

/**
 * Run a panel load and ALWAYS finish: `onDone` fires exactly once whatever the
 * outcome, so a panel can never stay in its loading state because of the auth
 * path (the original bug) — only while the request is genuinely in flight.
 */
export async function loadAdminPanel<T>(
  url: string,
  savedPw: string | null | undefined,
  h: { onData: (d: T) => void; onError: (status: number | null) => void; onDone: () => void },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const r = await fetchAdminJson<T>(url, savedPw, fetchImpl);
  if (r.ok) h.onData(r.data); else h.onError(r.status);
  h.onDone();
}
