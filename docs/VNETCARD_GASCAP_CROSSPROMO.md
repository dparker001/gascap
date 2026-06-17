# vNetCard™ × GasCap™ — Insider Cross-Promo Campaign

**Goal:** turn paying vNetCard™ customers into GasCap advocates (self-funding referral loop).
**Audience:** active monthly-paying vNetCard subscribers in GHL location `8oiEKtKPU1gvhSH5JF9p`.
**Send via:** GHL (their warm CRM) — NOT GasCap's Resend.

## The offer
- Get **GasCap Pro for LIFE** — one-time **$19.99** (normally a recurring plan).
- **+ a complimentary resort getaway certificate** (standing Lifetime perk).
- **Refer friends who download GasCap** (verified free sign-ups):
  - **5 sign-ups → 1 free month of vNetCard** (~$19–24 value)
  - **10 sign-ups → 2 free months**
- Must use their **vNetCard email** for GasCap so we can match + credit.

---

## EMAIL — MONTHLY customers (styled HTML — paste into GHL HTML block)

**Subject:** `vNetCard™ Members-Only: GasCap™ Pro for life + a free resort getaway 🎁`
**Preview text:** `vNetCard™ partnered with GasCap™ — Pro for life, a free getaway, and earn free vNetCard™ months.` (embedded as a hidden preheader at the top of the HTML below — also set it in GHL's preview-text field.)

> ℹ️ The **subject** is set in GHL's Subject field — it is NOT part of the HTML body below. The HTML is the email body only; the hidden preheader `<div>` just embeds the preview text as a fallback.

```html
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;color:transparent;height:0;width:0;">vNetCard&trade; partnered with GasCap&trade; &mdash; Pro for life, a free getaway, and earn free vNetCard&trade; months.&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f7;padding:32px 16px;font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;">
  <tr><td align="center">
    <table width="100%" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">
      <tr><td style="background:#1e2d4a;padding:20px 32px;text-align:center;">
        <span style="font-size:16px;font-weight:900;color:#fff;letter-spacing:.5px;">vNetCard&trade; <span style="color:#1EB68F;">&times;</span> GasCap&trade;</span>
        <div style="margin-top:4px;font-size:11px;color:#94a3b8;">Partner offer &middot; members only</div>
      </td></tr>
      <tr><td style="padding:32px;">
        <p style="margin:0 0 14px;font-size:18px;font-weight:900;color:#1e2d4a;">Hi {{contact.first_name}}, you've got the VIP deal &#127881;</p>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#475569;">Big news for vNetCard&trade; members: <strong>we partnered with GasCap&trade;</strong> &mdash; the app that ends guessing at the gas pump.</p>
        <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#475569;">Tell GasCap&trade; your tank size and fuel level, and it instantly shows exactly how many gallons you need and what you'll pay &mdash; using real local prices. Plus:</p>
        <ul style="margin:0 0 22px;padding-left:20px;font-size:14px;line-height:1.7;color:#475569;">
          <li>Live local gas prices</li>
          <li>Rental Car return mode (skip the refuel fee)</li>
          <li>MPG &amp; fill-up tracking</li>
          <li>A monthly gas-card giveaway</li>
        </ul>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef3c7;border:2px solid #f59e0b;border-radius:14px;margin:0 0 22px;">
          <tr><td style="padding:20px 22px;">
            <p style="margin:0 0 12px;font-size:12px;font-weight:900;color:#92400e;letter-spacing:.5px;text-transform:uppercase;">Your members-only offer</p>
            <p style="margin:0 0 8px;font-size:15px;color:#1e2d4a;">&#9989; <strong>GasCap&trade; Pro &mdash; yours for LIFE</strong>, one-time <strong>$19.99</strong> (no subscription)</p>
            <p style="margin:0 0 8px;font-size:15px;color:#1e2d4a;">&#127965;&#65039; <strong>A free resort getaway</strong> &mdash; a complimentary hotel stay, just for joining</p>
            <p style="margin:0;font-size:15px;color:#1e2d4a;">&#127873; <strong>Earn free vNetCard&trade; months</strong> &mdash; refer <strong>5 friends &rarr; 1 free month</strong>, <strong>10 &rarr; 2 free months</strong></p>
          </td></tr>
        </table>
        <p style="text-align:center;margin:0 0 22px;">
          <a href="https://www.gascap.app/upgrade?utm_source=vnetcard&utm_medium=email&utm_campaign=insider" style="display:inline-block;background:#005f4a;color:#fff;font-weight:900;font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none;">Claim my Lifetime + Getaway &mdash; $19.99 &rarr;</a>
        </p>
        <p style="margin:0 0 6px;font-size:13px;font-weight:900;color:#1e2d4a;">3 quick steps:</p>
        <p style="margin:0 0 18px;font-size:13px;line-height:1.7;color:#475569;">
          &#9312; Get Lifetime &mdash; <strong>use this same email</strong> so we can credit your free months.<br/>
          &#9313; Open <strong>Refer &amp; Earn</strong> in GasCap&trade; and grab your link.<br/>
          &#9314; Share it &mdash; every <strong>5 verified sign-ups = 1 free month of vNetCard&trade;</strong> (10 = 2).
        </p>
        <p style="margin:0;font-size:12px;color:#64748b;">&#128242; Native iOS &amp; Android apps launch soon &mdash; GasCap&trade; works in any browser today, and your Pro Lifetime + referrals carry over automatically.</p>
        <p style="margin:18px 0 0;font-size:14px;color:#475569;">Exclusive to vNetCard&trade; members. Thanks for being one. &#128588;<br/>&mdash; The vNetCard&trade; + GasCap&trade; Team</p>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
        <p style="margin:0 0 8px;font-size:10px;line-height:1.5;color:#94a3b8;"><strong>Getaway details:</strong> Hotel stay only &mdash; flights not included. The room rate is complimentary (no timeshare); you cover the nightly taxes &amp; fees (vary by destination) plus your own travel. Must be 21+, live 100+ miles from your destination, and book 30+ days ahead. Your certificate arrives by email within 24 hours of purchase. Full terms at RedeemVacations.com.</p>
        <p style="margin:0 0 8px;font-size:10px;line-height:1.5;color:#94a3b8;"><strong>Free-month details:</strong> Referrals must be verified GasCap&trade; sign-ups (confirmed email). Use the same email on GasCap&trade; as your vNetCard&trade; account so we can match and credit you. Free vNetCard&trade; month(s) are applied to your subscription within a few days of reaching 5 (and 10). One reward set per member.</p>
        <p style="margin:0;font-size:11px;color:#94a3b8;">GasCap&trade; &middot; Know before you go &middot; <a href="https://gascap.app" style="color:#f59e0b;">gascap.app</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
```

## EMAIL — MONTHLY customers (plain-text fallback)

**Preview text** (paste into GHL's "preview text" field): `vNetCard™ partnered with GasCap™ — Pro for life, a free getaway, and earn free vNetCard™ months.`

```
Subject: vNetCard™ Members-Only: GasCap™ Pro for life + a free resort getaway 🎁

Hi {{contact.first_name}},

Big news for vNetCard™ members: we partnered with GasCap™ — the app that ends guessing at the gas pump.

Tell GasCap™ your tank size and fuel level, and it instantly shows exactly how many gallons you need and what you'll pay, using real local prices. Plus:
• Live local gas prices
• Rental Car return mode (skip the refuel fee)
• MPG & fill-up tracking
• A monthly gas-card giveaway

YOUR MEMBERS-ONLY OFFER
✅ GasCap™ Pro — yours for LIFE, one-time $19.99 (no subscription)
🏝️ A free resort getaway — a complimentary hotel stay, just for joining
🎁 Earn free vNetCard™ months — refer 5 friends → 1 free month; 10 → 2 free months

Claim it → https://www.gascap.app/upgrade?utm_source=vnetcard&utm_medium=email&utm_campaign=insider

3 QUICK STEPS
1. Get Lifetime — use this same email so we can credit your free months.
2. Open "Refer & Earn" in GasCap™ and grab your link.
3. Share it — every 5 verified sign-ups = 1 free month of vNetCard™ (10 = 2).

📲 Native iOS & Android apps launch soon — GasCap™ works in any browser today, and your Pro Lifetime + referrals carry over automatically.

Exclusive to vNetCard™ members. Thanks for being one.
— The vNetCard™ + GasCap™ Team

—
Getaway details: Hotel stay only — flights not included. The room rate is complimentary (no timeshare); you cover the nightly taxes & fees (vary by destination) plus your own travel. Must be 21+, live 100+ miles from your destination, and book 30+ days ahead. Your certificate arrives by email within 24 hours of purchase. Full terms at RedeemVacations.com.

Free-month details: Referrals must be verified GasCap™ sign-ups (confirmed email). Use the same email on GasCap™ as your vNetCard™ account so we can match and credit you. Free vNetCard™ month(s) are applied to your subscription within a few days of reaching 5 (and 10). One reward set per member.

GasCap™ · Know before you go · gascap.app
```

## SMS (to vNetCard contacts who opted into marketing SMS)

Send URLs via **GHL trigger links** (tracked, branded, carrier-compliant — never a
public shortener like bit.ly). Build each SMS as a **GHL Snippet** that embeds the
trigger link, then insert the snippet in the workflow's Send-SMS action.

**Trigger links to create** (Marketing → Trigger Links; create in the location you send from):

| Name | Destination URL |
|---|---|
| GasCap Insider — Monthly | `https://www.gascap.app/upgrade?utm_source=vnetcard&utm_medium=sms&utm_campaign=insider` |
| GasCap Insider — Annual  | `https://www.gascap.app/upgrade?utm_source=vnetcard&utm_medium=sms&utm_campaign=insider-annual` |

**MONTHLY SMS snippet** (insert the "GasCap Insider — Monthly" trigger link where marked):

> vNetCard™ partner perk 👋 Get GasCap™ Pro for LIFE + a free resort getaway for $19.99 — and earn FREE vNetCard™ months when you refer. Claim 👉 [Monthly trigger link]
>
> Reply STOP to opt out.

**ANNUAL SMS snippet** (insert the "GasCap Insider — Annual" trigger link):

> vNetCard™ partner perk 👋 Get GasCap™ Pro for LIFE + a free resort getaway for $19.99 — and earn vNetCard™ RENEWAL CREDIT when you refer. Claim 👉 [Annual trigger link]
>
> Reply STOP to opt out.

**No-emoji lean versions** (emojis force Unicode/UCS-2 encoding = 70 chars/segment vs 160 GSM, so they cost more segments — use these to minimize cost):

> Monthly: `vNetCard partner perk: Get GasCap Pro for LIFE + a free resort getaway for $19.99 — and earn FREE vNetCard months when you refer. Claim: [Monthly trigger link] Reply STOP to opt out.`

> Annual: `vNetCard partner perk: Get GasCap Pro for LIFE + a free resort getaway for $19.99 — and earn vNetCard renewal credit when you refer. Claim: [Annual trigger link] Reply STOP to opt out.`

**Compliance:** "Reply STOP to opt out" is included; ensure the opt-in page carries the
"Msg & data rates may apply" + Privacy/Terms disclosure. Only send to contacts opted
into marketing SMS (GHL skips DND/opt-outs automatically).

---

## EMAIL — ANNUAL customers (styled HTML — paste into GHL HTML block)

Annual subscribers get **renewal credit** instead of free months (everything else
is identical; the subject stays the same, but the preview text mentions the credit).
Note the UTM is `insider-annual` for separate attribution.

**Subject:** `vNetCard™ Members-Only: GasCap™ Pro for life + a free resort getaway 🎁`
**Preview text:** `vNetCard™ partnered with GasCap™ — Pro for life, a free getaway, and earn $20–$40 renewal credit.`

**ANNUAL — plain-text fallback:**

```
Subject: vNetCard™ Members-Only: GasCap™ Pro for life + a free resort getaway 🎁

Hi {{contact.first_name}},

Big news for vNetCard™ members: we partnered with GasCap™ — the app that ends guessing at the gas pump.

Tell GasCap™ your tank size and fuel level, and it instantly shows exactly how many gallons you need and what you'll pay, using real local prices. Plus:
• Live local gas prices
• Rental Car return mode (skip the refuel fee)
• MPG & fill-up tracking
• A monthly gas-card giveaway

YOUR MEMBERS-ONLY OFFER
✅ GasCap™ Pro — yours for LIFE, one-time $19.99 (no subscription)
🏝️ A free resort getaway — a complimentary hotel stay, just for joining
🎁 Earn renewal credit — refer 5 friends → $20 off your next renewal; 10 → $40 off

Claim it → https://www.gascap.app/upgrade?utm_source=vnetcard&utm_medium=email&utm_campaign=insider-annual

3 QUICK STEPS
1. Get Lifetime — use this same email so we can credit your renewal.
2. Open "Refer & Earn" in GasCap™ and grab your link.
3. Share it — every 5 verified sign-ups = $20 off your vNetCard™ renewal (10 = $40).

📲 Native iOS & Android apps launch soon — GasCap™ works in any browser today, and your Pro Lifetime + referrals carry over automatically.

Exclusive to vNetCard™ members. Thanks for being one.
— The vNetCard™ + GasCap™ Team

—
Getaway details: Hotel stay only — flights not included. The room rate is complimentary (no timeshare); you cover the nightly taxes & fees (vary by destination) plus your own travel. Must be 21+, live 100+ miles from your destination, and book 30+ days ahead. Your certificate arrives by email within 24 hours of purchase. Full terms at RedeemVacations.com.

Credit details: Referrals must be verified GasCap™ sign-ups (confirmed email). Use the same email on GasCap™ as your vNetCard™ account so we can match and credit you. $20 (at 5 referrals) / $40 (at 10) is applied to your next vNetCard™ renewal. One reward set per member.

GasCap™ · Know before you go · gascap.app
```

**ANNUAL — styled HTML (paste into GHL HTML block):**

```html
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;color:transparent;height:0;width:0;">vNetCard&trade; partnered with GasCap&trade; &mdash; Pro for life, a free getaway, and earn $20&ndash;$40 renewal credit.&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f7;padding:32px 16px;font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;">
  <tr><td align="center">
    <table width="100%" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">
      <tr><td style="background:#1e2d4a;padding:20px 32px;text-align:center;">
        <span style="font-size:16px;font-weight:900;color:#fff;letter-spacing:.5px;">vNetCard&trade; <span style="color:#1EB68F;">&times;</span> GasCap&trade;</span>
        <div style="margin-top:4px;font-size:11px;color:#94a3b8;">Partner offer &middot; members only</div>
      </td></tr>
      <tr><td style="padding:32px;">
        <p style="margin:0 0 14px;font-size:18px;font-weight:900;color:#1e2d4a;">Hi {{contact.first_name}}, you've got the VIP deal &#127881;</p>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#475569;">Big news for vNetCard&trade; members: <strong>we partnered with GasCap&trade;</strong> &mdash; the app that ends guessing at the gas pump.</p>
        <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#475569;">Tell GasCap&trade; your tank size and fuel level, and it instantly shows exactly how many gallons you need and what you'll pay &mdash; using real local prices. Plus:</p>
        <ul style="margin:0 0 22px;padding-left:20px;font-size:14px;line-height:1.7;color:#475569;">
          <li>Live local gas prices</li>
          <li>Rental Car return mode (skip the refuel fee)</li>
          <li>MPG &amp; fill-up tracking</li>
          <li>A monthly gas-card giveaway</li>
        </ul>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef3c7;border:2px solid #f59e0b;border-radius:14px;margin:0 0 22px;">
          <tr><td style="padding:20px 22px;">
            <p style="margin:0 0 12px;font-size:12px;font-weight:900;color:#92400e;letter-spacing:.5px;text-transform:uppercase;">Your members-only offer</p>
            <p style="margin:0 0 8px;font-size:15px;color:#1e2d4a;">&#9989; <strong>GasCap&trade; Pro &mdash; yours for LIFE</strong>, one-time <strong>$19.99</strong> (no subscription)</p>
            <p style="margin:0 0 8px;font-size:15px;color:#1e2d4a;">&#127965;&#65039; <strong>A free resort getaway</strong> &mdash; a complimentary hotel stay, just for joining</p>
            <p style="margin:0;font-size:15px;color:#1e2d4a;">&#127873; <strong>Earn renewal credit</strong> &mdash; refer <strong>5 friends &rarr; $20 off</strong> your next renewal, <strong>10 &rarr; $40 off</strong></p>
          </td></tr>
        </table>
        <p style="text-align:center;margin:0 0 22px;">
          <a href="https://www.gascap.app/upgrade?utm_source=vnetcard&utm_medium=email&utm_campaign=insider-annual" style="display:inline-block;background:#005f4a;color:#fff;font-weight:900;font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none;">Claim my Lifetime + Getaway &mdash; $19.99 &rarr;</a>
        </p>
        <p style="margin:0 0 6px;font-size:13px;font-weight:900;color:#1e2d4a;">3 quick steps:</p>
        <p style="margin:0 0 18px;font-size:13px;line-height:1.7;color:#475569;">
          &#9312; Get Lifetime &mdash; <strong>use this same email</strong> so we can credit your renewal.<br/>
          &#9313; Open <strong>Refer &amp; Earn</strong> in GasCap&trade; and grab your link.<br/>
          &#9314; Share it &mdash; every <strong>5 verified sign-ups = $20 off your vNetCard&trade; renewal</strong> (10 = $40).
        </p>
        <p style="margin:0;font-size:12px;color:#64748b;">&#128242; Native iOS &amp; Android apps launch soon &mdash; GasCap&trade; works in any browser today, and your Pro Lifetime + referrals carry over automatically.</p>
        <p style="margin:18px 0 0;font-size:14px;color:#475569;">Exclusive to vNetCard&trade; members. Thanks for being one. &#128588;<br/>&mdash; The vNetCard&trade; + GasCap&trade; Team</p>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
        <p style="margin:0 0 8px;font-size:10px;line-height:1.5;color:#94a3b8;"><strong>Getaway details:</strong> Hotel stay only &mdash; flights not included. The room rate is complimentary (no timeshare); you cover the nightly taxes &amp; fees (vary by destination) plus your own travel. Must be 21+, live 100+ miles from your destination, and book 30+ days ahead. Your certificate arrives by email within 24 hours of purchase. Full terms at RedeemVacations.com.</p>
        <p style="margin:0 0 8px;font-size:10px;line-height:1.5;color:#94a3b8;"><strong>Credit details:</strong> Referrals must be verified GasCap&trade; sign-ups (confirmed email). Use the same email on GasCap&trade; as your vNetCard&trade; account so we can match and credit you. $20 (at 5 referrals) / $40 (at 10) is applied to your next vNetCard&trade; renewal. One reward set per member.</p>
        <p style="margin:0;font-size:11px;color:#94a3b8;">GasCap&trade; &middot; Know before you go &middot; <a href="https://gascap.app" style="color:#f59e0b;">gascap.app</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
```

**Annual SMS:** use the **ANNUAL SMS snippet** (with the "GasCap Insider — Annual" trigger link) from the SMS section above.

---

## Tracking + fulfillment SOP

1. **Build TWO segments** in GHL location `8oiEKtKPU1gvhSH5JF9p`:
   - **(a) Active paying MONTHLY** subscribers → send the main email (free months reward).
   - **(b) Active ANNUAL** subscribers → send the **annual-customer variant** (renewal credit reward).
   Send the matching SMS teaser only to contacts opted into marketing SMS.
2. **Attribution:** link carries `utm_source=vnetcard&utm_campaign=insider`. Ask them to sign up for GasCap with their vNetCard email (the matching key).
3. **Count referrals:** in the GasCap admin panel, look up the member by email → `referredUsers` shows everyone who signed up with their code (with join dates). Count **verified** sign-ups (confirmed email) toward the 5 / 10 thresholds.
   - *Optional improvement:* add a "verified referrals" count to the admin row so this is one glance instead of manual. (Easy to add — ask Claude.)
4. **Fulfill via Stripe** (Stripe runs vNetCard subscriptions) — reward depends on the member's plan:
   - **Monthly customers (free months):** create `VNET-1MO-FREE` (100% off, duration: once) and `VNET-2MO-FREE` (100% off, duration: repeating, 2 months). At **5** verified sign-ups → apply `VNET-1MO-FREE`; at **10** → `VNET-2MO-FREE` (or the 1-mo coupon twice).
   - **Annual customers (renewal credit):** create `VNET-ANNUAL-20` ($20 off, duration: once) and `VNET-ANNUAL-40` ($40 off, duration: once). At **5** → apply `VNET-ANNUAL-20` to their next renewal invoice; at **10** → `VNET-ANNUAL-40`. (Or add a $20/$40 customer-balance credit.)
5. **Getaway fulfillment** is already automated-ish ("Option B"): each Lifetime purchase fires an admin notification to issue the Marketing Boost certificate to the buyer's email.
6. **Cadence:** review qualifiers weekly; credit and notify the member ("🎉 Your free vNetCard month is applied").

## Sending it via a GHL Workflow (automation)

The contacts window can't attach an email template, but a **Workflow → "Send Email"
action has a full editor where you paste the HTML.** Use TWO simple workflows (one
per segment) — most reliable, no branching.

### Step 1 — Create two tags
- `vnetcard-insider-monthly` (enrolls monthly customers)
- `vnetcard-insider-annual` (enrolls annual customers)

### Step 2 — Build each workflow with GHL Workflow AI
Paste this into Workflow AI (run it once for MONTHLY, once for ANNUAL with the swaps noted):

> Create a workflow named **"vNetCard Insider — Monthly"**.
> Trigger: **Contact Tag Added**, tag = **`vnetcard-insider-monthly`**.
> Add these actions in order:
> 1. **Send Email** — create a new email named "Initial offer" (I'll paste my own subject and HTML body afterward).
> 2. **Wait 10 minutes.**
> 3. **Send SMS** — insert the **"GasCap Insider SMS · Monthly"** snippet (contains the "GasCap Insider — Monthly" trigger link; see the SMS section above).
> 4. **Wait 3 days.**
> 5. **If/Else** — condition: the contact **did NOT click the "GasCap Insider — Monthly" trigger link** (and did NOT click a link in the "Initial offer" email).
>    - **"Did NOT click" branch → Send Email** (the 3-day reminder — I'll paste it).
>    - **"Clicked" branch → no action** (they already engaged).
>
> In workflow settings: turn **Re-Entry OFF** (one send per contact) and **respect DND / unsubscribe**. End the workflow after the reminder branch.
>
> Note: keying the non-clicker branch off the **trigger-link click** (not just email opens/clicks) is more accurate — it catches people who converted from the SMS link too, so they don't get a redundant reminder.

**For the ANNUAL workflow**, paste the same prompt but change:
- Name → **"vNetCard Insider — Annual"**
- Trigger tag → **`vnetcard-insider-annual`**
- SMS → insert the **"GasCap Insider SMS · Annual"** snippet ("GasCap Insider — Annual" trigger link)
- Non-clicker condition → did NOT click the **"GasCap Insider — Annual"** trigger link
- 3-day reminder email → use the **ANNUAL reminder** (renewal-credit reward) below.

### Step 3 — Fill in the email content (the part the AI can't do)
Open each workflow's **Send Email** action → email editor → use the **Code/HTML** option →
paste the matching HTML from this doc (MONTHLY email for the monthly workflow, ANNUAL email
for the annual workflow). Set the **Subject** and **Preview text** fields from each section above.

### Step 4 — Enroll the contacts (this is the "send")
1. Build two smart lists in location `8oiEKtKPU1gvhSH5JF9p`: active paying **monthly** subs, and active **annual** subs.
2. Bulk-select the monthly list → **Add Tag** `vnetcard-insider-monthly` → that fires the monthly workflow.
3. Bulk-select the annual list → **Add Tag** `vnetcard-insider-annual` → fires the annual workflow.
4. (SMS) Both workflows only text contacts who can receive marketing SMS; GHL skips DND/opt-outs automatically.

> Tip: test first — add the tag to **your own** contact record in each segment and confirm the email + SMS arrive correctly before bulk-enrolling.

---

### Step 5 — 3-day reminder email (sent only to non-clickers)

Short nudge, **email only** (no second SMS). Paste into the reminder Send Email action.

**Subject (both):** `Still open, {{contact.first_name}}: GasCap™ for life + a free getaway 🎁`
**Preview text (monthly):** `Your vNetCard™ member offer — Pro for life, a free getaway, free vNetCard™ months.`
**Preview text (annual):** `Your vNetCard™ member offer — Pro for life, a free getaway, $20–$40 renewal credit.`

**MONTHLY reminder — HTML:**

```html
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;color:transparent;height:0;width:0;">Your vNetCard&trade; member offer is still open &mdash; Pro for life, a free getaway, free vNetCard&trade; months.&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f7;padding:32px 16px;font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;">
  <tr><td align="center">
    <table width="100%" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">
      <tr><td style="background:#1e2d4a;padding:18px 32px;text-align:center;">
        <span style="font-size:15px;font-weight:900;color:#fff;">vNetCard&trade; <span style="color:#1EB68F;">&times;</span> GasCap&trade;</span>
      </td></tr>
      <tr><td style="padding:28px 32px;">
        <p style="margin:0 0 12px;font-size:17px;font-weight:900;color:#1e2d4a;">Hi {{contact.first_name}}, did you catch this?</p>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#475569;">Quick reminder &mdash; your exclusive vNetCard&trade; member offer is still open:</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef3c7;border:2px solid #f59e0b;border-radius:14px;margin:0 0 20px;">
          <tr><td style="padding:16px 20px;">
            <p style="margin:0 0 6px;font-size:14px;color:#1e2d4a;">&#9989; <strong>GasCap&trade; Pro for life</strong> &mdash; one-time <strong>$19.99</strong></p>
            <p style="margin:0 0 6px;font-size:14px;color:#1e2d4a;">&#127965;&#65039; <strong>A free resort getaway</strong></p>
            <p style="margin:0;font-size:14px;color:#1e2d4a;">&#127873; Refer <strong>5 friends &rarr; 1 free month of vNetCard&trade;</strong> (10 &rarr; 2)</p>
          </td></tr>
        </table>
        <p style="text-align:center;margin:0 0 16px;">
          <a href="https://www.gascap.app/upgrade?utm_source=vnetcard&utm_medium=email&utm_campaign=insider-reminder" style="display:inline-block;background:#005f4a;color:#fff;font-weight:900;font-size:15px;padding:13px 30px;border-radius:12px;text-decoration:none;">Claim it &mdash; $19.99 &rarr;</a>
        </p>
        <p style="margin:0;font-size:13px;color:#475569;">Takes about 2 minutes. Thanks for being a vNetCard&trade; member!<br/>&mdash; The vNetCard&trade; + GasCap&trade; Team</p>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:14px 32px;border-top:1px solid #e2e8f0;">
        <p style="margin:0;font-size:10px;line-height:1.5;color:#94a3b8;">Getaway = complimentary hotel stay (flights not included; you cover nightly taxes &amp; fees). Referrals must be verified GasCap&trade; sign-ups; use the same email on GasCap&trade; as your vNetCard&trade; account. Full terms at RedeemVacations.com. GasCap&trade; &middot; gascap.app</p>
      </td></tr>
    </table>
  </td></tr>
</table>
```

**ANNUAL reminder — HTML:** same as above with two swaps —
- Preheader text → `Your vNetCard&trade; member offer is still open &mdash; Pro for life, a free getaway, $20&ndash;$40 renewal credit.`
- Reward line → `<p style="margin:0;font-size:14px;color:#1e2d4a;">&#127873; Refer <strong>5 friends &rarr; $20 off your renewal</strong> (10 &rarr; $40)</p>`
- CTA link → `utm_campaign=insider-reminder-annual`

**Plain-text reminder (either cohort):**

```
Subject: Still open, {{contact.first_name}}: GasCap™ for life + a free getaway 🎁

Hi {{contact.first_name}}, did you catch this? Quick reminder — your exclusive vNetCard™ member offer is still open:

✅ GasCap™ Pro for life — one-time $19.99
🏝️ A free resort getaway
🎁 Refer 5 friends → 1 free month of vNetCard™ (10 → 2)   [ANNUAL: → $20 off your renewal (10 → $40)]

Claim it → https://www.gascap.app/upgrade?utm_source=vnetcard&utm_medium=email&utm_campaign=insider-reminder

Takes about 2 minutes. Thanks for being a vNetCard™ member!
— The vNetCard™ + GasCap™ Team

Getaway = complimentary hotel stay (flights not included; you cover nightly taxes & fees). Referrals must be verified GasCap™ sign-ups; use the same email on GasCap™ as your vNetCard™ account. Full terms at RedeemVacations.com.
```

---

## Notes / decisions
- Email is the primary channel (deliverability + richer); SMS is a teaser only (A2P-safe).
- Net cost per redeemer ≈ $0 (the $19.99 Lifetime offsets the free vNetCard month) → near-zero CAC for 5–10 new GasCap users + a converted Lifetime customer + an advocate.
- Launch now (warm owned audience, web-based). When the apps are approved, swap the share CTA to "download GasCap on the App Store / Google Play" for an even easier referral ask.
