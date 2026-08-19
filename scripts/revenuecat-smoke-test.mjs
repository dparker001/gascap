#!/usr/bin/env node
/**
 * READ-ONLY RevenueCat v2 smoke test.
 *
 * Reads or writes: READS ONLY. Makes zero writes to RevenueCat or to
 * GasCap's database — this script does not import Prisma or touch the
 * database at all. It only issues GET requests to RevenueCat's v2 API
 * using the same request logic as lib/revenueCatApi.ts, mirrored here
 * standalone so this script has no dependency on the Next.js build.
 *
 * WHY THIS EXISTS: three consecutive independent-review rounds
 * (ChatGPT, Hardening Sprint 2 Revisions 4-6) each found the RevenueCat v2
 * client's assumed response shapes were wrong in some way, discovered only
 * by re-reading RevenueCat's documentation more carefully — never by
 * checking a real response. This script checks a real response. Run it
 * before trusting lib/revenueCatApi.ts's output for any real user, per
 * docs/migrations/2026-08-sprint2-revenuecat-historical-reconciliation.md.
 *
 * USAGE:
 *   REVENUECAT_V2_SECRET_KEY=... REVENUECAT_PROJECT_ID=... \
 *     node scripts/revenuecat-smoke-test.mjs \
 *       --active-monthly=<app_user_id> \
 *       --lifetime=<app_user_id> \
 *       --no-entitlement=<app_user_id> \
 *       --unknown=<app_user_id_that_should_not_exist> \
 *       --alias=<a_known_non-canonical_app_user_id> \
 *       --subscription-path=<app_user_id> \
 *       --environment=production|sandbox
 *
 * Every identity flag is optional — pass whichever real identities you
 * have on hand. At minimum, pass one known real customer id and one
 * `--unknown=...` id (any string you're confident isn't a real RevenueCat
 * app_user_id) to confirm the "does not create a customer" guarantee.
 *
 * `--subscription-path` is a DIAGNOSTIC-ONLY flag, separate from
 * `--active-monthly`/`--lifetime`/etc. It exists to validate the
 * subscription.gives_access + embedded EntitlementList interpretation path
 * specifically, for a customer whose Lifetime purchase would otherwise
 * take precedence (production's actual, correct behavior — Lifetime is
 * the stronger, permanent grant) and mask whether the subscription
 * interpretation logic itself is correct. It resolves the customer via
 * the exact same lookup/alias logic as every other flag, but then IGNORES
 * purchase/Lifetime records entirely and evaluates ONLY the subscription
 * response — this does NOT change production Lifetime-over-subscription
 * precedence anywhere; it only lets this one diagnostic check see past it
 * for a customer who happens to have both. Output is clearly labeled
 * "DIAGNOSTIC SUBSCRIPTION PATH" so it's never mistaken for the real
 * customerFound/active/interval decision the other flags report.
 *
 * `--environment` selects which RevenueCat environment the subscriptions/
 * purchases lookups query (`?environment=production|sandbox`, the exact
 * same query param `lib/revenueCatApi.ts` uses in the real code path).
 * DEFAULTS TO `production` if omitted — matching real runtime behavior.
 * Pass `--environment=sandbox` only to deliberately exercise the positive
 * monthly/Lifetime path against a RevenueCat SANDBOX test customer, before
 * GasCap has any real production purchaser to test against safely. Any
 * value other than exactly `production` or `sandbox` fails closed with a
 * clear error — this script never silently falls back to a default on a
 * typo.
 *
 * SAFETY:
 *   - Never logs the secret key, the Authorization header, a full raw
 *     provider payload, or a raw app_user_id/alias (an identifier may be
 *     an email or otherwise customer-identifying) — only the sanitized
 *     classification fields this script derives (customerFound / active /
 *     interval / productId), a short irreversible SHA-256-derived
 *     reference for each identity (not reversible back to the input), and
 *     HTTP status codes on failure. Project id and the configured
 *     entitlement lookup key are logged since they're not credentials.
 *   - Makes NO writes to RevenueCat (every call is GET) or to GasCap's
 *     database (this script never imports Prisma).
 *   - Do NOT run this without real REVENUECAT_V2_SECRET_KEY /
 *     REVENUECAT_PROJECT_ID credentials — it will simply fail fast with a
 *     clear error if they're missing.
 */

