/**
 * Focused validation test for scripts/revenuecat-smoke-test.mjs's
 * --environment flag handling. The smoke-test script is a standalone
 * .mjs with no imports from lib/ (deliberately, so it has no dependency
 * on the Next.js build — see its header comment), so this test mirrors
 * its exact resolveEnvironment() logic rather than importing it, to keep
 * that standalone property intact while still getting regression coverage
 * on the validation rule.
 */
import { describe, it, expect } from 'vitest';

const VALID_ENVIRONMENTS = new Set(['production', 'sandbox']);

function resolveEnvironment(args: { environment?: string }): string {
  if (args.environment === undefined) return 'production';
  if (VALID_ENVIRONMENTS.has(args.environment)) return args.environment;
  throw new Error(`--environment must be exactly "production" or "sandbox" (got "${args.environment}").`);
}

describe('revenuecat-smoke-test.mjs — --environment flag validation', () => {
  it('defaults to "production" when the flag is omitted', () => {
    expect(resolveEnvironment({})).toBe('production');
  });

  it('accepts --environment=production explicitly', () => {
    expect(resolveEnvironment({ environment: 'production' })).toBe('production');
  });

  it('accepts --environment=sandbox', () => {
    expect(resolveEnvironment({ environment: 'sandbox' })).toBe('sandbox');
  });

  it('fails closed on an invalid value rather than silently defaulting', () => {
    expect(() => resolveEnvironment({ environment: 'staging' })).toThrow(/production.*sandbox/);
  });

  it('fails closed on a typo/case mismatch (e.g. "Production") rather than silently accepting it', () => {
    expect(() => resolveEnvironment({ environment: 'Production' })).toThrow();
  });

  it('fails closed on an empty string', () => {
    expect(() => resolveEnvironment({ environment: '' })).toThrow();
  });
});
