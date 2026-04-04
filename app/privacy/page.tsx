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
        <p className="text-sm text-slate-400 mb-8">Last updated: April 3, 2026 (rev. 2)</p>

        <div className="space-y-8 text-slate-700 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">1. Information We Collect</h2>
            <p>We collect information you provide when creating an account (name, email, password, and optionally phone number) and when using the Service (vehicle information, fill-up logs, calculation history). We also collect basic activity data to improve the Service, including:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Login count and last login timestamp</li>
              <li>Number of calculations performed</li>
              <li>Active usage days and current streak</li>
              <li>Fill-up log count and most recent fill-up date</li>
            </ul>
            <p className="mt-2">This activity data is used to display personalized stats within the app (e.g., streak counter, savings dashboard) and to help us understand how the Service is being used.</p>
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
              <li><strong>Anthropic Claude</strong> — AI-powered fuel advisor, receipt scanning, VIN scanning, and fuel gauge scanning (Pro feature). Images and text are processed transiently and not stored beyond the duration of the request.</li>
              <li><strong>GoHighLevel (GHL)</strong> — CRM and marketing automation. Your name, email, phone (if provided), and plan status may be synced to GHL to manage communications. No payment data is shared.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">5. Push Notifications</h2>
            <p>If you enable push notifications, we store a push subscription token associated with your account. This token is used solely to deliver notifications to your device. Notification types may include:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Gas price alerts and weekly digests</li>
              <li>Fill-up reminders (if configured — weekly or bi-weekly)</li>
              <li>Service updates and announcements</li>
            </ul>
            <p className="mt-2">You may revoke push notification permission at any time from your device settings or from within the app under Settings → Share tab. Disabling push notifications will also disable fill-up reminders.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">6. Referral Program &amp; Leaderboard</h2>
            <p>When you participate in the referral program, your referral code is associated with your account. We track which users signed up using your code in order to credit your account with referral rewards. Your referral count and milestone badges may be displayed within the app. No sensitive personal data is shared with referred users.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">6a. Annual Wrapped</h2>
            <p>The Annual Wrapped feature compiles your fill-up history and activity data from the current calendar year into a personal summary (total spend, gallons, fill-up count, best/worst months, top vehicle, and estimated miles). This summary is computed entirely from your own stored data and is displayed only to you. If you choose to share your Wrapped summary, the text is copied to your clipboard — no data is automatically posted or transmitted to any third party.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">6b. Streak Reward Credits</h2>
            <p>When you earn a streak milestone reward (free Pro month credit), the milestone, date earned, and expiry date are stored with your account. These credits are used solely to apply billing discounts upon request and are never shared with third parties.</p>
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
