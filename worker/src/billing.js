/* OfferAIO billing — Stripe license keys, validated server-side.
 *
 * Design notes live in PROJECT.md §10. The four that shape this file:
 *   1. `past_due` stays ACTIVE. Stripe retries a declined card for ~2-3 weeks; killing
 *      Pro on the first transient decline downgrades customers who are still going to pay.
 *   2. Status is not purely webhook-driven. Every record carries `periodEnd`, and
 *      `isActive` expires on time — one dropped `subscription.deleted` must not mean
 *      Pro forever.
 *   3. Webhook handlers are order-independent. Stripe does not guarantee delivery order,
 *      so every handler upserts by customer id rather than assuming checkout arrived first.
 *   4. Keys bind to a few install ids to blunt casual sharing.
 *
 * No Stripe SDK: its `constructEvent` uses sync crypto and does not run on Workers, and
 * everything needed here is already in the event payloads — so Phase 1 needs no
 * STRIPE_SECRET_KEY, only STRIPE_WEBHOOK_SECRET.
 */

export const PLAN_QUOTA = { free: 50, pro: 250 };

// Statuses Stripe reports that should still grant Pro. `past_due` is deliberate — see (1).
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

const DAY = 86400 * 1000;
// Slack after periodEnd before access drops, so clock skew and a late renewal webhook
// don't lock out a paying customer.
const GRACE_MS = 3 * DAY;
// `past_due` means Stripe is still retrying. Hold access across the dunning window
// rather than cutting off mid-retry.
const DUNNING_GRACE_MS = 21 * DAY;
// Provisional periodEnd at checkout, replaced by the real value when `invoice.paid`
// or a subscription event lands. Generous on purpose: erring long costs one month,
// erring short locks out someone who just paid.
const PROVISIONAL_PERIOD_MS = 35 * DAY;

const EVENT_TTL_S = 3 * 86400; // idempotency markers; Stripe retries for ~3 days
const SESSION_TTL_S = 30 * 86400; // success page lookup window

const MAX_INSTALLS = 3;

/* ---------------------------------------------------------------- key format */

// Crockford base32: no I, L, O, U. 32 symbols divides 256 evenly, so rejection-free
// sampling from random bytes stays unbiased.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let out = "";
  for (let i = 0; i < 12; i++) {
    if (i && i % 4 === 0) out += "-";
    out += ALPHABET[bytes[i] % 32];
  }
  return "OA-" + out; // 60 bits of entropy — not brute-forceable
}

/** Uppercase, drop separators, and fold the characters Crockford treats as aliases. */
export function normalizeKey(raw) {
  if (typeof raw !== "string") return null;
  let s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.startsWith("OA")) s = s.slice(2);
  s = s.replace(/[IL]/g, "1").replace(/O/g, "0");
  if (s.length !== 12) return null;
  for (const c of s) if (!ALPHABET.includes(c)) return null;
  return "OA-" + s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8, 12);
}

/* ------------------------------------------------------------ signature check */

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verify a Stripe webhook signature.
 *
 * `rawBody` must be the exact bytes Stripe sent — re-serialising parsed JSON changes
 * key order and whitespace and the HMAC will not match.
 */
export async function verifyStripeSignature(rawBody, header, secret, nowMs = Date.now(), toleranceS = 300) {
  if (!header || !secret) return false;

  let timestamp = null;
  const provided = [];
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === "t") timestamp = v;
    else if (k === "v1") provided.push(v);
  }
  if (!timestamp || !provided.length) return false;

  // Reject replays of an old capture.
  const ageS = Math.abs(nowMs / 1000 - Number(timestamp));
  if (!Number.isFinite(ageS) || ageS > toleranceS) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const expected = toHex(sig);

  // Compare against every v1 present — Stripe sends several while a secret is rotating.
  let ok = false;
  for (const p of provided) if (timingSafeEqual(p, expected)) ok = true;
  return ok;
}

/* ---------------------------------------------------------------- KV records */

const keyRec = (k) => `key:${k}`;
const custRec = (c) => `cust:${c}`;
const sessRec = (s) => `sess:${s}`;
const evtRec = (e) => `evt:${e}`;

async function readKey(env, key) {
  const raw = await env.LICENSES.get(keyRec(key));
  return raw ? JSON.parse(raw) : null;
}

async function writeKey(env, key, rec) {
  await env.LICENSES.put(keyRec(key), JSON.stringify(rec));
}

/**
 * Find the license for a Stripe customer, creating one if this is the first event we've
 * seen for them.
 *
 * The `cust:` reverse index is what makes cancellation possible at all: subscription
 * lifecycle events carry a customer id and never the license key. Creating on demand
 * here is what makes handlers order-independent — whichever event arrives first mints
 * the key, and the rest patch it.
 */
