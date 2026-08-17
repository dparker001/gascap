import { describe, it, expect } from 'vitest';
import { amoeEntrantId, normalizeAmoeEmail, AMOE_ENTRY_VALUE } from '../lib/amoeEntries';

describe('AMOE entrant identity', () => {
  it('is worth exactly one entry', () => {
    expect(AMOE_ENTRY_VALUE).toBe(1);
  });

  it('keys the entrant id on the email, not the submission', () => {
    // Repeat-winner restrictions match on the recorded winner id. A per-
    // submission id would let the same person win consecutive months while a
    // registered user could not.
    expect(amoeEntrantId('A@Example.com ')).toBe('amoe:a@example.com');
    expect(amoeEntrantId('a@example.com')).toBe(amoeEntrantId('  A@EXAMPLE.COM'));
  });

  it('normalizes case and whitespace so dedupe actually dedupes', () => {
    expect(normalizeAmoeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });

  it('does not collide with a real user id', () => {
    // Real ids are UUIDs; the prefix keeps the two namespaces apart.
    expect(amoeEntrantId('x@y.com').startsWith('amoe:')).toBe(true);
  });
});
