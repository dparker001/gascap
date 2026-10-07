/**
 * Phase 0.5B — migration script safety + schema sync (no real DB in this
 * repo's test infra, so the script and schema are verified statically).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');
const script = readFileSync(path.join(root, 'scripts/add-fuel-price-snapshot.mjs'), 'utf8');
const schema = readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
// Strip comment lines so prose in the header can't satisfy/violate a check.
const sql = script.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe('add-fuel-price-snapshot.mjs is additive and idempotent', () => {
  it('declares in its header that it writes (schema only)', () => {
    expect(script.split('\n').slice(0, 3).join(' ')).toMatch(/WRITES/);
  });
  it('contains no destructive statements', () => {
    for (const bad of [/\bDROP\b/i, /\bTRUNCATE\b/i, /\bDELETE\s+FROM\b/i, /\bUPDATE\s+"/i, /\bALTER\s+COLUMN\b/i, /RENAME/i]) {
      expect(sql).not.toMatch(bad);
    }
  });
  it('every CREATE / ADD is guarded with IF NOT EXISTS', () => {
    const creates = sql.match(/CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)[^\n]*/gi) ?? [];
    expect(creates.length).toBe(3);
    for (const c of creates) expect(c).toMatch(/IF NOT EXISTS/i);
    const adds = sql.match(/ADD COLUMN[^\n]*/gi) ?? [];
    expect(adds.length).toBe(4);
    for (const a of adds) expect(a).toMatch(/IF NOT EXISTS/i);
  });
  it('new Fillup columns are nullable with no default (existing rows untouched)', () => {
    for (const a of sql.match(/ADD COLUMN[^\n]*/gi) ?? []) {
      expect(a).not.toMatch(/NOT NULL/i);
      expect(a).not.toMatch(/DEFAULT/i);
    }
  });
  it('prints before/after state and verifies the Fillup row count is unchanged', () => {
    expect(script).toMatch(/BEFORE/);
    expect(script).toMatch(/AFTER/);
    expect(script).toMatch(/fillupRows === before\.fillupRows/);
  });
});

describe('script DDL stays in sync with schema.prisma', () => {
  const model = (name: string) => {
    const m = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
    expect(m, `model ${name} exists`).toBeTruthy();
    return m![1];
  };
  const fields = (body: string) =>
    body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//') && !l.startsWith('@@'))
      .map((l) => l.split(/\s+/)[0]);

  it('FuelPriceSnapshot columns match', () => {
    const tableDdl = sql.match(/CREATE TABLE IF NOT EXISTS "FuelPriceSnapshot" \(([\s\S]*?)\n\s*\)\n/)![1];
    const ddlCols = [...tableDdl.matchAll(/"(\w+)"/g)].map((m) => m[1]);
    expect(ddlCols.sort()).toEqual(fields(model('FuelPriceSnapshot')).sort());
  });
  it('Fillup baseline columns match', () => {
    const ddl = [...sql.matchAll(/ADD COLUMN IF NOT EXISTS "(\w+)"/g)].map((m) => m[1]).sort();
    const prismaCols = fields(model('Fillup')).filter((f) => f.startsWith('baseline')).sort();
    expect(ddl).toEqual(prismaCols);
  });
  it('the unique key in SQL matches @@unique in the model', () => {
    expect(schema).toMatch(/@@unique\(\[source, duoarea, product, observedOn\]\)/);
    expect(sql).toMatch(/\("source", "duoarea", "product", "observedOn"\)/);
  });
});

describe('cron is registered', () => {
  it('crons.yml schedules fuel-price-snapshot outside the 9:45–10:15 AM ET window', () => {
    const yml = readFileSync(path.join(root, '.github/workflows/crons.yml'), 'utf8');
    expect(yml).toMatch(/endpoint=fuel-price-snapshot/);
    const m = yml.match(/cron: '(\d+) (\d+) \* \* \*'\s+# fuel-price-snapshot/)!;
    const utcMin = Number(m[2]) * 60 + Number(m[1]);
    // 9:45–10:15 AM ET = 13:45–14:15 UTC (EDT) or 14:45–15:15 UTC (EST)
    const inWindow = (a: number, b: number) => utcMin >= a && utcMin <= b;
    expect(inWindow(13 * 60 + 45, 14 * 60 + 15)).toBe(false);
    expect(inWindow(14 * 60 + 45, 15 * 60 + 15)).toBe(false);
  });
});
