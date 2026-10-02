/**
 * Protected-path guard (CR-1 tripwire), shared by the CR-1 tests.
 *
 * Replaces the old pattern `git diff main...HEAD` with a silent fallback to
 * `git diff` (working tree), which had two defects (rental round 2/3 review,
 * 2026-10-02):
 *   1. CI is blind: a fetch-depth-1 checkout has no `main`, so the fallback
 *      ran against an empty working tree and could never fire.
 *   2. Locally it compared against the LOCAL `main`, which can be stale.
 *
 * Now:
 *   - The base is the merge-base of HEAD with `origin/main` (override with
 *     PROTECTED_PATH_BASE). If it cannot be resolved the guard THROWS — it
 *     never silently degrades to "nothing changed". CI checks out with
 *     fetch-depth 0 so origin/main is present.
 *   - Every NON-MERGE commit in base..HEAD that touches a protected path must
 *     be listed, by exact SHA, for that exact path in the reviewed-exception
 *     registry (docs/reviews/protected-path-exceptions.json). A new commit to
 *     the same file is unreviewed until its SHA is added. Merge commits are
 *     skipped so a PR's synthetic merge ref doesn't need registering.
 *   - Uncommitted (staged or unstaged) edits to a protected path are always
 *     unreviewed — a SHA can't be reviewed before it exists.
 */
import { execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

export interface ProtectedPathException {
  path:    string;    // exact repo-relative path
  commits: string[];  // full 40-char SHAs reviewed for THIS path
  review:  string;    // repo-relative review record
  approvedBy: string;
}

const git = (cwd: string, args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

export function resolveGuardBase(cwd: string, env: Record<string, string | undefined> = process.env): string {
  const ref = env.PROTECTED_PATH_BASE || 'origin/main';
  try {
    return git(cwd, ['merge-base', 'HEAD', ref]);
  } catch {
    throw new Error(
      `protected-path guard: cannot resolve a merge-base with "${ref}". ` +
      'Fetch it (git fetch origin main; CI must use actions/checkout fetch-depth: 0). ' +
      'The guard fails closed rather than comparing against nothing.',
    );
  }
}

export function loadExceptions(cwd: string, file = 'docs/reviews/protected-path-exceptions.json'): ProtectedPathException[] {
  const p = path.join(cwd, file);
  if (!existsSync(p)) return [];
  const parsed = JSON.parse(readFileSync(p, 'utf8')) as { exceptions?: ProtectedPathException[] };
  return parsed.exceptions ?? [];
}

/** Returns human-readable offenders; empty means every protected change is reviewed. */
export function findUnreviewedProtectedChanges(opts: {
  cwd: string;
  base: string;
  patterns: RegExp[];
  exceptions: ProtectedPathException[];
}): string[] {
  const { cwd, base, patterns, exceptions } = opts;
  const isProtected = (f: string) => patterns.some((re) => re.test(f));
  const offenders: string[] = [];

  for (const file of lines(git(cwd, ['diff', '--name-only', `${base}...HEAD`])).filter(isProtected)) {
    const reviewed = new Set(exceptions.filter((e) => e.path === file).flatMap((e) => e.commits));
    for (const sha of lines(git(cwd, ['log', '--no-merges', '--format=%H', `${base}..HEAD`, '--', file]))) {
      if (!reviewed.has(sha)) offenders.push(`${file} @ ${sha.slice(0, 12)} (no reviewed exception for this commit)`);
    }
  }
  const uncommitted = new Set([
    ...lines(git(cwd, ['diff', '--name-only'])),
    ...lines(git(cwd, ['diff', '--name-only', '--cached'])),
  ]);
  for (const file of Array.from(uncommitted).filter(isProtected)) {
    offenders.push(`${file} (uncommitted — commit it, then record the reviewed SHA)`);
  }
  return offenders;
}
