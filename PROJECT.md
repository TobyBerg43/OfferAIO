# OfferAIO — Project Handoff / Context

Single source of truth for the OfferAIO project. Any assistant or person should be
able to read this file and pick up the work without re-discovering anything.
**Last updated: 2026-07-19.**

---

## 1. What OfferAIO is
OfferAIO helps students auto-apply to Summer 2027 internships **in their own browser**.
It watches live internship postings, fills each application across the major applicant
tracking systems, drafts cover letters in the user's voice, and lets the user review and
submit. Positioning: *"Auto apply to internships while in class."*

- **Live site:** https://offeraio.com
- **Onboarding:** https://offeraio.com/start.html
- **Dashboard (web app):** https://offeraio.com/dashboard/ → `OfferAIO.html` (~82KB)
- **Privacy policy:** https://offeraio.com/privacy.html
- **Repo:** https://github.com/TobyBerg43/OfferAIO (owner: TobyBerg43)

## 2. Product architecture (important)
The **Chrome extension is the actual product**. The website is the marketing site +
onboarding + a companion dashboard. There is **no signup, no auth, and no accounts** —
the extension stores the user's profile locally in `chrome.storage.local`, so the free
tier needs zero backend. `extension/bridge.js` lets offeraio.com push the profile into
the extension (the "sync" glue).

Flow: land on site → **Start free** → `/start.html` → install extension → pin → fill
profile → open any posting → click Fill → review → submit.

There is also an optional **local desktop engine** (Electron, `desktop/`) that the
dashboard can talk to on `http://127.0.0.1:7717` for real (non-simulated) applying.

## 3. Tech stack
- **Source + hosting:** GitHub repo, deployed by **GitHub Pages** (`CNAME` = offeraio.com).
- **`.nojekyll` is committed** — the site is pure static HTML. Jekyll is skipped entirely.
  (Added 2026-07-19 after Jekyll builds failed on GitHub's `jekyll-github-metadata` API
  returning persistent 503s. Do **not** delete this file — it also makes deploys faster.)
- **CDN/DNS:** Cloudflare. Account id `4062b706ecb83a30bdfcabc85c6f22be`, zone `offeraio.com`.
- **Waitlist:** Web3Forms (hero email form on the landing page).
- **Cover letters:** Cloudflare Worker (`offeraio-worker`) calling the Anthropic API.
  Needs secret `ANTHROPIC_API_KEY` — **still unset** (see TODOs).
- **Analytics:** GA4, measurement id `G-QP59EKE1BS`.

## 4. Deploy process (how changes go live)
1. Commit to `main` (easiest: `github.com/TobyBerg43/OfferAIO/upload/main[/<subdir>]`).
2. GitHub Pages rebuilds (~1 min). Check **Actions → pages build and deployment**.
3. **Purge the Cloudflare cache:** dash.cloudflare.com → offeraio.com → Caching →
   Configuration → **Purge Everything**. New URLs don't need it; changed ones do.
4. Verify by loading the live URL (add `?v=n` to bypass cache while testing).

Large files (`landing.html`, `OfferAIO.html`) are edited with **exact-match patch
scripts** (Node `String.replace`, failing loudly if a target string is missing) rather
than retyping them. There's also a manual-dispatch "Patch dashboard" Action
(`patch.yml` + `patch_dashboard.js`) using the same pattern.

⚠️ **Known hazard:** extension source has been silently reverted once by a parallel
session re-uploading old files. After any extension change, verify the raw file on
`main` before assuming it stuck.

## 5. Repo structure
- `index.html` — redirect to landing.html
- `landing.html` — marketing page (hero, demo, features, pricing, FAQ, footer)
- `start.html` — **onboarding**: install → pin → profile → apply, + safety block
- `privacy.html` — privacy policy (required for the Chrome Web Store listing)
- `OfferAIO.html` — the interactive dashboard app
- `extension/` — the Chrome extension (see §7)
- `internships/`, `data/` — programmatic SEO pages + listings, regenerated every 6h
- `pricing/`, `employers/`, `404.html`, `robots`, `sitemap`
- `store/` — Chrome Web Store listing copy + screenshots (see §8)
- `desktop/` — Electron local engine
- `.github/workflows/` — scrape + generate-pages pipeline, patch action
- `.nojekyll` — **do not delete**
- `PROJECT.md` — this file

## 6. Design system
- **Palette:** `--bg:#efe8d9` (cream), `--ink:#2b2823`, `--blue:#33528c`, `--blue2:#4a72b8`,
  gold `#b9822b`, green `#2e9d68`; panel tokens `--w-*`.
- **Fonts:** **Anton** (display headline) + **Playfair Display italic** (accent), via
  Google Fonts. Tokens `--display`, `--serif`.
- **Hero:** frame.io-style **split** — headline + single gold "Start free" CTA + Web3Forms
  waitlist on the left, the live dashboard demo framed on the right (`.hero-grid`,
  `.hero-copy`, `.hero-media`). Headline: *"Auto apply to / internships / while in class."*
  Sentence case — **not** all-caps.
