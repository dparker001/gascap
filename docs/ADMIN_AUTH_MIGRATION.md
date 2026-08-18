# Admin authentication — migration design

**Status: STEPS 1–4 IMPLEMENTED, staged (steps 5–6 pending soak).** Designed
in Hardening Sprint 1 (2026-08-18); implemented in Hardening Sprint 2
(2026-08-18) on branch `hardening/sprint-2`, not yet merged to `main`. See
`docs/SECURITY_AUDIT.md`'s "Sprint 2 — admin auth migration" entry and
`lib/adminAuth.ts` / `__tests__/adminAuth.test.ts`.

**What changed from the original design below:** the `support` role was
**not built**. Per the brief's own instruction not to add roles the current
system doesn't need, and since nothing in Sprint 2 required a read-only
middle tier, only `user`/`admin` exist in the shipped schema. Everything else
— schema shape, `requireAdmin`, the staged migration sequence — matches this
design.

---

## Current mechanism

```
app/admin/page.tsx
  localStorage.setItem('gascap_admin_session', JSON.stringify({ pw, ts }))
  fetch('/api/admin/…', { headers: { 'x-admin-password': pw } })

app/api/admin/*/route.ts   (17 endpoints)
  if (!process.env.ADMIN_PASSWORD) return false        ← fails closed, good
  return req.headers.get('x-admin-password') === pw
```

**It fails closed.** The sprint-1 audit confirmed every one of the 17 endpoints
guards a missing `ADMIN_PASSWORD`. This is not the RevenueCat bug. It is a
design problem, not an open door — which is why it was deferred rather than
rushed.

## What is actually wrong

1. **The raw password is written to `localStorage`**, in cleartext, for ~8
   hours. Any XSS anywhere on the origin reads it. Unlike a session token, it
   is the *permanent* credential — stealing it is not time-boxed, and rotating
   it means editing a Railway variable.
2. **It is replayed on every request** to 17 endpoints, widening exposure to
   logs, proxies and error reporters.
3. **One shared credential, no identity.** Every action is "someone who knew
   the password." No attribution, no revocation of one person's access, no
   read-only tier.
4. **No audit trail.** Admin endpoints send campaign blasts, issue gifts and
   run sweepstakes draws. There is no record of who did what.
5. **Rotation is disruptive** — changing it signs out everyone and requires a
   redeploy of the variable.

## Target design

**NextAuth session + a role field + server-side guards.** No new auth system:
GasCap already has NextAuth, and admins already have accounts.

### Schema (additive)

```prisma
model User {
  // …
  role      String   @default("user")   // 'user' | 'support' | 'admin'
  // Audit trail — new model
}

model AdminAuditLog {
  id         String   @id
  userId     String
  userEmail  String
  action     String   // 'draw.run', 'gift.issue', 'campaign.send', …
  target     String?  // affected record
  metadata   Json?
  createdAt  String
}
```

Additive and non-destructive: a `role` column defaulting to `'user'` changes no
existing behaviour. **Do not execute against production without approval.**

### Roles

| Role | Can |
|---|---|
| `user` | nothing admin |
| `support` | **read-only** — view users, email log, feedback, rental pilot metrics |
| `admin` | everything, including draws, gifts, campaign sends, backfills |

`support` is worth having: most admin-panel use is looking something up. It
also makes the eventual "who ran this draw" answer meaningful.

**Not built in Sprint 2.** Only `user` and `admin` shipped — see the status
note at the top of this document. Add `support` if a real read-only need
appears; the schema is a single `role` string column, so it's a one-line
change plus a `hasRole` update, not a migration.

### Server-side guard

```ts
// lib/adminAuth.ts
export async function requireAdmin(minRole: 'support' | 'admin' = 'admin') {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { ok: false, status: 401 };
  const user = await findById((session.user as { id?: string }).id ?? '');
  // Resolve from the DATABASE, never the JWT — the token carries a stale role
  // after a change, exactly as it does for `plan` (see lib/serverPlan.ts).
  if (!user || !hasRole(user.role, minRole)) return { ok: false, status: 403 };
  return { ok: true, user };
}
```

Every `/api/admin/*` route calls this. The `x-admin-password` header disappears
from the client entirely.

## Migration sequence — without locking Don out

The failure mode to avoid is deploying the new guard and discovering the role
was never set. Ordered so that never happens:

1. ✅ **Add `role` to the schema.** Additive; in
   `docs/migrations/2026-08-sprint2-schema.sql`, not yet applied to
   production (awaiting the same DB-apply approval as the rest of Sprint 2's
   schema).
2. ⏳ **Set `role='admin'` on Don's account** — the SQL is written (commented
   out in the same migration file, targeting `dparker001@gmail.com`,
   confirmed as the correct address) but **not yet run against production**.
   Must happen before step 4 has any effect for Don, or the silent
   session-probe in `app/admin/page.tsx` will just fail closed and fall back
   to the password prompt — safe, but not the intended state.
3. ✅ **Ship `requireAdmin` accepting EITHER** a valid admin session **or**
   the legacy `x-admin-password` header. Both work. No lockout possible. All
   21 existing admin/push/announcements routes widened to accept both — see
   `docs/SECURITY_AUDIT.md`.
4. ✅ **Move the admin UI to the NextAuth session.** `app/admin/page.tsx` no
   longer persists the password in `localStorage`; a signed-in admin session
   logs in silently via a probe request. The password prompt still exists as
   a fallback (not yet dropped from the client — see step 6).
5. ⏳ **Soak.** Not started — depends on step 2 (the schema apply + role
   backfill) actually happening in production first, and then real admin
   usage accumulating. No warning-log-on-legacy-path instrumentation was
   added yet; add it before starting the soak so "has it gone quiet" is
   answerable.
6. ⏳ **Remove the legacy branch** and `ADMIN_PASSWORD` — blocked on step 5.
7. **Add audit logging** to mutating endpoints — done for the
   highest-risk actions ahead of schedule (see `lib/adminAudit.ts`,
   `AdminAuditLog` table): user delete/plan-change/comp-grant/comp-revoke,
   sweepstakes draw runs and winner-email releases, AMOE backfill. Not
   wired to every mutating endpoint — the brief allowed prioritizing highest
   risk over full coverage.

Steps 3–6 mean there is never a moment where the only way in is a path that has
not yet been proven to work.

### Rollback

Until step 6, reverting the deploy restores the legacy header path. After step
6, rollback requires redeploying the previous build — so step 6 should be its
own small, easily-reverted PR.

## Later, not now

- **MFA / passkeys.** WebAuthn on admin accounts. Worth it once role-based auth
  exists; meaningless before.
- **Session TTL.** The current 8-hour `localStorage` TTL is noted in project
  memory as deliberate. NextAuth session policy should match unless Don says
  otherwise.
- **IP allow-listing** for the most destructive endpoints.

## Effort and recommendation

Roughly 1–2 days including tests for all 17 endpoints. **Not urgent** — it
fails closed today. Recommended for Sprint 2 or 3, after the endpoints that
handle money and compliance have coverage.

The single highest-value piece, if only one thing is done: **step 4** — stop
writing a permanent credential into `localStorage`. That removes the worst
property (XSS yields the permanent password) even before roles land.
