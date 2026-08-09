# OfferAIO — Project Handoff / Context

Single source of truth for the OfferAIO project. Any assistant or person should be
able to read this file and pick up the work without re-discovering anything.
**Last updated: 2026-08-08.** (Latest change: the **coverage pass** — the dashboard now
says which postings the extension can actually fill. Roughly **half the board cannot be
filled**, and every one of those rows used to offer "Open & fill". See **§16**, then §7
for the `ats` bridge message and §8 for the listing copy that claimed otherwise.
Extension at **v1.3.0**. 143 tests pass, up from 125.
The previous pass — 2026-08-06, the **trust & clarity pass** — removed the simulated
applying: the `setTimeout` chain that walked tasks to "✓ Submitted" and rolled dice for
replies and interviews is gone, and every number on screen derives from applications the
extension genuinely recorded. **§2** is still the one to read first.)

⚠️ Standing hazard, still true: a mis-pathed `wrangler deploy` from the repo root once
auto-created a static worker "ffer" serving the whole repo. Always deploy from `worker/`.

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

### ⚠️ The dashboard queues and tracks. It does not apply. (rewritten 2026-08-06)

This is the single most important rule in the project, and it was violated for the whole
of the product's life until now. `OfferAIO.html` used to walk a task through
`monitoring → match → filling → cover → submitted` on a `setTimeout` chain with random
delays, then roll `Math.random() < 0.65` for a reply and `< 0.45` for an interview. None
of it touched an employer. It printed **"✓ Submitted"** next to a real company pulled from
the live listings database — which is how a closed Veeam req came to be marked as applied
to, and why the founder's first read of the product was "the backend is not functioning."
There is no backend for applying, by design. The simulation was the bug.

The task lifecycle is now, in full:

| Status | Reached by |
| --- | --- |
| `idle` | nothing claimed yet |
| `ready` | a real listing matched the task's filters — instant, no timer |
| `opened` | the user clicked **Open & fill**; the posting is open in a tab |
| `applied` / `unconfirmed` | **only** an application record written by `content.js` |

**No status a user can see is reachable without a real event, and there is no path to
`applied` that does not go through the extension.** `stats`, `dayData` and `catCount` are
derived from the extension's application records on every load and are deliberately *not*
persisted, so there is nowhere for an invented number to survive a refresh. Guarded by
`tests/content-tracker.test.mjs` and by the "no setTimeout drives a status" rule below.

**The dashboard renders nothing until the extension answers the bridge.** With no
extension there is no identity, no usage and no history, so it shows a single connect
card (`#connectGate`). An empty dashboard is not a logged-out state, it is a broken one —
and filling it with sample numbers is what caused all of this.

**"Sign in" is the extension, and that is deliberate.** The dashboard asks the bridge for
`identity` (profile + plan + real monthly usage) and `applications`. Real accounts would
mean a user database, sessions, password reset and a privacy-policy rewrite — weeks of
work to solve a feeling, and it would cost the "nothing leaves your browser" claim that
currently helps sell the product. Do not build them.

**And it cannot fill every posting it lists.** About half the board is on hosts no content
script runs on. The dashboard now says so per row rather than offering to fill them — §16.

There is also an optional **local desktop engine** (Electron, `desktop/`) that the
dashboard can talk to on `http://127.0.0.1:7717` for real (non-simulated) applying.

## 3. Tech stack
- **Source + hosting:** GitHub repo, deployed by **GitHub Pages** (`CNAME` = offeraio.com).
- **`.nojekyll` is committed** — the site is pure static HTML. Jekyll is skipped entirely.
  (Added 2026-07-19 after Jekyll builds failed on GitHub's `jekyll-github-metadata` API
  returning persistent 503s. Do **not** delete this file — it also makes deploys faster.)
- **CDN/DNS:** Cloudflare. Account id `4062b706ecb83a30bdfcabc85c6f22be`, zone `offeraio.com`.
- **Waitlist:** Web3Forms (hero email form on the landing page).
- **Cover letters + ranking:** Cloudflare Worker (`offeraio-worker`) calling the OpenAI
  API. Needs secret `OPENAI_API_KEY` — **still unset** (see TODOs). Source lives in
  `worker/` and deploys from `main`; see §14.
- **AI vendor: OpenAI only.** One key covers both paths — chat for `/cover`, embeddings
  for `/rank`. Anthropic was dropped 2026-07-20 because it has no embeddings API, so
  keeping it meant either a second vendor or a Workers AI binding purely for ranking.
  **`ANTHROPIC_API_KEY` should never be set.**
- **Analytics:** GA4, measurement id `G-QP59EKE1BS`.