import { createHash } from 'node:crypto';

const ORIGIN = 'https://api.revenuecat.com';
const API_BASE = `${ORIGIN}/v2`;
const PRO_ENTITLEMENT_LOOKUP_KEY = process.env.REVENUECAT_PRO_ENTITLEMENT_ID || 'pro';

function parseArgs() {
  const out = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([a-z-]+)=(.+)$/);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

const VALID_ENVIRONMENTS = new Set(['production', 'sandbox']);

/**
 * Validates the --environment flag. FAILS CLOSED: any value other than
 * exactly 'production' or 'sandbox' exits with an error rather than
 * silently defaulting. Omitting the flag entirely defaults to
 * 'production', matching lib/revenueCatApi.ts's real runtime behavior.
 */
function resolveEnvironment(args) {
  if (args.environment === undefined) return 'production';
  if (VALID_ENVIRONMENTS.has(args.environment)) return args.environment;
  console.error(`ERROR: --environment must be exactly "production" or "sandbox" (got "${args.environment}").`);
  process.exit(1);
}

function requireConfig() {
  const apiKey = process.env.REVENUECAT_V2_SECRET_KEY;
  const projectId = process.env.REVENUECAT_PROJECT_ID;
  if (!apiKey || !projectId) {
    console.error('ERROR: REVENUECAT_V2_SECRET_KEY and REVENUECAT_PROJECT_ID must both be set in the environment.');
    process.exit(1);
  }
  return { apiKey, projectId };
}

async function fetchAllPages(path, apiKey, what) {
  const items = [];
  let url = `${API_BASE}${path}`;
  let pageCount = 0;
  while (url) {
    pageCount++;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw new Error(`${what} fetch failed: HTTP ${res.status}`);
    const json = await res.json();
    items.push(...(json.items ?? []));
    url = json.next_page ? `${ORIGIN}${json.next_page}` : null;
  }
  return { items, pageCount };
}

