/**
 * Post-Sprint-2 Revision 1 fix — X-Real-IP (Railway's trusted client-IP
 * header) must be preferred over X-Forwarded-For, which is not guaranteed
 * trustworthy depending on the proxy chain and could let a caller rotate
 * their apparent IP to defeat a per-IP rate limit.
 */
import { describe, it, expect } from 'vitest';
import { getTrustedClientIp } from '../lib/clientIp';

function req(headers: Record<string, string> = {}): Request {
  return new Request('https://www.gascap.app/api/x', { headers });
}

describe('getTrustedClientIp', () => {
  it('prefers X-Real-IP when both headers are present', () => {
    const ip = getTrustedClientIp(req({ 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' }));
    expect(ip).toBe('1.2.3.4');
  });

  it('falls back to X-Forwarded-For when X-Real-IP is absent', () => {
    const ip = getTrustedClientIp(req({ 'x-forwarded-for': '9.9.9.9' }));
    expect(ip).toBe('9.9.9.9');
  });

  it('takes only the first address in a comma-separated X-Forwarded-For chain', () => {
    const ip = getTrustedClientIp(req({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1, 10.0.0.2' }));
    expect(ip).toBe('9.9.9.9');
  });

  it('returns null when neither header is present — no shared "unknown" bucket fallback baked in here', () => {
    const ip = getTrustedClientIp(req());
    expect(ip).toBeNull();
  });

  it('trims whitespace from X-Real-IP', () => {
    const ip = getTrustedClientIp(req({ 'x-real-ip': '  1.2.3.4  ' }));
    expect(ip).toBe('1.2.3.4');
  });
});
