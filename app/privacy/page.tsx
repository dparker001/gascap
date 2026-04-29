import Link from 'next/link';
import StaticPageHeader from '@/components/StaticPageHeader';

export const metadata = { title: 'Privacy Policy — GasCap™' };

const YEAR = new Date().getFullYear();

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#eef1f7]">

      <StaticPageHeader active="privacy" />

      <div className="max-w-2xl mx-auto px-5 py-10 pb-20">
        <h1 className="text-3xl font-black text-navy-700 mb-1">Privacy Policy</h1>
        <p className="text-xs text-slate-500 mb-1">
          <strong>Gas Capacity LLC</strong> · 7901 4th St N STE 300, St. Petersburg, FL 33702 ·{' '}
          <a href="mailto:admin@gascap.app" className="text-amber-600 hover:underline">admin@gascap.app</a>
          {' · '}
          <a href="tel:+13215131321" className="text-amber-600 hover:underline">(321) 513-1321</a>
        </p>
        <p className="text-sm text-slate-400 mb-8">Last updated: April 29, 2026 (rev. 4)</p>

        <div className="space-y-8 text-slate-700 text-sm leading-relaxed">

          {/* 1 */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">1. Information We Collect</h2>
            <p>We collect information you provide when creating an account (name, email, password, and optionally phone number and display name) and when using the Service (vehicle information, fill-up logs, calculation history). We also collect basic activity data to improve the Service, including:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Login count and last login timestamp</li>
              <li>Number of calculations performed</li>
              <li>Active usage days and current streak</li>
              <li>Fill-up log count and most recent fill-up date</li>
            </ul>
            <p className="mt-2">This activity data is used to display personalized stats within the app (e.g., streak counter, savings dashboard) and to help us understand how the Service is being used.</p>
          </section>

          {/* 2 */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">2. How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>To provide and operate the Service</li>
              <li>To send account-related emails (verification, password reset, receipts)</li>
              <li>To send push notifications if you have opted in (gas price alerts, weekly digests, service updates)</li>
              <li>To send SMS text messages if you have opted in (see Section 5a)</li>
              <li>To process payments through Stripe</li>
              <li>To administer the referral and Ambassador programs</li>
              <li>To sync your contact information with our CRM (GoHighLevel) for marketing communications — you may opt out at any time</li>
              <li>To improve features and fix issues</li>
            </ul>
          </section>

          {/* 3 */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">3. Data Security &amp; Storage</h2>
            <p>Your data is stored on secure servers hosted on Railway (US region). We implement commercially reasonable technical and organizational safeguards to protect your personal information, including:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Passwords are hashed using bcrypt and are never stored in plain text</li>
              <li>All data transmissions use HTTPS/TLS encryption</li>
              <li>Access to production systems is restricted to authorized personnel only</li>
              <li>API keys and secrets are stored as environment variables, never in source code</li>
            </ul>
            <p className="mt-2">We retain your data for as long as your account is active. If you request account deletion, we will remove your personal data within a reasonable time, except where retention is required by law.</p>
          </section>

          {/* 4 */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">4. Third-Party Services</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Stripe</strong> — payment processing. Your payment details are handled directly by Stripe and never stored on our servers.</li>
              <li><strong>U.S. Energy Information Administration (EIA)</strong> — gas price data. No personal data is shared.</li>
              <li><strong>NHTSA / fueleconomy.gov</strong> — vehicle data lookups. No personal data is shared.</li>
              <li><strong>Resend</strong> — transactional email delivery. Your email address is shared solely for delivery purposes.</li>
              <li><strong>Anthropic Claude</strong> — AI-powered fuel advisor, receipt scanning, VIN scanning, and fuel gauge scanning (Pro feature). Images and text are processed transiently and not stored beyond the duration of the request.</li>
              <li><strong>GoHighLevel (GHL)</strong> — CRM and marketing automation. Your name, email, phone (if provided), and plan status may be synced to GHL to manage communications. No payment data is shared.</li>
              <li><strong>OneSignal</strong> — push notification delivery. A device token is associated with your account if you enable push notifications.</li>
              <li><strong>Google Analytics</strong> — aggregate website usage analytics. No personally identifiable information is shared with Google Analytics.</li>
              <li><strong>Meta (Facebook) Pixel</strong> — conversion tracking and ad performance measurement. See Section 8 for details.</li>
            </ul>
          </section>

          {/* 5 */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">5. Push Notifications</h2>
            <p>If you enable push notifications, we store a push subscription token associated with your account. This token is used solely to deliver notifications to your device. Notification types may include:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Gas price alerts and weekly digests</li>
              <li>Fill-up reminders (if configured — weekly or bi-weekly)</li>
              <li>Service updates and announcements</li>
            </ul>
            <p className="mt-2">You may revoke push notification permission at any time from your device settings or from within the app under Settings → Share tab.</p>
          </section>

          {/* 5a — SMS (required for A2P) */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">5a. SMS &amp; Text Message Communications</h2>
            <p>If you provide your phone number and opt into SMS communications — either through your account Settings page or through our Contact form at <Link href="/contact" className="text-amber-600 hover:underline">gascap.app/contact</Link> — Gas Capacity LLC may send you text messages. SMS message types include:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Account notifications (e.g., plan changes, billing alerts)</li>
              <li>Gas price alerts when prices drop below your configured threshold</li>
              <li>Fill-up reminders to help you maintain your fuel tracking habit</li>
              <li>Service updates and feature announcements</li>
              <li>Promotional messages and special offers (marketing messages only if separately consented)</li>
            </ul>
            <p className="mt-2"><strong>Message frequency</strong> varies based on your account activity and preferences. Standard message and data rates may apply.</p>
            <p className="mt-2"><strong>To opt out:</strong> Reply <strong>STOP</strong> to any SMS message. You will receive one final confirmation and no further messages will be sent. To opt out within the app, go to Settings → Profile → SMS Notifications and uncheck the opt-in box.</p>
            <p className="mt-2"><strong>For assistance:</strong> Reply <strong>HELP</strong> to any SMS message, or contact us at <a href="mailto:admin@gascap.app" className="text-amber-600 hover:underline">admin@gascap.app</a>.</p>

            <div className="mt-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
              <p className="font-semibold text-slate-700 mb-1">Mobile Information Sharing Statement</p>
              <p className="text-slate-600">We do not sell, share, or rent your mobile phone number or SMS opt-in consent to any third party for their own marketing purposes. Mobile information — including phone numbers and SMS consent status — collected through our website forms and in-app settings is used solely to communicate with you on behalf of Gas Capacity LLC and will not be shared with any affiliate, partner, or third party for marketing purposes without your express written consent.</p>
            </div>
          </section>

          {/* 6 */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">6. Ambassador Program &amp; Referral Tracking</h2>
            <p>When you participate in the Ambassador Program, your unique referral code is associated with your account. We track which users signed up and subsequently activated a paid subscription using your code in order to credit your account with Ambassador Program rewards. The following data is stored with your account:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Your cumulative paying referral count</li>
              <li>Your current Ambassador tier (Supporter, Ambassador, or Elite Ambassador)</li>
              <li>Tier-related rewards including complimentary Pro access status and drawing entry multiplier</li>
              <li>Month-end referral count snapshots used to determine tier eligibility</li>
            </ul>
            <p className="mt-2">Your referral count and Ambassador tier may be displayed within the app. No sensitive personal data is shared with referred users.</p>
          </section>

          {/* 6a */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">6a. Annual Wrapped</h2>
            <p>The Annual Wrapped feature compiles your fill-up history and activity data from the current calendar year into a personal summary (total spend, gallons, fill-up count, best/worst months, top vehicle, and estimated miles). This summary is computed entirely from your own stored data and is displayed only to you. If you choose to share your Wrapped summary, the text is copied to your clipboard — no data is automatically posted or transmitted to any third party.</p>
          </section>

          {/* 6b */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">6b. Streak Reward Credits</h2>
            <p>When you earn a streak milestone reward (free Pro month credit), the milestone, date earned, and expiry date are stored with your account. These credits are used solely to apply billing discounts upon request and are never shared with third parties.</p>
          </section>

          {/* 7 */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">7. Your Rights</h2>
            <p>You have the following rights with respect to your personal data:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Access:</strong> You may view the personal information stored in your account from within the app at any time.</li>
              <li><strong>Correction:</strong> You may update or correct your profile information (name, display name, phone) from Settings → Profile.</li>
              <li><strong>Deletion:</strong> You may request deletion of your account and all associated data by contacting us at <a href="mailto:admin@gascap.app" className="text-amber-600 hover:underline">admin@gascap.app</a>. We will process your request within a reasonable time.</li>
              <li><strong>Opt-out of marketing emails:</strong> You may opt out of marketing emails at any time by clicking the unsubscribe link in any email or contacting us directly.</li>
              <li><strong>Opt-out of SMS:</strong> Reply STOP to any text message or disable SMS from Settings → Profile.</li>
              <li><strong>Opt-out of push notifications:</strong> Revoke permission from your device settings or within the app.</li>
            </ul>
            <p className="mt-2">For any privacy-related requests or questions, contact us at <a href="mailto:admin@gascap.app" className="text-amber-600 hover:underline">admin@gascap.app</a>.</p>
          </section>

          {/* 8 */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">8. Cookies &amp; Tracking Technologies</h2>
            <p>We use the following cookies and tracking technologies:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Session cookies</strong> (via NextAuth.js) — used for authentication. These are strictly necessary and cannot be disabled without affecting your ability to log in.</li>
              <li><strong>Google Analytics</strong> — aggregate usage analytics to understand how visitors use the Service. This uses a first-party cookie. You may opt out using the <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer" className="text-amber-600 hover:underline">Google Analytics Opt-out Browser Add-on</a>.</li>
              <li><strong>Meta Pixel</strong> — conversion tracking to measure the effectiveness of our advertising on Facebook and Instagram. The Pixel sends anonymized event data (PageView) to Meta. You can manage your ad preferences at <a href="https://www.facebook.com/ads/preferences" target="_blank" rel="noopener noreferrer" className="text-amber-600 hover:underline">facebook.com/ads/preferences</a>.</li>
            </ul>
            <p className="mt-2">We do not use advertising cookies, tracking cookies from third-party ad networks, or cookies that track you across unrelated websites.</p>
          </section>

          {/* 9 */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">9. Children&apos;s Privacy</h2>
            <p>The Service is not directed to children under 13. We do not knowingly collect personal information from children under 13. SMS communications are available only to users who are 18 years of age or older.</p>
          </section>

          {/* 10 */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">10. Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. We will notify you of material changes via email or a prominent notice on the Service. Continued use of the Service after changes are posted constitutes your acceptance of the updated Policy.</p>
          </section>

          {/* 11 */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">11. Contact</h2>
            <p>Questions or concerns about this Privacy Policy? Contact us:</p>
            <ul className="list-none pl-0 space-y-0.5 mt-2">
              <li><strong>Gas Capacity LLC</strong></li>
              <li>7901 4th St N STE 300, St. Petersburg, FL 33702</li>
              <li>
                <a href="mailto:admin@gascap.app" className="text-amber-600 hover:underline">admin@gascap.app</a>
              </li>
              <li>
                <Link href="/contact" className="text-amber-600 hover:underline">gascap.app/contact</Link>
              </li>
            </ul>
          </section>

        </div>

        <div className="mt-10 pt-6 border-t border-slate-200 flex items-center justify-between gap-4 text-xs text-slate-400">
          <span>© {YEAR} Gas Capacity LLC — All rights reserved.</span>
          <div className="flex gap-4">
            <Link href="/terms"   className="hover:text-amber-600">Terms of Service</Link>
            <Link href="/contact" className="hover:text-amber-600">Contact</Link>
            <Link href="/help"    className="hover:text-amber-600">Help</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