async function collectEmbeddedEntitlementIds(list, apiKey) {
  if (!list) return [];
  const ids = (list.items ?? []).map((e) => e.id);
  let nextPage = list.next_page ?? null;
  while (nextPage) {
    const res = await fetch(`${ORIGIN}${nextPage}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw new Error(`embedded entitlement list fetch failed: HTTP ${res.status}`);
    const page = await res.json();
    ids.push(...(page.items ?? []).map((e) => e.id));
    nextPage = page.next_page ?? null;
  }
  return ids;
}

async function verifyAlias(customerId, appUserId, apiKey, projectId) {
  const { items } = await fetchAllPages(
    `/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(customerId)}/aliases`,
    apiKey, 'customer aliases',
  );
  return items.some((a) => a.id === appUserId);
}

async function findCustomerId(appUserId, apiKey, projectId) {
  const candidateIds = new Set();
  let url = `${API_BASE}/projects/${encodeURIComponent(projectId)}/customers?search=${encodeURIComponent(appUserId)}`;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw new Error(`customer search failed: HTTP ${res.status}`);
    const json = await res.json();
    const pageItems = json.items ?? [];
    for (const c of pageItems) {
      if (c.id === appUserId) return { customerId: c.id, viaAlias: false };
      candidateIds.add(c.id);
    }
    url = json.next_page ? `${ORIGIN}${json.next_page}` : null;
  }
  if (candidateIds.size === 0) return { customerId: null, viaAlias: false };
  const verified = [];
  for (const candidateId of candidateIds) {
    if (await verifyAlias(candidateId, appUserId, apiKey, projectId)) verified.push(candidateId);
  }
  if (verified.length === 1) return { customerId: verified[0], viaAlias: true };
  if (verified.length > 1) {
    throw new Error(`alias resolution ambiguous: ${verified.length} distinct customers each claim this app_user_id via their alias list`);
  }
  return { customerId: null, viaAlias: false }; // zero verified matches — not found.
}

async function resolveEntitlementInternalId(lookupKey, apiKey, projectId) {
  const { items } = await fetchAllPages(`/projects/${encodeURIComponent(projectId)}/entitlements`, apiKey, 'entitlements catalog');
  const match = items.find((e) => e.lookup_key === lookupKey);
  if (!match) throw new Error(`No RevenueCat entitlement configured with lookup_key="${lookupKey}" in this project.`);
  return match.id;
}

async function resolveProductStoreIdentifier(internalProductId, apiKey, projectId) {
  try {
    const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/products/${encodeURIComponent(internalProductId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.store_identifier ?? null;
  } catch {
    return null;
  }
}

/** Short, irreversible reference for a log line — never the raw identifier itself, which may be an email or otherwise customer-identifying. */
function shortRef(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

async function checkIdentity(label, appUserId, apiKey, projectId, proEntitlementId, environment) {
  console.log(`\n--- ${label} [ref:${shortRef(appUserId)}] ---`);
  let resolution;
  try {
    resolution = await findCustomerId(appUserId, apiKey, projectId);
  } catch (err) {
    console.log(`  RESULT: LOOKUP FAILED — ${err.message}`);
    return;
  }
  if (!resolution.customerId) {
    console.log('  RESULT: customerFound=false (not found — confirms no customer was created for an unknown identity)');
    return;
  }
  console.log(`  resolved canonical customerId (sanitized, not logging full payload)${resolution.viaAlias ? ' — resolved via alias verification, NOT an exact id match' : ''}`);

  let purchases, subscriptions;
  try {
    ({ items: purchases } = await fetchAllPages(
      `/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(resolution.customerId)}/purchases?environment=${environment}`,
      apiKey, `${environment} purchases`,
    ));
    ({ items: subscriptions } = await fetchAllPages(
      `/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(resolution.customerId)}/subscriptions?environment=${environment}`,
      apiKey, `${environment} subscriptions`,
    ));
  } catch (err) {
    console.log(`  RESULT: subscriptions/purchases FETCH FAILED — ${err.message}`);
    return;
  }

  for (const purchase of purchases) {
    if (purchase.status !== 'owned') continue;
    const entitlementIds = await collectEmbeddedEntitlementIds(purchase.entitlements, apiKey);
    if (entitlementIds.includes(proEntitlementId)) {
      const productId = await resolveProductStoreIdentifier(purchase.product_id, apiKey, projectId);
      console.log(`  RESULT: customerFound=true active=true interval=lifetime productId=${productId ?? '(unresolved — check /products response shape)'}`);
      return;
    }
  }
  for (const subscription of subscriptions) {
    if (!subscription.gives_access) continue;
    const entitlementIds = await collectEmbeddedEntitlementIds(subscription.entitlements, apiKey);
    if (entitlementIds.includes(proEntitlementId)) {
      const productId = await resolveProductStoreIdentifier(subscription.product_id, apiKey, projectId);
      console.log(`  RESULT: customerFound=true active=true interval=monthly productId=${productId ?? '(unresolved — check /products response shape)'}`);
      return;
    }
  }
  console.log(`  RESULT: customerFound=true active=false (${purchases.length} ${environment} purchase(s), ${subscriptions.length} ${environment} subscription(s) found — none grant the resolved pro entitlement)`);
}

/**
 * DIAGNOSTIC SUBSCRIPTION PATH ONLY — not the production entitlement
 * decision. See the module header comment for --subscription-path. Uses
 * the exact same customer/alias resolution as checkIdentity, then
 * evaluates ONLY the subscriptions response (subscription.gives_access +
 * the embedded EntitlementList), ignoring purchases/Lifetime entirely,
 * so this can be exercised on a mixed Lifetime+Monthly customer where
 * production's real Lifetime-over-subscription precedence would otherwise
 * mask this path in the normal checkIdentity flow.
 */
async function checkSubscriptionPathDiagnostic(appUserId, apiKey, projectId, proEntitlementId, environment) {
  console.log(`\n--- DIAGNOSTIC SUBSCRIPTION PATH [ref:${shortRef(appUserId)}] ---`);
  console.log('  (ignores purchases/Lifetime entirely — NOT the production entitlement decision)');
  let resolution;
  try {
    resolution = await findCustomerId(appUserId, apiKey, projectId);
  } catch (err) {
    console.log(`  RESULT: LOOKUP FAILED — ${err.message}`);
    return;
  }
  if (!resolution.customerId) {
    console.log('  RESULT: customerFound=false');
    return;
  }

  let subscriptions;
  try {
    ({ items: subscriptions } = await fetchAllPages(
      `/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(resolution.customerId)}/subscriptions?environment=${environment}`,
      apiKey, `${environment} subscriptions`,
    ));
  } catch (err) {
    console.log(`  RESULT: subscriptions FETCH FAILED — ${err.message}`);
    return;
  }

  for (const subscription of subscriptions) {
    if (!subscription.gives_access) continue;
    const entitlementIds = await collectEmbeddedEntitlementIds(subscription.entitlements, apiKey);
    if (entitlementIds.includes(proEntitlementId)) {
      const productId = await resolveProductStoreIdentifier(subscription.product_id, apiKey, projectId);
      console.log(`  RESULT: customerFound=true subscriptionAccess=true interval=monthly productId=${productId ?? '(unresolved — check /products response shape)'}`);
      return;
    }
  }
  console.log(`  RESULT: customerFound=true subscriptionAccess=false (${subscriptions.length} ${environment} subscription(s) found — none grant the resolved pro entitlement via gives_access)`);
}

async function main() {
  const { apiKey, projectId } = requireConfig();
  const args = parseArgs();
  const environment = resolveEnvironment(args);

  console.log('RevenueCat v2 READ-ONLY smoke test');
  console.log(`Smoke environment: ${environment.toUpperCase()}`);
  console.log(`Project: ${projectId} (secret key not logged)`);
  console.log(`Pro entitlement lookup key: "${PRO_ENTITLEMENT_LOOKUP_KEY}"`);

  let proEntitlementId;
  try {
    proEntitlementId = await resolveEntitlementInternalId(PRO_ENTITLEMENT_LOOKUP_KEY, apiKey, projectId);
    console.log(`Resolved entitlement catalog: lookup_key="${PRO_ENTITLEMENT_LOOKUP_KEY}" -> found (internal id not logged)`);
  } catch (err) {
    console.error(`FATAL: could not resolve the pro entitlement — ${err.message}`);
    console.error('This alone is diagnostic: it means REVENUECAT_PRO_ENTITLEMENT_ID does not match any entitlement lookup_key in this project.');
    process.exit(1);
  }

  if (!args['active-monthly'] && !args['lifetime'] && !args['no-entitlement'] && !args['unknown'] && !args['alias'] && !args['subscription-path']) {
    console.log('\nNo --active-monthly / --lifetime / --no-entitlement / --unknown / --alias / --subscription-path flags passed.');
    console.log('Nothing to check. See the header comment for usage.');
    return;
  }

  if (args['active-monthly']) await checkIdentity('1. Known active MONTHLY customer', args['active-monthly'], apiKey, projectId, proEntitlementId, environment);
  if (args['lifetime']) await checkIdentity('2. Known LIFETIME customer', args['lifetime'], apiKey, projectId, proEntitlementId, environment);
  if (args['no-entitlement']) await checkIdentity('3. Known customer with NO active entitlement', args['no-entitlement'], apiKey, projectId, proEntitlementId, environment);
  if (args['unknown']) await checkIdentity('4. Genuinely UNKNOWN app_user_id (expect not found, and confirms nothing gets created)', args['unknown'], apiKey, projectId, proEntitlementId, environment);
  if (args['alias']) await checkIdentity('5/6. ALIAS / non-canonical app_user_id (e.g. a pre-transfer identity)', args['alias'], apiKey, projectId, proEntitlementId, environment);
  if (args['subscription-path']) await checkSubscriptionPathDiagnostic(args['subscription-path'], apiKey, projectId, proEntitlementId, environment);

  console.log(`\nDone. Every subscriptions/purchases call above included ?environment=${environment}.`);
  if (environment === 'production') {
    console.log('To deliberately test the positive monthly/Lifetime path against a RevenueCat SANDBOX customer instead, re-run with --environment=sandbox.');
  } else {
    console.log('This run queried SANDBOX data only — results here do NOT reflect production entitlement state. Re-run with --environment=production (or omit the flag) to check real production data.');
  }
  console.log('Zero writes were made to RevenueCat or to GasCap\'s database.');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
