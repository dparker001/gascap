# GasCap™ Ambassador Program — Google Form Specifications

> Last updated: 2026-04-22
> Owner: Don Parker (admin@gascap.app)
> Form purpose: Post-placement reporting — submitted by ambassador immediately after each placard placement

---

## Form 1: Ambassador Placement Report

**Form title:** GasCap™ Ambassador — Placement Report
**Form description:** Submit this form immediately after placing each placard. It takes about 90 seconds. Your placements cannot be counted toward rewards until this form is submitted.

**Destination:** Google Sheet titled "GasCap™ Master Placement Log" (auto-populates via Forms → Sheets link)

---

### Fields

| # | Field Label | Type | Required | Notes |
|---|---|---|---|---|
| 1 | Placard Code | Short answer | ✅ | e.g. ORL003C — printed on back of placard. Add helper text: "Printed on the back of your placard in small text." |
| 2 | Business Name | Short answer | ✅ | |
| 3 | Business Address (Street, City, ZIP) | Short answer | ✅ | |
| 4 | Owner / Manager Name | Short answer | ✅ | |
| 5 | Owner / Manager Phone | Short answer | ✅ | |
| 6 | Owner / Manager Email | Short answer | ✅ | Used for GHL automation thank-you email |
| 7 | Placement Type | Multiple choice | ✅ | Options: Pump (exterior), Counter / Register, Waiting Room, Window (cling), Bulletin Board, Other |
| 8 | Consent Form Signed? | Multiple choice | ✅ | Options: Yes — signed, No — declined to sign, Will sign on follow-up visit |
| 9 | Photo of Placard In Place | File upload | ✅ | Set to allow only image files. Max 1 file. Required for reward counting. |
| 10 | Your Ambassador Name | Short answer | ✅ | Pre-fill from URL parameter if using unique ambassador links |
| 11 | Notes / Other Details | Paragraph | ❌ | Optional — hours, best contact time, any special circumstances |

---

### Form Settings

- **Response collection:** Requires Google sign-in → OFF (keep anonymous for ease of use)
- **Email responses to submitter:** OFF
- **Confirmation message:** "Thanks! Your placement has been logged. Placements count toward your monthly reward once verified. Keep going! 🚀"
- **Collect email addresses:** ON (set to "Responder input" so ambassador can optionally include their email)
- **Shuffle question order:** OFF
- **Limit to 1 response:** OFF (ambassadors submit multiple)

---

### Google Sheet Auto-Population

When form is linked to Google Sheets (Responses → Create Spreadsheet):

**Sheet name:** Master Placement Log
**Tab name:** Form Responses 1

**Additional columns to add manually** (right of form response columns):

| Column | Header | Purpose |
|---|---|---|
| Auto | Timestamp | Added by Google Forms |
| Manual | Verified (Y/N) | Don marks Y after reviewing photo + consent |
| Manual | Reward Month | e.g. "2026-05" — for monthly reward calculation |
| Manual | Ambassador Tier | Starter / Builder / Elite — calculated from active placement count |
| Manual | Scans This Month | Pull from admin dashboard monthly |
| Manual | Signups This Month | Pull from admin dashboard monthly |
| Manual | Bonus Eligible? | Y if signups ≥ 10 in month |
| Manual | Notes | Internal admin notes |

---

## Form 2: Ambassador Application / Intake Form

**Form title:** GasCap™ Field Ambassador — Apply Now
**Form description:** Interested in earning gas cards by placing GasCap™ displays at local businesses? Fill this out and we'll be in touch within 48 hours.

**Destination:** Google Sheet titled "GasCap™ Ambassador Applications"
**GHL Trigger:** Webhook from Google Sheet → GHL creates contact + tags ambassador-applicant + triggers review notification to Don

---

### Fields

| # | Field Label | Type | Required | Notes |
|---|---|---|---|---|
| 1 | Full Name | Short answer | ✅ | |
| 2 | Email Address | Short answer | ✅ | Used for GHL contact creation |
| 3 | Phone Number | Short answer | ✅ | |
| 4 | City / ZIP Code | Short answer | ✅ | Territory assignment |
| 5 | Do you have reliable transportation? | Multiple choice | ✅ | Options: Yes — I have a car, No |
| 6 | Are you currently a gig worker? (Uber, Lyft, DoorDash, etc.) | Multiple choice | ❌ | Options: Yes, No, Sometimes |
| 7 | How many hours per week can you dedicate? | Multiple choice | ✅ | Options: 1–3 hrs, 4–8 hrs, 8+ hrs |
| 8 | How did you hear about this? | Multiple choice | ❌ | Options: Facebook Group, Facebook Ad, Friend/Referral, Reddit, Other |
| 9 | Tell us why you're a good fit (optional) | Paragraph | ❌ | |

---

### Application Form Settings

- **Confirmation message:** "Thanks for applying! We review applications within 48 hours and will reach out to accepted ambassadors by email. — Don @ GasCap™"
- **Collect email addresses:** ON (Responder input)

---

## Zapier / Make Automation: Form → GHL

If using Zapier to bridge Google Forms → GHL:

**Trigger:** New form response (Google Forms)
**Action 1:** Search GHL contacts by email
**Action 2:** Create or update GHL contact with:
- First name, last name, email, phone, city from form fields
- Tag: `pilot-partner-candidate` (business owner form) OR `ambassador-applicant` (application form)
**Action 3:** Trigger GHL workflow by tag

Alternatively, configure GHL's native Google Forms integration under:
**GHL → Settings → Integrations → Google Forms**

---

## Ambassador Unique Form Links (Optional, Advanced)

To pre-fill the "Your Ambassador Name" field so ambassadors don't have to type it each time:

Base URL: `https://docs.google.com/forms/d/[FORM_ID]/viewform?usp=pp_url&entry.[FIELD_ID]=[Ambassador+Name]`

Create a shortened link per ambassador:
- `gascap.app/report/orlando1` → pre-filled for Orlando Ambassador 1
- `gascap.app/report/orlando2` → pre-filled for Orlando Ambassador 2

Implement as Next.js redirect in `next.config.js` or as short link in GHL.
