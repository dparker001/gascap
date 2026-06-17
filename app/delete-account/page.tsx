import StaticPageHeader from '@/components/StaticPageHeader';
import DeleteAccountPanel from '@/components/DeleteAccountPanel';

export const metadata = {
  title: 'Delete Your Account — GasCap™',
  description: 'How to request deletion of your GasCap™ account and associated data.',
};

export default function DeleteAccountPage() {
  return (
    <div className="min-h-screen bg-[#eef1f7]">

      <StaticPageHeader />

      <div className="max-w-2xl mx-auto px-5 py-10 pb-20">
        <h1 className="text-3xl font-black text-navy-700 mb-1">Delete Your Account</h1>
        <p className="text-xs text-slate-500 mb-1">
          <strong>Gas Capacity LLC</strong> (GasCap™) · 7901 4th St N STE 300, St. Petersburg, FL 33702 ·{' '}
          <a href="mailto:admin@gascap.app" className="text-amber-600 hover:underline">admin@gascap.app</a>
          {' · '}
          <a href="tel:+13215131321" className="text-amber-600 hover:underline">(321) 513-1321</a>
        </p>
        <p className="text-sm text-slate-400 mb-8">Last updated: June 15, 2026</p>

        <div className="space-y-8 text-slate-700 text-sm leading-relaxed">

          <section>
            <p>
              You can permanently delete your GasCap™ account and all associated personal data
              at any time, right here. Deletion is immediate and cannot be undone.
            </p>
          </section>

          {/* Self-service deletion — instant, in-app (App Store 5.1.1) */}
          <DeleteAccountPanel />

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">Prefer to email us?</h2>
            <p>
              You can also request deletion by emailing{' '}
              <a href="mailto:admin@gascap.app?subject=Delete%20my%20account" className="text-amber-600 hover:underline font-semibold">admin@gascap.app</a>{' '}
              <strong>from the email address on your account</strong> with the subject
              &ldquo;Delete my account.&rdquo; Emailed requests are processed within{' '}
              <strong>30 days</strong> (usually much sooner). The fastest way is the button above.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">What is deleted</h2>
            <p>When your account is deleted, we remove:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Your account and login credentials</li>
              <li>Your profile information (name, email address, phone number, display name)</li>
              <li>Your saved vehicles</li>
              <li>Your fill-up history and calculation history</li>
              <li>Your preferences and settings</li>
              <li>Your referral data and monthly giveaway entries</li>
              <li>Your email and SMS subscription records</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">What may be retained</h2>
            <p>
              We retain a limited set of records only where required by law or for legitimate
              business purposes — for example, transaction and payment records needed for tax,
              accounting, or fraud-prevention obligations. These are kept only as long as legally
              required and are then deleted. Any data we retain in aggregated or anonymized form
              no longer identifies you.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-black text-navy-700 mb-2">Questions</h2>
            <p>
              Contact us at{' '}
              <a href="mailto:admin@gascap.app" className="text-amber-600 hover:underline font-semibold">admin@gascap.app</a>{' '}
              or visit our{' '}
              <a href="/contact" className="text-amber-600 hover:underline">contact page</a>.
              See also our{' '}
              <a href="/privacy" className="text-amber-600 hover:underline">Privacy Policy</a>.
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}
