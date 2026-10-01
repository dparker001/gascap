/**
 * $20 Gift Campaign — native-shell Stripe guard (ChatGPT review item 1).
 *
 * The native iOS/Android shells load the live site, so the SERVER-rendered
 * HTML of /gift/20 is what a native WebView paints first. That HTML must not
 * contain the web/Stripe Lifetime purchase link: the CTA may only appear on
 * the client after detection confirms a normal browser.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { translations } from '@/lib/translations';

vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'unauthenticated', data: null }) }));
vi.mock('@/contexts/LanguageContext', () => ({ useTranslation: () => ({ t: translations.en, locale: 'en' }) }));
vi.mock('@/components/BrandBar', () => ({ default: () => null }));
vi.mock('@/components/CampaignTracker', () => ({ default: () => null }));

describe('/gift/20 server render', () => {
  it('contains no web/Stripe Lifetime purchase link before the environment is known', async () => {
    const { default: Gift20Landing } = await import('@/app/gift/20/Gift20Landing');
    const html = renderToString(React.createElement(Gift20Landing, { founderPhoto: null }));

    expect(html).toContain('I really did give you $20.');           // page did render
    expect(html).toContain('One purchase. GasCap Lifetime.');      // Lifetime section rendered…
    expect(html).not.toContain('/upgrade');                          // …but no checkout route
    expect(html).not.toContain('signup?next');
    expect(html).not.toContain('Get GasCap Lifetime');               // nor the CTA label
    expect(html).not.toContain(translations.en.gift20.lifetimeNativeNote); // nor the native note (env unknown)
  });

  it('collects no phone number (SMS opt-in not registered for /gift/20)', async () => {
    const { default: Gift20Landing } = await import('@/app/gift/20/Gift20Landing');
    const html = renderToString(React.createElement(Gift20Landing, { founderPhoto: '/marketing/gift20/don-parker.jpg' }));
    expect(html).not.toContain('type="tel"');
    expect(html).not.toMatch(/Reply STOP|Msg &amp; data/);
    expect(html).toContain('/marketing/gift20/don-parker.jpg');   // founder photo renders when present
  });
});
