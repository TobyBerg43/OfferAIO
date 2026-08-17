# OfferAIO — Project Handoff / Context

Single source of truth for the OfferAIO project. Any assistant or person should be
able to read this file and pick up the work without re-discovering anything.
**Last updated: 2026-08-17.**

**2026-08-16 — five things. §21 has the biggest number, §20 the worst bug, §22 the most
overdue.**

**§22: nothing verified the pipeline, so the pipeline was wrong in three ways nobody had
measured.** Building a daily audit found duplicate URLs on the board, seven job applications
linked over plain `http`, and — the bad one — closed reqs being forgotten on the next run and
re-imported as live, which is why the dead Veeam postings §15a recorded as caught on 08-06
were *still* being re-detected twice a run ten days later. Liveness coverage was 23% because
only three hosts were ever checked; it is 60.8% now, Workday included. `verify-listings.yml`
runs daily and opens an issue when it fails.

**§21: the board went 387 → 942 listings**, and most of the gain came from a feed `scrape.js`
already named. `communityListings()` took the first reachable source and returned, so
SimplifyJobs — the largest Summer 2027 list there is — was listed for weeks and never read.
Two more feeds added, 29 dead Workday boards removed and 46 recovered from the feeds' own
posting URLs. Fillable went 208 → 578.

**§19–§20: the website was selling a different product, and one real fill found a real bug.**
Nobody had ever audited `landing.html`, `pricing/` or `start.html` against the shipped code.
Four claims described features that did not exist; the hero demo was still running the §2
simulation ten days after it was deleted from the dashboard, inventing interview requests
beside real company names; 11 of the 14 companies it showed being applied to cannot be filled;
`start.html` told every visitor the extension **was not on the Chrome Web Store** and walked
them through Developer-mode sideloading, twelve days and four releases after it was published.
Two of those four claims were **built** instead of cut (the daily cap and randomized pacing are
now real code with tests). Then Toby's own profile was pushed into the extension and used on a
live DRW Greenhouse form — which had never been done — and it answered *"when will you complete
your university studies"* with **"Indiana University"**. §7 rule 2 also stopped a full-auto
submission to a real employer, correctly. **§20 first, then §19, then §7 rules 1 and 4.**

**2026-08-17 — v1.5.0 cleared review overnight and is PUBLISHED at 100%.** Verified against
`:fetchStatus`: `published PUBLISHED crx 1.5.0 @ 100%`, `submitted — none —`. **The repo and
the store agree**, and §19's daily-cap/pacing rails and §20's field-order fix are on real
installs — this file said the opposite until now, because it was written before the
submission went in. 248 tests pass and the 32 browser assertions pass against the shipped
build; the daily Verify listings run is green. **`:fetchStatus` is the only trustworthy
answer to "what version do users have" — this section has been wrong about it in both
directions.** Store screenshots regenerated against the v1.5.0 UI the same day (§8).

