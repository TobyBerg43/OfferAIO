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
 * Latest period end on an invoice.
 *
 * Not `lines.data[0]` — the first line can be a proration or credit covering an
 * *earlier* window, and because a provisional period accepts any authoritative value
 * (even an earlier one), that would expire a customer who just paid.
 */
function invoicePeriodEnd(inv) {
  const ends = (inv?.lines?.data || []).map((l) => toMs(l?.period?.end)).filter(Boolean);
  if (ends.length) return Math.max(...ends);
  return toMs(inv?.period_end);
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

/**
 * Should a subscription-scoped event be applied to this licence?
 *
 * A Stripe customer can own more than one subscription over time — cancel-then-
 * resubscribe is the common case, and the old subscription keeps emitting events
 * (`updated` as it winds down, `deleted` when its period finally lapses) *after* the
 * new one is live. Applying those to the licence would cancel a paying customer, and
 * because `invoice.paid` only rescues `past_due`, the record would never recover.
 *
 * So: accept events for the subscription we track, accept anything when we track none
 * yet, and otherwise accept only a genuine repurchase — an active subscription arriving
 * while the licence sits cancelled.
 */
function appliesToCurrentSubscription(rec, incomingId, incomingStatus) {
  if (!incomingId || !rec.subscriptionId) return true;
  if (incomingId === rec.subscriptionId) {
    // A late event for a subscription we already know is dead must not revive it.
    return rec.status !== "canceled" || !ACTIVE_STATUSES.has(incomingStatus);
  }
  return rec.status === "canceled" && ACTIVE_STATUSES.has(incomingStatus);
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

      // Delayed-notification methods (ACH, SEPA, Klarna…) complete the session while
      // payment is still pending. Provisioning here would hand out 35 days of Pro for
      // money that may never arrive; the subscription events will activate it if it does.
      if (obj.payment_status === "unpaid") return "ignored:unpaid";

      const { key, rec } = await ensureLicense(env, customerId, nowMs);
      rec.email = obj.customer_details?.email || obj.customer_email || rec.email;
      const incomingSub =
        (typeof obj.subscription === "string" ? obj.subscription : obj.subscription?.id) || null;

      // A cancelled licence must not be resurrected by a replayed checkout event — but a
      // customer who cancels and later buys again is a different case, and Stripe reuses
      // the customer id, so `cust:` still points at their old cancelled record. Tell them
      // apart by subscription id: a new one means a genuine re-subscribe, the same one
      // means a replay.
      const reSubscribed = rec.status === "canceled" && incomingSub && incomingSub !== rec.subscriptionId;
      if (rec.status !== "canceled" || reSubscribed) rec.status = "active";
      if (reSubscribed) {
        delete rec.canceledAt;
        // The old period is stale; fall back to a guess until this subscription's
        // invoice or subscription event lands.
        rec.periodEnd = nowMs + PROVISIONAL_PERIOD_MS;
        rec.periodProvisional = true;
      }

      if (incomingSub) rec.subscriptionId = incomingSub;
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
      applyPeriodEnd(rec, invoicePeriodEnd(obj));
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

      if (!appliesToCurrentSubscription(rec, obj.id, obj.status)) {
        return `ignored:other-subscription:${obj.id}`;
      }

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

      // Only the subscription the licence currently tracks can cancel it. A customer
      // who cancelled sub_A and re-subscribed as sub_B still gets sub_A's deleted event
      // when the old period lapses; acting on it would cut off someone who is paying.
      if (obj.id && rec.subscriptionId && obj.id !== rec.subscriptionId) {
        return `ignored:other-subscription:${obj.id}`;
      }

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

/* ------------------------------------------------- server-side AI metering */

// Cover letters and ranking cost real Anthropic/OpenAI money, so unlike the submission
// counter (which lives in chrome.storage.local and is trivially resettable) this one is
// authoritative. It's the only enforcement in the system that actually protects spend.
const AI_MONTHLY_LIMIT = PLAN_QUOTA.pro;

const usageRec = (key, month) => `use:${key}:${month}`;
const USAGE_TTL_S = 70 * 86400; // outlives the month it counts, then evaporates

function monthKey(nowMs) {
  const d = new Date(nowMs);
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}

/**
 * Gate an AI endpoint on a valid licence and a monthly cap.
 *
 * Note the counter is read-modify-write against KV, which is not atomic — two
 * simultaneous requests can both read the same value and one increment is lost. That
 * costs at most a few extra generations at the boundary, which is far cheaper than the
 * machinery to make it exact.
 */
export async function checkAI(env, { key, installId }, nowMs = Date.now()) {
  // Required here even though verifyLicense treats it as optional: without it the
  // 3-device binding is never consulted, and a shared key would be bounded only by the
  // monthly cap.
  if (!installId) return { allowed: false, status: 400, reason: "install_id_required" };

  const verdict = await verifyLicense(env, { key, installId }, nowMs);
  if (!verdict.active) {
    return { allowed: false, status: 402, reason: verdict.reason || "inactive" };
  }

  const rec = usageRec(normalizeKey(key), monthKey(nowMs));
  const used = Number((await env.LICENSES.get(rec)) || 0);

  if (used >= AI_MONTHLY_LIMIT) {
    return { allowed: false, status: 429, reason: "monthly_limit", used, limit: AI_MONTHLY_LIMIT };
  }

  return { allowed: true, meterRec: rec, used, limit: AI_MONTHLY_LIMIT };
}

/**
 * Count a generation that actually happened.
 *
 * Deliberately called *after* the LLM responds: charging on entry means an Anthropic
 * outage silently eats a customer's monthly allowance. The cap is still enforced up
 * front by checkAI, so the exposure from counting late is bounded by concurrency, not
 * by failures.
 */
export async function recordAI(env, gate) {
  if (!gate || !gate.meterRec) return gate;
  const used = gate.used + 1;
  await env.LICENSES.put(gate.meterRec, String(used), { expirationTtl: USAGE_TTL_S });
  return { ...gate, used };
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
