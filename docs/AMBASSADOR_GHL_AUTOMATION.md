# GasCap™ Ambassador Program — GHL Automation Setup

> Last updated: 2026-04-22
> Owner: Don Parker (admin@gascap.app)
> Platform: GoHighLevel (GHL) — GasCap sub-account (Location ID: CvoeirX6lIeXP021VqmY)

---

## Overview

Two GHL automations power the ambassador program:

| # | Automation Name | Trigger | Purpose |
|---|---|---|---|
| 1 | Ambassador — Business Owner Welcome | Contact tagged `pilot-partner-candidate` | Sends thank-you email to business that received a placard |
| 2 | Ambassador — Onboarding Sequence | Contact tagged `ambassador` | Sends 3-email welcome series to new field ambassadors |

---

## Automation 1: Business Owner Welcome

### Trigger
**Contact tag added:** `pilot-partner-candidate`

This tag is added by either:
- Manual: Don adds it after reviewing a placement form submission
- Automated: Zapier/Make webhook from Google Form → GHL contact creation

### Steps

```
[TRIGGER] Tag added: pilot-partner-candidate
        ↓
[WAIT] 0 minutes (immediate)
        ↓
[ACTION] Send Email
         Template: "Ambassador Program — Business Owner Thank-You"
         Subject:  Thanks for hosting a GasCap™ placard, {{contact.business_name}}!
         From:     Don Parker <don@gascap.app>
         Reply-to: admin@gascap.app
        ↓
[ACTION] Add Tag: pilot-partner-welcomed
        ↓
[ACTION] Internal Notification (to Don's email)
         Subject:  "New Placement: {{contact.business_name}} — tagged pilot-partner-candidate"
         Body:     Contact name, email, phone, city
        ↓
[END]
```

### Setup in GHL

1. Go to **Automation → Workflows → + New Workflow**
2. Name: `Ambassador — Business Owner Welcome`
3. Trigger: **Contact Tag** → Tag Added → `pilot-partner-candidate`
4. Add action: **Send Email** → select template "Ambassador Program — Business Owner Thank-You"
5. Add action: **Add Tag** → `pilot-partner-welcomed`
6. Add action: **Internal Notification** → configure email to admin@gascap.app
7. Set workflow status: **Published**

---

## Automation 2: Ambassador Onboarding Sequence

### Trigger
**Contact tag added:** `ambassador`

Add this tag to any contact who has been accepted as a field ambassador.

### Steps

```
[TRIGGER] Tag added: ambassador
        ↓
[WAIT] 0 minutes (immediate)
        ↓
[ACTION] Send Email — Email 1: Welcome
         Template: "Ambassador Onboarding — Email 1: Welcome"
         Subject:  Welcome to the GasCap™ Ambassador Program 🎉
        ↓
[WAIT] 1 day
        ↓
[ACTION] Send Email — Email 2: Pitch Script
         Template: "Ambassador Onboarding — Email 2: Pitch Script"
         Subject:  Your exact pitch script (memorize this) 📋
        ↓
[WAIT] 1 day
        ↓
[ACTION] Send Email — Email 3: Kit Walkthrough
         Template: "Ambassador Onboarding — Email 3: Kit Walkthrough"
         Subject:  Your ambassador kit is on the way — here's what's inside 📦
        ↓
[ACTION] Add Tag: ambassador-onboarded
        ↓
[ACTION] Internal Notification (to Don)
         Subject:  "Ambassador onboarding complete: {{contact.full_name}}"
        ↓
[END]
```

### Setup in GHL

1. Go to **Automation → Workflows → + New Workflow**
2. Name: `Ambassador — Onboarding Sequence`
3. Trigger: **Contact Tag** → Tag Added → `ambassador`
4. Add action: **Send Email** → select template "Ambassador Onboarding — Email 1: Welcome"
5. Add action: **Wait** → 1 Day
6. Add action: **Send Email** → select template "Ambassador Onboarding — Email 2: Pitch Script"
7. Add action: **Wait** → 1 Day
8. Add action: **Send Email** → select template "Ambassador Onboarding — Email 3: Kit Walkthrough"
9. Add action: **Add Tag** → `ambassador-onboarded`
10. Add action: **Internal Notification** → configure email to admin@gascap.app
11. Set workflow status: **Published**

---

## GHL Contact Tags — Ambassador Program Reference

