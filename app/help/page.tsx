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
        a: 'No — the fuel calculators work right away without signing up. Creating a free account lets you save 1 vehicle and sync your data across devices. Upgrading to Pro ($4.99/mo) unlocks fill-up tracking, MPG insights, receipt scanning, and up to 3 saved vehicles. Fleet ($19.99/mo) supports unlimited vehicles and up to 25 drivers. New users get 30 days of Pro free — no credit card required. After the trial, your account automatically reverts to the free plan.',
      },
      {
        q: 'I just signed up — what should I do first?',
        a: 'After signing up, GasCap™ shows a setup checklist on the main screen. It walks you through adding your first vehicle, logging your first fill-up, and (for Fleet) adding a driver. Each step fires automatically when completed. You can dismiss the checklist at any time — it won\'t reappear.',
      },
      {
        q: 'How do I add my vehicle?',
        a: 'Tap "Saved Vehicles" on the main screen, then tap "+ Add Vehicle." Search by Year/Make/Model, enter your VIN manually, or tap the camera icon to scan your VIN. Saving a vehicle pre-fills your tank size and MPG estimates in the calculator automatically.',
      },
      {
        q: 'What is a VIN and where do I find it?',
        a: 'A Vehicle Identification Number (VIN) is a 17-character code unique to your car. Find it on the driver-side dashboard (visible through the windshield), the driver-side door jamb sticker, or your vehicle registration / insurance card.',
      },
      {
        q: 'How do I install GasCap™ on my phone?',
        a: 'GasCap™ is a Progressive Web App (PWA) — no app store needed. On iPhone: open gascap.app in Safari → tap the Share icon → "Add to Home Screen." On Android: open in Chrome → tap the menu (⋮) → "Add to Home Screen" or "Install App." The app icon will appear on your home screen just like a native app.',
      },
      {
        q: 'How do I switch between Light and Dark mode?',
        a: 'Open the app, go to Settings (tap your profile or the settings icon), then find the Appearance section. Tap the three-way toggle to choose Auto (follows your device\'s system setting and switches at sunrise/sunset), Light, or Dark. Your preference is saved automatically.',
      },
    ],
  },
  {
    id: 'calculators',
    title: '⛽ Calculators',
    items: [
      {
        q: 'What is the "Target Fill" calculator?',
        a: 'Target Fill tells you exactly how much it will cost to reach a specific fuel level — for example, from ¼ tank to full. Drag the gauge to your current level, set your target, and enter the gas price. If you have a saved vehicle, your tank size is pre-filled.',
      },
      {
        q: 'What is the "By Budget" calculator?',
        a: 'By Budget works in reverse: enter how much money you want to spend and it tells you how many gallons you\'ll get and what fuel level to expect. Great for topping off on a tight budget.',
      },
      {
        q: 'What is the MPG Insight Card?',
        a: 'The MPG Insight Card appears on the main screen for Pro and Fleet users who have logged at least two fill-ups. It shows your real-world average MPG, your trend vs. previous fill-ups, and your best single fill-up efficiency. Tap the card to open the full MPG chart.',
      },
      {
        q: 'What is Rental Car Return Mode?',
        a: 'Rental Car Return Mode is designed for rental vehicle drop-offs. Tap the "🚗 Rental Car Return Mode" toggle at the top of the calculator to activate it. Your saved garage is hidden and replaced with rental car class presets (Economy, Midsize, SUV, etc.). Enter the rental company\'s per-gallon rate to see exactly how much you save by fueling up yourself vs. returning empty.',
      },
      {
        q: 'Can I scan my fuel gauge to set the current level?',
        a: 'Yes. Tap "Scan Gauge" to use your camera or "Upload Photo" to use an image from your gallery. AI reads the needle position — including vertical, horizontal, and arc-style gauges — and sets the fuel level automatically. You can always drag the gauge to fine-tune.',
      },
      {
        q: 'How does the live gas price lookup work?',
        a: 'Live gas price lookup requires a free GasCap™ account. Once signed in, tap "Use Local Price" and allow location access. GasCap™ fetches the current average price in your state from the U.S. Energy Information Administration (EIA). If you deny location access, it falls back to the national average. Prices are averages — actual pump prices may vary. Guests can always enter a price manually.',
      },
      {
        q: 'Can I use GasCap™ without internet?',
        a: 'Yes. Once installed as a PWA, the calculators work fully offline using the last-known gas price. Gas price lookup, gauge scan, VIN scan, and AI features require an internet connection.',
      },
    ],
  },
  {
    id: 'tools',
    title: '🛠️ Tools',
    items: [
      {
        q: 'What is the Trip Cost Estimator?',
        a: 'The Trip Cost Estimator calculates the fuel cost of a road trip. In manual mode (free for all users), enter your trip distance, vehicle MPG, and gas price to see total gallons needed and estimated cost. Pro and Fleet users can also use route mode: enter an origin and destination with address autocomplete and GasCap™ uses Google Routes API to calculate the real route distance — so you get a cost estimate for the actual road, not a straight line. When a fuel stop is needed along the way, GasCap™ finds real gas stations on the route. Your completed trips are saved and appear in the Stats tab.',
      },
      {
        q: 'Does GasCap™ work with Google Maps?',
        a: 'Yes. In the Trip tab, Pro and Fleet users can enter an origin and destination to get the exact fuel cost for the real route. When a fuel stop is needed, GasCap™ finds actual gas stations along the route — tap "Find Fuel Along the Way" to open Google Maps (or Waze) with turn-by-turn directions straight to the pump. After you close Maps and return to GasCap™, the app scrolls you right back to your trip result.',
      },
      {
        q: 'What is the Station Comparison tool?',
        a: 'Station Comparison lets you compare two nearby gas stations side by side. Enter the price per gallon at each station and the amount you need — it tells you which is cheaper and by exactly how much. Free for all users.',
      },
      {
        q: 'What is the Gas Price Alert?',
        a: 'Gas Price Alert (Pro and Fleet) lets you set a price threshold — for example, $3.50/gal. When the national average price drops at or below your threshold, a banner appears at the top of the app letting you know it\'s a good time to fill up. Set your alert in Settings → Gas Price Alert.',
      },
      {
        q: 'What is the AI Fuel Advisor?',
        a: 'The AI Fuel Advisor (Pro and Fleet) is a conversational AI assistant powered by GPT-4o. Ask it anything about fuel efficiency, trip planning, vehicle maintenance, cost estimates, or money-saving tips. It has context about your saved vehicles and recent fill-up history, so its answers are personalized to your actual driving.',
      },
    ],
  },
  {
    id: 'fillup-tracking',
    title: '📋 Fill-Up Tracking',
    items: [
      {
        q: 'How do I log a fill-up?',
        a: 'From the Tools tab, tap "Log Fill-Up." Enter the date, gallons, price per gallon, and odometer reading. You can also enter a gas station name — GasCap™ remembers the stations you\'ve used and shows them as quick-select chips so you can re-select your regular spot in one tap. Pro users can tap the camera icon to scan a receipt and auto-fill the amounts (including the station name). Fleet users can also assign the fill-up to a driver.',
      },
      {
        q: 'What receipts can I scan to log a fill-up?',
        a: 'Both pay-at-pump receipts and final store receipts are supported. Lay the receipt flat in good lighting with all numbers visible. The AI reads gallons, price per gallon, and date and pre-fills the form — you review before saving.',
      },
      {
        q: 'What are the smart validation warnings?',
        a: 'When you log a fill-up, GasCap™ checks for common mistakes and warns you if: the gallons seem unusually high or low for your tank size, the date is a duplicate of an existing entry, the odometer is lower than your last recorded reading, or the price per gallon seems implausible. You can override any warning and save anyway.',
      },
      {
        q: 'How is MPG calculated?',
        a: 'MPG is calculated automatically from consecutive fill-ups that both include odometer readings, using the formula: miles driven ÷ gallons pumped. You\'ll need at least two fill-ups with odometer readings to see MPG data.',
      },
      {
        q: 'How do I filter or browse my fill-up history?',
        a: 'Fill-ups are grouped by month. Use the filter bar at the top to narrow by vehicle, date range, or specific month. Fleet users get an additional driver filter. Tap any entry to see its full details or delete it.',
      },
      {
        q: 'Can I export my fill-up history?',
        a: 'Yes. Open Fill-Up History and tap "Export CSV" to download a spreadsheet, or "Print / PDF" to save a printable report. Fleet CSV exports include the driver attribution column. Available to Pro and Fleet users.',
      },
    ],
  },
  {
    id: 'stats',
    title: '📈 Stats & Insights',
    items: [
      {
        q: 'What is the Stats tab?',
        a: 'The Stats tab (📈) in the Tools panel is your personal fuel intelligence hub. It includes your Streak Counter, Savings Dashboard, Monthly Report Card, Worst Fill-Up Hall of Fame, Gas Price Trend Predictions, and Vehicle Health Alerts — all powered by your fill-up history.',
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
        a: 'The Hall of Fame highlights your most expensive single fill-up ("Worst Day 😬") alongside your best deal — the fill-up with the lowest price per gallon ("Best Deal 🎉"). You\'ll need at least 2 fill-ups logged to see this.',
      },
      {
        q: 'How do gas price trend predictions work?',
        a: 'GasCap™ compares the average price you\'ve paid in your last two fill-ups vs. the two before that. If prices are trending up, down, or flat, you\'ll see a trend indicator with a sparkline chart. You\'ll need at least 4 fill-ups logged.',
      },
      {
        q: 'What are Vehicle Health Alerts?',
        a: 'If your recent MPG drops more than 10% below your historical average for a vehicle, you\'ll see an alert suggesting you check tire pressure, air filter, or other common causes of declining efficiency.',
      },
      {
        q: 'What is Annual Wrapped?',
        a: 'Annual Wrapped (🎁) is a year-in-review summary — total fill-ups, gallons, money spent, average price, best and worst months, top vehicle, and estimated miles driven. Tap the gift icon in the header to view it. You can share your summary to social media or copy it to your clipboard.',
      },
      {
        q: 'How do Fill-Up Reminders work?',
        a: 'Fill-Up Reminders will notify you when you haven\'t logged a fill-up within your chosen interval. Reminders will be delivered via SMS to your opted-in phone number — this feature is coming soon (pending SMS service activation). GasCap™ does not use push notifications. In the meantime, you can set a recurring reminder manually in your phone\'s calendar app.',
      },
    ],
  },
  {
    id: 'fleet',
    title: '🚛 Fleet',
    items: [
      {
        q: 'What is GasCap™ Fleet?',
        a: 'Fleet is for businesses and owner-operators managing multiple vehicles. It includes unlimited vehicles, up to 25 drivers, driver attribution on fill-ups, a fleet-wide fuel dashboard, per-vehicle and per-driver reporting, annual tax report (PDF), bulk vehicle import, driver roster management, CSV export with driver column, referral rewards, and monthly giveaway entries.',
      },
      {
        q: 'How do I add drivers to my fleet?',
        a: 'From the Fleet Dashboard, tap "Manage Drivers" → "+ Add Driver." Enter the driver\'s name. When logging a fill-up, assign it to a driver using the driver dropdown. Driver history is preserved even if you later remove them from the roster.',
      },
      {
        q: 'What does the Fleet Dashboard show?',
        a: 'The Fleet Dashboard shows active drivers, total vehicles, this-month spend, all-time spend, a per-driver breakdown (fill-ups, gallons, spend, last fill date), and a sortable fill-up activity table with driver and month filters. An "Unattributed fill-ups" warning appears if any fill-ups haven\'t been assigned to a driver.',
      },
      {
        q: 'How do I bulk import vehicles from a CSV?',
        a: 'From the Fleet Dashboard, tap the "Bulk Vehicle Import" card. Download the template CSV to see the expected format, fill in your vehicles, then upload the file and tap "Import Vehicles." Required columns are Name and Tank Size (gal). Optional columns include Year, Make, Model, Trim, VIN, and Odometer. The import supports up to 200 vehicles per file. After import, a results summary shows how many were created and flags any rows that were skipped with a reason.',
      },
      {
        q: 'Can I download an annual tax report?',
        a: 'Yes — Fleet subscribers can download a PDF Annual Fleet Fuel Tax Report directly from the Fleet Dashboard. Tap the Reports card, choose a tax year from the dropdown, and tap "Download PDF." The report includes a monthly cost breakdown, per-vehicle summary with MPG, a complete fill-up log with driver attribution, and a tax disclaimer. It is ready to hand to your accountant or attach to your IRS records.',
      },
      {
        q: 'Can I show my company\'s logo in GasCap™?',
        a: 'Yes — Fleet subscribers can white-label the dashboard with their company name and logo. Go to Settings → Fleet Branding, enter your company name and logo URL, and your branding will appear in the desktop dashboard header for all fleet users. Your logo sits alongside "Powered by GasCap™ Fleet" attribution.',
      },
      {
        q: 'Can drivers log fill-ups on their own devices?',
        a: 'Currently, fill-ups are logged by the account holder and attributed to a driver. Multi-driver login with individual accounts is on the roadmap for a future Fleet update.',
      },
      {
        q: 'Is there a free trial for Fleet?',
        a: 'Yes — new users receive 30 days of Fleet features free with no credit card required. After the trial, your account automatically downgrades to the free plan. To continue with Fleet, upgrade at $19.99/month or $199/year.',
      },
    ],
  },
  {
    id: 'plans',
    title: '⭐ Plans & Billing',
    items: [
      {
        q: 'What\'s included in the free plan?',
        a: 'The free plan includes 1 saved vehicle, both calculators (Target Fill & By Budget), Trip Cost Estimator, Station Comparison, EPA vehicle database search, live local gas price lookup (free account required), dark mode, and offline use. Creating an account is free — no credit card ever required.',
      },
      {
        q: 'How do I get 30 days of Pro free?',
        a: 'All new users who create a GasCap™ account automatically receive 30 days of Pro features — no credit card required. Your free trial gives full access to fill-up tracking, MPG insights, receipt scanning, AI Fuel Advisor, Gas Price Alert, stats, streak rewards, referral program, and monthly giveaway entries. When there are 15 days left in your trial, a banner appears in the app to remind you. After the 30-day trial ends, your account automatically downgrades to the free plan — you are never charged. To keep Pro features, upgrade before the trial expires at $4.99/month (or $49/year).',
      },
      {
        q: 'What does Pro add?',
        a: 'Pro ($4.99/mo or $49/yr) adds up to 3 saved vehicles, VIN photo scan, fill-up history & MPG tracking, receipt scanning, MPG Insight Card, AI Fuel Advisor, Gas Price Alert, fuel savings dashboard, streak counter, monthly report card, gas price trend predictions, vehicle health alerts, Annual Wrapped, referral rewards, and monthly gas card giveaway entries.',
      },
      {
        q: 'What does Fleet add over Pro?',
        a: 'Fleet ($19.99/mo or $199/yr) adds unlimited vehicles (vs. 3), up to 25 drivers, driver attribution on fill-ups, fleet-wide fuel dashboard, per-driver reporting, annual tax report (PDF), bulk vehicle import, and driver roster management. Everything in Pro is included.',
      },
      {
        q: 'How do I upgrade my plan?',
        a: 'Tap your profile icon or visit Settings → "Upgrade to Pro" or "Upgrade to Fleet." You can also visit gascap.app/upgrade. You\'ll be taken to a secure Stripe checkout page.',
      },
      {
        q: 'How do I cancel my subscription?',
        a: 'Go to Settings → Plan → "Manage Billing & Subscription." This opens the Stripe self-serve portal where you can cancel, change your plan, or update your payment method at any time. You can also email support@gascap.app and we\'ll take care of it for you.',
      },
      {
        q: 'Is my payment information secure?',
        a: 'Yes. GasCap™ uses Stripe for all payments — we never store your card details. Stripe is PCI DSS Level 1 certified.',
      },
    ],
  },
  {
    id: 'giveaway',
    title: '🎁 Giveaway',
    items: [
      {
        q: 'What is the Monthly Gas Card Giveaway?',
        a: 'Every month, GasCap™ gives away a $25 Visa prepaid card — use it at the pump or anywhere Visa is accepted — to one lucky winner. The drawing is held on or about the 5th of the following month. No purchase is required to enter.',
      },
      {
        q: 'Who is eligible to enter?',
        a: 'Legal residents of the United States who are 18 years of age or older. Employees of Gas Capacity LLC and their immediate family members are not eligible. Void where prohibited by law.',
      },
      {
        q: 'How do I earn entries as a Pro or Fleet member?',
        a: 'Pro and Fleet subscribers automatically earn entries for each calendar day they use the app. Your daily entry count depends on your Ambassador Program tier: standard users earn 1 entry/day (up to 31/month); Supporters (5+ paying referrals) earn 2 entries/day (up to 62/month); Ambassadors (15+ paying referrals) earn 3 entries/day (up to 93/month); Elite Ambassadors (30+ paying referrals) earn 5 entries/day (up to 155/month). Tier status is based on your cumulative paying referral count as of the last day of the previous month. On top of daily entries, streak bonuses apply as a flat addition: a 7-day streak adds +2 bonus entries, 30-day adds +5, 90-day adds +10, 180-day adds +15, and a full 365-day streak adds +20 bonus entries per month.',
      },
      {
        q: 'Can I enter without a paid subscription?',
        a: 'Yes — no purchase necessary. Submit one free entry per month using the form at gascap.app/amoe. Only your name and email are required.',
      },
      {
        q: 'What is the entry toast notification?',
        a: 'Pro and Fleet users see a brief "⚡ Entry earned!" notification each day confirming their giveaway entry for the current month. It appears once per day and auto-dismisses.',
      },
      {
        q: 'Where can I check my entry count?',
        a: 'Visit gascap.app/giveaway to see your current entry count, eligibility status, and the most recent past winner.',
      },
      {
        q: 'Can I win every month?',
        a: 'It depends on your Ambassador tier. Standard users are subject to a consecutive-month restriction — a winner from the preceding calendar month is not eligible the following month, and no person may win more than once per calendar quarter. However, Ambassador Program tier holders (Supporter, Ambassador, and Elite Ambassador) are always eligible and may win in consecutive months with no quarterly limit. If a selected winner is ineligible, an additional drawing is held.',
      },
      {
        q: 'How will I know if I won?',
        a: 'Winners are notified by email within 7 days of the drawing. You must respond within 14 days or the prize may be forfeited and an alternate winner selected.',
      },
      {
        q: 'Where are the full official rules?',
        a: 'The complete official rules are at gascap.app/sweepstakes-rules.',
      },
    ],
  },
  {
    id: 'referrals',
    title: '🔗 Ambassador Program & Referrals',
    items: [
      {
        q: 'How does the Ambassador Program work?',
        a: 'Share your personal referral link with friends, family, coworkers, or followers. Every person who signs up using your link and subscribes to a paid GasCap™ Pro or Fleet plan counts as a paying referral. Only paid conversions count — free trial sign-ups that never pay do not. As your cumulative paying referral count grows, you unlock higher Ambassador tiers with better rewards — including up to 6 free Pro months, free Pro for life at 15 referrals, and bonus drawing entries every day.',
      },
      {
        q: 'Where do I find my referral link?',
        a: 'Your referral link is in Settings → Refer & Earn, and also on the Ambassador Program page (gascap.app/ambassador). You can copy the link or share it directly. Your link looks like: gascap.app/signup?ref=YOURCODE.',
      },
      {
        q: 'What counts as a paying referral?',
        a: 'A paying referral is someone who (1) signed up using your unique referral link AND (2) activated a paid GasCap™ Pro or Fleet subscription. Free trial sign-ups that never upgrade do not count — period. Self-referrals are blocked by the system. Only real paying customers qualify, which keeps the program sustainable and fraud-proof.',
      },
      {
        q: 'What are the Ambassador tier thresholds and rewards?',
        a: 'Three tiers, based on cumulative all-time paying referrals: Supporter (5+ referrals) — earn 1 free Pro month per paying referral, up to 6 free months total, plus 2× daily drawing entries; Ambassador (15+ referrals) — earn free GasCap™ Pro for life (no subscription ever required), plus 3× daily drawing entries; Elite Ambassador (30+ referrals) — Pro for life, 5× daily drawing entries, recognition in the Top Ambassadors list, early feature access, and a personal thank-you from the GasCap™ team.',
      },
      {
        q: 'How many free months can I earn through referrals?',
        a: 'You can earn up to 6 free Pro months through the referral program — 1 free month per paying referral, credited within 24 hours of their first payment. Once you reach 6 banked months, free month credits stop — but your referral count keeps climbing toward Pro for Life at 15 paying referrals. Credits are valid for 12 months and are applied automatically to your next billing cycle (up to 3 at a time).',
      },
      {
        q: 'How do Ambassador tiers affect my monthly drawing entries?',
        a: 'Once you reach a tier, your daily drawing entries are multiplied automatically: Supporter members earn 2 entries per day (up to 62/month); Ambassadors earn 3 entries per day (up to 93/month); Elite Ambassadors earn 5 entries per day (up to 155/month). Streak bonus entries still apply on top. Additionally, all Ambassador tier holders are always eligible to win the monthly drawing — the standard consecutive-month and quarterly restrictions do not apply.',
      },
      {
        q: 'When does my referral count update?',
        a: 'Your referral count updates within 24 hours of your referred friend\'s first payment. Milestones are permanent — once a tier threshold is crossed, it is never revoked regardless of whether referred subscribers later cancel.',
      },
      {
        q: 'What if my referred customers cancel their subscription?',
        a: 'Nothing changes for you. Ambassador tiers are based on cumulative all-time paying referrals, not on how many are still active. If 15 people have ever paid after using your link, you are Ambassador tier — even if some have since cancelled. Your milestone is locked in permanently.',
      },
      {
        q: 'Can I refer myself?',
        a: 'No — self-referrals are blocked at the system level. No credit will be awarded under any circumstance.',
      },
      {
        q: 'I referred someone but they don\'t appear in my referral count.',
        a: 'Confirm that your friend (1) signed up using your exact referral link (gascap.app/signup?ref=YOURCODE) and (2) has an active paid subscription. Free trial sign-ups without a paid plan do not count. Counts update within 24 hours of payment. If both conditions are met and 24 hours have passed, email support@gascap.app with your referral code and their email address.',
      },
    ],
  },
  {
    id: 'streak-rewards',
    title: '🏆 Streak Rewards',
    items: [
      {
        q: 'What are Streak Rewards?',
        a: 'Streak Rewards are free Pro month credits you earn by maintaining a consecutive daily streak. Open the app every day to keep your streak alive. Rewards are in the Share tab under "Streak Rewards."',
      },
      {
        q: 'What milestones earn a free month?',
        a: 'Reaching a 30-day streak earns 1 free Pro month. 90 days earns another. 180 days earns another. 365 days earns a final free Pro month plus Legend status — 4 free months total if you reach one year.',
      },
      {
        q: 'How do I redeem a banked free month?',
        a: 'Email support@gascap.app from your account email and mention your banked streak credit. We\'ll apply it to your next billing cycle.',
      },
      {
        q: 'Does breaking my streak affect credits I already earned?',
        a: 'No. Once a milestone is hit, the credit is banked permanently (valid for 12 months). Your streak resets to zero but you keep the credit.',
      },
      {
        q: 'When does a new streak day start?',
        a: 'Each day starts at midnight in your own local time zone — Eastern, Central, Mountain, Pacific, Hawaii, or anywhere else. GasCap™ uses your device\'s clock, so there\'s no unfair cutoff for users outside the East Coast.',
      },
    ],
  },
  {
    id: 'account',
    title: '👤 Account & Privacy',
    items: [
      {
        q: 'How do I reset my password?',
        a: 'On the sign-in page, tap "Forgot password?" Enter your email and we\'ll send a reset link valid for 1 hour.',
      },
      {
        q: 'Why do I need to verify my email?',
        a: 'Email verification protects your account and ensures we can reach you for important notices. Check your inbox and spam folder for a verification email from support@gascap.app.',
      },
      {
        q: 'What data does GasCap™ collect?',
        a: 'GasCap™ collects the information you provide (email, vehicle info, fill-up logs) and basic usage data to improve the app. We do not sell your personal data. See our Privacy Policy for full details.',
      },
      {
        q: 'How do I update my display name or phone number?',
        a: 'Go to Settings → Profile. You can update your display name (shown in the app instead of your full name) and your phone number. Your phone number is optional and used only for SMS notifications if you choose to opt in.',
      },
      {
        q: 'How do I opt into SMS text message notifications?',
        a: 'Go to Settings → Profile. Enter your phone number, then check the "SMS Notifications" box. By opting in you consent to receive account alerts, gas price notifications, fill-up reminders, and occasional promotional messages from Gas Capacity LLC. Message & data rates may apply. You must be 18 or older to opt in.',
      },
      {
        q: 'How do I opt out of SMS messages?',
        a: 'Reply STOP to any text message from GasCap™ to unsubscribe immediately. You can also go to Settings → Profile and uncheck the "SMS Notifications" box. Either method stops all further SMS from us.',
      },
      {
        q: 'How do I opt out of marketing emails?',
        a: 'Use the unsubscribe link in any GasCap™ email, or email support@gascap.app and we\'ll remove you from marketing communications. Transactional emails (receipts, password resets) are not affected.',
      },
      {
        q: 'How do I delete my account?',
        a: 'Email support@gascap.app with your account email address and we\'ll permanently delete your account and all associated data within 30 days.',
      },
    ],
  },
  {
    id: 'troubleshooting',
    title: '🔧 Troubleshooting',
    items: [
      {
        q: 'Gas price lookup isn\'t working.',
        a: 'Make sure you\'ve allowed location access in your browser settings. If it still fails, the EIA data service may be temporarily unavailable — try again later or enter a price manually.',
      },
      {
        q: 'VIN scan isn\'t reading my VIN correctly.',
        a: 'Ensure good lighting, hold the camera steady, and make sure the full 17-character VIN is in frame. The VIN is usually on the driver-side dashboard or door jamb sticker. If scanning fails, type your VIN manually.',
      },
      {
        q: 'Receipt scan isn\'t filling in my details.',
        a: 'Make sure the receipt is flat, well-lit, and fully in frame. Both pay-at-pump and final store receipts are supported. If the scan fails, enter your gallons, price, and total manually.',
      },
      {
        q: 'The app isn\'t updating after I upgraded my plan.',
        a: 'Sign out and sign back in to refresh your session. On the PWA, pull down from the top to refresh. If the issue persists, clear your browser cache or reinstall the PWA.',
      },
      {
        q: 'My streak didn\'t count today even though I used the app.',
        a: 'Make sure you\'re signed in — streaks only count for registered users. Each new streak day is counted at midnight in your device\'s local time zone, so whether you\'re on the East Coast, Central, Mountain, Pacific, or any other time zone, your streak resets at midnight where you are. If you used the app and the streak didn\'t increment, sign out and back in to force a session refresh.',
      },
      {
        q: 'My Pro features disappeared after my trial ended.',
        a: 'At the end of the 30-day free trial, your account automatically reverts to the free plan. No charge is ever applied — you simply lose access to Pro-only features (fill-up tracking, MPG charts, AI Advisor, etc.). To restore Pro access, go to Settings → Plan → "Upgrade to Pro." A reminder banner appears in the app starting 15 days before your trial expires so you have plenty of notice.',
      },
      {
        q: 'The AI Fuel Advisor isn\'t responding.',
        a: 'The AI Fuel Advisor requires an internet connection and an active Pro or Fleet plan. If you\'re connected and subscribed and it\'s still unresponsive, try refreshing the app. If the issue continues, email support@gascap.app.',
      },
      {
        q: 'I\'m having a different issue not listed here.',
        a: 'Use the "Share Feedback" button (bottom-right corner of the app) to describe what\'s happening, or email support@gascap.app. We typically respond within 1 business day.',
      },
    ],
  },
  {
    id: 'about',
    title: 'ℹ️ About',
    items: [
      {
        q: 'What does "Powered by VNetCard™" mean in the footer?',
        a: 'GasCap™ is built and operated by the same team behind VNetCard™ — a digital business card platform. The "Powered by VNetCard™" badge in the footer is simply a nod to the parent product. VNetCard™ has no access to your GasCap™ account or data. If you\'re curious about VNetCard™, visit vnetcard.com.',
      },
      {
        q: 'Who is Gas Capacity LLC?',
        a: 'Gas Capacity LLC is the Florida-based company that owns and operates GasCap™. It is a registered Florida LLC. For legal or business inquiries, contact admin@gascap.app.',
      },
      {
        q: 'How do I contact GasCap™ support?',
        a: 'Visit gascap.app/contact to send us a message, or email support@gascap.app — we respond within 1 business day. You can also use the "Share Feedback" button (bottom-right corner of the app). Live chat is available when visiting gascap.app on a desktop or laptop computer.',
      },
    ],
  },
];

