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

- Store icon 128×128 — included in the zip (icons/icon128.png). ✅
- At least 1 screenshot, 1280×800 or 640×400 (PNG/JPEG):
  1. `store-screenshot-1.png` — the extension popup. ✅ still accurate.
  2. `store-screenshot-2.png` — the in-page fill bar on an application. ✅ still accurate.
  3. `store-screenshot-3.png` — the dashboard. ⚠️ **STALE — regenerate before submitting.**
- (Optional) Small promo tile 440×280.

### Regenerating screenshot 3

All three were hand-drawn mocks. That was fine until the dashboard was rebuilt on
2026-07-22: #3 still shows the fake macOS titlebar (the three traffic-light dots) that no
longer exists, so it advertises a UI we don't ship.

`store/screenshot-3-source.html` replaces the drawing with the **real dashboard in an
iframe**, so it can't drift again — re-render it after any UI change and it tells the
truth by construction. To produce the PNG:

```
# from the repo root
node -e "const h=require('http'),f=require('fs'),p=require('path');h.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/OfferAIO.html';f.readFile(p.join(process.cwd(),u),(e,d)=>{if(e){s.writeHead(404);return s.end()}s.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png'}[p.extname(u)]||'application/octet-stream'});s.end(d)})}).listen(8099)"
# then open http://localhost:8099/store/screenshot-3-source.html
```

Capture it at a **1280×800 viewport** and save as `store/store-screenshot-3.png`. In
Chrome: DevTools → Ctrl+Shift+M (device toolbar) → set 1280×800 → ⋮ → "Capture screenshot".
That gives an exact-size PNG; a plain window screenshot does not, because the browser
window can't be sized to an exact viewport and the capture gets rescaled to a lossy JPEG.
The page is already laid out for exactly 1280×800 — the headline is `white-space:nowrap`
because wrapping pushes the subtitle into the dashboard frame.
