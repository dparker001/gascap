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
        <p className="text-sm text-slate-400 mb-8">Last updated: March 31, 2026</p>

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
            <h2 className="text-lg font-black text-navy-700 mb-2">5. Referral Program</h2>
            <p>GasCap™ offers a referral program that allows users to earn free months of Pro access by referring new users who sign up and verify their email address. The following terms apply:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Any user on any plan may refer others using their unique referral code.</li>
              <li>Referral credits (free Pro months) accumulate regardless of your current plan but may only be redeemed when you are on a paid Pro or Fleet subscription.</li>
              <li>Each verified referral earns one (1) free month of Pro access, up to a maximum of ten (10) months total.</li>
              <li>A maximum of three (3) referral months may be redeemed at one time.</li>
              <li>Unused referral credits expire six (6) months after they are earned.</li>
              <li>Referral credits have no cash value and are non-transferable.</li>
              <li>GasCap™ reserves the right to modify or discontinue the referral program at any time with reasonable notice.</li>
              <li>Fraudulent referrals (self-referrals, fake accounts, etc.) will result in forfeiture of all credits and may result in account termination.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">6. Beta Program</h2>
            <p>GasCap™ may offer beta access to select users. Beta participants receive a complimentary Pro trial for the duration specified at enrollment. Beta trials are non-transferable, have no cash value, and may be revoked at GasCap™'s discretion. Features available during beta testing may change or be removed prior to general release.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">7. Push Notifications</h2>
            <p>If you enable push notifications, GasCap™ may send you service-related alerts, gas price updates, weekly digests, and promotional messages. You may disable push notifications at any time from your device or account Settings.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">8. Acceptable Use</h2>
            <p>You agree not to misuse the Service, including but not limited to: attempting to gain unauthorized access, distributing malware, scraping data, or using the Service for any unlawful purpose.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">9. Disclaimers</h2>
            <p>Gas price data is provided by the U.S. Energy Information Administration (EIA) and may not reflect real-time local prices. Fuel estimates are approximate and for informational purposes only. The Service is provided "as is" without warranties of any kind.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">10. Limitation of Liability</h2>
            <p>To the maximum extent permitted by law, GasCap™ shall not be liable for any indirect, incidental, or consequential damages arising from your use of the Service.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">11. Changes to Terms</h2>
            <p>We may update these Terms from time to time. Continued use of the Service after changes constitutes acceptance of the new Terms. We will notify users of material changes via email.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">12. Contact</h2>
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
