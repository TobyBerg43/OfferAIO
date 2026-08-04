# OfferAIO — Project Handoff / Context

Single source of truth for the OfferAIO project. Any assistant or person should be
able to read this file and pick up the work without re-discovering anything.
**Last updated: 2026-08-04.** (Latest changes: the dashboard now actually calls the
Worker's `/cover` — the last piece of §14 that was still unfinished — via a new licence
relay in `extension/bridge.js`; extension bumped to **1.1.1**; privacy policy and store
listing brought in line with licensing, the Worker host permission and the OpenAI/Stripe
data transfers, which would have failed Web Store review as written. Between 2026-07-22
and 2026-08-04 nothing else changed: all 52 intervening commits were the 6-hourly
`chore: refresh listings` scrape.)

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
- `OfferAIO.html` — the interactive dashboard app
- `extension/` — the Chrome extension (see §7)
- `internships/`, `data/` — programmatic SEO pages + listings, regenerated every 6h
- `pricing/`, `employers/`, `404.html`, `robots`, `sitemap`
- `store/` — Chrome Web Store listing copy + screenshots (see §8)
- `desktop/` — Electron local engine
- `worker/` — Cloudflare Worker source (`src/index.js`, `wrangler.toml`) — see §14
- `tests/` — Node tests for extension files (`license.test.mjs`, `bridge.test.mjs`).
  Deliberately outside `extension/`, which `zip-extension.yml` ships wholesale to the store.
- `.github/workflows/` — scrape + generate-pages pipeline, patch action, worker deploy
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
Manifest V3. Name "OfferAIO — Auto Apply", **v1.1.1** (1.0.0 → 1.1.0 for licensing,
→ 1.1.1 for the bridge licence relay below).

Files: `manifest.json`, `popup.html`, `popup.js`, `content.js`, `bridge.js`,
`license.js`, `icons/icon16|48|128.png`.

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
`content_scripts.js` and the `executeScript` call in `popup.js` — if either loses it,
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
- **Remaining:** upload store icon + screenshots, complete the Privacy tab, submit for review.
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
code is done: 81 tests pass (`tests/license.test.mjs`, `tests/bridge.test.mjs`,
`worker/test/billing.test.mjs`), the Worker is deployed and gating correctly, and the
dashboard is wired to it. Nothing ships value until the four keys in §11 exist.

0. **The four keys (§11).** In the order that unlocks the most:
   - `OPENAI_API_KEY` → `npx wrangler secret put OPENAI_API_KEY` from `worker/`. Makes AI
     cover letters actually work. Safe to set now — the endpoints are gated (§14).
   - ~~Stripe Pro product + Payment Link~~ — **done 2026-08-04**, see §10.
   - ~~`STRIPE_WEBHOOK_SECRET`~~ — **done 2026-08-04.**
   - `CLOUDFLARE_API_TOKEN` → GitHub Actions secret. Until set, every push touching
     `worker/**` fails the Deploy Worker job and deploys stay local-only.
1. **Chrome Web Store:** the only remaining work is in the Developer Dashboard itself —
   upload the three screenshots from `store/`, complete the Privacy tab, and hit Submit.
   Everything feeding that is prepared and current as of 2026-08-04: listing copy,
   permission justifications, screenshots (all three regenerated from the real UI), and
   the packaged zip (v1.1.1, rebuilt automatically on every `extension/` change).
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
