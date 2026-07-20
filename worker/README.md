# offeraio-worker

The Cloudflare Worker behind OfferAIO. Live at
`https://offeraio-worker.tobybergerbusiness.workers.dev`.

Until 2026-07-19 this Worker existed **only as a deployed script** — there was no copy
in the repo. `src/index.js` was vendored from the live deployment (verified
byte-for-byte, md5 `46320584d9efd35f821709df1aec264d`) so that changes are reviewable
and can't be silently lost. Edit it here, not in the Cloudflare dashboard.

## Endpoints

| Route     | Method | Purpose                                    |
| --------- | ------ | ------------------------------------------ |
| `/health` | GET    | Liveness probe                             |
| `/cover`  | POST   | Cover-letter generation (Anthropic)        |
| `/rank`   | POST   | Resume↔listing ranking (OpenAI embeddings) |

> `/cover` and `/rank` are currently **unauthenticated and CORS-open to `*`**. Once
> `ANTHROPIC_API_KEY` is set, anyone who finds this hostname can spend the key.
> Gating these behind a license is Phase 4 of the billing work.

## Deploy

Pushing to `main` with changes under `worker/` runs `.github/workflows/deploy-worker.yml`.
Manually: `npx wrangler deploy` from this directory.

Validate without deploying: `npx wrangler deploy --dry-run`.

## Secrets

Set in Cloudflare, never in this repo. They are stored separately from the script and
**survive `wrangler deploy`**.

```
wrangler secret put ANTHROPIC_API_KEY      # cover letters
wrangler secret put OPENAI_API_KEY         # optional, needed by /rank
wrangler secret put STRIPE_SECRET_KEY      # Phase 1
wrangler secret put STRIPE_WEBHOOK_SECRET  # Phase 1
```

GitHub needs one repo secret, `CLOUDFLARE_API_TOKEN` ("Edit Cloudflare Workers" template).

## KV

`LICENSES` → namespace `40fb8a5ef93143fc9d0ad49592a7dc64` (`offeraio-licenses`).
Bound but unused until Phase 1. Key layout is documented in `wrangler.toml`.

## Caveat on the first deploy

The Cloudflare API doesn't expose the live Worker's binding list, so `wrangler.toml`
was reconstructed from what the source actually reads (`ANTHROPIC_API_KEY`,
`OPENAI_API_KEY` — both secrets) plus the new KV binding. If any binding was added
through the dashboard and isn't referenced in the code, the first `wrangler deploy`
will drop it. Check the dashboard's Settings → Bindings before the first deploy, and
confirm `/health` and a real `/cover` call afterwards.
