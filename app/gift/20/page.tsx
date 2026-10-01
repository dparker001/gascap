/**
 * /gift/20 — $20 Gift Campaign landing page (docs/GIFT20_CAMPAIGN_SPEC.md).
 *
 * Reached from the QR on Don's handed-out cards via /q/GIFT01…GIFT10 (which
 * logs the scan and sets the gc_src attribution cookie), or typed directly.
 * Deliberately a separate static segment from /gift (the existing
 * buy-a-gift-for-someone checkout), which it must never replace.
 */
import fs from 'fs';
import path from 'path';
import type { Metadata } from 'next';
import Gift20Landing from './Gift20Landing';

export const metadata: Metadata = {
  title: 'My gift to you — GasCap™',
  description: "Don Parker's $20 gift: it's yours, no strings attached. And a look at GasCap, the app that tells you how much gas you actually need.",
  // A private 10-card field test — keep it out of search results.
  robots: { index: false, follow: false },
};

// Founder photo is dropped in by Don later; until then the page shows a
// tasteful initials placeholder. Checked at build time — adding the photo
// ships with the next deploy.
const FOUNDER_PHOTO = '/marketing/gift20/don-parker.jpg';
const hasFounderPhoto = fs.existsSync(path.join(process.cwd(), 'public', FOUNDER_PHOTO));

export default function Gift20Page() {
  return <Gift20Landing founderPhoto={hasFounderPhoto ? FOUNDER_PHOTO : null} />;
}