| Tag | Applied When | Purpose |
|---|---|---|
| `pilot-partner-candidate` | Business owner consented to placard | Triggers Business Owner Welcome automation |
| `pilot-partner-welcomed`  | After welcome email sent | Prevents duplicate sends |
| `pilot-partner-active`    | Location generating scans | Track active locations |
| `pilot-partner-gold`      | Location reaches 100 signups | Partner Station milestone |
| `ambassador-applicant`    | Applied via intake form | Awaiting review |
| `ambassador`              | Accepted as ambassador | Triggers Onboarding Sequence |
| `ambassador-onboarded`    | Completed 3-email sequence | Prevents duplicate sends |
| `ambassador-active`       | Has at least 1 verified placement | For reward calculation filter |
| `ambassador-starter`      | 1–5 active placements | Reward tier |
| `ambassador-builder`      | 6–15 active placements | Reward tier |
| `ambassador-elite`        | 16+ active placements | Reward tier |

---

## Monthly Reward Workflow (Manual, ~15 min)

Run on the 1st of each month:

1. **Pull ambassador stats:**
   - Open Master Placement Log Google Sheet
   - Count active placements per ambassador (Verified = Y, no zero-scan flag)
   - Check admin dashboard for any placards flagged zero-scans for 2+ weeks
   - Record placement count per ambassador

2. **Assign reward tier:**
   - Add/update tag in GHL: `ambassador-starter`, `ambassador-builder`, or `ambassador-elite`
   - Remove old tier tag

3. **Check bonus eligibility:**
   - Pull "Signups This Month" column from Master Placement Log
   - Flag any location with ≥ 10 signups → mark `Bonus Eligible = Y`

4. **Calculate rewards:**
   | Tier | Reward | Bonus (if applicable) |
   |---|---|---|
   | Starter (1–5) | $25 gas card | +$10–$25 per qualifying location |
   | Builder (6–15) | $50 gas card | +$10–$25 per qualifying location |
   | Elite (16+) | $100 gas card | +$10–$25 per qualifying location |

5. **Distribute via TangoCard:**
   - Log in to TangoCard dashboard
   - Send gas cards (Shell, BP, Chevron, or Exxon) to each ambassador email
   - Record distribution in Google Sheet

6. **Send monthly summary:**
   - In GHL: create a manual email or one-off broadcast to ambassadors tagged `ambassador-active`
   - Include: their placement count, tier, reward amount, top-performing location
   - Encourage: "You're X placements away from the next tier!"

---

## Google Form → GHL Contact Creation (Zapier Setup)

If using Zapier to connect the Placement Report Google Form to GHL:

**Zap 1: New Placement → Create/Update Business Owner Contact**

| Step | App | Action |
|---|---|---|
| Trigger | Google Forms | New response submitted |
| Step 1 | Formatter | Extract owner name, email, phone, business name from response |
| Step 2 | GHL | Search contacts by email |
| Step 3 | GHL | Create contact (if not found) with name, email, phone, business name, tag: `pilot-partner-candidate` |
| Step 4 | GHL | Update contact (if found) — add tag: `pilot-partner-candidate` |

**Zap 2: New Application → Create Ambassador Applicant Contact**

| Step | App | Action |
|---|---|---|
| Trigger | Google Forms | New response (Ambassador Application form) |
| Step 1 | GHL | Search contacts by email |
| Step 2 | GHL | Create or update contact with name, email, phone, city, tag: `ambassador-applicant` |
| Step 3 | Gmail / GHL | Send internal notification to admin@gascap.app |

---

## Prerequisite Checklist

Before activating automations:

- [ ] Upload all 4 email templates to GHL (see `docs/ambassador-email-templates/README.md`)
- [ ] Replace `{{placement_form_url}}` in Email 3 with live Google Form URL
- [ ] Create Placement Report Google Form (see `docs/AMBASSADOR_GOOGLE_FORM.md`)
- [ ] Link Form to Google Sheet (Master Placement Log)
- [ ] Set up Zapier/Make webhook or GHL native Google Forms integration
- [ ] Test Automation 1 by manually adding `pilot-partner-candidate` tag to a test contact
- [ ] Test Automation 2 by manually adding `ambassador` tag to a test contact
- [ ] Verify emails arrive with correct merge field values
- [ ] Set up TangoCard account for gas card distribution
