/**
 * GoHighLevel (GHL) CRM integration for GasCap™
 *
 * Automatically syncs GasCap users to GHL as contacts.
 * Requires two env vars:
 *   GHL_API_KEY     — Private Integration Token (PIT) from GHL location settings
 *   GHL_LOCATION_ID — GHL sub-account/location ID for GasCap
 *
 * Docs: https://highlevel.stoplight.io/docs/integrations
 */

const GHL_API_KEY     = process.env.GHL_API_KEY     ?? '';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID ?? '';
const GHL_BASE        = 'https://services.leadconnectorhq.com';

/** Plan → GHL tag mapping */
export const PLAN_TAGS: Record<string, string> = {
  free:  'gascap-free',
  pro:   'gascap-pro',
  fleet: 'gascap-fleet',
};

/** All plan tags (used for cleanup before adding the new one) */
const ALL_PLAN_TAGS = Object.values(PLAN_TAGS);

function ghlHeaders() {
  return {
    'Authorization': `Bearer ${GHL_API_KEY}`,
    'Content-Type':  'application/json',
    'Version':       '2021-07-28',
  };
}

function isConfigured(): boolean {
  return !!GHL_API_KEY && !!GHL_LOCATION_ID;
}

// ── Contact upsert ────────────────────────────────────────────────────────

export interface GhlContactInput {
  name:         string;
  email:        string;
  plan?:        'free' | 'pro' | 'fleet';
  isBeta?:      boolean;
  source?:      string;
  phone?:       string;
  locale?:      'en' | 'es';  // signup language — used for workflow branching in GHL
  extraTags?:   string[];     // any additional tags to apply
}

/**
 * Create or update a GasCap contact in GHL.
 * - Looks up by email first; creates if not found, updates if found.
 * - Applies plan tag + beta tag automatically.
 * - Tags: gascap-free | gascap-pro | gascap-fleet, gascap-beta-tester, gascap
 */
export async function upsertGhlContact(input: GhlContactInput): Promise<boolean> {
  if (!isConfigured()) {
    console.warn('[GHL] Skipping — GHL_API_KEY or GHL_LOCATION_ID not set.');
    return false;
  }

  try {
    const [firstName, ...rest] = input.name.trim().split(' ');
    const lastName = rest.join(' ') || '';

    const langTag = input.locale === 'es' ? 'gascap-lang-es' : 'gascap-lang-en';

    const tags = [
      'gascap',
      langTag,
      ...(input.plan ? [PLAN_TAGS[input.plan] ?? 'gascap-free'] : []),
      ...(input.isBeta ? ['gascap-beta-tester'] : []),
      ...(input.extraTags ?? []),
    ];

    const customFields: { key: string; field_value: string }[] = [];
    if (input.plan)   customFields.push({ key: 'gascap_plan',   field_value: input.plan });
    if (input.locale) customFields.push({ key: 'gascap_locale', field_value: input.locale });

    const body: Record<string, unknown> = {
      locationId: GHL_LOCATION_ID,
      firstName,
      lastName,
      email:      input.email,
      tags,
      source:     input.source ?? 'GasCap App',
      ...(customFields.length > 0 ? { customFields } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
    };

    // Try upsert endpoint first (creates or updates by email)
    const res = await fetch(`${GHL_BASE}/contacts/upsert`, {
      method:  'POST',
      headers: ghlHeaders(),
      body:    JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[GHL] upsert failed:', res.status, err);
      return false;
    }

    const data = await res.json() as { contact?: { id?: string } };
    console.log(`[GHL] Contact upserted: ${input.email} → ${data.contact?.id}`);
    return true;
  } catch (err) {
    console.error('[GHL] upsert error:', err);
    return false;
  }
}

// ── Tag removal ──────────────────────────────────────────────────────────

/**
 * Remove specific tags from a contact (looked up by email).
 */
export async function removeGhlTags(email: string, tagsToRemove: string[]): Promise<boolean> {
  if (!isConfigured()) return false;
  try {
    const searchRes = await fetch(
      `${GHL_BASE}/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`,
      { headers: ghlHeaders() },
    );
    if (!searchRes.ok) return false;
    const searchData = await searchRes.json() as { contact?: { id?: string } };
    const contactId  = searchData.contact?.id;
    if (!contactId) return false;

    const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
      method:  'PUT',
      headers: ghlHeaders(),
      body:    JSON.stringify({ removeTag: tagsToRemove }),
    });
    return res.ok;
  } catch (err) {
    console.error('[GHL] removeGhlTags error:', err);
    return false;
  }
}

