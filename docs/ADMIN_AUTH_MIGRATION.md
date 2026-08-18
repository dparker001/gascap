# Admin authentication — migration design

**Status: PLANNED — design only, nothing implemented.** Hardening sprint 1,
2026-08-18. The sprint brief scoped this to a design for review; the existing
admin panel is untouched and fully working.

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

1. **Add `role` to the schema.** Additive; deploy; nothing changes yet.
2. **Set `role='admin'` on Don's account** with a documented read/write script.
   Verify by reading it back **before** step 3.
3. **Ship `requireAdmin` accepting EITHER** a valid admin session **or** the
   legacy `x-admin-password` header. Both work. No lockout possible.
4. **Move the admin UI to the NextAuth session**; stop writing the password to
   `localStorage`; drop the `x-admin-password` headers from the client.
5. **Soak.** Confirm from real use that no path still needs the legacy header —
   log a warning whenever the legacy path is exercised, and wait for the log to
   go quiet.
6. **Remove the legacy branch** and `ADMIN_PASSWORD` — only after step 5 is
   silent.
7. **Add audit logging** to mutating endpoints.

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
