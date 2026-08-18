# Diagnostic scripts

Ad-hoc, **read-only** queries against production, kept because the questions
recur. Moved here from the repository root in hardening sprint 1.

Run with production credentials injected, never committed:

```bash
railway run --service gascap -- npx tsx scripts/diagnostics/<name>.ts
```

> `railway run` executes **locally** with the service's environment variables.
> It does not run inside the container, so the Railway volume at `/app/data`
> (saved trips, AMOE entries) is **not** reachable this way.

## Rules

- Everything here **reads**. Anything that writes belongs in
  `scripts/maintenance/` or `scripts/one-time/` and must print before/after
  state — see `/CLAUDE.md`.
- State read-vs-write in a header comment at the top of every new script.
- These are snapshots of a past question. Treat them as examples, and check the
  schema still matches before trusting the output.

## Inventory

| Script | Question it answered | Access |
|---|---|---|
| `check_bonus.ts` | trial users, and whether any already received a bonus | read |
| `check_bonus2.ts` | follow-up bonus-entry counts | read |
| `check_engagement.ts` | engagement-campaign eligibility | read |
| `check_stripe.ts` | Stripe customer/subscription linkage | read |
| `check_trial_expiry.ts` | trials past `trialExpiresAt` | read |
| `check_users2.ts` | user counts by plan | read |
