# GasCap™ Ambassador Email Templates — GHL Upload Guide

The GHL MCP tool has a schema bug that blocks programmatic template creation.
Upload these 4 templates manually using the steps below. Takes ~10 minutes total.

---

## Files

| File | GHL Template Name | Subject Line |
|---|---|---|
| `01-business-owner-thankyou.html` | Ambassador Program — Business Owner Thank-You | Thanks for hosting a GasCap™ placard, {{contact.business_name}}! |
| `02-ambassador-welcome.html` | Ambassador Onboarding — Email 1: Welcome | Welcome to the GasCap™ Ambassador Program 🎉 |
| `03-ambassador-pitch-script.html` | Ambassador Onboarding — Email 2: Pitch Script | Your exact pitch script (memorize this) 📋 |
| `04-ambassador-kit-walkthrough.html` | Ambassador Onboarding — Email 3: Kit Walkthrough | Your ambassador kit is on the way — here's what's inside 📦 |

---

## Upload Steps (repeat for each file)

1. Open **GHL → Marketing → Emails → Templates**
2. Click **New** → **HTML Editor**
3. Paste the **entire contents** of the `.html` file into the HTML editor
4. Set the **Template Name** (from the table above)
5. Set the **Subject Line** (from the table above)
6. Click **Save**
7. Note the template ID — you'll need it when configuring the automation workflows

---

## Before Going Live

- Replace `{{placement_form_url}}` in template 04 with the actual Google Form URL
  (see `docs/AMBASSADOR_GOOGLE_FORM.md` for form setup)
- Add the GasCap™ logo image to each template header using the GHL image block
  (replace the text "GasCap™" placeholder in the `.header` div)
