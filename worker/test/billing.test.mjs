/* Tests for the billing module. Run: node --test worker/test/
 *
 * These run on plain Node — billing.js deliberately uses only Web-standard APIs
 * (crypto.subtle, Response, TextEncoder) that Workers and Node both provide, so no
 * miniflare or wrangler runtime is needed.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  generateKey,
  normalizeKey,
  verifyStripeSignature,
  processEvent,
  handleWebhook,
  verifyLicense,
  activateLicense,
  licenseBySession,
  isActive,
  PLAN_QUOTA,
} from "../src/billing.js";

const DAY = 86400 * 1000;
const SECRET = "whsec_test_secret_do_not_use";
const NOW = 1_760_000_000_000; // fixed clock so period arithmetic is deterministic

/* In-memory stand-in for the KV binding. Honours expirationTtl so TTL bugs surface. */
function fakeKV() {
  const store = new Map();
  return {
    store,
    async get(k) {
      const e = store.get(k);
      if (!e) return null;
      if (e.expiresAt && Date.now() > e.expiresAt) {
        store.delete(k);
        return null;
      }
      return e.value;
    },
    async put(k, value, opts = {}) {
      store.set(k, {
        value,
        expiresAt: opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null,
      });
    },
    async delete(k) {
      store.delete(k);
    },
  };
}

const makeEnv = () => ({ LICENSES: fakeKV(), STRIPE_WEBHOOK_SECRET: SECRET });

