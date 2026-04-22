import Link from 'next/link';
import StaticPageHeader from '@/components/StaticPageHeader';

export const metadata = { title: 'Help & Support — GasCap™' };

const YEAR = new Date().getFullYear();

// ── Data ──────────────────────────────────────────────────────────────────

const SECTIONS = [
  {
    id: 'getting-started',
    title: '🚀 Getting Started',
    items: [
      {
        q: 'Do I need an account to use GasCap™?',
        a: 'No — the fuel calculators work right away without signing up. Creating a free account lets you save 1 vehicle and sync your data across devices. Upgrading to Pro ($4.99/mo) unlocks fill-up tracking, MPG insights, receipt scanning, and up to 3 saved vehicles. Fleet ($19.99/mo) supports unlimited vehicles and up to 10 drivers. New users get 30 days of Pro free — no credit card required.',
      },
      {
        q: 'I just signed up — what should I do first?',
        a: 'After signing up, GasCap™ shows a setup checklist to help you get the most out of the app. It walks you through adding your first vehicle, trying a fuel calculation, enabling location for live gas prices, and installing the app to your home screen. You can dismiss the checklist at any time.',
      },
      {
        q: 'How do I add my vehicle?',
        a: 'Tap "Saved Vehicles" on the main screen, then tap "+ Add Vehicle." You can search by Year/Make/Model, enter your VIN manually, or tap the camera icon to scan your VIN with your phone\'s camera.',
      },
      {
        q: 'What is a VIN and where do I find it?',
        a: 'A Vehicle Identification Number (VIN) is a 17-character code unique to your car. Find it on the driver-side dashboard (visible through the windshield), the driver-side door jamb sticker, or your vehicle registration / insurance card.',
      },
      {
        q: 'How do I install GasCap™ on my phone?',
        a: 'GasCap™ is a Progressive Web App (PWA). On iPhone: open gascap.app in Safari → tap the Share icon → "Add to Home Screen." On Android: open in Chrome → tap the menu (⋮) → "Add to Home Screen" or "Install App."',
      },
    ],
  },
  {
    id: 'calculators',
    title: '⛽ Using the Calculators',
    items: [
      {
        q: 'What is the "Target Fill" calculator?',
        a: 'Target Fill tells you exactly how much it will cost to reach a specific fuel level — for example, from ¼ tank to full. Drag the gauge to your current level, set your target, and enter the gas price.',
      },
      {
        q: 'What is the "By Budget" calculator?',
        a: 'By Budget works in reverse: enter how much money you want to spend and it tells you how many gallons you\'ll get and what fuel level to expect. Great for topping off on a tight budget.',
      },
      {
        q: 'What is the MPG Insight Card?',
        a: 'The MPG Insight Card appears on the main screen for Pro and Fleet users who have logged at least two fill-ups for a saved vehicle. It shows your real-world MPG for that vehicle and updates automatically each time you log a fill-up. If your efficiency changes significantly, the card will flag it.',
      },
      {
        q: 'What is Rental Car Return Mode?',
        a: 'Rental Car Return Mode is a special calculator mode designed for rental vehicle drop-offs. Tap the "🚗 Rental Car Return Mode" toggle at the top of the calculator to activate it. Your saved garage is hidden and replaced with rental car class presets (Economy, Midsize, SUV, etc.). You can also enter the rental company\'s per-gallon rate to see a side-by-side comparison of what it costs you at the pump vs. what the rental company would charge if you returned it empty — showing exactly how much you save.',
      },
      {
        q: 'Can I scan my fuel gauge to set the current level?',
        a: 'Yes. On the "Set fuel level" step, tap "Scan Gauge" to use your camera or "Upload Photo" to use an image from your gallery. AI reads the needle position on your dashboard gauge — including vertical, horizontal, and arc-style gauges — and sets the fuel level automatically. You can always drag the gauge to fine-tune the result.',
      },
      {
        q: 'How does the live gas price lookup work?',
        a: 'Tap "Use Local Price" and allow location access. GasCap™ uses your location to look up the current average gas price in your state from the U.S. Energy Information Administration (EIA). It\'s an average — actual pump prices may vary.',
      },
      {
        q: 'Can I use GasCap™ without internet?',
        a: 'Yes. Once installed as a PWA, the calculators work fully offline. Gas price lookup, gauge scan, and VIN scan require an internet connection.',
      },
    ],
  },
  {
    id: 'fillup-tracking',
    title: '📋 Fill-Up Tracking (Pro)',
    items: [
      {
        q: 'How do I log a fill-up?',
        a: 'From the Tools tab, tap "Log Fill-Up." Enter the date, gallons, price per gallon, and odometer reading. Pro users can also tap the camera icon to scan a receipt and auto-fill the amounts.',
      },
      {
        q: 'What receipts can I scan to log a fill-up?',
        a: 'You can scan two types of receipts: a pay-at-pump receipt (printed immediately after fueling) or the final store receipt given to you inside the station. Both formats are supported. For best results, lay the receipt flat in good lighting and make sure all numbers are in frame.',
      },
      {
        q: 'How is MPG calculated?',
        a: 'MPG is calculated automatically from your fill-up history using the miles driven between fill-ups and the gallons added. You\'ll need at least two consecutive fill-up logs to see MPG data.',
      },
      {
        q: 'How do I filter or browse my fill-up history?',
        a: 'Fill-ups are grouped by month in the Fill-Up History panel. Use the filter bar at the top to narrow by vehicle, date range, or month. Tap any fill-up entry to see its full details.',
      },
      {
        q: 'Can I export my fill-up history?',
        a: 'Yes. Open the "Fill-Up History" panel and tap "Export CSV" to download a spreadsheet of all your fill-ups, or tap "Print / PDF" to open a printable report you can save as a PDF. Both options are available to Pro and Fleet users.',
      },
    ],
  },
  {
    id: 'plans',
    title: '⭐ Plans & Billing',
    items: [
      {
        q: 'What\'s included in the free plan?',
        a: 'The free plan includes 1 saved vehicle, both calculators (Target Fill & By Budget), EPA vehicle database search, live local gas price lookup, offline use, and badge achievements.',
      },
      {
        q: 'How do I get 30 days of Pro free?',
        a: 'New users who sign up and activate a GasCap™ account receive 30 days of Pro features free — no credit card required. Your free trial gives you full access to fill-up tracking, MPG insights, receipt scanning, stats, streak rewards, and the monthly gas card giveaway. After 30 days, you can upgrade to keep Pro or continue using the free plan.',
      },
      {
        q: 'What does Pro add?',
        a: 'Pro ($4.99/mo or $49/yr) adds up to 3 saved vehicles, VIN photo scan, fill-up history & MPG tracking, receipt photo scan, MPG Insight Card, fuel savings dashboard, streak counter, monthly report card, gas price trend predictions, vehicle health alerts, fill-up reminders, Annual Wrapped, referral rewards, and monthly gas card giveaway entries.',
      },
      {
        q: 'What is Fleet and who is it for?',
        a: 'Fleet ($19.99/mo or $199/yr) is designed for businesses managing multiple vehicles. It includes unlimited vehicles, up to 10 drivers, driver attribution on fill-ups, a fleet-wide fuel dashboard, per-vehicle and per-driver reporting, bulk vehicle import, driver roster management, and monthly giveaway entries.',
      },
      {
        q: 'How do I upgrade my plan?',
        a: 'You can upgrade directly from Settings — tap your profile icon or visit the Settings tab, then tap "Upgrade to Pro" or "Upgrade to Fleet." You can also visit gascap.app/upgrade. You\'ll be taken to a secure Stripe checkout page.',
      },
      {
        q: 'How do I cancel my subscription?',
        a: 'Email us at hello@gascap.app and we\'ll cancel your subscription and issue any applicable refund. We\'re working on a self-serve cancellation portal.',
      },
      {
        q: 'Is my payment information secure?',
        a: 'Yes. GasCap™ uses Stripe for all payments — we never store your card details on our servers. Stripe is PCI DSS Level 1 certified.',
      },
    ],
  },
  {
    id: 'giveaway',
    title: '🎁 Monthly Gas Card Giveaway',
    items: [
      {
        q: 'What is the Monthly Gas Card Giveaway?',
        a: 'Every month, GasCap™ gives away a $25 gas card to one lucky winner drawn from all eligible entries. The drawing is held on or about the 5th of the following month. There is no purchase required to enter.',
      },
      {
        q: 'Who is eligible to enter?',
        a: 'Legal residents of the United States who are 18 years of age or older. Employees of Gas Capacity LLC and their immediate family members are not eligible. Void where prohibited by law.',
      },
      {
        q: 'How do I earn entries as a Pro or Fleet member?',
        a: 'Pro and Fleet subscribers automatically earn one (1) entry for each calendar day they use the app — up to a maximum of 31 entries per month. "Use" means opening the app and performing any action: calculating fuel, looking up gas prices, managing vehicles, or logging in.',
      },
      {
        q: 'Can I enter without a paid subscription?',
        a: 'Yes — no purchase is necessary. Anyone eligible can submit one free entry per month using the free entry form at gascap.app/amoe. The form only requires your first name, last name, and email address.',
      },
      {
        q: 'What is the entry toast notification I see when I open the app?',
        a: 'If you\'re a Pro or Fleet subscriber, you\'ll see a brief notification each day confirming your giveaway entry was earned for the current month — for example, "⚡ Entry earned! You have 7 entries in the April drawing." It appears once per day and dismisses automatically.',
      },
      {
        q: 'Where can I check my entry count?',
        a: 'Tap the 🎁 giveaway icon or visit gascap.app/giveaway to see your current entry count, your eligibility status, and the most recent past winner.',
      },
      {
        q: 'Can I win every month?',
        a: 'No. A winner from the immediately preceding calendar month is not eligible to win again the following month. Additionally, no person may win more than once per calendar quarter (Q1: Jan–Mar, Q2: Apr–Jun, Q3: Jul–Sep, Q4: Oct–Dec). If a selected winner is ineligible, an additional drawing is held from the remaining entries.',
      },
      {
        q: 'How will I know if I won?',
        a: 'Winners are notified by email within 7 days of the drawing, using the email address on their GasCap™ account (or the email provided on the free entry form). You must respond within 14 days or the prize may be forfeited and an alternate winner selected.',
      },
      {
        q: 'Where are the full official rules?',
        a: 'The complete official rules are available at gascap.app/sweepstakes-rules.',
      },
    ],
  },
  {
    id: 'account',
    title: '👤 Account & Privacy',
    items: [
      {
        q: 'How do I reset my password?',
        a: 'On the sign-in page, tap "Forgot password?" Enter your email address and we\'ll send you a reset link valid for 1 hour.',
      },
      {
        q: 'Why do I need to verify my email?',
        a: 'Email verification helps us protect your account and ensure we can reach you for important account notices. Check your inbox (and spam folder) for a verification email from hello@gascap.app.',
      },
      {
        q: 'What data does GasCap™ collect?',
        a: 'GasCap™ collects the information you provide (email, vehicle info, fill-up logs) and basic usage data to improve the app. We do not sell your personal data. See our Privacy Policy for full details.',
      },
      {
        q: 'How do I delete my account?',
        a: 'Email hello@gascap.app with your account email address and we\'ll permanently delete your account and all associated data within 30 days.',
      },
    ],
  },
  {
    id: 'stats',
    title: '📈 Stats & Insights (Pro)',
    items: [
      {
        q: 'What is the Stats tab?',
        a: 'The Stats tab (📈) in the Tools panel is your personal fuel intelligence hub. It includes your Streak Counter, Savings Dashboard, Monthly Report Card, Worst Fill-Up Hall of Fame, Gas Price Trend Predictions, and Vehicle Health Alerts — all powered by your fill-up history.',
      },
      {
        q: 'How does the Streak Counter work?',
        a: 'Your streak counts how many consecutive days you\'ve opened GasCap™. The counter resets if you miss a day. Your current streak and today\'s count are updated in real time when you open the app.',
      },
      {
        q: 'What is the Savings Dashboard?',
        a: 'The Savings Dashboard shows your total fuel spending, total gallons filled, average price per gallon, and estimated savings compared to the national average price. It updates automatically as you log fill-ups.',
      },
      {
        q: 'What is the Monthly Report Card?',
        a: 'The Monthly Report Card compares this month\'s fill-ups, gallons, spending, and average gas price to last month — with color-coded arrows showing whether each metric improved or worsened.',
      },
      {
        q: 'What is the Worst Fill-Up Hall of Fame?',
        a: 'The Hall of Fame highlights your most expensive single fill-up ("Worst Day 😬") alongside your best deal — the fill-up with the lowest price per gallon ("Best Deal 🎉"). You\'ll need at least 2 fill-ups logged to see this feature.',
      },
      {
        q: 'How do gas price trend predictions work?',
        a: 'GasCap™ compares the average price you\'ve paid in your last two fill-ups vs. the two before that. If prices are trending up, down, or staying flat, you\'ll see a trend indicator with a sparkline chart. You\'ll need at least 4 fill-ups logged to see predictions.',
      },
      {
        q: 'What are Vehicle Health Alerts?',
        a: 'Vehicle Health Alerts monitor your MPG over time. If your recent fuel efficiency drops more than 10% below your historical average for that vehicle, you\'ll see an alert card suggesting you check your tire pressure, air filter, or other common causes of declining MPG.',
      },
      {
        q: 'What is Annual Wrapped?',
        a: 'Annual Wrapped (🎁) is a year-in-review summary of your fuel activity — total fill-ups, gallons, money spent, average price, best and worst months, top vehicle, and estimated miles driven. Tap the gift icon in the header to see your Wrapped. You can also share a summary to social media or copy it to your clipboard.',
      },
      {
        q: 'How do Fill-Up Reminders work?',
        a: 'Fill-Up Reminders send you a push notification if you haven\'t logged a fill-up in a while. You can set reminders to weekly (every 7 days) or bi-weekly (every 14 days) from the Share tab in the Tools panel. Push notifications must be enabled for reminders to work.',
      },
    ],
  },
  {
    id: 'fleet',
    title: '🚛 Fleet',
    items: [
      {
        q: 'What is GasCap™ Fleet?',
        a: 'Fleet is designed for businesses, owner-operators, and anyone managing multiple vehicles. It includes unlimited vehicles, up to 10 drivers, a fleet-wide fuel dashboard, per-vehicle and per-driver reporting, driver roster management, driver attribution on fill-ups, bulk vehicle import, and monthly giveaway entries.',
      },
      {
        q: 'How do I add drivers to my fleet?',
        a: 'From the Fleet Dashboard, tap "Manage Drivers" to open the driver roster. Tap "+ Add Driver" and enter the driver\'s name. Each fill-up can be attributed to a specific driver so you can track fuel usage by person.',
      },
      {
        q: 'What does the Fleet Dashboard show?',
        a: 'The Fleet Dashboard gives you a bird\'s-eye view of your entire fleet — total fuel spend, gallons consumed, average MPG across all vehicles, and a breakdown by vehicle and by driver. It updates in real time as fill-ups are logged.',
      },
      {
        q: 'Can drivers log fill-ups on their own devices?',
        a: 'Currently, fill-ups are logged by the account holder. Multi-driver login with individual driver accounts is on the roadmap for a future Fleet update.',
      },
      {
        q: 'Is there a free trial for Fleet?',
        a: 'Yes — new users receive 30 days of Fleet features free as part of the standard GasCap™ trial. After the trial, Fleet is $19.99/month or $199/year.',
      },
    ],
  },
  {
    id: 'streak-rewards',
    title: '🏆 Streak Rewards',
    items: [
      {
        q: 'What are Streak Rewards?',
        a: 'Streak Rewards are free Pro month credits you earn by maintaining a consecutive daily streak in GasCap™. Open the app every day to keep your streak alive. Rewards are found in the Share tab under "Streak Rewards."',
      },
      {
        q: 'What milestones earn a free month?',
        a: 'Reaching a 30-day streak earns 1 free Pro month. 90 days earns another. 180 days earns another. 365 days earns a final free Pro month plus Legend status — 4 free months total if you reach one year.',
      },
      {
        q: 'How do I redeem a banked free month?',
        a: 'Email hello@gascap.app from your account email and mention your banked streak credit. We\'ll apply it to your next billing cycle.',
      },
      {
        q: 'Does breaking my streak affect credits I already earned?',
        a: 'No. Once a milestone is hit, the credit is banked permanently (valid for 12 months). Your streak resets to zero, but you keep the credit. You would need to reach the next milestone (e.g., 90 days) to earn another.',
      },
    ],
  },
  {
    id: 'troubleshooting',
    title: '🔧 Troubleshooting',
    items: [
      {
        q: 'Gas price lookup isn\'t working — what should I do?',
        a: 'Make sure you\'ve allowed location access in your browser settings. The lookup uses your location to find your state\'s average price from the EIA. If it still fails, the EIA data service may be temporarily unavailable — try again later or enter a price manually.',
      },
      {
        q: 'VIN scan isn\'t reading my VIN correctly.',
        a: 'For best results: ensure good lighting, hold the camera steady, and make sure the full 17-character VIN is in frame. The VIN is usually on a sticker on the driver-side dashboard or door jamb. If scanning fails, you can always type your VIN manually.',
      },
      {
        q: 'Receipt scan isn\'t filling in my fill-up details.',
        a: 'Make sure the receipt is flat, well-lit, and fully in frame. Both pay-at-pump receipts and final store receipts are supported. If the scan fails, tap the fields to enter your gallons, price, and total manually.',
      },
      {
        q: 'The app isn\'t updating after I upgraded my plan.',
        a: 'Sign out and sign back in to refresh your session. On the installed PWA, you can also pull down from the top of the screen to refresh. If the issue persists, clear your browser cache or reinstall the PWA.',
      },
      {
        q: 'My streak didn\'t count today even though I used the app.',
        a: 'Your streak is recorded when the app loads on a new calendar day. Make sure you\'re signed in — streaks only count for registered users. If you used the app but the streak didn\'t increment, try signing out and back in to force a session refresh.',
      },
      {
        q: 'I\'m having a different issue not listed here.',
        a: 'Use the "Share Feedback" button (bottom-right corner of the app) to describe what\'s happening, or email us at hello@gascap.app. We typically respond within 1 business day.',
      },
    ],
  },
];

