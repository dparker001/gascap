/**
 * T1 — rental event-timezone columns: the Prisma schema and the additive
 * SQL script must describe exactly the same six nullable columns, and the
 * script must be a dry run unless --apply is passed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { COLUMNS, TABLE, buildStatements, isApply } from '../scripts/add-rental-event-timezone-columns.mjs';

const schema = readFileSync(path.resolve(__dirname, '../prisma/schema.prisma'), 'utf8');
const model = schema.slice(schema.indexOf('model RentalSession {'), schema.indexOf('}', schema.indexOf('model RentalSession {')));

const EXPECTED: Record<string, { prisma: string; sql: string }> = {
  pickupTimeZone:       { prisma: 'String?', sql: 'TEXT' },
  returnTimeZone:       { prisma: 'String?', sql: 'TEXT' },
  pickupLatitude:       { prisma: 'Float?',  sql: 'DOUBLE PRECISION' },
  pickupLongitude:      { prisma: 'Float?',  sql: 'DOUBLE PRECISION' },
  pickupTimeZoneSource: { prisma: 'String?', sql: 'TEXT' },
  returnTimeZoneSource: { prisma: 'String?', sql: 'TEXT' },
};

describe('rental event-timezone schema (T1)', () => {
  it('Prisma model declares all six fields as nullable with the right types and no default', () => {
    for (const [name, t] of Object.entries(EXPECTED)) {
      const line = model.split('\n').find((l) => new RegExp(`^\\s*${name}\\s`).test(l));
      expect(line, name).toBeTruthy();
      expect(line!.trim().split(/\s+/)[1]).toBe(t.prisma);
      expect(line).not.toMatch(/@default/);
    }
  });

  it('keeps the legacy timeZone column', () => {
    expect(model).toMatch(/^\s*timeZone\s+String\?/m);
  });

  it('script columns match the schema exactly', () => {
    expect(TABLE).toBe('RentalSession');
    expect(Object.fromEntries(COLUMNS.map((c: { name: string; sqlType: string }) => [c.name, c.sqlType])))
      .toEqual(Object.fromEntries(Object.entries(EXPECTED).map(([k, v]) => [k, v.sql])));
  });

  it('every statement is additive + idempotent — no DROP, no DEFAULT, no UPDATE', () => {
    const sql: string[] = buildStatements();
    expect(sql).toHaveLength(6);
    for (const s of sql) {
      expect(s).toMatch(/^ALTER TABLE "RentalSession" ADD COLUMN IF NOT EXISTS "\w+" (TEXT|DOUBLE PRECISION)$/);
      expect(s).not.toMatch(/DROP|DEFAULT|UPDATE|NOT NULL/i);
    }
  });

  it('is a dry run unless --apply is passed', () => {
    expect(isApply(['node', 'script'])).toBe(false);
    expect(isApply(['node', 'script', '--dry-run'])).toBe(false);
    expect(isApply(['node', 'script', '--apply'])).toBe(true);
  });
});