/* Sign exactly the way Stripe does, so we're testing our verifier against the real scheme. */
async function stripeSign(body, secret = SECRET, tsMs = NOW) {
  const t = Math.floor(tsMs / 1000);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${t},v1=${hex}`;
}

function webhookRequest(body, sigHeader) {
  return new Request("https://w.dev/stripe/webhook", {
    method: "POST",
    body,
    headers: sigHeader ? { "stripe-signature": sigHeader } : {},
  });
}

/* Event fixtures, trimmed to the fields the handlers read. */
const CUST = "cus_TEST123";

const checkoutEvent = (over = {}) => ({
  id: "evt_checkout_1",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_test_abc123",
      customer: CUST,
      subscription: "sub_TEST1",
      customer_details: { email: "student@example.edu" },
      ...over,
    },
  },
});

const invoicePaidEvent = (periodEndMs, id = "evt_invoice_1") => ({
  id,
  type: "invoice.paid",
  data: {
    object: {
      customer: CUST,
      customer_email: "student@example.edu",
      lines: { data: [{ period: { end: Math.floor(periodEndMs / 1000) } }] },
    },
  },
});

const subEvent = (status, periodEndMs, id = "evt_sub_1", type = "customer.subscription.updated") => ({
  id,
  type,
  data: {
    object: {
      id: "sub_TEST1",
      customer: CUST,
      status,
      current_period_end: Math.floor(periodEndMs / 1000),
    },
  },
});

/* ------------------------------------------------------------------ key format */

test("generated keys match the documented OA-XXXX-XXXX-XXXX shape", () => {
  for (let i = 0; i < 200; i++) {
    assert.match(generateKey(), /^OA-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  }
});

test("generated keys survive a normalize round-trip", () => {
  for (let i = 0; i < 100; i++) {
    const k = generateKey();
    assert.equal(normalizeKey(k), k);
  }
});

test("normalizeKey folds Crockford aliases and tolerates user formatting", () => {
  const k = generateKey();
  assert.equal(normalizeKey(k.toLowerCase()), k);
  assert.equal(normalizeKey(k.replace(/-/g, "")), k);
  assert.equal(normalizeKey("  " + k + "  "), k);
  // I/L read as 1, O reads as 0 — the point of excluding them from the alphabet.
  assert.equal(normalizeKey("OA-IIII-LLLL-OOOO"), "OA-1111-1111-0000");
});

test("normalizeKey rejects wrong lengths and non-strings", () => {
  assert.equal(normalizeKey("OA-1234"), null);
  assert.equal(normalizeKey("OA-1234-5678-9ABC-DEFG"), null);
  assert.equal(normalizeKey(""), null);
  assert.equal(normalizeKey(null), null);
  assert.equal(normalizeKey(12345), null);
});

/* ------------------------------------------------------------ signature check */

test("accepts a genuine Stripe signature", async () => {
  const body = JSON.stringify({ hello: "world" });
  assert.equal(await verifyStripeSignature(body, await stripeSign(body), SECRET, NOW), true);
});

test("rejects a signature made with the wrong secret", async () => {
  const body = JSON.stringify({ hello: "world" });
  const forged = await stripeSign(body, "whsec_attacker");
  assert.equal(await verifyStripeSignature(body, forged, SECRET, NOW), false);
});

test("rejects a valid signature over different bytes", async () => {
  const sig = await stripeSign(JSON.stringify({ amount: 1 }));
  assert.equal(await verifyStripeSignature(JSON.stringify({ amount: 999999 }), sig, SECRET, NOW), false);
});

test("rejects a replayed signature outside the tolerance window", async () => {
  const body = JSON.stringify({ hello: "world" });
  const old = await stripeSign(body, SECRET, NOW - 10 * 60 * 1000);
  assert.equal(await verifyStripeSignature(body, old, SECRET, NOW), false);
  // ...but the same capture verifies at the time it was made.
  assert.equal(await verifyStripeSignature(body, old, SECRET, NOW - 10 * 60 * 1000), true);
});

test("accepts when one of several v1 signatures matches (secret rotation)", async () => {
  const body = JSON.stringify({ hello: "world" });
  const good = await stripeSign(body);
  const header = good + ",v1=" + "0".repeat(64);
  assert.equal(await verifyStripeSignature(body, header, SECRET, NOW), true);
});

test("rejects missing, malformed, and empty signature headers", async () => {
  const body = "{}";
  assert.equal(await verifyStripeSignature(body, null, SECRET, NOW), false);
  assert.equal(await verifyStripeSignature(body, "", SECRET, NOW), false);
  assert.equal(await verifyStripeSignature(body, "garbage", SECRET, NOW), false);
  assert.equal(await verifyStripeSignature(body, "t=123", SECRET, NOW), false);
  assert.equal(await verifyStripeSignature(body, await stripeSign(body), "", NOW), false);
});

/* ----------------------------------------------------------- webhook handling */

test("webhook rejects an unsigned request with 400 and provisions nothing", async () => {
  const env = makeEnv();
  const body = JSON.stringify(checkoutEvent());
  const res = await handleWebhook(webhookRequest(body, null), env, NOW);
  assert.equal(res.status, 400);
  assert.equal(env.LICENSES.store.size, 0);
});

test("webhook rejects a forged signature with 400", async () => {
  const env = makeEnv();
  const body = JSON.stringify(checkoutEvent());
  const forged = await stripeSign(body, "whsec_attacker");
  const res = await handleWebhook(webhookRequest(body, forged), env, NOW);
  assert.equal(res.status, 400);
  assert.equal(env.LICENSES.store.size, 0);
});

test("webhook fails closed when the secret is not configured", async () => {
  const env = { LICENSES: fakeKV() };
  const body = JSON.stringify(checkoutEvent());
  const res = await handleWebhook(webhookRequest(body, await stripeSign(body)), env, NOW);
  assert.equal(res.status, 500);
  assert.equal(env.LICENSES.store.size, 0);
});

test("webhook is idempotent — a redelivered event is not processed twice", async () => {
  const env = makeEnv();
  const body = JSON.stringify(checkoutEvent());
  const sig = await stripeSign(body);

  const first = await handleWebhook(webhookRequest(body, sig), env, NOW);
  const firstBody = await first.json();
  assert.equal(first.status, 200);
  assert.match(firstBody.result, /^provisioned:OA-/);

  const second = await handleWebhook(webhookRequest(body, sig), env, NOW);
  const secondBody = await second.json();
  assert.equal(second.status, 200);
  assert.equal(secondBody.dedup, true);

  // Exactly one licence exists.
  const keys = [...env.LICENSES.store.keys()].filter((k) => k.startsWith("key:"));
  assert.equal(keys.length, 1);
});

test("a handler failure returns 500 and leaves the event unmarked, so Stripe retries", async () => {
  const env = makeEnv();
  const originalPut = env.LICENSES.put.bind(env.LICENSES);
  let fail = true;
  env.LICENSES.put = async (k, v, o) => {
    if (fail && k.startsWith("key:")) throw new Error("KV down");
    return originalPut(k, v, o);
  };

  const body = JSON.stringify(checkoutEvent());
  const sig = await stripeSign(body);
  const res = await handleWebhook(webhookRequest(body, sig), env, NOW);
  assert.equal(res.status, 500);
  assert.equal(await env.LICENSES.get("evt:evt_checkout_1"), null);

  // The retry succeeds.
  fail = false;
  const retry = await handleWebhook(webhookRequest(body, sig), env, NOW);
  assert.equal(retry.status, 200);
  assert.match((await retry.json()).result, /^provisioned:OA-/);
});

/* -------------------------------------------------------------- provisioning */

test("checkout provisions a key plus the cust and sess indexes", async () => {
  const env = makeEnv();
  const result = await processEvent(env, checkoutEvent(), NOW);
  const key = result.split(":")[1];

  assert.equal(await env.LICENSES.get(`cust:${CUST}`), key);
  assert.equal(await env.LICENSES.get("sess:cs_test_abc123"), key);

  const rec = JSON.parse(await env.LICENSES.get(`key:${key}`));
  assert.equal(rec.email, "student@example.edu");
  assert.equal(rec.subscriptionId, "sub_TEST1");
  assert.equal(rec.status, "active");
  assert.equal(rec.customerId, CUST);
  assert.deepEqual(rec.installs, []);
  // Provisional period until the invoice lands.
  assert.ok(rec.periodEnd > NOW);
});

test("events arriving out of order still yield exactly one licence", async () => {
  // Stripe does not guarantee ordering; invoice.paid routinely beats checkout.
  const env = makeEnv();
  const realEnd = NOW + 30 * DAY;

  await processEvent(env, invoicePaidEvent(realEnd), NOW);
  await processEvent(env, checkoutEvent(), NOW);

  const keys = [...env.LICENSES.store.keys()].filter((k) => k.startsWith("key:"));
  assert.equal(keys.length, 1, "out-of-order delivery must not mint two keys");

  const rec = JSON.parse(await env.LICENSES.get(keys[0]));
  assert.equal(rec.periodEnd, realEnd);
  assert.equal(rec.email, "student@example.edu");
  assert.equal(rec.subscriptionId, "sub_TEST1");
});

test("a real period end replaces the provisional guess even when it is earlier", async () => {
  // Regression: the provisional 35-day period is longer than a real 30-day one, so a
  // plain "never shorten" rule kept the guess and over-granted a month of Pro.
  const env = makeEnv();
  const realEnd = NOW + 30 * DAY;
  await processEvent(env, checkoutEvent(), NOW);

  const key = await env.LICENSES.get(`cust:${CUST}`);
  const provisional = JSON.parse(await env.LICENSES.get(`key:${key}`));
  assert.ok(provisional.periodEnd > realEnd, "precondition: guess is longer than reality");
  assert.equal(provisional.periodProvisional, true);

  await processEvent(env, invoicePaidEvent(realEnd), NOW);
  const settled = JSON.parse(await env.LICENSES.get(`key:${key}`));
  assert.equal(settled.periodEnd, realEnd);
  assert.equal(settled.periodProvisional, false);
});

test("a late-arriving older invoice cannot shorten the period", async () => {
  const env = makeEnv();
  await processEvent(env, checkoutEvent(), NOW);
  const far = NOW + 60 * DAY;
  await processEvent(env, invoicePaidEvent(far, "evt_a"), NOW);
  await processEvent(env, invoicePaidEvent(NOW + 5 * DAY, "evt_b"), NOW);

  const key = await env.LICENSES.get(`cust:${CUST}`);
  assert.equal(JSON.parse(await env.LICENSES.get(`key:${key}`)).periodEnd, far);
});

test("subscription events accept the newer per-item current_period_end shape", async () => {
  // Stripe moved this field onto items in 2025 API versions.
  const env = makeEnv();
  const end = NOW + 30 * DAY;
  await processEvent(
    env,
    {
      id: "evt_items",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_TEST1",
          customer: CUST,
          status: "active",
          items: { data: [{ current_period_end: Math.floor(end / 1000) }] },
        },
      },
    },
    NOW,
  );
  const key = await env.LICENSES.get(`cust:${CUST}`);
  assert.equal(JSON.parse(await env.LICENSES.get(`key:${key}`)).periodEnd, end);
});

/* ------------------------------------------------------------- cancellation */

test("subscription.deleted cancels and the next verify downgrades to Free", async () => {
  const env = makeEnv();
  await processEvent(env, checkoutEvent(), NOW);
  const key = await env.LICENSES.get(`cust:${CUST}`);

  const before = await verifyLicense(env, { key }, NOW);
  assert.equal(before.active, true);
  assert.equal(before.quota, PLAN_QUOTA.pro);

  await processEvent(
    env,
    { id: "evt_del", type: "customer.subscription.deleted", data: { object: { id: "sub_TEST1", customer: CUST } } },
    NOW,
  );

  const after = await verifyLicense(env, { key }, NOW);
  assert.equal(after.active, false);
  assert.equal(after.plan, "free");
  assert.equal(after.quota, PLAN_QUOTA.free);
  assert.equal(after.reason, "canceled");
});

test("a replayed checkout cannot resurrect a cancelled licence", async () => {
  const env = makeEnv();
  await processEvent(env, checkoutEvent(), NOW);
  const key = await env.LICENSES.get(`cust:${CUST}`);
  await processEvent(
    env,
    { id: "evt_del", type: "customer.subscription.deleted", data: { object: { customer: CUST } } },
    NOW,
  );

  // Same checkout event body, different event id — passes the dedup guard.
  await processEvent(env, { ...checkoutEvent(), id: "evt_checkout_replay" }, NOW);

  assert.equal((await verifyLicense(env, { key }, NOW)).active, false);
});

test("cancellation of an unknown customer is ignored rather than throwing", async () => {
  const env = makeEnv();
  const r = await processEvent(
    env,
    { id: "e", type: "customer.subscription.deleted", data: { object: { customer: "cus_nobody" } } },
    NOW,
  );
  assert.equal(r, "ignored:unknown-customer");
});

/* --------------------------------------------------- dunning / payment_failed */

test("invoice.payment_failed does not downgrade a customer mid-dunning", async () => {
  // The deliberate departure from the original design: Stripe retries a declined card
  // for weeks, so acting here would cut off people who are still going to pay.
  const env = makeEnv();
  await processEvent(env, checkoutEvent(), NOW);
  const key = await env.LICENSES.get(`cust:${CUST}`);

  const r = await processEvent(
    env,
    { id: "evt_fail", type: "invoice.payment_failed", data: { object: { customer: CUST } } },
    NOW,
  );
  assert.equal(r, "noop:payment_failed");
  assert.equal((await verifyLicense(env, { key }, NOW)).active, true);
});

test("past_due keeps access through the dunning window, then expires", async () => {
  const env = makeEnv();
  const periodEnd = NOW + DAY;
  await processEvent(env, checkoutEvent(), NOW);
  await processEvent(env, subEvent("past_due", periodEnd, "evt_pd"), NOW);
  const key = await env.LICENSES.get(`cust:${CUST}`);

  // Two weeks past the period end, Stripe is still retrying — keep them on Pro.
  assert.equal((await verifyLicense(env, { key }, periodEnd + 14 * DAY)).active, true);
  // Past the retry window with no payment, access lapses even if no webhook ever landed.
  assert.equal((await verifyLicense(env, { key }, periodEnd + 25 * DAY)).active, false);
});

test("paying after a past_due returns the record to active", async () => {
  const env = makeEnv();
  await processEvent(env, checkoutEvent(), NOW);
  await processEvent(env, subEvent("past_due", NOW + DAY, "evt_pd"), NOW);
  await processEvent(env, invoicePaidEvent(NOW + 31 * DAY, "evt_paid"), NOW);

  const key = await env.LICENSES.get(`cust:${CUST}`);
  const rec = JSON.parse(await env.LICENSES.get(`key:${key}`));
  assert.equal(rec.status, "active");
  assert.equal((await verifyLicense(env, { key }, NOW)).active, true);
});

/* --------------------------------------------------------- expiry / fail-safe */

test("access expires on time even if the cancellation webhook never arrives", async () => {
  // The whole reason periodEnd is stored: one dropped subscription.deleted must not
  // mean Pro forever.
  const env = makeEnv();
  const periodEnd = NOW + 30 * DAY;
  await processEvent(env, checkoutEvent(), NOW);
  await processEvent(env, subEvent("active", periodEnd, "evt_sub"), NOW);
  const key = await env.LICENSES.get(`cust:${CUST}`);

  assert.equal((await verifyLicense(env, { key }, periodEnd - DAY)).active, true);
  assert.equal((await verifyLicense(env, { key }, periodEnd + DAY)).active, true, "inside grace");
  assert.equal((await verifyLicense(env, { key }, periodEnd + 10 * DAY)).active, false, "past grace");
});

test("isActive rejects records with no usable periodEnd", () => {
  assert.equal(isActive({ status: "active" }, NOW), false);
  assert.equal(isActive({ status: "active", periodEnd: null }, NOW), false);
  assert.equal(isActive(null, NOW), false);
});

/* ------------------------------------------------------------------- verify */

test("unknown and malformed keys downgrade to Free without erroring", async () => {
  const env = makeEnv();
  const unknown = await verifyLicense(env, { key: "OA-2222-3333-4444" }, NOW);
  assert.equal(unknown.ok, true);
  assert.equal(unknown.active, false);
  assert.equal(unknown.reason, "unknown");
  assert.equal(unknown.quota, PLAN_QUOTA.free);

  const bad = await verifyLicense(env, { key: "nonsense" }, NOW);
  assert.equal(bad.ok, true);
  assert.equal(bad.active, false);
  assert.equal(bad.reason, "malformed");
});

test("verify accepts the key in whatever formatting the user pasted", async () => {
  const env = makeEnv();
  await processEvent(env, checkoutEvent(), NOW);
  const key = await env.LICENSES.get(`cust:${CUST}`);

  assert.equal((await verifyLicense(env, { key: key.toLowerCase() }, NOW)).active, true);
  assert.equal((await verifyLicense(env, { key: key.replace(/-/g, "") }, NOW)).active, true);
});

/* ---------------------------------------------------------- install binding */

test("a key binds to at most three installs", async () => {
  const env = makeEnv();
  await processEvent(env, checkoutEvent(), NOW);
  const key = await env.LICENSES.get(`cust:${CUST}`);

  for (const id of ["dev-1", "dev-2", "dev-3"]) {
    const r = await activateLicense(env, { key, installId: id }, NOW);
    assert.equal(r.active, true, `${id} should activate`);
  }

  const fourth = await activateLicense(env, { key, installId: "dev-4" }, NOW);
  assert.equal(fourth.active, false);
  assert.equal(fourth.reason, "device_limit");

  // Already-bound installs keep working.
  assert.equal((await activateLicense(env, { key, installId: "dev-2" }, NOW)).active, true);
});

test("re-activating the same install is idempotent, not a new slot", async () => {
  const env = makeEnv();
  await processEvent(env, checkoutEvent(), NOW);
  const key = await env.LICENSES.get(`cust:${CUST}`);

  for (let i = 0; i < 5; i++) await activateLicense(env, { key, installId: "dev-1" }, NOW);
  const rec = JSON.parse(await env.LICENSES.get(`key:${key}`));
  assert.deepEqual(rec.installs, ["dev-1"]);
});

test("verify adopts a new install when there is room but refuses past the limit", async () => {
  const env = makeEnv();
  await processEvent(env, checkoutEvent(), NOW);
  const key = await env.LICENSES.get(`cust:${CUST}`);

  // Adopting silently is what makes a reinstall not require re-activation.
  assert.equal((await verifyLicense(env, { key, installId: "a" }, NOW)).active, true);
  assert.equal((await verifyLicense(env, { key, installId: "b" }, NOW)).active, true);
  assert.equal((await verifyLicense(env, { key, installId: "c" }, NOW)).active, true);

  const shared = await verifyLicense(env, { key, installId: "d" }, NOW);
  assert.equal(shared.active, false);
  assert.equal(shared.reason, "device_limit");
});

test("activate refuses without an install id, and on a cancelled key", async () => {
  const env = makeEnv();
  await processEvent(env, checkoutEvent(), NOW);
  const key = await env.LICENSES.get(`cust:${CUST}`);

  assert.equal((await activateLicense(env, { key }, NOW)).reason, "install_id_required");

  await processEvent(
    env,
    { id: "evt_del", type: "customer.subscription.deleted", data: { object: { customer: CUST } } },
    NOW,
  );
  const r = await activateLicense(env, { key, installId: "dev-1" }, NOW);
  assert.equal(r.active, false);
  assert.equal(r.reason, "canceled");
});

/* --------------------------------------------------------------- by-session */

test("by-session returns the key for a real session id only", async () => {
  const env = makeEnv();
  await processEvent(env, checkoutEvent(), NOW);
  const key = await env.LICENSES.get(`cust:${CUST}`);

  const found = await licenseBySession(env, "cs_test_abc123");
  assert.equal(found.ok, true);
  assert.equal(found.key, key);
  assert.equal(found.email, "student@example.edu");

  assert.equal((await licenseBySession(env, "cs_test_nope")).ok, false);
  assert.equal((await licenseBySession(env, "not_a_session")).reason, "malformed");
  assert.equal((await licenseBySession(env, null)).reason, "malformed");
});

/* ------------------------------------------------------------------- misc */

test("unrelated event types are ignored without side effects", async () => {
  const env = makeEnv();
  const r = await processEvent(env, { id: "e", type: "customer.created", data: { object: {} } }, NOW);
  assert.equal(r, "ignored:customer.created");
  assert.equal(env.LICENSES.store.size, 0);
});

test("malformed events do not throw", async () => {
  const env = makeEnv();
  assert.equal(await processEvent(env, {}, NOW), "ignored:malformed");
  assert.equal(await processEvent(env, { type: "checkout.session.completed" }, NOW), "ignored:malformed");
  assert.equal(
    await processEvent(env, { id: "e", type: "checkout.session.completed", data: { object: {} } }, NOW),
    "ignored:no-customer",
  );
});

test("customer may arrive expanded as an object rather than an id string", async () => {
  const env = makeEnv();
  const r = await processEvent(env, checkoutEvent({ customer: { id: CUST } }), NOW);
  assert.match(r, /^provisioned:/);
  assert.ok(await env.LICENSES.get(`cust:${CUST}`));
});
