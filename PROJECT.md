# OfferAIO — Project Handoff / Context

Single source of truth for the OfferAIO project. Any assistant or person should be
able to read this file and pick up the work without re-discovering anything.
**Last updated: 2026-07-19.** (Latest change: Stripe licensing Phase 0 — Worker source
moved into the repo, §14 added, §10 rewritten with the settled design.)

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
  Needs secret `ANTHROPIC_API_KEY` — **still unset** (see TODOs). Source lives in
  `worker/` and deploys from `main`; see §14.
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
- `license.html` — post-checkout page showing the Pro key (noindex); polls the Worker
- `billing.js` — the single place the Stripe Payment Link lives; wires `[data-buy-pro]`
- `OfferAIO.html` — the interactive dashboard app
- `extension/` — the Chrome extension (see §7)
- `internships/`, `data/` — programmatic SEO pages + listings, regenerated every 6h
- `pricing/`, `employers/`, `404.html`, `robots`, `sitemap`
- `store/` — Chrome Web Store listing copy + screenshots (see §8)
- `desktop/` — Electron local engine
- `worker/` — Cloudflare Worker source (`src/index.js`, `wrangler.toml`) — see §14
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

## 10. Stripe licensing (design settled 2026-07-19; Phase 0 done, 1–4 pending)
Chrome Web Store payments were discontinued, so the approach is license keys validated
server-side. **Not** offline-signed keys — those can't be revoked when someone cancels.

**Phases.** 0: Worker source into the repo + KV namespace (**done**, §14). 1: Worker
endpoints (**done** — `worker/src/billing.js`, 40 tests, contract in `worker/README.md`;
not deployed yet). 2: site success page + Payment Link buttons (**done** —
`license.html`, `billing.js`). 3: extension quota + license UI. 4: gate `/cover` behind
a key.

**To go live, paste the Payment Link into `billing.js`.** That's the only edit needed —
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
`/cover` costs actual Anthropic money, so metering it per key server-side is the lever
that matters.

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
4. **Stripe licensing** (§10) — Phase 0 done. Phase 1 is blocked on you creating the Pro
   product + Payment Link in Stripe and setting `STRIPE_SECRET_KEY` /
   `STRIPE_WEBHOOK_SECRET` as Worker secrets.
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

## 14. The Cloudflare Worker (`worker/`)
Live at `https://offeraio-worker.tobybergerbusiness.workers.dev`. Routes: `/health`,
`/cover`, `/rank`.

Until 2026-07-19 this Worker existed **only as a deployed script** — no copy in the repo,
so changes were unreviewable and one dashboard edit from being lost. `worker/src/index.js`
was vendored from the live deployment, verified byte-for-byte (md5
`46320584d9efd35f821709df1aec264d`). **Edit it here, not in the Cloudflare dashboard.**

- Deploy: push to `main` touching `worker/**` → `.github/workflows/deploy-worker.yml`.
  Needs repo secret `CLOUDFLARE_API_TOKEN`. Manually: `npx wrangler deploy` from `worker/`.
- Worker secrets are stored in Cloudflare, survive deploys, and are never in the repo.
- KV `LICENSES` → `offeraio-licenses` (`40fb8a5ef93143fc9d0ad49592a7dc64`), bound but
  unused until §10 Phase 1.
- ⚠️ The site does **not** call this Worker. The dashboard's cover-letter button hits the
  local Electron engine on `127.0.0.1:7717`, not `/cover`. Wiring it up is unfinished work.
- ⚠️ `/cover` and `/rank` are unauthenticated with `Access-Control-Allow-Origin: *`. Gate
  them (§10 Phase 4) before setting `ANTHROPIC_API_KEY`, or the key can be drained by
  anyone who finds the hostname.
- ⚠️ First `wrangler deploy` caveat: the Cloudflare API doesn't expose the live binding
  list, so `wrangler.toml` was reconstructed from what the code reads. Check the
  dashboard's Settings → Bindings first; any dashboard-added binding not referenced in
  code would be dropped.