async function ensureLicense(env, customerId, nowMs) {
  const existingKey = await env.LICENSES.get(custRec(customerId));
  if (existingKey) {
    const rec = await readKey(env, existingKey);
    if (rec) return { key: existingKey, rec };
  }

  const key = generateKey();
  const rec = {
    email: null,
    status: "active",
    plan: "pro",
    periodEnd: nowMs + PROVISIONAL_PERIOD_MS,
    // Marks the value above as a guess, so the first authoritative value from Stripe
    // replaces it even if it happens to be earlier.
    periodProvisional: true,
    customerId,
    subscriptionId: null,
    installs: [],
    createdAt: nowMs,
  };
  await writeKey(env, key, rec);
  await env.LICENSES.put(custRec(customerId), key);
  return { key, rec };
}

/** Seconds or milliseconds from Stripe, normalised to ms. */
function toMs(epoch) {
  if (typeof epoch !== "number" || !Number.isFinite(epoch)) return null;
  return epoch > 1e11 ? epoch : epoch * 1000;
}

/**
 * Stripe moved `current_period_end` onto subscription items in 2025 API versions but
 * still sends it at the top level on older ones. Read whichever is present so this
 * doesn't silently start returning null after an API version bump.
 */
function subscriptionPeriodEnd(sub) {
  return toMs(sub?.current_period_end) ?? toMs(sub?.items?.data?.[0]?.current_period_end);
}

/**
 * Adopt a period end from Stripe.
 *
 * Two rules that interact: a real value must always replace the provisional guess made
 * at checkout (which is deliberately long, so "newer wins" alone would keep the guess
 * and over-grant), but once a real value is in place, a late-arriving older event must
 * never shorten the licence.
 */
function applyPeriodEnd(rec, periodEnd) {
  if (!periodEnd) return;
  if (rec.periodProvisional || periodEnd > (rec.periodEnd ?? 0)) {
    rec.periodEnd = periodEnd;
    rec.periodProvisional = false;
  }
}

/* ------------------------------------------------------------- active window */

export function isActive(rec, nowMs = Date.now()) {
  if (!rec || !ACTIVE_STATUSES.has(rec.status)) return false;
  const grace = rec.status === "past_due" ? DUNNING_GRACE_MS : GRACE_MS;
  if (typeof rec.periodEnd !== "number") return false;
  return nowMs < rec.periodEnd + grace;
}

/* ------------------------------------------------------------------ webhook */

/**
 * Handle one Stripe event. Returns a short string describing what happened, which the
 * tests assert on and the Worker logs.
 */
export async function processEvent(env, event, nowMs = Date.now()) {
  const type = event?.type;
  const obj = event?.data?.object;
  if (!type || !obj) return "ignored:malformed";

  switch (type) {
    case "checkout.session.completed": {
      const customerId = typeof obj.customer === "string" ? obj.customer : obj.customer?.id;
      if (!customerId) return "ignored:no-customer";

      const { key, rec } = await ensureLicense(env, customerId, nowMs);
      rec.email = obj.customer_details?.email || obj.customer_email || rec.email;
      rec.subscriptionId =
        (typeof obj.subscription === "string" ? obj.subscription : obj.subscription?.id) ||
        rec.subscriptionId;
      // Don't resurrect a cancelled licence just because an old checkout event is replayed.
      if (rec.status !== "canceled") rec.status = "active";
      await writeKey(env, key, rec);

      // Lets the success page show the key without a Stripe API call.
      if (obj.id) await env.LICENSES.put(sessRec(obj.id), key, { expirationTtl: SESSION_TTL_S });
      return `provisioned:${key}`;
    }

    case "invoice.paid":
    case "invoice_payment.paid": {
      const customerId = typeof obj.customer === "string" ? obj.customer : obj.customer?.id;
      if (!customerId) return "ignored:no-customer";

      const { key, rec } = await ensureLicense(env, customerId, nowMs);
      applyPeriodEnd(rec, toMs(obj.lines?.data?.[0]?.period?.end) ?? toMs(obj.period_end));
      if (rec.status === "past_due") rec.status = "active"; // they paid; dunning is over
      rec.email = obj.customer_email || rec.email;
      await writeKey(env, key, rec);
      return `renewed:${key}`;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const customerId = typeof obj.customer === "string" ? obj.customer : obj.customer?.id;
      if (!customerId) return "ignored:no-customer";

      const { key, rec } = await ensureLicense(env, customerId, nowMs);
      rec.subscriptionId = obj.id || rec.subscriptionId;
      if (typeof obj.status === "string") rec.status = obj.status;
      applyPeriodEnd(rec, subscriptionPeriodEnd(obj));
      // `cancel_at_period_end` is NOT a cancellation — access runs to periodEnd, and
      // `customer.subscription.deleted` arrives when it actually lapses.
      await writeKey(env, key, rec);
      return `updated:${key}:${rec.status}`;
    }

    case "customer.subscription.deleted": {
      const customerId = typeof obj.customer === "string" ? obj.customer : obj.customer?.id;
      if (!customerId) return "ignored:no-customer";

      const key = await env.LICENSES.get(custRec(customerId));
      if (!key) return "ignored:unknown-customer";
      const rec = await readKey(env, key);
      if (!rec) return "ignored:unknown-key";
      rec.status = "canceled";
      rec.canceledAt = nowMs;
      await writeKey(env, key, rec);
      return `canceled:${key}`;
    }

    case "invoice.payment_failed":
      // Deliberately a no-op. Stripe's dunning retries for weeks and will send
      // `customer.subscription.updated` (past_due) and eventually `.deleted` if it
      // never succeeds. Acting here would cut off customers mid-retry — see (1).
      return "noop:payment_failed";

    default:
      return `ignored:${type}`;
  }
}

