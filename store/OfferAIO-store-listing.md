# OfferAIO — Chrome Web Store listing kit

Everything to paste into the Developer Dashboard once your account is verified.
Privacy policy URL to enter: **https://offeraio.com/privacy.html**

---

## Product details

**Item name**
OfferAIO — Auto Apply

**Summary** (max 132 chars)
Auto-fill Summer 2027 internship applications across major job boards — in your own browser. You review and submit.

**Category**
Workflow & Planning  (alternative: Productivity)

**Language**
English (United States)

**Detailed description**
OfferAIO fills out internship applications for you — in your own browser, on your own logged-in sessions. Save your details once, then click "Fill" on any supported application page and OfferAIO completes the fields in seconds. You always review and submit.

Works across the major applicant tracking systems, plus any employer link you paste:
Greenhouse, Lever, Ashby, Workday, SmartRecruiters, iCIMS, Workable, Jobvite, BambooHR, Breezy, Taleo, Handshake, LinkedIn Jobs, ZipRecruiter, Indeed, and Wellfound.

How it works
• Save your profile — name, school, major, grad date, work authorization, LinkedIn, and an optional cover-letter template. Or sync it from your OfferAIO dashboard at offeraio.com.
• Open an application and click "Fill". OfferAIO matches and completes the standard fields, and drafts your cover letter from your own words.
• Review everything, attach your resume (highlighted for you), and submit.

Built to be safe and honest
• Runs in your browser, on your IP and your sessions — nothing is sent from a server pretending to be you.
• You approve every submission. A semi-auto mode fills and waits for you; full-auto is opt-in and clearly labeled.
• CAPTCHAs are never bypassed — if one appears, it's handed back to you.
• Your resume is never uploaded or transmitted by the extension; the file field is highlighted so you attach it yourself.
• Your profile is stored locally in your browser, not on our servers.

Free to install and use — 50 submissions a month, no account required. Pro ($30/month) raises that to 250 and adds AI cover letters written in your own voice.

Learn more at https://offeraio.com

---

## Privacy practices tab

**Single purpose**
OfferAIO fills internship application forms on supported job sites with the user's saved profile, in the user's own browser, so the user can review and submit them.

**Permission justifications**
- storage — Save the user's application profile (name, school, contact details, cover-letter template) locally in the browser, plus their monthly submission count and, on the paid plan, their license key.
- activeTab — Act on the application page the user is currently viewing when they click "Fill".
- scripting — Inject the form-filler into that page on demand to complete the fields.
- Host permissions (the job sites listed) — Fill application form fields on those application pages.
- offeraio.com — Let the OfferAIO dashboard sync the user's profile into the extension, and hand the dashboard the license key it needs to request a cover letter.
- tobyberg43.github.io — The same dashboard served from its GitHub Pages origin, used for staging and as a fallback if the custom domain is unavailable.
- offeraio-worker.tobybergerbusiness.workers.dev — Our own backend. Used only to verify that a paid license key is still active and to request an AI cover letter the user asked for. No browsing data is sent to it.

**Data collected / usage disclosures** (check these in the form)
- Personally identifiable information (name, email address, phone number): YES — collected.
- Web history / location / financial / health / authentication info: NO.
- The profile is stored locally on the user's device and is used only for the single purpose above.
- Transferred to third parties only for a feature the user actively invokes: OpenAI, to generate a cover letter they requested; and Stripe, to process a subscription payment. **Not sold.**
- Not used for purposes unrelated to the single purpose; not used for creditworthiness or lending.

⚠️ **The "not sold or transferred" box cannot be checked as-is.** The paid tier sends the
company, role and the profile fields needed to write the letter to our Worker, which calls
OpenAI. Declare that transfer — it is disclosed in the privacy policy under "Cover-letter
generation (Pro)" and "Licensing and payments (Pro)", and a mismatch between this form and
the policy is a common rejection reason.

**Privacy policy URL**
https://offeraio.com/privacy.html

---

## Graphic assets you still need to upload

- Store icon 128×128 — included in the zip (icons/icon128.png). ✅ **New logo as of
  2026-08-04** — if the draft listing already has the old blue "O" icon uploaded,
  replace it.
- Screenshots, all three exactly 1280×800 PNG, regenerated 2026-08-04 with the new logo.
  ✅ Upload as-is:
  1. `store-screenshot-1.png` — the extension popup.
  2. `store-screenshot-2.png` — the in-page fill bar on an application.
  3. `store-screenshot-3.png` — the dashboard.
- (Optional) Small promo tile 440×280 — not made.

### Regenerating the screenshots

```
node store/regenerate.mjs      # from the repo root
```

That's the whole procedure. It serves the repo, drives headless Chrome, writes all three
PNGs and fails loudly if any comes out at the wrong size.

**Why it exists.** All three used to be hand-drawn pictures of the product, and pictures
rot: #3 still showed the fake macOS titlebar deleted on 2026-07-22, and #1 showed a popup
with no plan badge, no quota meter and no License section, none of which existed when it
was drawn. The listing was advertising a product we no longer shipped.

Each `screenshot-N-source.html` now frames the **real thing** — the live dashboard, the
real `popup.html` running the real `popup.js`, and the real `content.js` actually filling
a form and rendering its own bar (the "Filled 11 fields … 32 of 50 left" text in #2 is
genuine output, not typography). Only `chrome.storage.local` is stubbed, because it
doesn't exist outside an extension context; it's seeded with an ordinary Free user at
18/50. **Re-run the script after any UI change** and the listing corrects itself.

Two deliberate fakes, both documented in the source files: the employer in #2
("Northgate Systems") is invented, because putting a real company's branded application
page in our store listing isn't ours to do; and `scrollIntoView` is stubbed out in #2 so
the highlighted resume field doesn't scroll itself out of frame mid-capture.
