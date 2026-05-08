/**
 * Simple in-memory rate limiter.
 * Suitable for a single-instance Railway deployment.
 * For multi-instance deploys, replace the Map with Redis.
 */

interface RateLimitEntry {
  count:     number;
  resetAt:   number;   // Unix ms
}

const store = new Map<string, RateLimitEntry>();

// Clean up stale entries every 10 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.resetAt) store.delete(key);
  }
}, 10 * 60 * 1000);

export interface RateLimitResult {
  allowed:       boolean;
  remaining:     number;
  resetInSeconds: number;
}

/**
 * Check and increment the counter for a given key.
 * @param key       Unique identifier (e.g. "register:1.2.3.4")
 * @param limit     Max requests allowed in the window
 * @param windowMs  Window duration in milliseconds
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now   = Date.now();
  let   entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(key, entry);
  }

  entry.count += 1;
  const allowed       = entry.count <= limit;
  const remaining     = Math.max(0, limit - entry.count);
  const resetInSeconds = Math.ceil((entry.resetAt - now) / 1000);

  return { allowed, remaining, resetInSeconds };
}