## 4. Deploy process (how changes go live)
1. Commit to `main` (easiest: `github.com/TobyBerg43/OfferAIO/upload/main[/<subdir>]`).
2. GitHub Pages rebuilds (~1 min). Check **Actions → pages build and deployment**.
3. **Purge the Cloudflare cache — but only for static assets.** Measured 2026-08-04:
   HTML pages (`/`, `/privacy.html`, `/dashboard/`) come back `cf-cache-status: DYNAMIC`,
   i.e. Cloudflare isn't caching them at all, and edits are live the moment Pages
   finishes. `.js`/`.css` **are** cached (`EXPIRED`/`HIT`). So a page-only change needs
   no purge; a change to `billing.js` — which is exactly the file that changes when the
   Stripe Payment Link is pasted in — does. Purge at dash.cloudflare.com → offeraio.com →
   Caching → Configuration → **Purge Everything** (user-only; there's no API token).
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
- `license.html` — post-checkout page showing the Pro key (noindex); polls the Worker
- `billing.js` — the single place the Stripe Payment Link lives; wires `[data-buy-pro]`
- `OfferAIO.html` — the interactive dashboard app (**canonical**; `engine-server.js`,
  `patch_dashboard.js` and `patch.yml` all address it by this name)
- `dashboard/index.html` — a copy of the above, emitted by `generate_pages.js`. Everything
  on the site links to `/dashboard/`, which previously resolved **only** through a
  Cloudflare rule kept outside version control — so the repo alone did not build a working
  site and a fresh deploy 404'd on the product's main entry point. Don't hand-edit it.
- User state lives in `localStorage`: `oa_profile` (Settings fields) and `oa_state`
  (tasks, stats, feed, radar). Before 2026-08-05 the dashboard held all of it in memory
  and a refresh wiped everything.
- `extension/` — the Chrome extension (see §7)
- `internships/`, `data/` — programmatic SEO pages + listings, regenerated every 6h
- `pricing/`, `employers/`, `404.html`, `robots`, `sitemap`
- `store/` — Chrome Web Store listing copy + screenshots (see §8)
- `desktop/` — Electron local engine
- `worker/` — Cloudflare Worker source (`src/index.js`, `wrangler.toml`) — see §14
- `tests/` — Node tests for extension + pipeline logic (`license.test.mjs`,
  `bridge.test.mjs`, `content-workauth.test.mjs`, `content-tracker.test.mjs`,
  `listings.test.mjs`, and from 2026-08-08 `ats-manifest.test.mjs`,
  `dashboard-canfill.test.mjs`, `version-sync.test.mjs`). Deliberately outside
  `extension/`, which `zip-extension.yml` ships wholesale to the store. `test.yml` globs
  `tests/*.test.mjs`, so a new file runs on its own.
  ⚠️ The last three are **consistency** tests: they read `manifest.json`, `OfferAIO.html`
  and `data/listings.json` off disk and assert the repo agrees with itself. They fail on a
  half-finished change (a version bumped in one file, a dashboard copy not regenerated)
  rather than on broken logic — which is the point, since every rule they check was
  written down in this file first and drifted anyway.
- `.github/workflows/` — scrape + generate-pages pipeline, worker deploy, tests, zip
- ~~`patch_dashboard.js` + `patch.yml`~~ — **deleted 2026-08-06.** All three of its targets
  were already applied and `rep()` throws on a miss, so the manual "Patch dashboard"
  dispatch failed immediately every time it was run. A committed patch script is a
  single-use tool that becomes a landmine the moment it succeeds; write one-shot patches
  outside the repo and let them die with the change.
- `.nojekyll` — **do not delete**
- `README.md` — the map for someone opening the repo for the first time; points here
- `PROJECT.md` — this file
- **Branch `dev-harness`** (not merged, never merged) — `dev/mock-application.html`, a fake
  Greenhouse-style form for testing the extension end to end without submitting anything to
  a real employer. It exercises every branch of the submit tracker, the resume field scripts
  cannot fill, the ambiguous work-auth question, and a dense block where label→input binding
  must refuse to guess. It lives off `main` for two reasons: GitHub Pages publishes every
  file in the repo, so a tracked `dev/` would put a convincing fake job posting live on
  offeraio.com; and using it needs temporary `127.0.0.1`/`localhost` host permissions in the
  extension that must never reach the Web Store. Setup in that branch's `dev/README.md`.

## 6. Design system

### Logo and brand assets (replaced 2026-08-04)
The old mark — a blue gradient tile with a white "O" — is **gone everywhere**. The new
mark is a near-black rounded-square plate (`#060a15`) with a white arch, a violet
gradient stroke (`#553bfa`) and a sparkle.

**Master: `store/logo-master.png`.** Everything else is cut from it by
**`node store/regenerate.mjs`**, which rebuilds, in one pass:

| Output | Used by |
| --- | --- |
| `extension/icons/icon16\|48\|128.png` | the extension + Web Store |
| `favicon-32.png`, `favicon-180.png` | modern favicon + apple-touch-icon |
| `favicon.svg` | **every generated `internships/` page** — rebuilt from the 180px raster |
| `logo-96.png` | nav/header marks (the 512 is ~300KB, far too heavy for a 30px tile) |
| `logo.png` (512) | JSON-LD `Organization.logo`, general use |
| `store/store-icon-128.png` | **the Web Store listing icon** — 96×96 artwork centred in a 128×128 canvas with 16px transparent padding, per Google's image guidelines. Deliberately *not* the same as the extension's edge-to-edge `icon128.png` |
| `og.png` | the social share card, from `store/og-source.html` |
| `store/store-screenshot-{1,2,3}.png` | the Web Store listing |

Two things worth knowing. The master is a 1254² export whose plate sits at
**(121,103) 1012×1012** on near-white, not transparency — the extra ~24px of bounding box
below it is a drop shadow. Each output is masked to a rounded rect at radius 0.222×size,
otherwise the toolbar icon shows white notches on a dark browser theme. And the in-page
bar in `content.js` carries the icon as an **inlined data URI**, because a relative path
there would resolve against the employer's origin, and `chrome.runtime.getURL` would mean
adding `web_accessible_resources` and re-justifying it at Web Store review.

⚠️ **The new mark's palette does not match the site's.** The logo is near-black + electric
violet; the site is cream `#efe8d9` + navy `#33528c` + gold. It reads as intentional
contrast at nav size, but the violet appears nowhere else in the UI. Deliberately **not**
resolved here — swapping the site palette is a rebrand, not a logo swap, and was not asked
for. Decide whether to pull violet into the accents or leave the mark as the only dark
element.

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
Manifest V3. Name "OfferAIO — Auto Apply", **v1.3.0** (1.0.0 → 1.1.0 licensing,
→ 1.1.1 bridge licence relay, → 1.1.2 new logo, → 1.1.3 the three safety fixes below,
→ 1.2.0 the application tracker, the context-aware popup and the identity relay,
→ 1.3.0 the ATS relay and the `*.wellfound.com` host fix, §16).

**`manifest.json` is the single source of truth for the version.** It disagreed four ways
(manifest `1.1.2`, landing `v3.1.0`, dashboard `build 2027.1`, this file `1.1.1`); the
landing page and the dashboard sidebar now both read `v1.3.0`. Bump all three together —
**`tests/version-sync.test.mjs` fails if you don't**, and it also fails if
`dashboard/index.html` is out of date with `OfferAIO.html`. The rule was written here
before and drifted anyway; a comment cannot enforce a convention.

### ⚠️ Four rules in `content.js` that must never regress (1–3 fixed 2026-08-05, 4 on 08-06)

1. **Never assert work authorisation.** `answerFor` used to return a flat `"Yes"` for any
   label matching `/authoriz|eligible to work|legally/`, and route anything containing
   "sponsor" through `needsSponsorship`. On *"Are you authorized to work in the US without
   sponsorship?"* — which contains both — an international student was made to assert the
   opposite of the truth on a legal declaration. `workAuthAnswer()` now answers only
   unambiguous phrasings and returns `NEEDS_USER` otherwise, leaving the field blank,
   outlined amber, and named in the bar. **The `without …sponsor` test must stay ahead of
   the `requires …sponsor` test** — *"can you work without requiring sponsorship"* matches
   both and inverts if ordered wrongly. Tests: `tests/content-workauth.test.mjs` (8 tests,
   which caught exactly that ordering bug mid-fix). F-1 is deliberately never
   auto-answered: CPT/OPT may authorise work, but the right answer varies by question and
   by stage — precisely the judgement not to make on someone's behalf.
2. **Full-auto stops for a missing resume or a flagged question.** Browsers forbid scripts
   from attaching files, so auto-submitting past an empty file input sends a resume-less
   application in the user's name.
3. **Quota is charged only after the submission is evidenced.** It used to count on
   `btn.click()`, so a blocked submit burned a submission *and* reported "Submitted via
   OfferAIO" for an application that never left the page. `doSubmit` runs
   `form.checkValidity()` before clicking **and** waits for a real success signal after
   it — see the application tracker below.
4. **`controlForLabel()` must refuse to guess.** It binds on `for=`, on a control nested
   inside the label, or on a parent holding **exactly one** control, and otherwise binds
   nothing. The old fallback took "the first input under the label's parent", so on a
   dense form every label wrote into the first box and the answer to one question landed
   in another. That is the same class of harm as rule 1: a false answer under the user's
   name. Tests: `tests/content-tracker.test.mjs`.

### The application tracker (added 2026-08-06) — the other half of §2

`content.js` used to click Submit, increment the quota, and forget. Two things wrong with
that: it counted a submission it had no evidence had happened, and it left the dashboard
with nothing real to display. `doSubmit()` now waits for the page to prove the submission
landed, and writes a record to `chrome.storage.local.applications`:

```js
{ company, role, url, ats, submittedAt, fieldsFilled, fieldsTotal, unfilledRequired[], confirmed, signal }
```

Three outcomes, and the distinction between them matters:
- **Evidenced** — the page navigated, the form was replaced, or a confirmation appeared.
  Recorded `confirmed:true`, quota charged, dashboard reads **Applied**.
- **Bounced** — `form.checkValidity()` fails after the click. Nothing recorded, nothing
  counted, and the bar says which field is missing.
- **No signal in 9s** — recorded `confirmed:false`, quota **not** charged, dashboard reads
  **Sent — not confirmed**. Undercounting is the safe direction: PROJECT.md's own rule is
  that a metering bug must never stop someone applying for a job, and a guess that costs a
  user one of their 50 submissions is worse than a quota that runs slightly cold.

`bridge.js` answers `{type:"applications"}`, `{type:"identity"}` and `{type:"ats"}`
(§16) alongside the existing `license`, all behind the same `e.source !== window` guard. `license.js` is now loaded
*before* `bridge.js` in the content-script list so identity reports the real plan through
`OfferAIOLicense.status()` (cache + offline grace) rather than reading storage raw; it
falls back to a raw read if absent, which is what the tests exercise.

`extension/ats.js` is the one list of supported applicant tracking systems, shared by
`content.js` (to label what it filled), `popup.js` (to decide whether the Fill button can
do anything) and, over the bridge, the dashboard. Keep it in step with `manifest.json`; a
host here but not there is a button that lights up and does nothing — which is exactly
what happened on `www.wellfound.com`. **`tests/ats-manifest.test.mjs` now enforces the
agreement in all three directions**; see §16.

⚠️ **`jobs.lever.co` → `*.lever.co` in host permissions.** Lever and Greenhouse run EU
instances (`jobs.eu.lever.co`, `job-boards.eu.greenhouse.io`) that carry **US** roles, and
the old pattern didn't match the Lever one — the extension could not fill a posting the
product was advertising. See §15 before "fixing" anything about `.eu.` hosts.

### The popup says what it will do (2026-08-06)

The Fill button was unconditional: identical on a Greenhouse form, on a new tab and on the
dashboard, and it silently did nothing on two of those three — it injected two scripts and
closed the window without ever running a fill. It now probes the active tab on open and is
**disabled unless it can actually act**, and after filling it reports
`Filled 11 of 14 fields · 3 need you` instead of vanishing.

Files: `manifest.json`, `popup.html`, `popup.js`, `content.js`, `bridge.js`,
`license.js`, `ats.js`, `icons/icon16|48|128.png`.

`bridge.js` relays the profile from offeraio.com into storage, and answers a
`{type:"license"}` request from the dashboard with `{key, installId}`. It deliberately
hands over the **extension's existing** `installId` (minting one only if absent) rather
than letting the dashboard generate its own — keys are bound to 3 installs, and one
browser must not consume two slots just because the dashboard was opened in it. It also
ignores messages whose `e.source !== window`, so an embedded third-party iframe can't
ask for the key. Tests: `node --test tests/bridge.test.mjs` (9 tests).

`license.js` holds licensing + the submission counter and is shared by the popup and
the content script. It's a plain IIFE on `self` rather than an ES module, because
content scripts can't `import`. It is listed **before** `content.js` in both
`manifest.json`'s `content_scripts` list and the `executeScript` call in `popup.js` — if either loses it,
the quota check silently no-ops (deliberately: a metering bug must never stop someone
applying for a job). Tests: `node --test tests/license.test.mjs` — kept outside
`extension/` because `zip-extension.yml` ships that whole folder to the store.

**Three fixes that must not regress:**
1. `popup.js` is **external** — MV3's CSP blocks inline `<script>`, so an inline popup
   silently does nothing. `popup.html` must reference `<script src="popup.js">`.
2. `manifest.json` must declare `icons` **and** `action.default_icon` (store requires 128px).
3. `offeraio.com` must be in `host_permissions` **and** the `bridge.js` content-script
   matches, or the extension can't talk to the live dashboard.
4. The Worker origin is now in `host_permissions` too, for license verification.
   ⚠️ Adding it means the **Chrome Web Store privacy tab and permission justifications
   in `store/OfferAIO-store-listing.md` need updating** before the next submission.

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
- Screenshots (1280×800) in `store/` — popup, in-page fill bar, dashboard. **Regenerate
  with `node store/regenerate.mjs`; all three are current as of 2026-08-04.** They used to
  be hand-drawn and rotted silently: the dashboard one still showed the fake titlebar
  removed on 2026-07-22, and the popup one predated licensing entirely. Each
  `store/screenshot-N-source.html` now frames the **real** UI — the live dashboard, the
  real `popup.js`, and `content.js` genuinely filling a form — with only
  `chrome.storage.local` stubbed. The script drives headless Chrome, which is the only
  way to get an exact 1280×800 PNG; a normal window screenshot comes out rescaled.
- Privacy policy URL to enter: `https://offeraio.com/privacy.html`
- **Remaining:** complete the Privacy tab + listing fields, then submit.
- ✅ **Screenshots regenerated 2026-08-06** against the v1.2.0 UI. Two of the three sources
  needed changes first, because rendering the *real* UI means the sources break when the
  UI's preconditions change:
  - **Screenshot 1** stubs an active tab on a Greenhouse posting. The popup is now
    disabled unless it can act, so with no tab stubbed it captured a greyed-out primary
    button — accurate, but it makes the product look broken in a listing.
  - **Screenshot 3** injects the bridge messages `bridge.js` would send. The dashboard
    renders only a connect card until the extension answers, so the capture was otherwise
    a picture of the connect card. The messages must be posted from **inside** the frame —
    the dashboard drops anything where `e.source !== window`.
  - Both seeds use a neutral persona (Ada Lovelace / UC Berkeley). Screenshot 2 previously
    seeded the owner's own name and email into a public store listing.
  - Sample data in screenshot 3 leaves Responses and Interviews at **zero**, which is what
    the product honestly shows with no local engine watching an inbox. **Do not pad these.**
    Inventing a response rate in a store listing is the same failure this pass removed from
    the app, in a more public place.
- ✅ **Permission justifications are current** (re-checked 2026-08-08). Both items this
  section used to flag as outstanding are already written into
  `store/OfferAIO-store-listing.md`: the regional-ATS entry explaining `*.lever.co` /
  `*.greenhouse.io` and EU-hosted boards carrying US roles (§15), and the Worker-origin
  entry for licence verification (§7 rule 4). `*.wellfound.com` (§16) is covered by the
  generic "Host permissions (the job sites listed)" line and needs no new text.
- ✅ **Listing copy corrected 2026-08-08.** The detailed description claimed OfferAIO works
  on the listed ATSes "**plus any employer link you paste**" — it does not, and cannot: a
  pasted tesla.com link is one of the 49% no content script runs on (§16). That sentence is
  gone, replaced with a line saying employers who run their own careers site can't be
  filled and that the dashboard marks them. A store description that overstates what an
  extension does is a rejection reason on its own, quite apart from being untrue.
- **Submitting via API:** `node store/publish-extension.mjs` uploads the packaged zip and
  calls `:publish`. Needs `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` and
  `CWS_PUBLISHER_ID` in the environment; `--dry-run` authenticates and reads status without
  changing anything. ⚠️ **The API cannot fill the listing.** There is no method for the
  description, category, screenshots, store icon or the Privacy practices tab — those are
  dashboard-only, and `:publish` fails naming them if they're blank.
- ⚠️ **The dashboard cannot be automated at all.** Verified 2026-08-04: Chrome refuses
  extension scripting on `chrome.google.com/webstore/*` — a screenshot attempt returns
  "The extensions gallery cannot be scripted". This applies to the dev console, not just
  the public gallery, so browser automation is not an option for any of it.
- The packaged zip is also published on the `extension-latest` GitHub release.

## 9. Pricing
- **Free** — $0, **50 submissions/month**
- **Pro** — $30/mo, **250 submissions/month** ("Most popular")
- The Season plan was removed. Keep the JSON-LD `offers` in `landing.html`'s `<head>` in sync.
- **No billing exists yet.** See §10.

## 10. Stripe licensing (design settled 2026-07-19; Phase 0 done, 1–4 pending)
Chrome Web Store payments were discontinued, so the approach is license keys validated
server-side. **Not** offline-signed keys — those can't be revoked when someone cancels.

**Phases.** 0: Worker source into the repo + KV namespace (**done**, §14). 1: Worker
endpoints (**done** — `worker/src/billing.js`, 40 tests, contract in `worker/README.md`;
not deployed yet). 2: site success page + Payment Link buttons (**done** —
`license.html`, `billing.js`). 3: extension quota + license UI (**done** —
`extension/license.js`, 19 tests). 4: gate the paid AI endpoints (**done** — `/cover`
and `/rank` now require an active key and are metered server-side at 250/month).

**Phase 3 built the submission counter from scratch** — nothing in the extension
tracked submissions before, so "50/month" was marketing copy only. Counting happens in
`content.js` `doSubmit()`, *after* the submit button is actually clicked, so a failed
lookup never burns a submission. The monthly reset is keyed on local-time `YYYY-MM`.

### Stripe objects — created live 2026-08-04

**Account: `acct_1U0olS2ctbNhEUYI`, display name "OfferAIO", `livemode: true`.** Its own
account, deliberately **not** `acct_1Tm4Y7K5Z8GDflE1` ("CertTrack"), which the connector
was originally bound to. Checkout branding and the statement descriptor are account-level,
so building here would have put "CertTrack" on students' card statements and commingled
two businesses' books. If the Stripe connector ever reports CertTrack again, it is pointed
at the wrong account — revoke it from CertTrack's Connected apps, switch the dashboard to
OfferAIO, then re-authorize.

| Object | Id / value |
| --- | --- |
| Product | `prod_V0qxqcvAJ5vin2` — "OfferAIO Pro", statement descriptor `OFFERAIO PRO` |
| Price | `price_1U0pGB2ctbNhEUYIbQgkXzuh` — $30.00/month USD recurring |
| Payment Link | `plink_1U0pGM2ctbNhEUYIg2X6HKaz` → https://buy.stripe.com/8x2fZaaIG8XI5vs9r78N200 |
| Webhook | `we_1U0pGm2ctbNhEUYIq2QF7lrI` → the Worker's `/stripe/webhook`, all 7 events |

The Payment Link redirects to `https://offeraio.com/license.html?session_id={CHECKOUT_SESSION_ID}`
and is pasted into `billing.js`. `STRIPE_WEBHOOK_SECRET` is set as a Worker secret.

⚠️ **A secret change takes a minute or two to reach every edge location.** Straight after
`wrangler secret put`, the webhook alternated cleanly between `400 invalid signature` and
`500 webhook secret not configured` — old and new isolates both serving. It settled on its
own. If you rotate the secret, expect the same and don't chase it. That's the only edit needed —
`landing.html` and `pricing/index.html` both read it from there. While it's empty the
"Get access" buttons keep their old waitlist behaviour, so this ships safely before
Stripe exists. Set the link's success URL to
`https://offeraio.com/license.html?session_id={CHECKOUT_SESSION_ID}`.

Phase 1 needs **only `STRIPE_WEBHOOK_SECRET`** — every field required comes in the event
payloads, so there's no Stripe API call and no `STRIPE_SECRET_KEY` to leak.

**KV layout** (namespace `offeraio-licenses`, binding `LICENSES`):
- `key:<KEY>` → `{email, status, periodEnd, customerId, subscriptionId, installs[]}`
- `cust:<STRIPE_CUSTOMER_ID>` → `<KEY>` — **required.** Subscription lifecycle webhooks
  carry a customer id, not the license key. Without this reverse index, written at
  checkout time, cancellation cannot be processed at all.
- `evt:<STRIPE_EVENT_ID>` → `"1"`, 3-day TTL — webhook idempotency. Stripe retries.
- `sess:<CHECKOUT_SESSION_ID>` → `<KEY>`, 30-day TTL — lets the success page show the key
  with no Stripe API call.

**Flow.** Payment Link → `checkout.session.completed` → generate `OA-XXXX-XXXX-XXXX`,
write both KV records → surface on `/license?session_id=…`. The extension stores the key,
calls `/license/verify`, and caches the result ~24h.

**Four decisions that differ from the original sketch:**
1. **`invoice.payment_failed` does NOT deactivate.** Stripe's dunning retries a failed
   card for ~2–3 weeks; deactivating on the first transient decline downgrades customers
   who are still going to pay. Deactivate on `customer.subscription.deleted` and on
   `customer.subscription.updated` when status becomes `canceled`/`unpaid`.
2. **Status is not purely webhook-driven.** Store `periodEnd` (pushed forward by
   `invoice.paid`) and have verify compute `active = status === "active" && now <
   periodEnd + grace`. Webhooks are best-effort; one dropped `subscription.deleted`
   would otherwise mean Pro forever. Expire on time so it fails safe.
3. **Fail open on network error, closed on explicit inactive.** If the Worker is
   unreachable, the extension keeps last-known-good for ~7 days rather than dropping to
   Free — an outage here must not downgrade paying users.
4. **Keys are bound to installs** (max 3), to stop casual key-sharing. `activate` binds
   explicitly; `verify` adopts a new install when there's room, so a reinstall doesn't
   force re-activation, and refuses only once the limit is reached.

A fifth rule emerged while implementing: the `periodEnd` written at checkout is a
**provisional 35-day guess** (the checkout event carries no period), flagged
`periodProvisional`. The first authoritative value from Stripe always replaces it, even
if earlier — otherwise a plain "never shorten" guard keeps the guess and grants a free
extra month. After that, "never shorten" applies normally.

**Known limitation (not fixed).** Webhook idempotency and the `cust:` index are
read-then-write with no atomic reservation, and Workers KV is eventually consistent. Two
near-simultaneous deliveries of the same event can in principle both miss the guard and
mint two keys, leaving `cust:`/`sess:` pointing at different ones — the buyer would see a
key that later stops renewing. Fixing it properly needs a Durable Object. At this volume
the odds are negligible; **if a customer ever reports a key that stopped working a month
after purchase, look here first.**

**Two Workers gotchas.** Stripe's Node SDK `constructEvent` uses sync crypto and does not
run on Workers — use `constructEventAsync`, or hand-roll HMAC-SHA256 over
`` `${timestamp}.${payload}` `` with `crypto.subtle` (preferred: no SDK, no bundler). And
the webhook must read the **raw** body before any `.json()`, or signature checks fail.

**No email in v1.** Emailing the key needs Resend/Postmark plus SPF/DKIM on offeraio.com.
Instead: the success page shows the key, and recovery goes through the `session_id` on the
Stripe receipt the customer already has. Known weak spot — revisit when it hurts.

Note the submission counter lives in `chrome.storage.local`, so submission enforcement is
inherently soft; that's true of all client-side extensions and is why heavy auth isn't
worth building. The counter **does not exist yet** — nothing in `extension/` tracks
submissions today, so Phase 3 builds it from scratch. Real enforcement lives in Phase 4:
`/cover` costs actual OpenAI money, so metering it per key server-side is the lever
that matters.

## 11. Accounts and keys
- GitHub: **TobyBerg43**
- Google (Cloudflare, Chrome Web Store, GA4): **tobybergerbusiness@gmail.com**
- **Never commit secrets.** API keys belong only in Cloudflare Worker secrets or GitHub
  Actions secrets.

**The complete key inventory — there are exactly four.** All four re-verified unset on
2026-08-04 (`wrangler secret list` → `[]`, `gh secret list` → empty).

| Key | Lives in | Purpose | Status |
| --- | --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret | lets CI run `wrangler deploy` | **unset — blocking the Worker deploy** |
| `OPENAI_API_KEY` | Cloudflare Worker secret | chat for `/cover`, embeddings for `/rank` | unset |
| `STRIPE_SECRET_KEY` | Cloudflare Worker secret | reserved; **the code does not use it** — every field needed arrives in the webhook payloads | unset |
| `STRIPE_WEBHOOK_SECRET` | Cloudflare Worker secret | webhook signature verification | **set 2026-08-04** — verified live: forged events get 400, unsigned get 400, nothing provisions |

`ANTHROPIC_API_KEY` is **not** on this list and should never be set — see §3.

## 12. Open TODOs

**Everything left is blocked on a key or an account action only Toby can perform.** The
code is done: **143 tests pass** (92 in `tests/`, 51 in `worker/test/`), the Worker is
deployed and gating correctly, and the dashboard is wired to it. Nothing ships value until
the four keys in §11 exist.

✅ **The 2026-08-06 trust pass is deployed.** It merged as PR #1 and Pages rebuilt the same
day; the live dashboard no longer simulates applying. (This section said otherwise until
2026-08-08 — it was written before the merge and never updated.)

⚠️ **The 2026-08-08 coverage pass (§16) is committed but NOT deployed.** Deploying means:
push to `main`, wait for Pages, then check §4 — this pass changed `landing.html`,
`OfferAIO.html` and the regenerated `dashboard/index.html`, all served as HTML
(`DYNAMIC`), and added no new `.js` at the site root, so **no Cloudflare purge is needed**.
Also **reload the unpacked extension** in any browser testing it: `manifest.json` changed
(version, `*.wellfound.com`, and `ats.js` now loads on offeraio.com too), so a stale load
will answer the dashboard's `ats` request with nothing and every listing will show as
unknown rather than as fillable.

0. **The four keys (§11).** In the order that unlocks the most:
   - `OPENAI_API_KEY` → `npx wrangler secret put OPENAI_API_KEY` from `worker/`. Makes AI
     cover letters actually work. Safe to set now — the endpoints are gated (§14).
   - ~~Stripe Pro product + Payment Link~~ — **done 2026-08-04**, see §10.
   - ~~`STRIPE_WEBHOOK_SECRET`~~ — **done 2026-08-04.**
   - `CLOUDFLARE_API_TOKEN` → GitHub Actions secret. Until set, every push touching
     `worker/**` fails the Deploy Worker job and deploys stay local-only.
1. **Chrome Web Store:** the only remaining work is in the Developer Dashboard itself —
   upload the three screenshots from `store/`, complete the Privacy tab, and hit Submit.
   Everything feeding that is prepared and current as of 2026-08-08: listing copy
   (corrected, §8), permission justifications (re-checked, §8), screenshots (regenerated
   2026-08-06 from the real UI), and the packaged zip — now **v1.3.0**, rebuilt
   automatically on every `extension/` change, so push §16 before uploading.
   ⚠️ Read the warning in `store/OfferAIO-store-listing.md` before answering the
   data-transfer question — the honest answer changed once Pro started sending data
   off-device, and a mismatch with privacy.html is a common rejection reason.
2. **Cloudflare Worker** — deployed and verified (§14). Confirmed still healthy
   2026-08-04: `/health` 200, and `/cover` returns 402 `unknown` for a bogus key and 400
   `install_id_required` with no install id. `wrangler secret list` returns `[]`, so
   **no Worker secret is set yet** — that is item 0, not a code problem.
3. **Dashboard UI polish** — **done 2026-07-22.** The fake titlebar is removed entirely
   (the ENGINE/DB/CONNECTED status chips moved to the sidebar bottom, ids unchanged so
   the JS kept working), Live-activity timestamps are staggered, the 14-day chart has
   date labels, and headings (`h1`, logo, modal `h2`) now use Anton via `--display`,
   matching the landing page. Verified locally in Chrome before pushing.
4. **Stripe licensing** (§10) — **live as of 2026-08-04.** Phases 0–4 built, tested and
   now configured: product, price, Payment Link and webhook all exist in the OfferAIO
   account, the link is in `billing.js`, and `STRIPE_WEBHOOK_SECRET` is set. Note
   `STRIPE_SECRET_KEY` is **not** needed — the code never calls the Stripe API.
   **Untested end to end:** nobody has actually bought yet, so the
   checkout → webhook → key-minted → `/license.html` path has never run with a real
   Stripe event. The first purchase is the real test; if it misbehaves, look at the
   KV race documented at the end of §10 first.
5. Mark GA4 key events once they appear in the Events list.
6. **`/rank` has no caller, and can't get one as designed.** The endpoint, its gating and
   its metering exist and are tested, but nothing invokes it — and wiring it the obvious
   way would break a promise we make in public. `/rank` takes `resumeText`, while
   `privacy.html` says in the summary box and again under "Your resume" that the resume
   is **never uploaded or transmitted**. Sending resume text to the Worker and on to
   OpenAI would contradict that on the same site. Three honest options, in the order I'd
   pick them:
   - **Drop `/rank`.** It is deployed, billable surface area with no caller. Least work,
     no promise to renegotiate.
   - **Rank on stated preferences instead** — category, major, target roles, i.e. text the
     user typed into the dashboard rather than their resume. Keeps the promise intact and
     still sorts the ~330 live listings by fit.
   - **Keep resume ranking and rewrite the privacy promise** to be narrower ("the resume
     *file* is never uploaded"). Possible, but it weakens a claim that currently helps
     sell the product, for a feature nobody has asked for.
7. **No email on purchase** (§10). The success page is the only place a key is ever
   shown. Fine at zero customers; the first "I lost my key" email is the signal to fix it.
8. Optional: `/guides/` blog template, comparison pages.

## 13. Conventions for assistants
- Verify the live site after every deploy (load the URL, screenshot).
- After extension edits, re-check the raw file on `main` (see §4 hazard).
- **Never** enter passwords, make payments, or accept legal agreements on the user's
  behalf — hand those back (account creation, fees, agreements, final "Submit for review").
- Chrome blocks extensions from scripting the Web Store gallery; that console can only be
  read via screen capture, not automated.
- Keep this file updated when the project changes.

## 14. The Cloudflare Worker (`worker/`)
Live at `https://offeraio-worker.tobybergerbusiness.workers.dev`. Routes: `/health`,
`/cover`, `/rank`.

Until 2026-07-19 this Worker existed **only as a deployed script** — no copy in the repo,
so changes were unreviewable and one dashboard edit from being lost. `worker/src/index.js`
was vendored from the live deployment, verified byte-for-byte (md5
`46320584d9efd35f821709df1aec264d`). **Edit it here, not in the Cloudflare dashboard.**

- Deploy: push to `main` touching `worker/**` → `.github/workflows/deploy-worker.yml`.
  Needs repo secret `CLOUDFLARE_API_TOKEN`. Manually: `npx wrangler deploy` from `worker/`.
- ℹ️ **Live is one commit behind `main` as of 2026-08-04, harmlessly.** The 2026-08-04
  push touched `worker/**` with a comment-only edit (a stale "Anthropic" reference), so
  CI tried to deploy and failed on the missing token as usual. The deployed script is
  therefore functionally identical to `main` — no behaviour differs. It syncs on the next
  successful deploy; nothing needs doing.
- Worker secrets are stored in Cloudflare, survive deploys, and are never in the repo.
- KV `LICENSES` → `offeraio-licenses` (`40fb8a5ef93143fc9d0ad49592a7dc64`), bound but
  unused until §10 Phase 1.
- **The dashboard calls `/cover` as of 2026-08-04.** `enhanceCover()` in `OfferAIO.html`
  tries the local Electron engine first (free, private, already running if it's on) and
  falls back to the Worker, which is what almost every user actually has. Credentials come
  from the extension over the bridge (§7); with no key the templated letter stands in
  exactly as before and the feed says so **once** per session. A 429 `monthly_limit`
  toasts; any other rejection degrades quietly. Verified in Chrome against the live
  Worker: an invalid key returns 402 and the page handles it without throwing.
  Still unwired: `/rank` has no caller anywhere.
- `/cover` and `/rank` require an active licence and are metered per key in KV
  (250/month). Fixed in §10 Phase 4 — before that they were open to the world, which
  would let anyone drain `OPENAI_API_KEY` once it is set. Any caller must send
  `{key, installId}` in the POST body. **Deployed 2026-07-22** (local wrangler,
  version `03e504fe`) and verified live: unlicensed `/cover`/`/rank` calls are
  rejected, so setting the OpenAI key is now safe.
- Models: `/cover` on `gpt-5.6-terra`, `/rank` on `text-embedding-3-small`. Both are
  constants at the top of `worker/src/index.js`. `/cover` is deliberately not on a
  mini/nano model — voice-matching is the product, and that's where small models fail.
- ⚠️ First `wrangler deploy` caveat: the Cloudflare API doesn't expose the live binding
  list, so `wrangler.toml` was reconstructed from what the code reads. Check the
  dashboard's Settings → Bindings first; any dashboard-added binding not referenced in
  code would be dropped.

## 15. Listings hygiene (`scrape.js`, reworked 2026-08-06)

### ⚠️⚠️ Do NOT block `.eu.` hostnames. This is a trap, and it looks like a fix.

The dead link the founder hit was `job-boards.eu.greenhouse.io/veeamsoftware?error=true`.
The obvious inference — "an EU link got into a US-only product" — is **wrong**, and acting
on it deletes some of the best listings on the board.

Every `.eu.`-hosted row is a **US role**. The EU is the *company's ATS account region*,
not the job's location: IMC Trading is Amsterdam-headquartered, Cirrus Logic was founded
in Edinburgh, Veeam is Swiss — so their Greenhouse and Lever instances live on the EU
domain while they hire in Chicago, Austin and San Jose. `isUS()` reads the **location**
and is working correctly on these rows.

```
Cirrus Logic   Austin, TX     Embedded Software Test Engineer Intern
IMC Trading    Chicago   ×7   Quant Trader / Quant Research / SWE / Hardware ML
Veeam Software San Jose, CA ×2 Software Engineering Intern   ← these two really did close
```

Blocking the domain would drop **7 IMC Trading Chicago quant roles** — a top-tier quant
shop and precisely the highest-value listings for this product's audience. The geographic
filter is location-based only. `tests/listings.test.mjs` asserts this explicitly, and one
test fails if `scrape.js` so much as mentions an `.eu.` hostname.

The Veeam failure had exactly one cause: **the req was closed.**

### a) Closed postings are now detected

Nothing was ever marked inactive — 0 of 394 rows — so a req that closed between refreshes
stayed listed forever. `verifyStillOpen()` HEAD-checks Greenhouse / Lever / Ashby URLs and
flags `active:false` on a 404/410 or an `?error=true` redirect. **On the first run it
caught both dead Veeam reqs.**

Budgeted for the 6-hourly job: newest 120 per run, plus anything unverified for 48h, 6
concurrent. Anything ambiguous — a timeout, a 5xx, a 405 from a host that dislikes HEAD —
**leaves the listing alone**. Dropping a live posting because their server hiccuped costs
a user a job; leaving a dead one up for six more hours costs a wasted click.

Closed rows **stay in `listings.json`** rather than being deleted: consumers skip
`active === false`, and keeping the row is what stops the next run re-importing the same
dead posting from a community feed that hasn't noticed yet. They're forgotten after 14
days. ⚠️ **Any new consumer of `listings.json` must filter `active !== false`** —
`generate_pages.js` needed exactly that fix, or the SEO pages would have advertised dead
reqs. `data/meta.json` carries `checked` / `checkable` so shrinking coverage is visible.

### b) Deduplication

Both old keys were exact-match, so ~7% of the board was redundant (25 groups, 28 rows):
`Chicago, IL` vs `Chicago, Illinois`, `… Intern` vs `… Intern, Summer 2027`. Now
normalised on company + title + first location token. Live result: **394 → 364, zero
duplicate groups**, all 10 EU rows and all 13 Wells Fargo roles intact.

⚠️ **Strip a leading year token only, never the remainder.** Wells Fargo titles everything
`2027 <Function> Summer Internship – Early Careers`. A rule that strips from the first year
onwards collapses Audit, Finance, HR and Risk into one row and silently deletes three real
internships. This is caught by a dedicated test — it fired during development.

### c) `checked N ago` on every listing row (see also §16)

`date_checked` rides on each listing and the dashboard shows how recently the pipeline
confirmed the req was open. A user who hits a dead link should see that the product
already knew, rather than being told it had applied.

## 16. What the extension can actually fill (added 2026-08-08)

### The number: about half

Measured against the live board on 2026-08-08, with `extension/ats.js` classifying every
row in `data/listings.json`:

```
active listings   364
fillable          186   (51.1%)
NOT fillable      178   (48.9%)
```

The 178 are not junk. They are Tesla (26), TikTok (33), Jane Street (15), Y Combinator's
Work at a Startup (13), Optiver (11), Akuna (8), Rippling's own ATS (8), ByteDance, IMC,
DRW, Snowflake, Apple, Amazon, Microsoft — employers who run their own careers site
instead of buying Greenhouse or Lever. Several are the most sought-after names on the board.

Every one of those rows used to render **"Open & fill"** and a note reading *"The OfferAIO
extension fills it there"*. Clicking it opened the posting and nothing else ever happened,
because `content.js` is not injected on those hosts at all — there is no error, no bar, no
message. This is the §2 failure again in a quieter form: an application that is never
filled is indistinguishable from a user who got distracted, so it generates no bug report
and never gets fixed.

### The fix: the extension is asked, not guessed at

`bridge.js` answers a new `{type:"ats"}` message with the list from `ats.js`. The dashboard
holds **no copy** of that list — a copy goes stale the first time an ATS is added, and the
page would then be confidently wrong about a build it does not ship. `canFill()` in
`OfferAIO.html` applies the list and returns **true / false / null**, and the third one is
the point: an extension older than this message never answers, and *unknown must read as
unknown*. Guessing "yes" restores the lie; guessing "no" tells users their working
extension is broken.

Where it shows up: an amber **"✋ manual apply"** on the listing row, **"Open"** instead of
**"Open & fill"** on the button, an honest note on the review card, and a feed line saying
you will be filling this one by hand. `matchListing()` also *prefers* a fillable posting
when two equally qualify — but never filters the others out. A Jane Street role you have to
type by hand is still a Jane Street role, and hiding half the board to make the product
look more capable is the same dishonesty pointed the other way.

⚠️ **`canFill()` is a second implementation of `ats.fromUrl()`'s matching rules**, in a
different file, over a wire format. Those drift. `tests/dashboard-canfill.test.mjs` lifts
`canFill` straight out of the HTML and asserts the two agree on **every URL on the live
board** plus the edges, and that the split is neither 0% nor 100% — a regression returning
one answer for everything would otherwise keep every other test green.

### `ats.js` entries are plain data now

They were regexes; they are `{id, name, suffix}` (or `exactHost`), with the matching derived
once. Regexes do not survive `postMessage` — they arrive as `{}` — so the bridge could not
have sent them, and fifteen hand-written copies of one pattern was fifteen chances to typo
one. `tests/ats-manifest.test.mjs` asserts the list stays JSON-serialisable.

### ⚠️ The two lists must agree, and now something checks

`ats.js` has always said it must stay in step with `manifest.json`. It wasn't: it matched
any subdomain of `wellfound.com` and of `linkedin.com`, while the manifest granted only
`wellfound.com` and `www.linkedin.com/jobs/*`. On `www.wellfound.com` the popup's Fill
button therefore lit up, injected nothing and closed — exactly the failure the v1.2.0 popup
work existed to end. Resolved in the cheaper direction each time: **manifest widened** to
`*.wellfound.com` (same site, negligible review cost), **`ats.js` narrowed** to
`www.linkedin.com` (claiming `*.linkedin.com` would request a huge site's worth of
permission for regional hosts a US-only product never needs).

`tests/ats-manifest.test.mjs` now fails if an ATS is supported but not granted, granted but
not supported, or granted but not injected. All three directions were mutation-tested.

### Two other things this pass removed

- **The review card's field checklist was hardcoded.** Every card printed *"✓ resume
  attached · ✓ contact info · ✓ education · ✓ work auth"* regardless of what the profile
  held. There is no resume anywhere in the profile and browsers forbid a script attaching a
  file (§7), so "resume attached" told users the one thing they still had to do was already
  done; and "work auth" reads as a promise to answer the question §7 rule 1 deliberately
  refuses to answer. `reviewFields()` now ticks only what the profile really carries, says
  plainly what is missing, and never ticks the resume.
- **A raw NUL byte in `content.js`.** The `NEEDS_USER` sentinel had the control character
  written literally into the source. Harmless at runtime — it is compared by identity and
  never written to a field — but ripgrep classifies the file as **binary** and silently
  returns nothing, so the extension's largest and most safety-critical file was invisible to
  search. It is now the `\u0000` escape: same value, greppable file. **Do not paste a raw
  control character into source.**

### Where the remaining half could come from

Not attempted here, in rough order of return: `ats.rippling.com` (8 rows, a real
multi-tenant ATS on one host), `*.oraclecloud.com` and `*.successfactors.com` / `sapsf.com`
(enterprise ATSes, several rows each), `workatastartup.com` (13). The long tail —
tesla.com, janestreet.com, lifeattiktok.com — is one bespoke careers site per employer,
each needing its own selectors, which is a different kind of work from adding an ATS.
