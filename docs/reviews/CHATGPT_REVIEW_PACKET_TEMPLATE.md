# ChatGPT Review Packet — Template

Reusable skeleton for the Claude ↔ ChatGPT independent-review process defined
by Don. Copy this file to `docs/reviews/<yyyy-mm-dd>-<short-topic>.md`, fill it
in for the work under review, then paste the filled contents into ChatGPT (or
point ChatGPT at this file + the branch/SHA it names).

Do not soften findings to make this file shorter. Every section exists because
skipping it is how a reviewer misses something.

---

## 1. Objective
What Don asked Claude to accomplish, in his words or a faithful paraphrase.

## 2. Repository State
- **Branch:**
- **Review Target SHA:** the functional/code commit whose *behavior* is under
  review — i.e. the last commit that changed application code, tests, or
  config, not documentation about the review itself.
- **Packet Commit SHA (optional):** the commit that records this packet, if
  different from the Review Target SHA. **These are often different, and
  that's expected, not an error:** saving a filled-in packet to the repo is
  itself a commit, so if a packet reports "the current HEAD" as its target and
  is then committed, the act of committing moves HEAD past the SHA the packet
  describes. Name the two explicitly instead of relying on "current branch
  HEAD" to mean one stable thing.
- **Base branch:**
- **Relevant PR, if one exists:**
- **Review this diff:** `git diff --name-status <base>...<Review Target SHA>`
  — generate this list mechanically and paste the real output. Do not hand-
  count or hand-summarize file changes; a manually-typed count silently drifts
  from the actual diff (this happened in the sprint-1 packet: 27 reported vs.
  29 actual after a docs-only follow-up commit).

## 3. What I Found
Actual repository state *before* changes. Call out anything that differed from
the original assumption, ticket, or a prior ChatGPT recommendation — this is
where silent scope drift gets caught.

## 4. What I Changed
Per significant change: file, purpose, behavior before, behavior after. Don't
dump code unless a specific snippet is the thing under review.

## 5. Architectural Decisions
Non-obvious technical choices and why. Name the alternative considered and why
it lost.

## 6. Security Impact
State explicitly:
- security problems fixed
- new security considerations introduced
- remaining security concerns
- whether authentication/authorization behavior changed

If none: write "No security impact." — don't leave the section silently empty.

## 7. Data / Database Impact
State explicitly: schema changes, migrations, backfills, production-data
implications, whether any destructive operation occurred.

If none: write "No database or production-data changes."

## 8. User / Business Impact
Customers, trials, paid users, pricing, rewards, rental users, giveaway
entrants, app-store users, email/SMS/push campaigns — whichever apply.

## 9. Testing Performed
Only report what was actually run, with actual output/counts.

```
npm test          →
npx tsc --noEmit   →
npm run build      →
```
Other tests:

## 10. Files Changed
Output of `git diff --name-status <base>...<Review Target SHA>`, pasted
verbatim. Not hand-typed, not summarized — see the note in §2 about why a
manual count drifts.

## 11. Known Risks / Remaining Questions
Candid, even though implementation is "done." Include process mistakes made
and corrected during the work, not just code-level risk — a reviewer catching
a bad habit is as valuable as catching a bad line.

## 12. Claude's Assessment
One of: **READY FOR REVIEW** / **READY WITH KNOWN CONCERNS** / **NOT READY TO
MERGE**, with the reason in a sentence.

## 13. Questions for ChatGPT
Specific, falsifiable questions — not "does this look okay?"

## 14. Requested Review Scope
Name exactly what should get the most scrutiny. A reviewer given everything
equally weighted reviews nothing carefully.

---

## After the review comes back

When Don pastes ChatGPT's findings into Claude Code, classify each one before
touching code:

- AGREE — ACTION REQUIRED
- AGREE — ALREADY ADDRESSED
- PARTIALLY AGREE
- DISAGREE — WITH EVIDENCE
- NEEDS DON'S DECISION

Verify every finding against the current repository before acting on it. A
recommendation that was correct when ChatGPT read the code can be stale by the
time it's applied. Disagreement is expected and welcome — see `/CLAUDE.md` for
the disagreement format — but it must cite repository evidence, not just
assert a different view.

**Merge authority stays with Don.** "ChatGPT approved this" is not "ChatGPT
approved merging this." Stop at READY FOR REVIEW unless Don explicitly
delegates merge authority for the specific task.