- **Chrome polish:** soft layered shadows + top sheen on cards, hover lift, blue accent
  underline under section headings, marquee edge-fade, flat professional buttons
  (solid muted gold primary, white ghost — no glossy gradients).

## 7. The Chrome extension (`extension/`)
Manifest V3. Name "OfferAIO — Auto Apply", v1.0.0.

Files: `manifest.json`, `popup.html`, `popup.js`, `content.js`, `bridge.js`,
`icons/icon16|48|128.png`.

**Three fixes that must not regress:**
1. `popup.js` is **external** — MV3's CSP blocks inline `<script>`, so an inline popup
   silently does nothing. `popup.html` must reference `<script src="popup.js">`.
2. `manifest.json` must declare `icons` **and** `action.default_icon` (store requires 128px).
3. `offeraio.com` must be in `host_permissions` **and** the `bridge.js` content-script
   matches, or the extension can't talk to the live dashboard.

Behaviour: fills fields across Greenhouse, Lever, Ashby, Workday, SmartRecruiters, iCIMS,
Workable, Jobvite, BambooHR, Breezy, Taleo, Handshake, LinkedIn, ZipRecruiter, Indeed,
Wellfound — matching on autocomplete/name/label attributes. Runs on the user's IP and
session. **CAPTCHAs are never bypassed.** Resume upload stays manual (browsers forbid
scripts attaching files); the field is highlighted instead.

## 8. Chrome Web Store status
- Developer account: **tobybergerbusiness@gmail.com** — registered, dashboard accessible.
- Item created as **Draft**: `OfferAIO — Auto Apply`, item id
  **`hcbchgpjladdfmcammhgbbmkdagcfcgd`**. Zip uploaded, title/summary auto-filled.
- Listing copy, category, permission justifications and data disclosures live in
  `store/OfferAIO-store-listing.md`.
- Screenshots (1280×800) in `store/` — popup, in-page fill bar, dashboard.
- Privacy policy URL to enter: `https://offeraio.com/privacy.html`
- **Remaining:** upload store icon + screenshots, complete the Privacy tab, submit for review.
- The packaged zip is also published on the `extension-latest` GitHub release.

## 9. Pricing
- **Free** — $0, **50 submissions/month**
- **Pro** — $30/mo, **250 submissions/month** ("Most popular")
- The Season plan was removed. Keep the JSON-LD `offers` in `landing.html`'s `<head>` in sync.
- **No billing exists yet.** See §10.

## 10. Planned: Stripe licensing (not built)
Chrome Web Store payments were discontinued, so the standard approach is license keys:
1. **Stripe Payment Link** for Pro ($30/mo).
2. **Stripe webhook → Cloudflare Worker.** On `checkout.session.completed`, generate a key
   (`OA-XXXX-XXXX-XXXX`) and store in KV: `key → {email, status, periodEnd}`. Surface it on
   a `/license?session_id=…` success page + email.
3. **Extension Settings: "Enter license key"** → `Worker /license/verify` → cache result
   ~24h → active key ⇒ quota 250.
4. Webhook also handles `customer.subscription.deleted` / `invoice.payment_failed` →
   status inactive → next verify silently downgrades to Free.

Use **server-side validation**, not offline-signed keys — offline keys can't be revoked
when someone cancels. Note the quota counter lives in `chrome.storage.local`, so
enforcement is inherently soft; that's true of all client-side extensions and is why
heavy auth isn't worth building here.

## 11. Accounts
- GitHub: **TobyBerg43**
- Google (Cloudflare, Chrome Web Store, GA4): **tobybergerbusiness@gmail.com**
- **Never commit secrets.** The Anthropic key belongs only in Cloudflare Worker secrets.

## 12. Open TODOs
1. **Chrome Web Store:** finish the draft listing (icon, screenshots, privacy tab) and submit.
2. **Cloudflare Worker:** set the `ANTHROPIC_API_KEY` secret so cover letters work.
3. **Dashboard UI polish** (agreed, not yet done): remove the fake window chrome /
   traffic-light title bar (it wastes ~20% of the viewport inside a browser tab), fix the
   duplicate identical timestamps in Live activity, add date labels to the 14-day chart,
   and align typography with the landing page.
4. **Stripe licensing** (§10) — deferred until there's demand.
5. Mark GA4 key events once they appear in the Events list.
6. Optional: `/guides/` blog template, comparison pages.

## 13. Conventions for assistants
- Verify the live site after every deploy (load the URL, screenshot).
- After extension edits, re-check the raw file on `main` (see §4 hazard).
- **Never** enter passwords, make payments, or accept legal agreements on the user's
  behalf — hand those back (account creation, fees, agreements, final "Submit for review").
- Chrome blocks extensions from scripting the Web Store gallery; that console can only be
  read via screen capture, not automated.
- Keep this file updated when the project changes.