(Earlier: v1.4.1 cleared review and was published at 100%, giving real installs §17's résumé
auto-attach and §18's work-auth fix. `/health` and offeraio.com both answer 200.)

**248 tests pass** (184 in `tests/`, 64 in `worker/test/`), plus 32 browser assertions and a
real-ATS run across all three open-form ATSes. **No code or store item is on the critical
path.** What is left is an account action only Toby can perform (the screenshots + Privacy
practices tab in §8, the Actions secret in §11), a product decision (§12 item 6, `/rank`), and
above both, **distribution: the product is published, correct and has no users.**

(Earlier, 2026-08-15 — two things.

**§18 — the work-authorisation bug that hid inside the rule against it, fixed in v1.4.1.**
Rule 1 stopped `answerFor` asserting work authorisation and left a guard for "we don't
know". The guard could never fire, because **neither profile UI could produce that state**:
both derived `needsSponsorship = (workAuth === "Requires sponsorship")`, so picking
**"F-1 (CPT/OPT)" stored `false`** and the extension answered **"Yes"** to *"authorized to
work without sponsorship?"* — the exact false declaration rule 1 exists to prevent, for
exactly the students it exists to protect. Neither select had a blank option either, so a
user who never touched the control still shipped an answer they never gave. Read §18, then
§7 rule 1.

**§17 is verified.** The résumé handoff genuinely works from a content script's isolated
world, on a real form, in a real Chrome — including the part that matters, that the file is
in the form's `FormData` and not merely displayed. `tests/browser-endtoend.mjs` is the
harness; it is also what found the bug above and two silences beside it. **154 tests pass**
(115 in `tests/`, up from 103; 51 in `worker/test/`), plus 32 browser assertions.

**§8 — review cleared. The store is PUBLISHED at v1.3.1, at
100%, with nothing pending.** Verified against `:fetchStatus` on 2026-08-15: there is no
`submittedItemRevisionStatus` at all. The blocker that led this file for three days — real
installs stuck on the 2026-08-04 v1.1.2 build, without any of the §7 safety rules and with a
`bridge.js` that could not answer the deployed dashboard — **is gone.** Users now have the
work through §16. What they do *not* have is **§17, the résumé auto-attach**: the repo and
the `extension-latest` zip are at **v1.4.0** and the store is not. That is the open item,
and it is a feature, not a correctness fix, so it is no longer urgent in the way §8 was.
**154 tests pass** (103 in `tests/`, 51 in `worker/test/`), up from 149.

Before that, 2026-08-13: a **verification pass against the local harness** found two real
bugs in the build that had already been submitted, which is why the published version is
v1.3.1 rather than the v1.3.0 that was sent first: a `CSS` global shadowed in `content.js`
that silently ate the "here's what still needs you" message and, worse, could eat the submit
click entirely (**new §7 rule 5**), and a dashboard ternary that rendered "Open & fill" for
the *unknown* state §16 exists to keep honest.
The 2026-08-08 **coverage pass** — the dashboard now says which postings the extension can
actually fill. Roughly **half the board cannot be filled**, and every one of those rows
used to offer "Open & fill". See **§16**, then §7 for the `ats` bridge message and §8 for
the listing copy that claimed otherwise.
Before that — 2026-08-06, the **trust & clarity pass** — removed the simulated
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
  API. Needs secret `OPENAI_API_KEY` — **set as of 2026-08-08** (§11). Source lives in
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
  `dashboard-canfill.test.mjs`, `version-sync.test.mjs`, and from 2026-08-15
  `profile-contract.test.mjs` (§18) plus `browser-endtoend.mjs` — the last of which is
  **not** a `.test.mjs` on purpose, so CI's glob skips it: it drives a real Chrome.
  Deliberately outside
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
  ⚠️ **That branch's `dev/README.md` is stale in three places** and cost a verification pass
  real time on 2026-08-13: it names version 1.2.0, it claims `manifest.json`/`ats.js` already
  carry local-only host entries (they never were committed — they were working-tree edits),
  and it said the "without sponsorship" question must be left blank, which contradicts both
  `content.js` and `tests/content-workauth.test.mjs`. The on-disk copy was corrected, and
  `dev/local-mode.mjs` now writes the host entries; **the copy on `dev-harness` still has
  all three errors.** A doc that describes an uncommitted working tree rots the moment that
  tree is discarded.

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
Manifest V3. Name "OfferAIO — Auto Apply", **v1.5.0 in the repo and on the store**
(1.0.0 → 1.1.0 licensing, → 1.1.1 bridge licence relay, → 1.1.2 new logo, → 1.1.3 the three
safety fixes below, → 1.2.0 the application tracker, the context-aware popup and the identity
relay, → 1.3.0 the ATS relay and the `*.wellfound.com` host fix, §16, → 1.3.1 the two bugs
the harness pass found, → 1.4.0 the résumé auto-attach, §17).

**`manifest.json` is the single source of truth for the version.** It disagreed four ways
(manifest `1.1.2`, landing `v3.1.0`, dashboard `build 2027.1`, this file `1.1.1`); the
landing page and the dashboard sidebar now both read the manifest's version. Bump all three together —
**`tests/version-sync.test.mjs` fails if you don't**, and it also fails if
`dashboard/index.html` is out of date with `OfferAIO.html`. The rule was written here
before and drifted anyway; a comment cannot enforce a convention.

### ⚠️ Six rules in `content.js` that must never regress (1–3 fixed 2026-08-05, 4 on 08-06, 5 on 08-13, 6 on 08-16)

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
   ⚠️ **This rule was correct and still shipped the harm it forbids for a week.** The
   guard it relies on, `typeof p.needsSponsorship !== "boolean"`, was unreachable: the
   writers of the profile could not produce a non-boolean. Reading `sponsorshipNeed()` in
   `content.js` is now the rule; **§18** is why, and `tests/profile-contract.test.mjs`
   is what keeps the writers honest. A rule enforced only on the reader is half a rule.
2. **Full-auto stops for a missing resume or a flagged question.** ⚠️ **The premise under
   this rule was wrong for the product's whole life, and it was corrected in v1.4.0 — see
   §17.** Browsers do not forbid attaching a file; they forbid setting `input.value` to a
   path. The rule itself still stands, because `attachResume()` can fail on a custom
   uploader and reports honestly when it does — full-auto reads `input.files` rather than
   trusting the attempt. What follows is the original reasoning, kept because it is still
   why the stop exists: browsers forbid scripts
   from attaching files, so auto-submitting past an empty file input sends a resume-less
   application in the user's name.
3. **Quota is charged only after the submission is evidenced.** It used to count on
   `btn.click()`, so a blocked submit burned a submission *and* reported "Submitted via
   OfferAIO" for an application that never left the page. `doSubmit` runs
   `form.checkValidity()` before clicking **and** waits for a real success signal after
   it — see the application tracker below.
5. **Never shadow a browser global in `content.js`.** `const CSS = [...stylesheet...]` shadowed
   the global `CSS` object for the whole IIFE, so `fieldLabel()`'s `CSS.escape(el.id)` threw
   `TypeError` — and `doSubmit` is `async`, so it died as a silent unhandled rejection. Two
   consequences, both user-facing: the invalid-form branch set the amber outline and then
   threw before `status()` ran, so the user got a highlighted box and **no explanation**; and
   `unfilledRequired()`, which runs *before* `btn.click()`, threw on any empty
   `aria-required` field carrying an id — eating the click entirely, with no message at all.
   Workday and Ashby both lean on `aria-required`. Renamed to `BAR_CSS` (renaming beats
   `self.CSS.escape` — it removes the shadow for anything added later). Found by the
   2026-08-13 verification pass; guarded by `tests/content-tracker.test.mjs`, which had to
   grow a `label[for=]` selector in its fake DOM to reach the call at all.
4. **`controlForLabel()` must refuse to guess.** It binds on `for=`, on a control nested
   inside the label, or on a parent holding **exactly one** control, and otherwise binds
   nothing. The old fallback took "the first input under the label's parent", so on a
   dense form every label wrote into the first box and the answer to one question landed
   in another. That is the same class of harm as rule 1: a false answer under the user's
   name. Tests: `tests/content-tracker.test.mjs`.

6. **The test chain in `answerFor()` is order-sensitive, top to bottom.** Rule 1 already says
   the `without …sponsor` test must precede `requires …sponsor`. The same trap bit again on a
   real DRW form: `/school|university|college/` sat above any test for a date, so **"Please
   confirm when you will complete your university studies." was answered "Indiana
   University"** — a WHEN question answered with a WHERE. Rule 4 stops a label binding to the
   wrong control; this bound the right control to the wrong answer, which is the same harm.
   A date test now runs before any place test. **Add nothing above the work-auth and date
   tests.** Tests: `tests/content-fieldorder.test.mjs` (11, mutation-tested). See §20.

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
session. **CAPTCHAs are never bypassed.** The resume is saved in the popup and attached
automatically (§17); the field is highlighted only when a form's own uploader refuses it.

## 8. Chrome Web Store status

### ✅ Review cleared. PUBLISHED at v1.5.0, 100%, nothing pending (2026-08-17)

Verified against `:fetchStatus`:

```
publishedItemRevisionStatus  PUBLISHED  crxVersion 1.5.0  deployPercentage 100
submittedItemRevisionStatus  — absent —
```

The absent second block is the whole story: nothing is in review, so **v1.5.0 — §19's
daily-cap and pacing rails and §20's field-order fix — is what installs now get**, and the
repo and the store agree. Four submissions, four clean reviews.

⚠️ **This section, §7 and §12 all said the store was on v1.4.1 until 2026-08-17**, because
the submission went in after they were written and nobody re-read the status afterwards. The
version this file *claims* is published is worth nothing; `node store/publish-extension.mjs
--dry-run` takes ten seconds and is the only answer. **Read the status before believing a
version gap here — in either direction.**

(Read for history: the same block read `crxVersion 1.3.1` on 2026-08-15, after the 08-13
harness pass. Every version gap this file has tracked has closed within two days of
submission — the API path plus `browser-endtoend.mjs` before submitting is a working loop, and
neither of the last three submissions was rejected.) **Every problem this section
described for a week is fixed for real users**: the §7 safety rules, the tracker, the
`identity` bridge message the deployed dashboard needs, the ATS coverage of §16, §17's
résumé auto-attach and §18's work-auth fix. The extended review predicted below for the
widened host permissions either did not happen or did not take long.

⚠️ **Still owed, and it is the same item it has been since v1.1.2: one dashboard visit.**
Neither part is a code change and neither can be done through the API:

- **The screenshots on the live listing are still whatever v1.1.2 uploaded** — v1.1.2-era
  pictures of v1.5.0 code. ✅ **The three in `store/` were regenerated 2026-08-17 against the
  shipped v1.5.0 UI** (screenshots 2 and 3 changed; 1 came out byte-identical, and no icon
  did), so they can be uploaded as they sit — no need to re-run `regenerate.mjs` first.
  Screenshot 3's sidebar reads `v1.5.0` and `931 LIVE`, which is the check that they are
  current.
- **The Privacy practices tab may be answered wrongly.** Those answers date from v1.1.2,
  before Pro sent anything off-device and before v1.4.0 became the first build to store a
  résumé file. See the warning in `store/OfferAIO-store-listing.md`
  — `privacy.html` was already rewritten to match, and a listing that disagrees with the
  policy it links to is a standard rejection reason.

For history, and because it explains why the published version is 1.3.1 and not the 1.3.0
this file said was submitted: the listing was **published at v1.1.2** from 2026-08-04, not a
draft as this section claimed until 2026-08-12. v1.3.0 was submitted via the API on 08-13,
the harness pass then found two bugs in that exact build (§7 rule 5, §16), and v1.3.1 went
in behind it. Google approved the later one.

⚠️ **The API path was enough, contrary to what this file predicted** — twice now. The worry
was that `:publish` would reject an incomplete listing, but the fields were filled by the
original v1.1.2 submission and are inherited by every update. What it still cannot touch:
**the screenshots on the live listing are whatever v1.1.2 uploaded**, and the regenerated
v1.2.0-era ones in `store/` cannot be put there through the API. Upload them by hand next
time the dashboard is open.

- Developer account: **tobybergerbusiness@gmail.com** — registered, dashboard accessible.
- Item id **`hcbchgpjladdfmcammhgbbmkdagcfcgd`**, published at **v1.5.0**.
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
- **Remaining:** the Privacy practices tab, in the dashboard, now that a résumé file is
  stored (§17). **v1.4.1 was submitted 2026-08-15** via `node store/publish-extension.mjs`.
  A rejection leaves v1.3.1 serving users, which is a good build — so this was a low-stakes
  submission, unlike the last one. The permission justifications (§7 rule 4, §15, §16) are
  unchanged since v1.3.1 cleared review with them, and v1.4.x adds no host permissions.
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
- **Submitting via API:** `node store/publish-extension.mjs` uploads the packaged zip
  (pulled straight from the `extension-latest` release) and calls `:publish`. Needs
  `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` and `CWS_PUBLISHER_ID` in the
  environment; `--dry-run` authenticates and reads status without changing anything.
  **Mint the token with `node store/mint-cws-token.mjs <client-id> <client-secret>`** — it
  runs the loopback OAuth flow and writes all four values to `~/.offeraio-cws.env`, outside
  the repo, rather than printing the secret into a terminal transcript.
- ⚠️ **The API cannot fill the listing.** There is no method for the description, category,
  screenshots, store icon or the Privacy practices tab — those are dashboard-only.
  **But that mattered less than this file feared — proven twice now.** A published item
  already has all of those populated, because Chrome will not publish without them, and for
  a *version update* `:publish` inherits them: the 1.3.x submissions went straight to
  `PENDING_REVIEW` and one of them is live. Two things it still cannot do, and both are real:
  - **Screenshots stay whatever v1.1.2 uploaded.** The current `store/store-screenshot-*.png`
    were regenerated against the v1.2.0 UI (§8 above) and the API cannot replace them. So the
    live listing shows v1.1.2-era pictures of v1.3.1 code. Acceptable — the code is what users
    need — but it means the dashboard visit is deferred, not avoided.
  - **The Privacy practices tab may now be answered wrongly.** Those answers date from the
    v1.1.2 submission, before Pro started sending data off-device — and **v1.4.0 makes this
    sharper**, since it is the first build to store a résumé file (§17). See the warning in
    `store/OfferAIO-store-listing.md`. A stale data-transfer answer is a compliance problem
    and a common rejection reason, and no API call can correct it.
  - ~~Also expect **extended review** for the widened host permissions~~ — it did not
    materialise: `*.lever.co`/`*.greenhouse.io` (§15), `*.wellfound.com` (§16) and the Worker
    origin (§7 rule 4) all cleared with v1.3.1. v1.4.0 adds no new host permissions at all.
- ⚠️ **Leaving the OAuth consent screen in "Testing" expires the refresh token after 7
  days**, and every later publish fails with `invalid_grant`. Set it to "In production"
  before minting. This is the most common way the credential path breaks.
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

**Minting a key by hand: `node worker/mint-license.mjs`.** Prints a key in the Worker's
own format; `--write` puts it in KV and verifies it against the live Worker. For
dogfooding (the owner needs Pro to exercise `/cover`), for support (§10's KV race, whose
first symptom is a key that stops working a month after purchase), and for comps.
⚠️ A hand-minted key has **no subscription behind it** — nothing renews or cancels it, it
just expires at `periodEnd`. And it **does not test the purchase path**: it skips exactly
the checkout → webhook → key → `license.html` chain that has never run (§12 item 4).
⚠️ `--check`, and the verify that follows `--write`, each consume one of the three install
slots.

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

**The complete key inventory — there are exactly four.** Re-verified 2026-08-08:
`wrangler secret list` from `worker/` returns `OPENAI_API_KEY` and `STRIPE_WEBHOOK_SECRET`;
`gh secret list` is still empty.

| Key | Lives in | Purpose | Status |
| --- | --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret | lets CI run `wrangler deploy` | **unset — blocking the Worker deploy** |
| `OPENAI_API_KEY` | Cloudflare Worker secret | chat for `/cover`, embeddings for `/rank` | **set, and as of 2026-08-15 genuinely working** — see the warning below. It was set with a **UTF-8 BOM** and had never once succeeded |
| `STRIPE_SECRET_KEY` | Cloudflare Worker secret | reserved; **the code does not use it** — every field needed arrives in the webhook payloads | unset |
| `STRIPE_WEBHOOK_SECRET` | Cloudflare Worker secret | webhook signature verification | **set 2026-08-04** — verified live: forged events get 400, unsigned get 400, nothing provisions |

`ANTHROPIC_API_KEY` is **not** on this list and should never be set — see §3.

### ⚠️ "The secret is set" is not the same as "the secret works" (2026-08-15)

`OPENAI_API_KEY` was set on 2026-08-08 and this file recorded it as done. It was broken
from that moment, in two independent ways, and **`/cover` had never once succeeded**:

1. **A UTF-8 BOM in front of the key.** PowerShell's `>` and `Out-File` both write one by
   default; `wrangler secret put` stored it faithfully. Every call came back
   `500 Incorrect API key provided: <BOM>sk-pr…`. `wrangler secret list` shows names, not
   values, so every check anyone could run said the key was fine.
2. **`max_tokens`.** Current OpenAI chat models reject it — *"Unsupported parameter:
   'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."*

Neither was noticed because **nothing had ever called it.** `/cover` requires an active
licence, nobody had bought, and this file's own note — "never exercised end to end" — was
filed as a curiosity rather than as the risk it was. The first person to run this code
would have been a customer who had just paid $30.

Fixed: `secret()` in `worker/src/index.js` strips a leading BOM and surrounding whitespace
from any secret, `/rank` was reading the raw value too and now shares it, and the request
uses `max_completion_tokens`. Guarded by `worker/test/secret.test.mjs` and
`worker/test/cover-request.test.mjs`. **Verified live on 2026-08-15**: a real letter, 3.6s,
metered 1 of 250.

The general lesson is worth more than the fix. **An untested path is not a low-severity
item just because it has no users — it is a bug you have decided a customer will find.**
Anything gated behind a purchase should be exercised with a hand-minted key (§10) the day
it ships, not the day it sells.

## 12. Open TODOs

**Nothing left is a code blocker.** As of 2026-08-16: **248 tests pass** (184 in `tests/`,
64 in `worker/test/`) plus 32 browser assertions and a real-ATS run across all three
open-form ATSes (§20), the Worker is deployed and gating
correctly, `/cover` genuinely works (§11), the dashboard is wired to it, three of the four
keys in §11 are set, and **the store listing is published and current at v1.5.0** — the repo
and the store agree (§8). What remains is one dashboard visit, a first real purchase to
exercise the Stripe path, the `/rank` decision below — and the thing this list has never had
an item for:

⚠️ **The real gate is distribution, not code.** The product is published, correct, and has
**no users and no purchases**. Every item below is worth less than one student installing it.
The season this product exists for — Summer 2027 recruiting — is open now through roughly
November 2026, so the scarce resource is calendar, not engineering. Nothing in this repo will
change that; the next honest unit of work is getting it in front of students. Resist adding
a ninth engineering TODO here in preference to that.

✅ **The 2026-08-06 trust pass is deployed.** It merged as PR #1 and Pages rebuilt the same
day; the live dashboard no longer simulates applying. (This section said otherwise until
2026-08-08 — it was written before the merge and never updated.)

✅ **The 2026-08-08 coverage pass (§16) and the 2026-08-13 résumé pass (§17) are both on
`main` and deployed.** (This section said the coverage pass was undeployed until 2026-08-15;
it was merged days earlier and never ticked off. Check `git merge-base --is-ancestor` before
believing a "not deployed" note in this file.) Remember to **reload the unpacked extension**
in any browser testing it after either pass — `manifest.json` changed in both.

0. **The keys (§11) — three of four are done.** Only one is left:
   - ~~`OPENAI_API_KEY`~~ — **set** (confirmed 2026-08-08). Untested end to end; see §11.
   - ~~Stripe Pro product + Payment Link~~ — **done 2026-08-04**, see §10.
   - ~~`STRIPE_WEBHOOK_SECRET`~~ — **done 2026-08-04.**
   - `CLOUDFLARE_API_TOKEN` → GitHub Actions secret. Until set, every push touching
     `worker/**` fails the Deploy Worker job. **This is a convenience, not a blocker** —
     `npx wrangler deploy` from `worker/` works today on this machine, so the only cost is
     that Worker deploys stay manual.
1. ✅ **Chrome Web Store — published at v1.5.0, review cleared (§8).** Confirmed 2026-08-17:
   `publishedItemRevisionStatus` is `PUBLISHED` at 100% and there is no submitted revision.
   Every safety rule in §7, the tracker, the `identity` bridge message, §16's coverage
   honesty, §17's résumé auto-attach, §18's work-auth fix, §19's rails and §20's field-order
   fix have all reached real installs.
   Poll any future submission with
   `node store/publish-extension.mjs --dry-run`, which now prints both revision blocks
   directly (it used to slice the raw response at 500 chars, and the ~400-char `publicKey`
   ate the whole window, so the one thing the poll exists to report was never visible).
   The submit loop that works: `node tests/browser-endtoend.mjs`, then
   `node store/publish-extension.mjs`, then poll `--dry-run` a day later. Three for three.
   **One thing still owed:**
   - **A dashboard visit**, for the two things the API cannot touch: the screenshots (the
     live listing still shows v1.1.2's; the three in `store/` were regenerated against the
     shipped v1.5.0 UI on 2026-08-17 and are ready to upload as-is), and the Privacy
     practices tab. ⚠️ Read the warning in `store/OfferAIO-store-listing.md` before
     answering the data-transfer question — the honest answer changed when Pro started
     sending data off-device and again when §17 started storing a résumé file, and a
     mismatch with privacy.html is a common rejection reason.
2. **Cloudflare Worker** — deployed and verified (§14). Confirmed still healthy
   2026-08-08: `/health` returns `{"ok":true,"service":"offeraio-worker/1.0"}`, and
   `/cover` returns **402** for a bogus key, so the licence gate is live and
   `OPENAI_API_KEY` cannot be drained by an unlicensed caller.
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
  held. At the time there was no resume anywhere in the profile, so "resume attached" told
  users the one thing they still had to do was already done; and "work auth" reads as a
  promise to answer the question §7 rule 1 deliberately refuses to answer. As of v1.4.0 the
  resume tick can be true — but it is driven by what the extension reports over the bridge
  (§17), never assumed. `reviewFields()` now ticks only what the profile really carries, says
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

## 17. The résumé is attached, not highlighted (added 2026-08-13, v1.4.0)

### ⚠️ "Browsers forbid scripts from attaching files" was wrong, and it cost the product its most-requested feature

That sentence appeared in **eleven places** — `content.js`'s header, `resumeMissing()`'s
comment, §7 rule 2, §7's behaviour list, the dashboard's `reviewFields()`, `privacy.html`
twice, `start.html` twice, the mock form and `dev/README.md`. It shaped the product: the
résumé field was highlighted and handed back to the user on **every single application**,
which is the one manual step in a tool whose whole pitch is "auto apply while in class".

It is a misconception. What browsers forbid is setting `input.value` to a filesystem path —
a script cannot reach into your disk. But a `File` built from bytes the extension already
holds can be handed over through a `DataTransfer`, and **`input.files` has been assignable
for years**. Verified in Chrome against `dev/mock-application.html` before any code changed:

```
attachedFromEmpty: true
onForm:      { count: 1, name: "priya-raman-resume.pdf" }
inFormData:  ["resume=priya-raman-resume.pdf"]     ← genuinely submitted, not just displayed
changeFired: true,  validityNowOk: true
```

The `FormData` line is the one that matters. A file that merely *appears* attached but is
absent from the form's payload would be the §2 failure all over again, in the worst possible
place — the user submits believing their résumé went, and it did not.

### How it works

- **Saved in the popup** (`popup.html` / `popup.js`) as base64 in `chrome.storage.local`
  under `resume` = `{name, type, size, data, savedAt}`. **Capped at 2 MB**: `storage.local`
  allows ~10 MB without the `unlimitedStorage` permission, base64 inflates by a third, and
  requesting a larger storage permission at review to hold a document that is nearly always
  under 500 KB is a bad trade. The cap is enforced with a plain message rather than left to
  surface as an uninterpretable quota error.
- **Attached by `content.js` `attachResume()`**, which dispatches both `input` and `change`
  (React listens for one or the other).
- **The field turns green, not blue.** Blue means "your turn"; marking a finished thing as
  outstanding is the same class of dishonesty as the reverse.

### ⚠️ It verifies; it never assumes

`attachResume()` re-reads `input.files` afterwards and returns whether the file is genuinely
there. **Nothing downstream trusts the attempt.** A custom drag-and-drop uploader that posts
to S3 itself, a sandboxed iframe, or a cross-origin form can all leave the input untouched —
and a résumé we *believe* we attached is worse than one we know is missing, because full-auto
would submit on the strength of it. §7 rule 2 therefore still stands unchanged: `resumeMissing()`
reads the input, so full-auto still stops when the attach failed. The popup and the in-page
bar both distinguish "attached", "this form wouldn't take it", and "none saved".

It also refuses to overwrite a file the user attached themselves.

### Privacy — the claim changed, and the policy had to change with it

`privacy.html` said the résumé "is never uploaded or transmitted". That is no longer the
right sentence: the extension now attaches it to **the employer's** form, so submitting sends
it to that employer — which is the entire point, and exactly what happens when a user picks
the file by hand. What remains true, and is now what the policy says, is that it is **never
sent to OfferAIO**: it lives in `chrome.storage.local`, there is no server that receives it,
and it is never part of a `/cover` request. The Web Store data disclosure in
`store/OfferAIO-store-listing.md` was updated to match — §8's warning about privacy.html and
the Privacy tab disagreeing applies directly here.

This also **strengthens** the §12 item 6 argument against wiring `/rank` as designed: the
extension now holds an actual résumé file, so "we never send your résumé anywhere" is a
sharper promise than it was, and sending résumé *text* to the Worker would break it more
visibly.

### ✅ Verified in the isolated world (2026-08-15)

This section used to end "Not verified" — the check had only ever run in a normal page, and
content scripts run in an **isolated world** with its own `File`, `DataTransfer` and
`FileList` constructors. `tests/browser-endtoend.mjs` now settles it, against a real Chrome
with the real extension installed:

```
attachResume() returns true · file on the input · bytes survive the base64 round trip
in the form's FormData: ada-lovelace-resume.pdf, exact byte length
the page's OWN world sees the same file  ← a wrapper that existed only in the isolated
                                            world would pass every other assertion here
input and change both fire · the required file input now validates
a file the user attached themselves is left alone
```

The page's-own-world assertion is the one worth keeping. Everything else could be satisfied
by an object visible only to us, which is precisely the failure mode that would let a user
submit believing their résumé went.

Still unproven on a **real ATS**, and that is a different claim: Greenhouse and Lever may
use custom uploaders, sandboxed iframes, or post to S3 themselves. The design already fails
safe there — `attachResume()` re-reads `input.files` and reports honestly — so the residual
risk is a résumé we correctly report as not attached, not one we wrongly report as attached.

## 18. The profile is a contract, and only one side of it was tested (added 2026-08-15, v1.4.1)

### ⚠️ Rule 1 was right, was tested, and shipped the exact harm it forbids anyway

`answerFor` no longer asserts work authorisation — §7 rule 1, eight tests, all green since
2026-08-05. It leaves ambiguous questions blank, and its guard for "we don't know" is
`typeof p.needsSponsorship !== "boolean"`.

**Nothing could reach that guard.** The profile has two writers and one reader:

| | writes the profile |
| --- | --- |
| `extension/popup.html` + `popup.js` | what the user types into the extension |
| `OfferAIO.html` | what the user types into the website, pushed over the bridge |
| `extension/content.js` | the only reader — on somebody's job application |

Both writers derived the flag the same wrong way:

```js
needsSponsorship = (workAuth === "Requires sponsorship")   // four answers into two
```

Two consequences, both live from the day rule 1 was written until 2026-08-15:

1. **"F-1 (CPT/OPT)" stored `false`.** So on *"Are you authorized to work in the United
   States without sponsorship?"* the reader took the boolean at face value and answered
   **"Yes"**. That is the false legal declaration rule 1 exists to prevent, made on behalf
   of precisely the students it exists to protect, by the code written to protect them.
2. **Neither select had a blank option.** The dashboard's defaulted to "US Citizen", the
   popup's to "Sponsorship? No". A user who never touched the control still shipped a
   confident answer they had never given — and the reader could not tell that from a
   deliberate one.

`tests/content-workauth.test.mjs` was green throughout, and its own fixtures show why:
`const f1 = { needsSponsorship: true, workAuth: "F-1 (CPT/OPT)" }` — a shape **no writer
ever produced**. The reader was tested exhaustively against a profile the product did not
build. **Test the writers, or the reader's tests are fiction.**

### The fix

`sponsorshipNeed(p)` in `content.js` returns **true / false / null**, and reads the explicit
selection rather than the derived boolean:

| selection | stored | read as |
| --- | --- | --- |
| US Citizen, Permanent Resident | `needsSponsorship: false` | false — answerable |
| Requires sponsorship | `needsSponsorship: true` | true — answerable |
| **F-1 (CPT/OPT)** | **key absent** | **null — ask the user** |
| blank (the default) | key absent | null — ask the user |

A stored `false` with no selection behind it is **not trusted** — that was the old default on
both UIs, a value nobody chose. A stored `true` is, because it only ever came from a
deliberate pick and over-declaring a need for sponsorship is not the dangerous direction.
Dashboard profiles written before the blank option existed drop a stored "US Citizen" on
load (`PROFILE_VERSION` 2): it costs a citizen one dropdown, and it stops an international
student's applications declaring something they never said.

Both UIs now offer the same five choices with the blank one selected, and the popup's binary
"Sponsorship?" select is gone — it could express neither F-1 nor silence.

⚠️ **The derivation now exists three times** — `content.js`, `popup.js`, `OfferAIO.html` —
in files that cannot import each other. That is the §16 problem again.
**`tests/profile-contract.test.mjs`** holds them together: same options in both UIs, blank
first and selected, identical derivation for every option either offers, and the reader's
conclusion matching what the writers stored. It also asserts every key `popup.js` saves has
a matching id in `popup.html` — `document.getElementById(k).value` throws inside the Save
handler, so renaming a control without renaming its key silently kills the whole button.

### Two silences fixed beside it

Both found by the browser harness, both the §16 failure in miniature — a question left
blank is indistinguishable from a user who got distracted, so it generates no bug report:

- **A label whose control could not be resolved was dropped without a word.** `controlForLabel`
  refuses to guess on a dense form (§7 rule 4), which is right — but when we *had* an answer
  and nowhere provably safe to put it, nothing was said. It is now named in the bar (no
  outline: we do not know which box it is).
- **A dropdown with no option matching our answer was left empty without a word** — "Yes"
  against options reading "Yes, I am authorized to work". Now flagged like anything else.

### `tests/browser-real-ats.mjs`

The same machinery pointed at **live** Greenhouse, Lever and Ashby postings, filling real
forms and reporting what landed. `browser-endtoend.mjs` proves the mechanism against a form
we wrote, which means it proves the mechanism and assumes the market; this closes §17's last
caveat with evidence.

⚠️ **It never submits.** It calls `run()` and reads the DOM back; `doSubmit` is never called
and no button is ever clicked. Keep it that way — the moment it can submit, running it costs
somebody a real application under their name. The profile it seeds is a throwaway
(`nobody@example.invalid`), because these are real employers' pages.

`node tests/browser-real-ats.mjs [url…]`. With no arguments it samples one posting per ATS.
The line to watch is **`report disagrees with the DOM`**: §17's whole safety argument is that
`attachResume()` never claims an attachment it cannot see, so that warning firing is the one
result that would actually matter.

### `tests/browser-endtoend.mjs`

A real Chrome, the real extension, the real content script in its real isolated world.
32 assertions covering §17's handoff, §7 rules 1/3/4/5, and the tracker's three outcomes.

- **Run it before any store submission.** It is not in CI — `test.yml` globs
  `tests/*.test.mjs`, which this deliberately is not, because it needs a Chrome binary.
  `node tests/browser-endtoend.mjs`, or `--head` to watch it.
- ⚠️ **`--load-extension` and `--disable-extensions-except` are ignored by branded Google
  Chrome** ("not allowed in Google Chrome"), silently apart from one stderr warning — the
  symptom is simply that no isolated world ever appears. The extension is installed over
  CDP instead: `Extensions.loadUnpacked`, which `--enable-unsafe-extension-debugging`
  unlocks. Do not "fix" this back to the flags.
- The mock form is **generated into a temp dir at runtime**, not committed. GitHub Pages
  publishes every file in this repo, so a tracked `dev/mock-application.html` would put a
  convincing fake job posting live on offeraio.com — the reason `dev-harness` exists and
  stays unmerged. The extension is copied to a temp dir too and given its `127.0.0.1` host
  permission *there*, so a local-only host entry cannot leak into the store zip.
- It found the work-auth bug within a minute of first running green, by the plain mechanism
  of using the profile shape the product actually stores. The first version of the harness
  used `firstName`/`lastName`, "found" a name-filling bug that did not exist, and that false
  positive is itself the argument for `profile-contract.test.mjs`.

## 19. The marketing page was selling a different product (added 2026-08-16, v1.5.0)

### The pattern, stated once

Every problem in this section is the same problem, and it is the one §2 is about: **a claim
that nothing checks drifts away from the code and nobody notices, because a claim has no
tests.** §2 fixed it in the dashboard on 08-06. §8 fixed it in the store listing on 08-08.
Nobody audited **landing.html, pricing/index.html or start.html**, and by 08-16 all three
were describing a product that did not exist. Found by reading the live site against the
shipped code, which had never been done.

### a) Four claims the product could not deliver

| Claim | Where | Reality | Resolution |
| --- | --- | --- | --- |
| "plus **any link you paste**", a green `+ any link` chip, "Paste any link as a task" | `landing.html` ×3, `pricing/index.html` | §16: ~49% of the board is on employer-owned careers sites where no content script runs. §8 cut this exact sentence from the store listing on 08-08 as untrue and a rejection risk, and never touched the site | **cut** |
| "**Resume-ranked matching** — tasks fire on the roles your resume scores highest on" + a Pro bullet | `landing.html`, `pricing/` | `/rank` has no caller outside the desktop engine, and wiring it as designed contradicts `privacy.html` (§12 item 6) | **cut**, replaced with §16's coverage honesty, which is real and is a genuine differentiator |
| "**Response Radar** — watches Gmail, Handshake and LinkedIn" + a Pro bullet | `landing.html`, `pricing/` | `engine-gmail.js`, the optional Electron engine. The extension reads no mail. §8 already keeps Responses at 0 in the store screenshots for exactly this reason | **scoped** — labelled "desktop app" |
| "**PACING** humanized · randomized", "**DAILY CAP** 12 applications" | `landing.html` trust band | A grep of `extension/` for `dailyCap`, `pacing`, `humaniz`, `randomDelay` returned **nothing at all**. Both were claims about code that did not exist | **built** — see (b) |

⚠️ The trust band is the worst place in the product for a false statement, because its whole
job is to be believed. Two of its five rows were fiction.

### b) The rails now exist, and are the real thing (`license.js`, `content.js`)

`getDaily()` counts auto-sends against a **12/day** cap on the same local-date basis as the
monthly counter. `paceWaitMs()` reports a **randomized 45–90s** gap, drawn once per
submission in `recordSubmission()` and stored as an absolute deadline — **not rolled per
call**, because a re-rolled gap changes on every read and therefore never elapses, and
nothing about it could be tested. Clock skew clamps to one normal gap, the same reasoning as
the licence cache.

⚠️ **Both govern AUTOMATIC sending only, and this is deliberate.** Full-auto pauses and says
how to send anyway; `doSubmit` does not re-check either. A user clicking Submit is present and
choosing, and this project's rule is that a metering bug must never stop someone applying for
a job — which applies to a safety rail with *more* force, not less. **A rail you cannot
override is a trap.** Full-auto's flat 2s delay is now jittered too: a constant interval is
itself a signature, which is the entire point of pacing.

`tests/pacing.test.mjs` (16 tests) asserts the cap, the day rollover, the range, the
stored-deadline property, clock skew, junk input — **and the advertised constants**, so the
trust band cannot quietly become a lie again. That last test is the point of the file.

The dashboard's **"Daily cap" input had existed for a while and was wired to nothing** —
localStorage and no further. It now rides over the bridge; `bridge.js` validates the range
before storing it and ignores anything out of range so `getDaily()` keeps the shipped
default. Its default moved **25 → 12** to agree with the code and the page.

### c) The hero demo was still running the §2 simulation

`landing.html`'s `STAGES` walked `Monitoring → Match found → Filling application… → Writing
cover letter… → Submitted ✓ → ★ Interview request` on `setInterval(tick, 1900)`, and rolled
`Math.random() < .05` to **invent interview requests** next to real company names. That is
verbatim the thing §2 calls "the single most important rule in the project", deleted from the
dashboard on 08-06 and left running for ten more days **on the most public page we have** —
where §8's rule ("inventing a response rate in a store listing is the same failure in a more
public place") applies harder, not less.

Deleted. `tick`, `startSim` and the interval are gone; `typeof tick === "undefined"` on the
live page. Two active statuses remain because two is all the product has (`Ready · matched`,
`Opened for review`), and the Submitted tab shows **Applied ✓** vs **Sent · not confirmed** —
the tracker's own outcomes. Showing the unconfirmed row turns out to be the most persuasive
thing on the page: the honesty *is* the pitch.

⚠️ **Nothing may advance on a timer here again.** The honest levers are the ones a visitor
drives — switch pages, add a task, open one, send from the queue. Reaching `applied` needs the
extension on a real employer's form, which a marketing page cannot do and must not mime.

**The cast was also wrong.** Of the 14 companies shown being applied to, **nine were not on
the live board at all** (Stripe, Anthropic, Bain, Goldman, Two Sigma, Figma, Meta, McKinsey,
Ramp) and Jane Street's 15 rows and Databricks' 1 are **zero-fillable** — 11 of 14 were
postings the product cannot fill, and Jane Street was both the flagship row and the
cover-letter showcase. Now Palantir, DRW, Point72, Anduril, IMC, Capital One, Citi, Virtu,
Micron, Etched: every one on the board and on a host `ats.js` matches. `FALLBACK` too.
And `toby · Pro` is off the public page — §8 caught the identical leak in store screenshot 2.

### d) `catForTitle()` used Software Engineering as a dumping ground

Its last line was `return 'swe'`. Measured against the 387-row board:

```
                      before          after
Software Engineering   284 (73.4%)     201 (51.9%)
...with no tech word    49               0
categories produced      8              16
```

The 49 were Wells Fargo **Human Resources**, Marsh McLennan **Insurance**, Oliver Wyman
**Actuarial**, Commercial Banking, Wealth Management, Corporate Risk. "Pick your lanes" is the
feature that broke: a student who picks Software Engineering and is handed an insurance req has
been told something false about the board. `swe` is now claimed only on a real engineering
signal; seven categories were added (`hardware`, `finance`, `risk`, `ops`, `marketing`, `hr`,
`other`) and the remainder says **`other`**. An honest Other beats a confident wrong label —
the same reasoning as `canFill()`'s third state in §16.

`tests/category.test.mjs` (9 tests) is a consistency test over the live board, and was
**mutation-tested**: restoring `return 'swe'` fails two of it.

⚠️ **`generate_pages.js` keeps its own `CATS`** with the same bare-`engineer` over-match.
Deliberately untouched: its slugs are live SEO URLs (`/internships/software-engineering/`) and
changing them churns indexed pages. That is a decision, not an oversight.

### e) `landing.html` read `listings.json` without filtering `active !== false`

The one rule §15a says every consumer must follow, and the exact fix `generate_pages.js`
needed. Harmless only while `data/meta.json` reports `closed: 0`, which is not the steady
state — `verifyStillOpen()` exists precisely because it will not stay 0. Filtered before the
newest-8 slice, or a run that closes eight reqs empties the panel.

### f) The dashboard had no media queries at all

`OfferAIO.html` declared `<meta name="viewport" content="width=device-width">` and then laid
out a `width:200px` non-shrinking sidebar, a `repeat(4,1fr)` stat grid and full-width data
tables. On a 390px phone: 200px of chrome, 190px of content. **The landing page had a dozen
breakpoints; the product had none**, which is the wrong way round.

Now: grids collapse at 1080/900, and under **900px** (not 760 — an iPad in portrait is 768,
and 768 − 200 leaves 568px for tables that want 560) the sidebar becomes a horizontal
scrollable top strip with a right-edge mask that drops once scrolled to the end. Tables keep a
`min-width` and scroll **inside their card** rather than being reflowed into stacked cards,
which preserves the column alignment that makes a listings table scannable. `100dvh` with a
`100vh` fallback. Reduced motion honoured. Verified at 390/768/1100px with no horizontal
overflow.

### g) `start.html` told every visitor the extension was not on the store

The page every **"Start free"** click lands on carried a badge reading `MANUAL INSTALL · NOT
YET ON THE CHROME WEB STORE` and a paragraph opening *"Straight answer: OfferAIO isn't on the
Chrome Web Store yet — it hasn't been submitted, so there's no review to wait for"*, followed
by five steps of unzip-and-enable-Developer-mode.

True when written. False from **2026-08-04**, and it survived **four store releases** —
v1.1.2, v1.3.0, v1.3.1 and v1.4.1 all shipped while onboarding said the extension had never
been submitted. Two costs, the second larger: it asked a student to sideload an unpacked
extension where one click would do, and it told every visitor **in the product's own words
that the product was not finished**, on the one page whose entire job is to convert. §12 says
the remaining gate is distribution; this was distribution blocked by a stale sentence.

Now one **"Add to Chrome — free"** button →
`chromewebstore.google.com/detail/hcbchgpjladdfmcammhgbbmkdagcfcgd` (verified 200, serving
v1.4.1). The zip path is kept — it is still the only way to run a build newer than the
published one — but collapsed into a `<details>` so it stops competing. Same for the
dashboard's connect gate and the landing footer.

⚠️ **Whenever the store status changes, `start.html` step 1 is the thing to check.** It is
the only place that describes how to install, and it is not covered by any test.

## 20. Filling a real form with a real profile (added 2026-08-16)

Toby's own profile was pushed through the dashboard into the extension and used to fill live
DRW Greenhouse postings. **This had never been done**, and it found in one run what no test in
the repo had.

### ⚠️ a) A "when" question answered with the school name

```
"Please confirm when you will complete your university studies."   ->   "Indiana University"
```

The label contains **"university"**, and `answerFor()`'s school test sat above any test for a
date. Reproduced on both DRW postings. This is **§7 rule 4's failure by another route**: rule
4 stops a label binding to the wrong *control*; this bound the right control to the wrong
*answer*. The consequence is identical and it is the one that matters — something untrue, in
the user's name, on a form an employer reads.

§7 rule 1 already documents an ordering trap in this same function ("without sponsor" must be
tested before "requires sponsor"). **Treat the whole chain as order-sensitive and add nothing
above the work-auth and date tests.** A WHEN question is now answered before any WHERE
question, and `NEEDS_USER` when no date is stored — the bar names it, the user fills it.

`tests/content-fieldorder.test.mjs` (11 tests), **mutation-tested**: moving the school test
back above the date test fails two of it.

Two fields the profile already knew and never used, both empty **and required** on both DRW
forms: **"Discipline"** / "course of study" (Greenhouse's word for the major) and **"Legal
First/Last Name"** (asked as a custom question named `question_<id>`, which `SEL.first` and
`SEL.last` cannot see). Coverage on that form went **9 → 22 of 48**.

### b) §7 rule 2 earned its keep on a real employer's page

The extension was still in **full-auto** from the 08-13 harness runs. On a live DRW form it
**paused** rather than submitting, because it had declined to answer *"Please provide visa
status and expiration if applicable."* Had the rule not been there, a real application would
have gone to a real employer unattended. The rule works; the mode was then set back to semi.

⚠️ **A harness run leaves state in whatever browser it touched** — mode, profile, usage
counter, application records. Check the mode before testing anything on a real posting.

### c) `tests/browser-real-ats.mjs` was broken, and had been flattering itself

§18 presents this harness as closing §17's last caveat "with evidence". It had three bugs, and
the second means the evidence was never what it looked like:

1. **`waitFor()` did `await fn().catch(...)`**, but one call site passes a *synchronous*
   callback returning `null` until the isolated world appears. So on any page where the
   content script had not attached by the first poll, `null.catch` threw
   `Cannot read properties of null (reading 'catch')` and the run died on the first URL — and
   the TypeError replaced `waitFor`'s own message, the one that says what to check. Timing
   dependent, so it passed whenever the extension won the race.
2. **Lever and Ashby keep the posting and the application on separate URLs**, so both were
   skipped as "no application form" while the output read as though three ATSes were covered.
   In practice **only Greenhouse was ever reached.** Now falls through to `/apply` and
   `/application`.
3. **The payload check did `FormData(f).get(rf.name)`** and reported `in FormData: no` on every
   real Greenhouse posting — because Greenhouse's résumé input carries `id="resume"` and **no
   `name` attribute**, and `FormData` only serialises *named* controls. The single line §17
   calls "the one that matters" was answering a question about markup while reading as a
   verdict on our attachment. It also inspected the *first* file input, not the one the
   extension used, so Ashby (which has two) reported "no file to check" on a form where the
   handoff had worked.

### ✅ d) §17 is now verified on all three ATSes

```
Greenhouse  attached · real File · input unnamed, so FormData excludes it for a
                                   hand-picked file too - this ATS reads input.files itself
Lever       attached · IN FormData as test-resume.pdf, 193B      <- the fully proven case
Ashby       attached · uploader sits outside any <form>, so no payload exists to check
```

No **"report disagrees with the DOM"** warning on any of them, which §18 correctly names as
the one result that would matter. Nothing was submitted; `doSubmit` was never called.

⚠️ The payload check now distinguishes four states — `present`, `unnamed`, `noform`,
`MISSING` — and **only `MISSING` is a bug**. Do not "fix" `unnamed` or `noform`; they are
properties of the employer's markup and are identical for a file the user picked by hand.

### e) What the fill rate actually looks like

`Greenhouse 22/48 · Lever 6/89 · Ashby 1/4`. Greenhouse is genuinely good; **Lever and Ashby
are not**, and the honest reading is that the numbers reflect long custom-question sections and
lazily-rendered fields rather than contact details being missed. Not investigated further — the
next real coverage work is here, not in adding another ATS.

⚠️ **A business/finance student's fillable half is mostly Workday.** Of 126 postings on
open-form ATSes (Greenhouse/Lever/Ashby), **74 are software** and only 8 are in finance, IB,
accounting, real estate or consulting. The 51% coverage headline of §16 is not evenly
distributed across categories, and for a non-technical user the practical figure is worse.

## 21. The board doubled, mostly from a feed already listed here (added 2026-08-16)

```
                     before    after
active listings        387       942     +143%
fillable               208       578     53.7% -> 61.4%
HEAD-checkable         126       213
in finance/IB/RE/
  accounting lanes      55       130     (fillable)
```

### ⚠️ a) A fallback chain and a merge look almost identical in code

`communityListings()` iterated `COMMUNITY_SOURCES`, took the **first reachable** one and
`return`ed. `vanshb03` is first and always reachable, so **SimplifyJobs — 46k stars, the
largest Summer 2027 list in existence — was listed in `scrape.js` for weeks and never once
read.** Nothing failed. Nothing logged. Measured on 08-16: vanshb03 carries 401 rows,
SimplifyJobs **14,286** (919 tagged Summer 2027).

This is §19's pattern in the pipeline instead of the copy: **the config said the right thing
and the code did something else, and no test compared them.** The two shapes differ by a
`return`.

### b) Four feeds, each with its own parser

| Feed | Kept | Why it is here |
| --- | --- | --- |
| `SimplifyJobs/Summer2027-Internships` | 364 | The big one. Listed for weeks, never read |
| `vanshb03/Summer2027-Internships` | 161 | Already used; tags no terms, so the title rules carry it |
| `speedyapply/2027-SWE-College-Jobs` | 81 | 8.8k stars, daily. Its generator reads a **private** API, so the only public copy of the data is the **markdown table in the README** |
| `zshah101/Automated-List-Of-…` | 41 | ~4,300 employer boards every 30 min, clean CSV with an explicit `season` column, plus salary and H-1B sponsor data. **72% fillable — the best share of any feed**, because its rows come from ATS hosts rather than employer careers pages |

Merging is only safe because **the dedupe is URL-first**. The same posting arrives from three
aggregators as "Palantir", "Palantir Technologies" and "Palantir Technologies Inc"; the
company+title+location key treats those as three companies, and the URL key collapses them to
one row. ⚠️ **Do not reorder the dedupe to put the name key first.**

⚠️ **`mirrors` inside a feed IS a fallback chain, and that is correct** — they are copies of
one source (`/dev` and `/main` of the same repo), not different sources. The bug was applying
that logic *between* feeds.

### ⚠️ c) The sanity gate, and why a parser must never be trusted

Two of the four parsers read formats maintained by strangers — a CSV and a markdown table. **A
parser aimed at a format that has moved on does not throw.** It returns rows with the columns
shifted, so the title column now holds a location, and every one of those rows becomes a
posting the product advertises and the user cannot open. That is worse than a crash.

So `fetchFeed()` discards a feed **wholesale** unless it clears both `FEED_MIN_ROWS` (20) and
`FEED_MIN_INTERN_RATIO` (0.5 of titles passing `isIntern`). A broken feed contributes nothing
and says so in the log; it never contributes garbage. `tests/feeds.test.mjs` simulates a
column shift and asserts the gate rejects it.

### ⚠️ d) 29 of 56 Workday boards in `companies.json` were dead

Probing every one found these returning **422 or 404 on every run**, for an unknown length of
time — roughly 87 wasted requests every six hours, and enough log noise to hide a real
failure. The slug is wrong, not the request: the hosts resolve (a bare root gives 406 because
Workday wants a real site path), and **no site-variant guess fixes any of them**, so the
tenant is wrong too.

They are **removed** rather than left failing, and recorded here so the intent is not lost.
**Wanted, needs a correct `host`/`tenant`/`site`:**

> Goldman Sachs, KKR, Deloitte, KPMG, EY, Grant Thornton, BDO, CBRE, Hines, Brookfield, AMD,
> Qualcomm, Intuit, Visa, American Express, Truist, BNY Mellon, Northern Trust, T. Rowe Price,
> PIMCO, Aon, Apollo, Carlyle, Moelis, Guggenheim, Baird, William Blair, Piper Sandler,
> Jefferies

That list is disproportionately **investment banking, accounting, PE and real estate** — the
lanes a non-technical user cares about (§20e). Recovering them is the single highest-value
listings work left. The method that works: find the employer's real Workday careers URL, read
the `host` and the site slug out of it, then validate with a POST to
`https://{host}/wday/cxs/{tenant}/{site}/jobs` before committing it. Some of these employers
are **not on Workday at all** (Goldman runs `higher.gs.com`), so expect to delete a few rather
than fix them.

### ✅ e) 46 Workday boards recovered from the feeds' own URLs

The trick worth remembering: **a posting URL in a community feed proves the host and site slug
are real.** Harvesting `myworkdayjobs.com` URLs off the merged board yielded 53 host/site pairs
`companies.json` did not have; 52 validated against the live API; 46 survived after dropping
internal boards (`private`, `redeployment`, `sourcer_on_req` — recruiter and existing-staff
sites, not public postings) and case-duplicate slugs. **14,875 postings sit behind them.**

Enumerating a board directly finds every intern posting on it, not just the one or two an
aggregator happened to catch — which is why 46 boards moved the Workday row from 53 listings
to 221.

Good ones for a finance audience: **Arrowstreet Capital** (`Campus_Careers`), **LPL Financial**
(`university`), **HNTB** (`hntb_university_careers`), Crowe, UHY, First American, PGIM,
Prudential, KeyBank, Northwestern Mutual, Genworth, CNO Financial, FTI Consulting.

### f) `scrape.js` is testable now

It exports its parsers and predicates, and `main` is behind `require.main === module`. Before
this, **nothing in the repo exercised any of the pipeline** — which is how (a) survived. `node
scrape.js` behaves exactly as before. `tests/feeds.test.mjs` (16) covers the merge shape, all
four parsers, CSV quoting, markdown entity decoding, the sanity gate and cross-feed URL
dedupe, and was **mutation-tested**: restoring the fallback chain fails it.

### g) Sources considered and rejected

- **`sndsh404/summer-2027-internships`** (907 stars) — publishes only `internship_tracker.xlsx`.
  Parsing xlsx with zero dependencies means unzipping and reading XML; not worth it for the
  volume, and the repo had not been pushed in two weeks.
- **SmartRecruiters** — its public postings API works
  (`api.smartrecruiters.com/v1/companies/{co}/postings`, no auth) and the extension already
  fills that host, but every company needs its slug discovered by hand. **Worth doing next**
  after the §21d recovery.
- **Breezy** (`{co}.breezy.hr/json`) — redirects (302); needs follow logic. Small volume.
- **The remaining 12 fillable ATSes** — the extension fills 16 (`ats.js`) and the pipeline
  enumerates 4. iCIMS, Taleo, Jobvite and Workable have no clean public JSON per tenant;
  LinkedIn/Indeed/ZipRecruiter forbid it. SmartRecruiters and Breezy are the only two with a
  real opening.

## 22. Verifying the listings, and the three bugs verification found (added 2026-08-16)

### The premise

The pipeline had a liveness checker and a filter chain, and **nothing checked either of
them.** §21 is what that costs: a feed named in `scrape.js` went unread for weeks and nothing
failed. So this pass built the audit, and the audit found three real bugs within minutes of
first running. That is the argument for it, and it is the same argument as §18's — *test the
writers, or the reader's tests are fiction* — applied to the pipeline instead of the profile.

### a) 77% of the board was never verified

`CHECKABLE_HOST` covered Greenhouse, Lever and Ashby only: **213 of 942 rows (23%)**. Workday
had meanwhile become the largest host on the board at 324 rows and was checked not at all.

Every major host was **measured, not assumed** — guessing is dangerous in both directions,
because a host that always says 200 makes coverage look complete while nothing is verified,
and a host that 404s a live posting deletes a job somebody could have had:

| Host | Rows | Verdict |
| --- | --- | --- |
| `myworkdayjobs.com` | 324 | ⚠️ **the posting HTML is a SPA shell and returns 200 for a req id that never existed** — HEAD proves nothing. The **cxs per-job JSON** endpoint returns 404 (`errorCode S21`). Checkable, via a different request |
| `greenhouse.io` / `lever.co` / `ashbyhq.com` | 213 | HEAD: 404, 410, or a redirect to the board root |
| `icims.com` | 21 | clean **410 Gone** |
| `smartrecruiters.com` | 12 | public postings API 404s a missing id |
| `ats.rippling.com` | 11 | **200 for a fabricated job id** — not checkable |
| `lifeattiktok.com` | 106 | refuses our requests — not checkable |

Coverage **23% → 60.8%**. The expanded checker immediately caught a **CNO Financial**
(Workday) and an **Uber** (iCIMS) req that were dead and still listed — both on hosts that
could not be checked at all the day before.

⚠️ The unverifiable remainder — TikTok, Tesla, Jane Street, Oracle Cloud, Work at a Startup,
Rippling — is largely **the same employer-owned set §16 says cannot be filled**. The two gaps
overlap, which is worth remembering before treating either number as improvable in isolation.

### b) "Checked daily" was not something the code did

`RECHECK_MS` was **48h**. Now **20h**, so a listing always comes due within a day, and
`CHECK_BUDGET` went 120 → **250**: four runs a day gives 1,000 checks against 563 checkable
rows, with headroom. Verified empirically rather than by arithmetic alone — after two passes,
**278 of 278** settled checkable rows were verified inside 36h.

⚠️ Both numbers are asserted by `tests/listings-integrity.test.mjs`, including the arithmetic
one: **if the board outgrows `CHECK_BUDGET × 4`, the test fails before coverage visibly
rots.** That is the check that would have caught this in the first place.

### ⚠️ c) Three bugs, found by the audit on its first run

**1. Duplicate URLs reached the board.** The dedupe registered the *loser's* keys but never
the *winner's*, so after a richness replacement the winner's URL was unknown to `seen` and a
third row carrying it was pushed as new:

```
A (url=uA, key=k)  -> idx 0
B (url=uB, key=k)  -> collides on k, replaces A at idx 0; uB never registered
C (url=uB, key=k2) -> matches nothing, pushed as a NEW row  ->  uB is on the board twice
```

Optiver posting one title in one city under two req ids is exactly that shape. Three
duplicates; 942 → 934 once fixed. The registration is guarded with `has`, because a key
already pointing at a different index must keep pointing there.

**2. Seven rows on plain `http`** — JazzHR, Ashby and an Oracle tenant. Not pedantry: the user
types their name, phone and email into that page and attaches a résumé, so `http` sends all of
it **in the clear**. Every one of those hosts answers 200 on https — the `http` was stale feed
data — so URLs are upgraded at ingest, **before** the dedupe keys are computed, or the two
forms of one posting both land.

**3. ⚠️ Closed rows were forgotten on the very next run, so §15a's fortnight of retention
never existed.** The carry-forward copied `active: false` but **not `date_closed`**, so the
forget filter evaluated `(undefined || 0) > cutoff` — false — dropped the row, and the
community feed, which had not noticed the req closed, re-imported it as live. Flagged closed,
forgotten, re-imported, flagged closed again, indefinitely.

The proof was sitting in the logs the whole time: **the two dead Veeam reqs PROJECT.md records
as caught on 2026-08-06 were still being re-detected twice a run on 08-16.** Retention is the
one thing that stops a dead posting coming back, and it was the one field not carried across.
Verified after the fix: run one flags five closed and retains them, **run two re-closes
nothing.**

Also `meta.json` counted `checked` and `checkable` over retained rows while `total` counted
open ones, so the coverage ratio was measured against a different set than its own denominator
and read slightly high.

### d) What now checks, and where

**`audit-listings.mjs`** — data invariants, coverage arithmetic, staleness, source
concentration, and a **stratified sample of real URLs actually fetched** to see whether they
still resolve. Exits non-zero on a hard invariant or a breached threshold.

⚠️ Coverage is measured **only over rows old enough to have been due**, using a new
`date_first_seen` carried across runs. Scoring a row that arrived twenty minutes ago as
unverified would make every board expansion look like a broken checker, and an audit that
cries wolf after every good day is an audit everyone learns to ignore — which is precisely
what happened to the coverage numbers already sitting in `meta.json`.

**`.github/workflows/verify-listings.yml`** — daily at **07:30 UTC**, ninety minutes after
`update.yml`'s 06:00 pass so it audits fresh data, plus on any push touching `scrape.js`,
`companies.json` or the audit itself. It uploads the report and **opens or comments on a single
labelled issue on failure**, then closes it when green. A red X in the Actions tab is easy to
miss for weeks, which is the exact failure mode this workflow exists to prevent; an alert
nobody sees is not an alert.

⚠️ It is deliberately **separate from `update.yml`**. `update.yml` does the checking; this
checks that the checking happened. Do not merge them — a failing audit must not stop fresh
listings from publishing, and a broken pipeline must not be able to suppress its own alarm.

**`tests/listings-integrity.test.mjs`** (17, no network, every push) — re-applies the ingest
filters to the committed data, so a filter regression is caught by the data rather than by a
user landing on a Summer 2025 req. Also asserts no duplicate URLs, https everywhere, that
`CHECKABLE_HOST` and `isStillOpen` **agree about which hosts have a real strategy** (a host in
the first without one in the second would be counted as covered and silently HEAD-checked —
exactly wrong for Workday), that the budget covers the board daily, and that every closed row
carries `date_closed`.

### e) Standing hazards

- ⚠️ **GitHub disables scheduled workflows after 60 days of repository inactivity.** Both
  `update.yml` and `verify-listings.yml` are cron-driven. If listings ever go stale for no
  visible reason, check whether the schedules were disabled before debugging anything else.
- ⚠️ **Never let an ambiguous response mark a listing closed.** A timeout, a 5xx, a 403, a 422
  from a wrong Workday tenant, or an unexpected JSON shape must all return `null`. §15a's
  reasoning, restated because the new per-host checkers each had to re-implement it: dropping
  a live posting costs somebody a job, leaving a dead one up costs a wasted click.
- The `checkable` figure in `meta.json` is the number to watch. If it falls, a host stopped
  reporting closure honestly and coverage is quietly rotting.
