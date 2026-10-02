/**
 * CR-1 protected-path guard — behavioural proof against REAL temporary git
 * repositories (rental review round 3, 2026-10-02). Required properties:
 *   1. an unauthorized protected-path change fails locally;
 *   2. the same condition fails in CI-equivalent git state (shallow clone
 *      with no main ref fails CLOSED; a full clone detects the change);
 *   3. a reviewed exception (exact SHA + exact path) passes;
 *   4. unrelated protected-path edits — another protected file, a later
 *      commit to the excepted file, or an uncommitted edit — stay protected.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { resolveGuardBase, findUnreviewedProtectedChanges, type ProtectedPathException } from './helpers/protectedPathGuard';

const PATTERNS = [/^app\/api\/rental-sessions\/route\.ts$/, /stripe/i];
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (root: string, rel: string, body: string) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
};

let tmp: string, origin: string, work: string, reviewedSha: string;

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'ppguard-'));
  origin = path.join(tmp, 'origin.git');
  work = path.join(tmp, 'work');
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, work);
  git(work, 'config', 'user.email', 't@example.com'); git(work, 'config', 'user.name', 'T');
  git(work, 'checkout', '-q', '-b', 'main');
  write(work, 'app/api/rental-sessions/route.ts', 'v1\n');
  write(work, 'lib/stripe.ts', 'v1\n');
  write(work, 'README.md', 'base\n');
  git(work, 'add', '-A'); git(work, 'commit', '-q', '-m', 'base');
  git(work, 'push', '-q', 'origin', 'main');
  git(work, 'checkout', '-q', '-b', 'feat/x');
  write(work, 'app/api/rental-sessions/route.ts', 'v2 reviewed\n');
  git(work, 'commit', '-q', '-am', 'reviewed route change');
  reviewedSha = git(work, 'rev-parse', 'HEAD');
  git(work, 'push', '-q', 'origin', 'feat/x');
});
afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

const run = (cwd: string, exceptions: ProtectedPathException[] = []) =>
  findUnreviewedProtectedChanges({ cwd, base: resolveGuardBase(cwd, {}), patterns: PATTERNS, exceptions });
const exceptionFor = (sha: string): ProtectedPathException[] =>
  [{ path: 'app/api/rental-sessions/route.ts', commits: [sha], review: 'docs/x.md', approvedBy: 'Don' }];

describe('protected-path guard', () => {
  it('1. an unreviewed protected-path commit fails locally', () => {
    const offenders = run(work);
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toMatch(/^app\/api\/rental-sessions\/route\.ts @ /);
  });

  it('2a. CI-equivalent shallow clone with no main ref FAILS CLOSED (never compares against nothing)', () => {
    const shallow = path.join(tmp, 'ci-shallow');
    git(tmp, 'clone', '-q', '--depth', '1', '--branch', 'feat/x', '--single-branch', `file://${origin}`, shallow);
    expect(() => resolveGuardBase(shallow, {})).toThrow(/fails closed/);
  });

  it('2b. CI-equivalent full clone (fetch-depth 0) detects the same unreviewed change', () => {
    const full = path.join(tmp, 'ci-full');
    git(tmp, 'clone', '-q', '--branch', 'feat/x', `file://${origin}`, full);
    expect(run(full)).toHaveLength(1);
  });

  it('3. the exact reviewed SHA for the exact path passes', () => {
    expect(run(work, exceptionFor(reviewedSha))).toEqual([]);
  });

  it('4a. another protected file is still protected despite the route exception', () => {
    git(work, 'checkout', '-q', '-b', 'feat/y', reviewedSha);
    write(work, 'lib/stripe.ts', 'v2 unreviewed\n');
    git(work, 'commit', '-q', '-am', 'stripe change');
    const offenders = run(work, exceptionFor(reviewedSha));
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toMatch(/^lib\/stripe\.ts @ /);
  });

  it('4b. a LATER commit to the excepted file is unreviewed until its own SHA is recorded', () => {
    git(work, 'checkout', '-q', '-b', 'feat/z', reviewedSha);
    write(work, 'app/api/rental-sessions/route.ts', 'v3 not yet reviewed\n');
    git(work, 'commit', '-q', '-am', 'follow-up route change');
    const offenders = run(work, exceptionFor(reviewedSha));
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toContain(git(work, 'rev-parse', 'HEAD').slice(0, 12));
  });

  it('4c. an uncommitted protected edit is always unreviewed', () => {
    git(work, 'checkout', '-q', '-b', 'feat/w', reviewedSha);
    write(work, 'app/api/rental-sessions/route.ts', 'dirty\n');
    const offenders = run(work, exceptionFor(reviewedSha));
    expect(offenders.some((o) => o.includes('(uncommitted'))).toBe(true);
    git(work, 'checkout', '-q', '--', '.');
  });

  it('a non-protected change never trips the guard', () => {
    git(work, 'checkout', '-q', '-b', 'feat/v', reviewedSha);
    write(work, 'README.md', 'docs only\n');
    git(work, 'commit', '-q', '-am', 'docs');
    expect(run(work, exceptionFor(reviewedSha))).toEqual([]);
  });
});