// ── Sub-components ─────────────────────────────────────────────────────────

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div className="border-b border-slate-100 last:border-0 py-4">
      <p className="text-sm font-black text-[#1E2D4A] mb-1.5">{q}</p>
      <p className="text-sm text-slate-600 leading-relaxed">{a}</p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-[#eef1f7]">

      <StaticPageHeader active="help" />

      {/* ── Sticky section nav ─────────────────────────────────────────── */}
      <div className="sticky top-[52px] z-20 bg-[#eef1f7]/95 backdrop-blur-sm border-b border-slate-200">
        <div
          className="flex gap-2 px-4 py-2.5 overflow-x-auto"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="flex-shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full
                         bg-white border border-slate-200 text-slate-600
                         hover:border-[#1EB68F] hover:text-[#1EB68F]
                         active:bg-[#1EB68F] active:text-white active:border-[#1EB68F]
                         transition-colors whitespace-nowrap shadow-sm"
            >
              {s.title}
            </a>
          ))}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-5 py-8 pb-20">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-black text-[#1E2D4A] leading-tight">Help &amp; Support</h1>
          <p className="text-sm text-slate-500 mt-2">
            Find answers below, or{' '}
            <a href="mailto:support@gascap.app" className="text-[#FA7109] font-semibold hover:underline">
              contact us
            </a>{' '}
            and we&apos;ll respond within 1 business day.
          </p>
        </div>

        {/* FAQ sections */}
        <div className="space-y-6">
          {SECTIONS.map((s) => (
            <section
              key={s.id}
              id={s.id}
              className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6
                         scroll-mt-24"
            >
              <h2 className="text-base font-black text-[#1E2D4A] mb-1">{s.title}</h2>
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
            Our team typically responds within 1 business day.
          </p>
          <a
            href="mailto:support@gascap.app"
            className="inline-block bg-[#FA7109] hover:bg-orange-400 text-white
                       font-black text-sm px-6 py-3 rounded-2xl transition-colors"
          >
            Email support@gascap.app
          </a>
          <p className="text-white/40 text-xs mt-4">
            You can also use the{' '}
            <span className="text-[#FA7109] font-semibold">💬 Share Feedback</span>{' '}
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