// ── Sub-components ─────────────────────────────────────────────────────────

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div className="border-b border-slate-100 last:border-0 py-4">
      <p className="text-sm font-black text-navy-700 mb-1.5">{q}</p>
      <p className="text-sm text-slate-600 leading-relaxed">{a}</p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-[#eef1f7]">

      <StaticPageHeader active="help" />

      <div className="max-w-2xl mx-auto px-5 py-10 pb-20">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-black text-navy-700 leading-tight">Help &amp; Support</h1>
          <p className="text-sm text-slate-500 mt-2">
            Find answers to common questions, or{' '}
            <a href="mailto:hello@gascap.app" className="text-amber-600 font-semibold hover:underline">
              contact us
            </a>{' '}
            and we&apos;ll get back to you within 1 business day.
          </p>
        </div>

        {/* Quick links */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-10">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="bg-white rounded-2xl px-4 py-3 text-xs font-bold text-slate-700
                         border border-slate-100 hover:border-amber-300 hover:text-amber-700
                         transition-colors shadow-sm text-center"
            >
              {s.title}
            </a>
          ))}
        </div>

        {/* FAQ sections */}
        <div className="space-y-6">
          {SECTIONS.map((s) => (
            <section key={s.id} id={s.id} className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6">
              <h2 className="text-base font-black text-navy-700 mb-1">{s.title}</h2>
              <div>
                {s.items.map((item) => (
                  <FaqItem key={item.q} q={item.q} a={item.a} />
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Sweepstakes quick-link card */}
        <div className="mt-6 bg-[#005F4A] rounded-3xl p-6 text-center">
          <p className="text-white font-black text-lg mb-1">🎁 Monthly Gas Card Giveaway</p>
          <p className="text-white/60 text-sm mb-4">
            Pro and Fleet members earn entries every day they use the app.
            No purchase required to enter.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/giveaway"
              className="inline-block bg-[#1EB68F] hover:bg-[#17a07e] text-white
                         font-black text-sm px-6 py-3 rounded-2xl transition-colors"
            >
              View My Entries
            </Link>
            <Link
              href="/sweepstakes-rules"
              className="inline-block bg-white/10 hover:bg-white/20 text-white
                         font-black text-sm px-6 py-3 rounded-2xl transition-colors"
            >
              Official Rules
            </Link>
            <Link
              href="/amoe"
              className="inline-block bg-white/10 hover:bg-white/20 text-white
                         font-black text-sm px-6 py-3 rounded-2xl transition-colors"
            >
              Free Entry Form
            </Link>
          </div>
        </div>

        {/* Contact card */}
        <div className="mt-6 bg-[#1E2D4A] rounded-3xl p-6 text-center">
          <p className="text-white font-black text-lg mb-1">Still need help?</p>
          <p className="text-white/60 text-sm mb-4">
            Our team is here for you. We typically respond within 1 business day.
          </p>
          <a
            href="mailto:hello@gascap.app"
            className="inline-block bg-amber-500 hover:bg-amber-400 text-white
                       font-black text-sm px-6 py-3 rounded-2xl transition-colors"
          >
            Email hello@gascap.app
          </a>
          <p className="text-white/40 text-xs mt-4">
            You can also use the{' '}
            <span className="text-amber-400 font-semibold">💬 Share Feedback</span>{' '}
            button inside the app.
          </p>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-400 mt-8">
          © {YEAR} GasCap™ — All rights reserved.
        </p>
      </div>
    </div>
  );
}