// ── Campaign attribution ──────────────────────────────────────────────────

/**
 * Derive a consistent set of GHL tags for a placement code so that the
 * QR pilot campaign can drive automations / segmentation in GHL.
 */
export interface CampaignAttribution {
  placementCode:    string;
  station?:         string;
  city?:            string;
  placement?:       string;
  headlineVariant?: string;
  campaign?:        string;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function buildCampaignTags(a: CampaignAttribution): string[] {
  const tags: string[] = ['gascap-qr-pilot', `gascap-code-${slug(a.placementCode)}`];
  if (a.station)         tags.push(`gascap-station-${slug(a.station)}`);
  if (a.city)            tags.push(`gascap-city-${slug(a.city)}`);
  if (a.placement)       tags.push(`gascap-placement-${slug(a.placement)}`);
  if (a.headlineVariant) tags.push(`gascap-headline-${slug(a.headlineVariant)}`);
  if (a.campaign)        tags.push(`gascap-campaign-${slug(a.campaign)}`);
  return tags;
}

/**
 * Convenience: upsert a contact AND attach campaign attribution tags +
 * GHL custom fields in a single call. Use this from signup / lead capture
 * when an attribution cookie is present.
 */
export async function upsertGhlContactWithCampaign(
  contact: GhlContactInput,
  attribution: CampaignAttribution,
): Promise<boolean> {
  const campaignTags = buildCampaignTags(attribution);
  return upsertGhlContact({
    ...contact,
    extraTags: [...(contact.extraTags ?? []), ...campaignTags],
    source:    contact.source ?? `GasCap QR — ${attribution.station ?? attribution.placementCode}`,
  });
}

// ── Plan tag update ───────────────────────────────────────────────────────

/**
 * Update a contact's plan tag when they upgrade/downgrade.
 * Removes all plan tags then adds the correct one.
 */
export async function updateGhlContactPlan(
  email: string,
  newPlan: 'free' | 'pro' | 'fleet',
): Promise<boolean> {
  if (!isConfigured()) return false;

  try {
    // 1. Find contact by email
    const searchRes = await fetch(
      `${GHL_BASE}/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`,
      { headers: ghlHeaders() },
    );

    if (!searchRes.ok) return false;
    const searchData = await searchRes.json() as { contact?: { id?: string } };
    const contactId  = searchData.contact?.id;
    if (!contactId) {
      // Contact doesn't exist yet — upsert instead
      return false;
    }

    // 2. Remove all plan tags, add new one
    const removeTags = ALL_PLAN_TAGS.filter((t) => t !== PLAN_TAGS[newPlan]);
    const addTags    = [PLAN_TAGS[newPlan]];

    const updateRes = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
      method:  'PUT',
      headers: ghlHeaders(),
      body:    JSON.stringify({
        tags:        addTags,
        removeTag:   removeTags,
        customFields: [{ key: 'gascap_plan', field_value: newPlan }],
      }),
    });

    if (!updateRes.ok) {
      console.error('[GHL] plan update failed:', await updateRes.text());
      return false;
    }

    console.log(`[GHL] Plan updated: ${email} → ${newPlan}`);
    return true;
  } catch (err) {
    console.error('[GHL] plan update error:', err);
    return false;
  }
}
