import Link from 'next/link';
import StaticPageHeader from '@/components/StaticPageHeader';

export const metadata = { title: 'Terms of Service — GasCap™' };

const YEAR = new Date().getFullYear();

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#eef1f7]">

      <StaticPageHeader active="terms" />

      <div className="max-w-2xl mx-auto px-5 py-10 pb-20">
        <h1 className="text-3xl font-black text-navy-700 mb-1">Terms of Service</h1>
        <p className="text-xs text-slate-500 mb-1">
          <strong>Gas Capacity LLC</strong> · 16260 Bristol Lake Circle, Orlando, FL 32828 ·{' '}
          <a href="mailto:admin@gascap.app" className="text-amber-600 hover:underline">admin@gascap.app</a>
        </p>
        <p className="text-sm text-slate-400 mb-8">Last updated: April 29, 2026</p>

        <div className="space-y-8 text-slate-700 text-sm leading-relaxed">

          {/* 1 */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">1. Acceptance of Terms</h2>
            <p>By accessing or using GasCap™ ("the Service"), operated by Gas Capacity LLC, you agree to be bound by these Terms of Service and our <Link href="/privacy" className="text-amber-600 hover:underline">Privacy Policy</Link>. If you do not agree, please do not use the Service.</p>
          </section>

          {/* 2 */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">2. Description of Service</h2>
            <p>GasCap™ is a fuel cost calculator and vehicle management tool that helps you estimate fuel costs, track fill-ups, and manage vehicle information. The Service includes free and paid subscription tiers with the following features:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Free:</strong> 1 saved vehicle, fuel calculators (Target Fill &amp; By Budget), EPA vehicle database, live gas price lookup, offline use, badge achievements.</li>
              <li><strong>Pro ($4.99/mo or $49/yr):</strong> Up to 3 saved vehicles, VIN photo scan, fill-up history &amp; MPG tracking, pump receipt scan, fuel savings dashboard, streak counter, monthly report card, gas price predictions, vehicle health alerts, fill-up reminders, Annual Wrapped, and referral rewards.</li>
              <li><strong>Fleet ($19.99/mo or $199/yr):</strong> Unlimited vehicles, up to 25 drivers, fleet-wide fuel dashboard, per-vehicle and per-driver reporting, bulk vehicle import, and driver management.</li>
            </ul>
            <p className="mt-2">Feature availability may change over time. We will notify users of significant changes via email or in-app notice.</p>
          </section>

          {/* 3 */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">3. User Accounts</h2>
            <p>You are responsible for maintaining the confidentiality of your account credentials and for all activity under your account. You must provide accurate information when creating an account and keep it up to date. You must be at least 13 years old to create an account. You must be at least <strong>18 years old</strong> to opt into SMS communications (see Section 7c).</p>
          </section>

          {/* 4 */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">4. Paid Subscriptions</h2>
            <p>Pro and Fleet plan subscriptions are billed monthly or annually through Stripe. You may cancel at any time; your access continues until the end of the current billing period. You can upgrade your plan directly from the Settings page within the app or by visiting{' '}<Link href="/upgrade" className="text-amber-600 hover:underline">gascap.app/upgrade</Link>. We reserve the right to change pricing with 30 days&apos; notice.</p>
          </section>

          {/* 5 */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">5. Ambassador Program &amp; Referral Rewards</h2>
            <p>GasCap™ operates an Ambassador Program that allows users to earn rewards by referring new users who become paying subscribers. Referral progress is measured in <strong>cumulative paying referrals</strong> — the total number of individuals who have signed up using your unique referral link and subsequently activated a paid GasCap™ Pro or Fleet subscription. Free sign-ups that never become paying subscribers do not count. The following terms apply:</p>
            <p className="mt-2"><strong>Tier Thresholds &amp; Rewards</strong></p>
            <ul className="list-disc pl-5 space-y-1 mt-1">
              <li><strong>Supporter (5+ cumulative paying referrals):</strong> Earns one (1) free month of Pro for each paying referral credited at month-end, plus two (2) daily drawing entries per active day, plus exemption from the monthly drawing&apos;s consecutive-win eligibility restriction.</li>
              <li><strong>Ambassador (15+ cumulative paying referrals):</strong> Earns a permanent complimentary GasCap™ Pro subscription for as long as the account remains in good standing, plus three (3) daily drawing entries, plus consecutive-win exemption. This milestone is cumulative and permanent — it is not revoked if referred users subsequently cancel their subscriptions.</li>
              <li><strong>Elite Ambassador (30+ cumulative paying referrals):</strong> Earns all Ambassador benefits plus recognition in the app&apos;s Top Ambassadors list, early feature access, and a personal acknowledgment from the founder, plus five (5) daily drawing entries.</li>
            </ul>
            <p className="mt-2"><strong>Month-End Snapshots.</strong> Tier status is determined by a snapshot of each user&apos;s cumulative paying referral count taken on the last day of each calendar month. A new tier unlocked during a given month&apos;s snapshot takes effect for the following month&apos;s drawing entry multiplier.</p>
            <p className="mt-2"><strong>Additional Terms</strong></p>
            <ul className="list-disc pl-5 space-y-1 mt-1">
              <li>Supporter-tier free Pro month credits have no cash value, are non-transferable, and are applied automatically to the account.</li>
              <li>The complimentary Pro subscription at Ambassador and Elite tiers remains active only while the account is in good standing and not in violation of these Terms of Service.</li>
              <li>Fraudulent referrals (self-referrals, fake accounts, coordinated sign-up abuse, etc.) will result in forfeiture of all credits and tier status, and may result in account termination.</li>
              <li>GasCap™ reserves the right to modify or discontinue the Ambassador Program at any time with 30 days&apos; notice to affected tier holders.</li>
            </ul>
          </section>

          {/* 7 */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">7. Push Notifications &amp; Fill-Up Reminders</h2>
            <p>If you enable push notifications, GasCap™ may send you service-related alerts, gas price updates, weekly digests, fill-up reminders, and promotional messages.</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Fill-Up Reminders:</strong> Pro and Fleet users may configure automatic push reminders to log fill-ups on a weekly (7-day) or bi-weekly (14-day) schedule. Reminders are sent only if you haven&apos;t logged a fill-up within the selected interval.</li>
              <li>Reminders require push notifications to be enabled on your device and within the app.</li>
              <li>You may disable fill-up reminders or all push notifications at any time from the Share tab in the Tools panel or from your device settings.</li>
            </ul>
          </section>

          {/* 7b */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">7b. Streak Reward Credits</h2>
            <p>Users who maintain consecutive daily usage streaks may earn free Pro month credits at the following milestones: 30, 90, 180, and 365 consecutive days. The following terms apply:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Each milestone may only be earned once per user account.</li>
              <li>Streak credits are valid for 12 months from the date earned and expire if not redeemed.</li>
              <li>Breaking the streak resets the day counter, but previously earned credits are retained.</li>
              <li>Credits have no cash value, are non-transferable, and may only be redeemed toward an active paid subscription.</li>
              <li>GasCap™ reserves the right to modify or discontinue the streak rewards program at any time with reasonable notice.</li>
            </ul>
          </section>

          {/* 7c — SMS (required for A2P) */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">7c. SMS &amp; Text Message Communications</h2>
            <p>Gas Capacity LLC may send text (SMS) messages to users and contacts who have opted into SMS communications through the GasCap™ website contact form (<Link href="/contact" className="text-amber-600 hover:underline">gascap.app/contact</Link>) or the in-app Settings page.</p>

            <p className="mt-2"><strong>SMS Use Cases</strong></p>
            <p className="mt-1">SMS messages sent by Gas Capacity LLC may include:</p>
            <ul className="list-disc pl-5 space-y-1 mt-1">
              <li>Account notifications (plan changes, billing confirmations, account alerts)</li>
              <li>Gas price alerts when prices drop below your configured threshold</li>
              <li>Fill-up reminders to help you maintain your fuel tracking habit</li>
              <li>Service updates, feature announcements, and operational communications</li>
              <li>Marketing or promotional messages (only if you have separately consented to marketing messages)</li>
            </ul>

            <p className="mt-3"><strong>Age Requirement</strong></p>
            <p className="mt-1">You must be at least <strong>18 years of age</strong> to opt into SMS communications from Gas Capacity LLC. By providing your phone number and opting in, you represent that you are 18 or older.</p>

            <p className="mt-3"><strong>Message Frequency &amp; Data Rates</strong></p>
            <p className="mt-1">Message frequency varies based on your account activity, alert settings, and preferences. <strong>Standard message and data rates may apply</strong> depending on your mobile carrier plan. Gas Capacity LLC is not responsible for any charges incurred through your mobile carrier.</p>

            <p className="mt-3"><strong>Opt-Out Instructions</strong></p>
            <p className="mt-1">You may opt out of SMS communications at any time by:</p>
            <ul className="list-disc pl-5 space-y-1 mt-1">
              <li>Replying <strong>STOP</strong> to any SMS message from us — you will receive one final confirmation message and no further SMS will be sent</li>
              <li>Navigating to <strong>Settings → Profile → SMS Notifications</strong> within the GasCap™ app and unchecking the SMS opt-in checkbox</li>
            </ul>

            <p className="mt-3"><strong>Customer Support</strong></p>
            <p className="mt-1">Reply <strong>HELP</strong> to any SMS message for assistance. You may also contact us at:</p>
            <ul className="list-none pl-0 mt-1 space-y-0.5">
              <li>Email: <a href="mailto:admin@gascap.app" className="text-amber-600 hover:underline">admin@gascap.app</a></li>
              <li>Web: <Link href="/contact" className="text-amber-600 hover:underline">gascap.app/contact</Link></li>
              <li>Mail: Gas Capacity LLC, 16260 Bristol Lake Circle, Orlando, FL 32828</li>
            </ul>

            <p className="mt-3"><strong>Carrier Disclaimer</strong></p>
            <p className="mt-1">Carriers (including but not limited to AT&amp;T, T-Mobile, Verizon, and Sprint) are not liable for delayed or undelivered SMS messages. Delivery of SMS messages is subject to effective transmission from your mobile operator.</p>

            <p className="mt-3"><strong>Privacy</strong></p>
            <p className="mt-1">Your mobile phone number and SMS opt-in status will not be shared with third parties for their own marketing purposes. See our full <Link href="/privacy" className="text-amber-600 hover:underline">Privacy Policy</Link> — specifically Section 5a — for complete details on mobile information handling.</p>
          </section>

          {/* 8 */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">8. Acceptable Use</h2>
            <p>You agree not to misuse the Service, including but not limited to: attempting to gain unauthorized access, distributing malware, scraping data, submitting fraudulent referrals, or using the Service for any unlawful purpose.</p>
          </section>

          {/* 9 */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">9. Disclaimers</h2>
            <p>Gas price data is provided by the U.S. Energy Information Administration (EIA) and may not reflect real-time local prices. Fuel estimates are approximate and for informational purposes only. The Service is provided "as is" without warranties of any kind.</p>
          </section>

          {/* 10 */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">10. Limitation of Liability</h2>
            <p>To the maximum extent permitted by law, Gas Capacity LLC shall not be liable for any indirect, incidental, or consequential damages arising from your use of the Service.</p>
          </section>

          {/* 11 */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">11. Governing Law</h2>
            <p>These Terms are governed by the laws of the State of Florida, without regard to conflict of law principles. Any disputes shall be resolved in the courts of Orange County, Florida.</p>
          </section>

          {/* 12 */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">12. Changes to Terms</h2>
            <p>We may update these Terms from time to time. Continued use of the Service after changes constitutes acceptance of the new Terms. We will notify users of material changes via email.</p>
          </section>

          {/* 13 */}
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">13. Contact</h2>
            <p>Questions about these Terms? Contact us:</p>
            <ul className="list-none pl-0 space-y-0.5 mt-2">
              <li><strong>Gas Capacity LLC</strong></li>
              <li>16260 Bristol Lake Circle, Orlando, FL 32828</li>
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
            <Link href="/privacy" className="hover:text-amber-600">Privacy Policy</Link>
            <Link href="/contact" className="hover:text-amber-600">Contact</Link>
            <Link href="/help"    className="hover:text-amber-600">Help</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
