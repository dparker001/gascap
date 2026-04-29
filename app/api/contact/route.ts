import { NextRequest, NextResponse } from 'next/server';
import { upsertGhlContact } from '@/lib/ghl';

/**
 * POST /api/contact
 * Accepts a public contact form submission, upserts the contact in GHL,
 * and applies appropriate tags based on SMS / marketing consent.
 */
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    firstName?:        string;
    lastName?:         string;
    email?:            string;
    phone?:            string;
    message?:          string;
    smsConsent?:       boolean;
    marketingConsent?: boolean;
  };

  if (!body.email || !body.email.includes('@')) {
    return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
  }

  const firstName = (body.firstName ?? '').trim();
  const lastName  = (body.lastName  ?? '').trim();
  const name      = [firstName, lastName].filter(Boolean).join(' ') || body.email;

  const extraTags: string[] = ['gascap-contact-form'];
  if (body.smsConsent)       extraTags.push('gascap-sms-optin');
  if (body.marketingConsent) extraTags.push('gascap-marketing-consent');

  try {
    await upsertGhlContact({
      name,
      email:     body.email,
      phone:     body.phone ?? '',
      source:    'GasCap Contact Form',
      extraTags,
    });
  } catch (e) {
    console.error('[Contact] GHL sync failed:', e);
    // Still return success to the user — the important part is capturing intent
  }

  return NextResponse.json({ ok: true });
}