/** Full webhook request handler: verify, dedupe, process. */
export async function handleWebhook(request, env, nowMs = Date.now()) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return new Response("webhook secret not configured", { status: 500 });
  }
  if (!env.LICENSES) {
    return new Response("LICENSES KV not bound", { status: 500 });
  }

  // Raw bytes, before any parse — re-serialising would break the HMAC.
  const rawBody = await request.text();
  const sigHeader = request.headers.get("stripe-signature");

  const ok = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET, nowMs);
  if (!ok) return new Response("invalid signature", { status: 400 });

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  // Stripe retries on non-2xx and can deliver the same event more than once.
  if (event.id) {
    const seen = await env.LICENSES.get(evtRec(event.id));
    if (seen) return new Response(JSON.stringify({ ok: true, dedup: true }), { status: 200 });
  }

  let result;
  try {
    result = await processEvent(env, event, nowMs);
  } catch (e) {
    // 500 so Stripe retries rather than dropping a real payment event.
    return new Response(`handler error: ${e.message}`, { status: 500 });
  }

  // Marked only after success, so a failed attempt is retried rather than swallowed.
  if (event.id) await env.LICENSES.put(evtRec(event.id), "1", { expirationTtl: EVENT_TTL_S });

  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/* ------------------------------------------------------------------- verify */

function planResponse(rec, active, extra = {}) {
  return {
    ok: true,
    active,
    plan: active ? "pro" : "free",
    quota: active ? PLAN_QUOTA.pro : PLAN_QUOTA.free,
    status: rec?.status ?? "unknown",
    periodEnd: rec?.periodEnd ?? null,
    ...extra,
  };
}

/**
 * Check a key. Returns 200 with `active:false` for bad keys rather than an error status,
 * so the extension has one code path: trust `active`, fall back to Free.
 */
export async function verifyLicense(env, { key: rawKey, installId }, nowMs = Date.now()) {
  const key = normalizeKey(rawKey);
  if (!key) return { ok: true, active: false, plan: "free", quota: PLAN_QUOTA.free, reason: "malformed" };

  const rec = await readKey(env, key);
  if (!rec) return { ok: true, active: false, plan: "free", quota: PLAN_QUOTA.free, reason: "unknown" };

  const active = isActive(rec, nowMs);
  if (!active) return planResponse(rec, false, { reason: rec.status === "canceled" ? "canceled" : "expired" });

  if (installId) {
    const installs = rec.installs || [];
    if (!installs.includes(installId)) {
      if (installs.length >= MAX_INSTALLS) {
        return planResponse(rec, false, { reason: "device_limit", maxInstalls: MAX_INSTALLS });
      }
      // Adopt silently when there's room, so a reinstall doesn't demand re-activation.
      installs.push(installId);
      rec.installs = installs;
      await writeKey(env, key, rec);
    }
  }

  return planResponse(rec, true, { key, installs: (rec.installs || []).length, maxInstalls: MAX_INSTALLS });
}

/** Explicit activation — same checks, but reports the device limit instead of adopting. */
export async function activateLicense(env, { key: rawKey, installId }, nowMs = Date.now()) {
  const key = normalizeKey(rawKey);
  if (!key) return { ok: false, active: false, reason: "malformed" };
  if (!installId) return { ok: false, active: false, reason: "install_id_required" };

  const rec = await readKey(env, key);
  if (!rec) return { ok: false, active: false, reason: "unknown" };

  if (!isActive(rec, nowMs)) {
    return planResponse(rec, false, { reason: rec.status === "canceled" ? "canceled" : "expired" });
  }

  const installs = rec.installs || [];
  if (!installs.includes(installId)) {
    if (installs.length >= MAX_INSTALLS) {
      return planResponse(rec, false, { reason: "device_limit", maxInstalls: MAX_INSTALLS });
    }
    installs.push(installId);
    rec.installs = installs;
    await writeKey(env, key, rec);
  }

  return planResponse(rec, true, { key, installs: installs.length, maxInstalls: MAX_INSTALLS });
}

/**
 * Success-page lookup. The session id is the capability: it's only in the redirect URL
 * and on the customer's Stripe receipt. Deliberately does not accept an email, which
 * would let anyone enumerate keys by guessing addresses.
 */
export async function licenseBySession(env, sessionId) {
  if (!sessionId || typeof sessionId !== "string" || !sessionId.startsWith("cs_")) {
    return { ok: false, reason: "malformed" };
  }
  const key = await env.LICENSES.get(sessRec(sessionId));
  if (!key) return { ok: false, reason: "not_found" };
  const rec = await readKey(env, key);
  return { ok: true, key, email: rec?.email ?? null };
}
