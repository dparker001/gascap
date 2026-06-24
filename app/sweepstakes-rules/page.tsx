import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Official Sweepstakes Rules — GasCap™',
  description: 'Official rules for the GasCap™ Weekly $25 Gas Card Giveaway.',
};

const PRIZE_VALUE = '$25';
const SPONSOR = 'Gas Capacity LLC';
const CONTACT_EMAIL = 'support@gascap.app';

export default function SweepstakesRulesPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-[#005F4A] pt-12 pb-8 px-5">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <Link href="/" className="text-white/60 hover:text-white transition-colors">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-white font-black text-xl">Official Sweepstakes Rules</h1>
            <p className="text-white/60 text-xs mt-0.5">GasCap™ Weekly $25 Gas Card Giveaway</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

        {/* Intro box */}
        <div className="bg-[#1EB68F]/10 border border-[#1EB68F]/30 rounded-2xl p-5">
          <p className="text-sm text-slate-700 leading-relaxed">
            <strong>Plain-English Summary:</strong> Every week, GasCap™ gives away a {PRIZE_VALUE} Visa prepaid card — use it at the pump or anywhere Visa is accepted — to one
            lucky Pro or Fleet member. The more days you use the app, the more entries you earn.
            Standard users earn 1 entry per day; Ambassador Program members earn 2–5 entries per day
            depending on their tier (based on cumulative paying referrals). Keep a login streak going
            for additional bonus entries. Pro Lifetime members receive an automatic bonus of 20 entries
            every draw period. Ambassador tier holders are always eligible to win — no
            consecutive-week restrictions apply to them. No purchase is required to enter.
          </p>
        </div>

        {/* Rules sections */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-50">

          <section className="p-5 space-y-2">
            <h2 className="text-sm font-black text-slate-800">1. Sponsor</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              The GasCap™ Weekly $25 Gas Card Giveaway (&ldquo;Sweepstakes&rdquo;) is sponsored by {SPONSOR}
              (&ldquo;Sponsor&rdquo;), the operator of{' '}
              <Link href="https://www.gascap.app" className="text-[#1EB68F] underline" target="_blank" rel="noopener noreferrer">gascap.app</Link>.
            </p>
          </section>

          <section className="p-5 space-y-2">
            <h2 className="text-sm font-black text-slate-800">2. Eligibility</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Open to legal residents of the United States who are 18 years of age or older at the time
              of entry. Employees of the Sponsor and their immediate family members are not eligible.
              Void where prohibited by law.
            </p>
            <p className="text-sm text-slate-600 leading-relaxed">
              <strong>Verified Email Requirement:</strong> Entrants must have a verified GasCap™
              account email address to be eligible to win. Entries accumulated by accounts with
              unverified email addresses will be excluded from the drawing pool.
            </p>
            <p className="text-sm text-slate-600 leading-relaxed">
              <strong>Membership Requirement (Method A):</strong> App-use entries (Method A, Section 4)
              are available only to active GasCap™ Pro subscribers (including subscribers in a Pro
              free-trial period), GasCap™ Pro Lifetime members, and GasCap™ Fleet subscribers. Free
              accounts do not earn app-use entries; any person, including holders of free accounts,
              may still enter at no cost using the No Purchase Necessary method (Method B, Section 4).
            </p>
            <p className="text-sm text-slate-600 leading-relaxed">
              <strong>Winner Frequency Restriction:</strong> A person who has won a prize in any
              of the four (4) preceding Entry Weeks is not eligible to win again in the current
              Entry Week. If a selected winner is ineligible under this restriction, an additional
              drawing will be conducted from the remaining eligible entries until an eligible winner
              is selected.
            </p>
            <p className="text-sm text-slate-600 leading-relaxed">
              <strong>Ambassador Program Exception:</strong> Entrants who have reached a GasCap™
              Ambassador Program tier (Supporter, Ambassador, or Elite Ambassador) as of the first day
              of the current Entry Week are exempt from the Winner Frequency Restriction set forth
              above. Such entrants are eligible to win in any Entry Week, including consecutive
              weeks. Tier status is determined by cumulative paying referral count as of the
              first day of the Entry Week.
            </p>
          </section>

          <section className="p-5 space-y-2">
            <h2 className="text-sm font-black text-slate-800">3. Entry Period</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Each Sweepstakes period covers one calendar week Monday through Sunday (the &ldquo;Entry Week&rdquo;),
              beginning Monday at 12:00:00 AM Eastern Time and ending Sunday at 11:59:59 PM Eastern Time.
              A new drawing is held each Friday evening.
            </p>
          </section>

          <section className="p-5 space-y-2">
            <h2 className="text-sm font-black text-slate-800">4. How to Enter</h2>
            <div className="space-y-3 text-sm text-slate-600 leading-relaxed">
              <p>
                <strong>Method A — App Use (paid plans):</strong> GasCap™ Pro and Fleet subscribers
                automatically earn entries for each calendar day they use the app during the
                Entry Month. &ldquo;Use&rdquo; means opening the app and performing any action (fuel calculation,
                gas price lookup, vehicle management, or account login). The number of entries earned
                per active day is determined by the subscriber&apos;s Ambassador Program tier as of the
                last day of the month immediately preceding the Entry Month, as follows:
              </p>
              <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600">
                <li><strong>Standard (0–4 cumulative paying referrals):</strong> one (1) entry per active day; maximum 7 base entries per Entry Week.</li>
                <li><strong>Supporter tier (5–14 cumulative paying referrals):</strong> two (2) entries per active day; maximum 14 base entries per Entry Week.</li>
                <li><strong>Ambassador tier (15–29 cumulative paying referrals):</strong> three (3) entries per active day; maximum 21 base entries per Entry Week.</li>
                <li><strong>Elite Ambassador tier (30 or more cumulative paying referrals):</strong> five (5) entries per active day; maximum 35 base entries per Entry Week.</li>
              </ul>
              <p>
                &ldquo;Cumulative paying referrals&rdquo; means the total number of individuals who signed up using
                the subscriber&apos;s unique referral link and subsequently activated a paid GasCap™
                subscription at any point in time, regardless of whether those referred users remain
                active subscribers.
              </p>
              <p>
                <strong>Streak Bonus Entries (Method A subscribers only):</strong> Subscribers who
                maintain a consecutive daily-use streak also receive bonus entries on top of their
                base entries. Bonus entries are awarded based on the subscriber&apos;s active streak
                as of the last day of the Entry Week: 7–29 consecutive days = 2 bonus entries;
                30–89 consecutive days = 5 bonus entries; 90 or more consecutive days = 10 bonus
                entries. Streak bonus entries require at least one (1) base active-day entry to be
                awarded. Streak bonus entries are fixed and are not multiplied by Ambassador tier.
              </p>
              <p>
                <strong>Method B — No Purchase Necessary (free online entry):</strong> Any eligible
                person may enter without purchasing a GasCap™ subscription by completing the free
                entry form at:
              </p>
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-700">
                <Link
                  href="/amoe"
                  className="text-[#1EB68F] underline font-semibold"
                >
                  gascap.app/amoe
                </Link>
                <span className="text-slate-500 ml-2">— Free Entry Form</span>
              </div>
              <p>
                The free entry form requires only a first name, last name, and valid email address.
                Free-entry submissions must be submitted before 11:59:59 PM Eastern Time on the Sunday
                closing the Entry Week. Limit one (1) free online entry per person per Entry Week,
                as determined by email address. Free online entries receive one (1) entry regardless
                of the number of app active days.
              </p>
            </div>
          </section>

          <section className="p-5 space-y-2">
            <h2 className="text-sm font-black text-slate-800">5. Drawing &amp; Winner Selection</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              On or about the Friday evening closing each Entry Week, the Sponsor will conduct
              a random weighted drawing from all eligible entries received during that Entry Week.
              Each entry represents one equal chance to win. The drawing is conducted electronically by
              the Sponsor using a randomized selection process. Odds of winning depend on the total
              number of entries received.
            </p>
            <p className="text-sm text-slate-600 leading-relaxed">
              If the selected potential winner is ineligible due to the winner frequency restrictions
              set forth in Section 2, that person&apos;s entries will be removed from the pool and
              an additional drawing will be conducted from the remaining eligible entries. This process
              will repeat until an eligible winner is identified. In the unlikely event that all
              entrants are ineligible under the frequency restrictions, no prize will be awarded for
              that Entry Week and the prize will not carry over.
            </p>
          </section>

          <section className="p-5 space-y-2">
            <h2 className="text-sm font-black text-slate-800">6. Prize</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              One (1) Grand Prize per Entry Week: a {PRIZE_VALUE} Visa prepaid card (or equivalent
              Visa prepaid card of equal value, at Sponsor&apos;s discretion). Approximate retail
              value: {PRIZE_VALUE}. Prize is non-transferable and no substitution or cash equivalent is
              permitted, except at Sponsor&apos;s sole discretion. Sponsor reserves the right to substitute
              a prize of equal or greater value if the advertised prize becomes unavailable.
            </p>
          </section>

          <section className="p-5 space-y-2">
            <h2 className="text-sm font-black text-slate-800">7. Winner Notification</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              The potential winner will be notified by email at the address associated with their
              GasCap™ account (or the email provided on the mail-in entry) within 7 days of the
              drawing. The potential winner must respond within 3 days of notification or the prize
              may be forfeited and an alternate winner selected. The Sponsor is not responsible for
              undeliverable email.
            </p>
          </section>

          <section className="p-5 space-y-2">
            <h2 className="text-sm font-black text-slate-800">8. Conditions of Participation</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              By entering, participants agree to these Official Rules and to the Sponsor&apos;s
              {' '}<Link href="/privacy" className="text-[#1EB68F] underline">Privacy Policy</Link>{' '}
              and{' '}<Link href="/terms" className="text-[#1EB68F] underline">Terms of Service</Link>.
              The Sponsor reserves the right to disqualify any entrant who tampers with the entry
              process or violates these rules. All decisions of the Sponsor are final and binding.
            </p>
          </section>

          <section className="p-5 space-y-2">
            <h2 className="text-sm font-black text-slate-800">9. Limitation of Liability</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              To the fullest extent permitted by law, the Sponsor is not responsible for any
              technical failures, lost or misdirected entries, or any injuries, losses, or damages
              of any kind arising from participation in this Sweepstakes or acceptance of any prize.
              The Sponsor&apos;s maximum liability to any entrant shall not exceed the value of the
              prize offered in the applicable Entry Month.
            </p>
          </section>

          <section className="p-5 space-y-2">
            <h2 className="text-sm font-black text-slate-800">10. Privacy</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Personal information collected in connection with this Sweepstakes will be used only
              to administer the Sweepstakes and deliver the prize. The Sponsor will not sell or
              share entrant information with third parties except as required to fulfill the prize.
            </p>
          </section>

          <section className="p-5 space-y-2">
            <h2 className="text-sm font-black text-slate-800">11. Governing Law</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              This Sweepstakes is governed by the laws of the State of Florida and, where
              applicable, the laws of the United States, without regard to conflict-of-law
              principles. All disputes shall be resolved exclusively in the state or federal
              courts located in Orange County, Florida.
            </p>
          </section>

          <section className="p-5 space-y-2">
            <h2 className="text-sm font-black text-slate-800">12. Contact &amp; Winners List</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              For questions, a copy of these rules, or a list of prize winners (available after
              the conclusion of each Entry Week), contact us at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#1EB68F] underline">{CONTACT_EMAIL}</a>{' '}
              or by mail at: {SPONSOR}, 7901 4th St N, STE 300, St. Petersburg, FL 33702.
            </p>
          </section>

        </div>

        {/* Disclaimer */}
        <p className="text-[10px] text-slate-400 text-center leading-relaxed pb-4">
          These rules may be amended at any time; any material changes will be posted at{' '}
          <Link href="/sweepstakes-rules" className="text-slate-500 hover:text-slate-700 underline">gascap.app/sweepstakes-rules</Link>.
          Continued participation after a change is posted
          constitutes acceptance of the revised rules. This page constitutes the complete
          Official Rules for the GasCap™ Weekly $25 Gas Card Giveaway.{' '}
          <strong>No purchase necessary. A purchase does not improve your odds of winning.</strong>
        </p>

      </div>
    </div>
  );
}
