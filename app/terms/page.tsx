import Link from 'next/link';
import StaticPageHeader from '@/components/StaticPageHeader';

export const metadata = { title: 'Terms of Service — GasCap™' };

const YEAR = new Date().getFullYear();

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#eef1f7]">

      <StaticPageHeader active="terms" />

      <div className="max-w-2xl mx-auto px-5 py-10 pb-20">
        <h1 className="text-3xl font-black text-navy-700 mb-2">Terms of Service</h1>
        <p className="text-sm text-slate-400 mb-8">Last updated: March 29, 2026</p>

        <div className="space-y-8 text-slate-700 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">1. Acceptance of Terms</h2>
            <p>By accessing or using GasCap™ ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, please do not use the Service.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">2. Description of Service</h2>
            <p>GasCap™ is a fuel cost calculator and vehicle management tool that helps you estimate fuel costs, track fill-ups, and manage vehicle information. The Service includes free and paid subscription tiers.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">3. User Accounts</h2>
            <p>You are responsible for maintaining the confidentiality of your account credentials and for all activity under your account. You must provide accurate information when creating an account and keep it up to date. You must be at least 13 years old to use the Service.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">4. Paid Subscriptions</h2>
            <p>Pro and Fleet plan subscriptions are billed monthly through Stripe. You may cancel at any time; your access continues until the end of the current billing period. We reserve the right to change pricing with 30 days' notice.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">5. Acceptable Use</h2>
            <p>You agree not to misuse the Service, including but not limited to: attempting to gain unauthorized access, distributing malware, scraping data, or using the Service for any unlawful purpose.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">6. Disclaimers</h2>
            <p>Gas price data is provided by the U.S. Energy Information Administration (EIA) and may not reflect real-time local prices. Fuel estimates are approximate and for informational purposes only. The Service is provided "as is" without warranties of any kind.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">7. Limitation of Liability</h2>
            <p>To the maximum extent permitted by law, GasCap™ shall not be liable for any indirect, incidental, or consequential damages arising from your use of the Service.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">8. Changes to Terms</h2>
            <p>We may update these Terms from time to time. Continued use of the Service after changes constitutes acceptance of the new Terms. We will notify users of material changes via email.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">9. Contact</h2>
            <p>Questions about these Terms? Email us at <a href="mailto:hello@gascap.app" className="text-amber-600 hover:underline">hello@gascap.app</a>.</p>
          </section>
        </div>

        <div className="mt-10 pt-6 border-t border-slate-200 flex items-center justify-between gap-4 text-xs text-slate-400">
          <span>© {YEAR} GasCap™ — All rights reserved.</span>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-amber-600">Privacy Policy</Link>
            <Link href="/help"    className="hover:text-amber-600">Help</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
