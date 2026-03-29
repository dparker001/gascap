import Link from 'next/link';

export const metadata = { title: 'Privacy Policy — GasCap™' };

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#eef1f7]">
      <div className="bg-navy-700 px-5 py-4">
        <Link href="/" className="flex items-center gap-2.5 w-fit">
          <div className="w-8 h-8 rounded-xl bg-amber-500 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <rect x="2" y="6" width="11" height="16" rx="1.5" />
              <rect x="4" y="9" width="7" height="4" rx="0.75" />
              <path d="M13 8 L18 8 Q21 8 21 11 L21 16 Q21 18 19 18" />
              <circle cx="18.5" cy="18.5" r="1.5" />
            </svg>
          </div>
          <span className="text-white font-black text-lg">
            GasCap<sup className="text-amber-400 text-xs ml-0.5">™</sup>
          </span>
        </Link>
      </div>

      <div className="max-w-2xl mx-auto px-5 py-10 pb-20">
        <h1 className="text-3xl font-black text-navy-700 mb-2">Privacy Policy</h1>
        <p className="text-sm text-slate-400 mb-8">Last updated: March 29, 2026</p>

        <div className="space-y-8 text-slate-700 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">1. Information We Collect</h2>
            <p>We collect information you provide when creating an account (name, email, password) and when using the Service (vehicle information, fill-up logs, calculation history). We also collect basic usage data to improve the Service.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">2. How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>To provide and operate the Service</li>
              <li>To send account-related emails (verification, password reset, receipts)</li>
              <li>To process payments through Stripe</li>
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
              <li><strong>Resend / Gmail</strong> — transactional email delivery.</li>
              <li><strong>Anthropic Claude</strong> — AI-powered receipt and VIN scanning (Pro feature). Images are processed and not stored beyond the duration of the request.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">5. Your Rights</h2>
            <p>You may request deletion of your account and data at any time by contacting us at <a href="mailto:hello@gascap.app" className="text-amber-600 hover:underline">hello@gascap.app</a>. You may also update or correct your information from within the app.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">6. Cookies</h2>
            <p>We use session cookies for authentication (via NextAuth.js). We do not use tracking or advertising cookies.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">7. Children's Privacy</h2>
            <p>The Service is not directed to children under 13. We do not knowingly collect personal information from children under 13.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">8. Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. We will notify you of material changes via email or a prominent notice on the Service.</p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">9. Contact</h2>
            <p>Questions about this Privacy Policy? Email us at <a href="mailto:hello@gascap.app" className="text-amber-600 hover:underline">hello@gascap.app</a>.</p>
          </section>
        </div>

        <div className="mt-10 pt-6 border-t border-slate-200 flex gap-4 text-xs text-slate-400">
          <Link href="/terms" className="hover:text-amber-600">Terms of Service</Link>
          <Link href="/"      className="hover:text-amber-600">← Back to GasCap™</Link>
        </div>
      </div>
    </div>
  );
}
