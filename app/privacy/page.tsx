import Link from 'next/link';
import StaticPageHeader from '@/components/StaticPageHeader';

export const metadata = { title: 'Privacy Policy — GasCap™' };

const YEAR = new Date().getFullYear();

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#eef1f7]">

      <StaticPageHeader active="privacy" />

      <div className="max-w-2xl mx-auto px-5 py-10 pb-20">
        <h1 className="text-3xl font-black text-navy-700 mb-2">Privacy Policy</h1>
        <p className="text-sm text-slate-400 mb-8">Last updated: March 31, 2026</p>

        <div className="space-y-8 text-slate-700 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">1. Information We Collect</h2>
            <p>We collect information you provide when creating an account (name, email, password, and optionally phone number) and when using the Service (vehicle information, fill-up logs, calculation history). We also collect basic usage data to improve the Service.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">2. How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>To provide and operate the Service</li>
              <li>To send account-related emails (verification, password reset, receipts)</li>
              <li>To send push notifications if you have opted in (gas price alerts, weekly digests, service updates)</li>
              <li>To process payments through Stripe</li>
              <li>To administer the referral and beta programs</li>
              <li>To sync your contact information with our CRM (GoHighLevel) for marketing communications — you may opt out at any time</li>
              <li>To improve features and fix issues</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">3. Data Storage</h2>
            <p>Your data is stored on secure servers hosted on Railway (US region). Passwords are hashed using bcrypt and are never stored in plain text. We retain your data for as long as your account is active.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">4. Third-Party Services</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Stripe</strong> — payment processing. Your payment details are handled directly by Stripe and never stored on our servers.</li>
              <li><strong>U.S. Energy Information Administration (EIA)</strong> — gas price data. No personal data is shared.</li>
              <li><strong>NHTSA / fueleconomy.gov</strong> — vehicle data lookups. No personal data is shared.</li>
              <li><strong>Resend</strong> — transactional email delivery.</li>
              <li><strong>Anthropic Claude</strong> — AI-powered fuel advisor, receipt and VIN scanning (Pro feature). Data is processed and not stored beyond the duration of the request.</li>
              <li><strong>GoHighLevel (GHL)</strong> — CRM and marketing automation. Your name, email, phone (if provided), and plan status may be synced to GHL to manage communications. No payment data is shared.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">5. Push Notifications</h2>
            <p>If you enable push notifications, we store a push subscription token associated with your account. This token is used solely to deliver notifications to your device. You may revoke this permission at any time from your device settings or within the app under Settings.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">6. Referral Program</h2>
            <p>When you participate in the referral program, your referral code is associated with your account. We track which users signed up using your code in order to credit your account with referral rewards. No sensitive personal data is shared with referred users.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">7. Your Rights</h2>
            <p>You may request deletion of your account and data at any time by contacting us at <a href="mailto:hello@gascap.app" className="text-amber-600 hover:underline">hello@gascap.app</a>. You may also update or correct your information from within the app under Settings.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">8. Cookies</h2>
            <p>We use session cookies for authentication (via NextAuth.js). We do not use tracking or advertising cookies.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">9. Children's Privacy</h2>
            <p>The Service is not directed to children under 13. We do not knowingly collect personal information from children under 13.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">10. Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. We will notify you of material changes via email or a prominent notice on the Service.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">11. Contact</h2>
            <p>Questions about this Privacy Policy? Email us at <a href="mailto:hello@gascap.app" className="text-amber-600 hover:underline">hello@gascap.app</a>.</p>
          </section>
        </div>

        <div className="mt-10 pt-6 border-t border-slate-200 flex items-center justify-between gap-4 text-xs text-slate-400">
          <span>© {YEAR} GasCap™ — All rights reserved.</span>
          <div className="flex gap-4">
            <Link href="/terms" className="hover:text-amber-600">Terms of Service</Link>
            <Link href="/help"  className="hover:text-amber-600">Help</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
