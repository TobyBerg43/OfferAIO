# OfferAIO

Auto-apply to Summer 2027 internships **in your own browser**. A Chrome extension fills
applications across the major applicant tracking systems; a companion web dashboard queues
postings and tracks what was actually sent.

**Live:** [offeraio.com](https://offeraio.com) · **Dashboard:** [/dashboard/](https://offeraio.com/dashboard/) · **Setup:** [/start.html](https://offeraio.com/start.html)

---

## Read this first

**[`PROJECT.md`](PROJECT.md) is the single source of truth.** It is a full handoff
document — architecture, deploy process, accounts, billing design, open TODOs, and the
reasoning behind decisions that look odd from the outside. This README is just the map.

If you read only two sections of it, read **§2** (why the dashboard does not apply to
anything) and **§15** (why EU-hosted job listings must not be filtered out).

**Setting up on a new machine?** **§26** — it is a clone, two `git config` lines and
`gh auth login`; there is no `npm install`, because there are no dependencies. It also lists
the three credentials that live outside the repo, and the 60-day scheduled-workflow trap that
silently stops the listings pipeline if the repo goes quiet.

## The one rule

**The extension applies. The dashboard queues and tracks. Nothing else may claim an
application happened.**

Until August 2026 the dashboard walked tasks through `monitoring → filling → submitted` on
random timers and rolled dice to invent replies and interviews. It printed "✓ Submitted"
beside real companies pulled from the live database, for applications that were never sent —
including one against a job that had already closed. Every number a user sees is now derived
from records `extension/content.js` writes after a submit it could actually evidence.

If you are changing task status, stats, or anything in the apply path, that is the
invariant you must not break.

## Repo map

| Path | What it is |
| --- | --- |
| `extension/` | **the actual product.** Manifest V3 Chrome extension |
| `OfferAIO.html` | the dashboard (canonical; `dashboard/index.html` is generated from it) |
| `landing.html`, `start.html`, `pricing/`, `employers/` | marketing site + onboarding |
| `scrape.js` | the 6-hourly listings pipeline → `data/listings.json` |
| `generate_pages.js` | programmatic SEO pages → `internships/`, `sitemap.xml` |
| `worker/` | Cloudflare Worker — licence verification, AI cover letters |
| `store/` | Chrome Web Store listing copy + screenshot generators |
| `tests/` | extension + pipeline tests (deliberately outside `extension/`) |
| `desktop/` | optional Electron local engine |

### Inside `extension/`

| File | Role |
| --- | --- |
| `content.js` | fills forms, records what it actually submitted |
| `bridge.js` | relays profile / licence / usage / applications to offeraio.com |
| `license.js` | licensing + monthly quota, shared by popup and content script |
| `popup.js` | the toolbar popup; context-aware Fill button |
| `ats.js` | the one list of supported applicant tracking systems |

## Running things

```bash
node --test tests/*.test.mjs        # extension + pipeline  (74 tests)
node --test worker/test/*.test.mjs  # worker billing        (51 tests)

node scrape.js                      # rebuild data/listings.json (hits the network)
node generate_pages.js              # rebuild SEO pages + dashboard/index.html
node store/regenerate.mjs           # rebuild icons, favicons, store screenshots
```

**Load the extension:** `chrome://extensions` → Developer mode → **Load unpacked** →
`extension/`. Press the reload arrow after any change; manifest edits need it.

**Test without emailing a real employer:** a local mock application form lives on the
[`dev-harness`](../../tree/dev-harness) branch — `git checkout dev-harness`, then see
`dev/README.md`. **Do not merge that branch:** it carries deliberate local-only host
permissions that must never reach the Chrome Web Store.

## Editing the big HTML files

`OfferAIO.html` and `landing.html` are edited with **exact-match patch scripts** that fail
loudly on a missing target, never by retyping the file. Write those scripts *outside* the
repo and let them die with the change: a committed patch script becomes a landmine the
moment it succeeds, which is why `patch_dashboard.js` was deleted.

`dashboard/index.html` is generated. Edit `OfferAIO.html` and re-run `generate_pages.js`.

## Deploying

Push to `main` → GitHub Pages rebuilds (~1 min) → live. That is the whole deploy, so
**merging to `main` is shipping.** See `PROJECT.md` §4 for the Cloudflare cache rules
(HTML is uncached; `.js`/`.css` are not).

⚠️ Deploy from `worker/` when touching the Worker — a mis-pathed `wrangler deploy` from the
repo root once auto-created a static worker serving the whole repo.

ℹ️ Actions can lag well behind a push — the 2026-08-06 merge queued its runs **24 minutes**
later, so "no runs yet" a minute after merging means nothing. And if you query the API,
`head_sha` needs the **full** 40-character SHA: an abbreviated one returns zero runs
instead of an error, which looks exactly like CI never firing.

## Status

The product works end to end, but **nothing ships value until four API keys exist** — see
`PROJECT.md` §11 and §12. Cover letters are templated stubs until `OPENAI_API_KEY` is set.
The Chrome Web Store item is a **draft that has never been submitted**.

Known gap: the extension has been tested against the mock form and a full automated suite,
but has **never filled a real employer's form end to end**.

## Conventions

- Verify the live site after every deploy.
- After extension edits, re-check the raw file on `main` — source has been silently
  reverted once by a parallel session re-uploading old files.
- **Never** commit secrets. Keys live in Cloudflare Worker secrets or GitHub Actions secrets.
- Keep `PROJECT.md` updated when the project changes.
