/**
 * Resolves the public-facing base URL of the app.
 * Railway (and similar platforms) set req.url to an internal localhost address,
 * so we must rely on NEXTAUTH_URL or x-forwarded-host instead.
 */
export function getBaseUrl(req: Request): string {
  const nextAuthUrl   = process.env.NEXTAUTH_URL;
  const forwardedHost = req.headers.get('x-forwarded-host');
  const host          = req.headers.get('host');
  const proto         = req.headers.get('x-forwarded-proto') ?? 'https';
  if (nextAuthUrl)   return nextAuthUrl.replace(/\/$/, '');
  if (forwardedHost) return `${proto}://${forwardedHost}`;
  if (host)          return `${proto}://${host}`;
  return 'https://www.gascap.app';
}
