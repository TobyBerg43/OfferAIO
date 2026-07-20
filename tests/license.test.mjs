/* Tests for extension/license.js — the caching, fail-open/fail-closed and quota rules.
 *
 * license.js is a plain IIFE that hangs an object off `self`, so it loads into a vm
 * context with fakes for chrome.storage and fetch. Lives outside extension/ because
 * zip-extension.yml ships that whole folder to the Chrome Web Store.
 *
 * Run: node --test tests/license.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { webcrypto } from "node:crypto";

const SRC = readFileSync(new URL("../extension/license.js", import.meta.url), "utf8");
const DAY = 86400 * 1000;

/** Build an isolated copy of the module with controllable storage and network. */
function load({ verify, activate } = {}) {
  const store = {};
  const calls = { verify: 0, activate: 0 };

  const chrome = {
    storage: {
      local: {
        get(keys, cb) {
          const out = {};
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
            if (k in store) out[k] = store[k];
          });
          cb(out);
        },
        set(obj, cb) {
          Object.assign(store, obj);
          if (cb) cb();
        },
      },
    },
  };

  async function fakeFetch(url, opts) {
    const body = JSON.parse(opts.body);
    if (url.endsWith("/license/verify")) {
      calls.verify++;
      const r = verify ? await verify(body, calls.verify) : { ok: true, active: false, reason: "unknown" };
      if (r instanceof Error) throw r;
      return { ok: true, json: async () => r };
    }
    if (url.endsWith("/license/activate")) {
      calls.activate++;
      const r = activate ? await activate(body, calls.activate) : { ok: false, active: false, reason: "unknown" };
      if (r instanceof Error) throw r;
      return { ok: true, json: async () => r };
    }
    throw new Error("unexpected url " + url);
  }

  const sandbox = { self: {}, chrome, fetch: fakeFetch, crypto: webcrypto, console };
  createContext(sandbox);
  runInContext(SRC, sandbox);
  return { LIC: sandbox.self.OfferAIOLicense, store, calls };
}

const activeVerdict = (over = {}) => ({
  ok: true,
  active: true,
  plan: "pro",
  quota: 250,
  status: "active",
  periodEnd: Date.now() + 30 * DAY,
  key: "OA-4K2P-9XQR-7M3V",
  installs: 1,
  maxInstalls: 3,
  ...over,
});

/* --------------------------------------------------------------- free tier */

test("with no key stored, the plan is Free with a 50 limit", async () => {
  const { LIC, calls } = load();
  const s = await LIC.status();
  assert.equal(s.plan, "free");
  assert.equal(s.quota, 50);
  assert.equal(s.remaining, 50);
  assert.equal(s.reason, "no_key");
  assert.equal(calls.verify, 0, "must not hit the network when there's no key");
});

/* --------------------------------------------------------------- activation */

test("activating a good key switches to Pro and persists it", async () => {
  const { LIC, store } = load({ activate: () => activeVerdict() });
  const res = await LIC.activate("oa-4k2p-9xqr-7m3v");
  assert.equal(res.ok, true);
  assert.equal(res.quota, 250);
  assert.equal(store.license.key, "OA-4K2P-9XQR-7M3V");
  assert.equal(store.license.cache.active, true);

  const s = await LIC.status();
  assert.equal(s.plan, "pro");
  assert.equal(s.quota, 250);
});

test("activation failures surface the reason and store nothing", async () => {
  for (const reason of ["device_limit", "canceled", "unknown", "expired"]) {
    const { LIC, store } = load({ activate: () => ({ ok: false, active: false, reason }) });
    const res = await LIC.activate("OA-1111-2222-3333");
    assert.equal(res.ok, false);
    assert.equal(res.reason, reason);
    assert.equal(store.license, undefined, "a rejected key must not be saved");
  }
});

test("activation reports unreachable rather than invalid when the network fails", async () => {
  // These must not look the same to the user: one means "wrong key", the other
  // means "try again in a minute".
  const { LIC } = load({ activate: () => new Error("offline") });
  const res = await LIC.activate("OA-1111-2222-3333");
  assert.equal(res.ok, false);
  assert.equal(res.reason, "unreachable");
});

test("an empty key is rejected without a network call", async () => {
  const { LIC, calls } = load();
  assert.equal((await LIC.activate("   ")).reason, "empty");
  assert.equal(calls.activate, 0);
});

/* -------------------------------------------------------------- verify cache */

test("the verify result is cached for 24h", async () => {
  const { LIC, calls } = load({ activate: () => activeVerdict(), verify: () => activeVerdict() });
  await LIC.activate("OA-4K2P-9XQR-7M3V");
  for (let i = 0; i < 5; i++) await LIC.getLicense();
  assert.equal(calls.verify, 0, "activation is fresh — no verify needed yet");
});

test("a stale cache triggers one re-verify", async () => {
  const { LIC, store, calls } = load({ activate: () => activeVerdict(), verify: () => activeVerdict() });
  await LIC.activate("OA-4K2P-9XQR-7M3V");

  store.license.cache.checkedAt = Date.now() - 25 * 60 * 60 * 1000;
  assert.equal((await LIC.getLicense()).active, true);
  assert.equal(calls.verify, 1);

  await LIC.getLicense(); // now fresh again
  assert.equal(calls.verify, 1);
});

test("force skips the cache", async () => {
  const { LIC, calls } = load({ activate: () => activeVerdict(), verify: () => activeVerdict() });
  await LIC.activate("OA-4K2P-9XQR-7M3V");
  await LIC.getLicense({ force: true });
  assert.equal(calls.verify, 1);
});

/* ------------------------------------------------- fail closed / fail open */

test("an explicit inactive verdict downgrades immediately", async () => {
  // Fail CLOSED: the Worker said the licence is dead, so believe it.
  const { LIC, store } = load({
    activate: () => activeVerdict(),
    verify: () => ({ ok: true, active: false, reason: "canceled", status: "canceled" }),
  });
  await LIC.activate("OA-4K2P-9XQR-7M3V");
  store.license.cache.checkedAt = 0;

  const s = await LIC.status();
  assert.equal(s.plan, "free");
  assert.equal(s.quota, 50);
  assert.equal(s.reason, "canceled");
});

test("a Worker outage keeps Pro alive for the grace window", async () => {
  // Fail OPEN: our outage must not downgrade someone who paid.
  const { LIC, store } = load({ activate: () => activeVerdict(), verify: () => new Error("network down") });
  await LIC.activate("OA-4K2P-9XQR-7M3V");

  store.license.cache.checkedAt = 0;
  store.license.cache.lastActiveAt = Date.now() - 3 * DAY;

  const s = await LIC.status();
  assert.equal(s.plan, "pro");
  assert.equal(s.quota, 250);
  assert.equal(s.stale, true);
});

test("a Worker outage past the grace window falls back to Free but keeps the key", async () => {
  const { LIC, store } = load({ activate: () => activeVerdict(), verify: () => new Error("network down") });
  await LIC.activate("OA-4K2P-9XQR-7M3V");

  store.license.cache.checkedAt = 0;
  store.license.cache.lastActiveAt = Date.now() - 10 * DAY;

  const s = await LIC.status();
  assert.equal(s.plan, "free");
  assert.equal(s.reason, "unreachable");
  assert.equal(store.license.key, "OA-4K2P-9XQR-7M3V", "the key must survive an outage");
});

test("an inactive verdict does not advance the offline grace clock", async () => {
  // Otherwise a cancelled user could go offline and coast on grace forever.
  const { LIC, store } = load({
    activate: () => activeVerdict(),
    verify: () => ({ ok: true, active: false, reason: "canceled" }),
  });
  await LIC.activate("OA-4K2P-9XQR-7M3V");
  const activatedAt = store.license.cache.lastActiveAt;

  store.license.cache.checkedAt = 0;
  await LIC.getLicense();
  assert.equal(store.license.cache.lastActiveAt, activatedAt, "must not move on an inactive answer");
});

test("removing the key returns the user to Free", async () => {
  const { LIC } = load({ activate: () => activeVerdict() });
  await LIC.activate("OA-4K2P-9XQR-7M3V");
  assert.equal((await LIC.status()).plan, "pro");

  await LIC.clearLicense();
  const s = await LIC.status();
  assert.equal(s.plan, "free");
  assert.equal(s.reason, "no_key");
});

/* ------------------------------------------------------------------- quota */

test("submissions count against the monthly limit", async () => {
  const { LIC } = load();
  for (let i = 0; i < 3; i++) await LIC.recordSubmission();
  const s = await LIC.status();
  assert.equal(s.used, 3);
  assert.equal(s.remaining, 47);
});

test("usage resets when the month rolls over", async () => {
  const { LIC, store } = load();
  await LIC.recordSubmission();
  assert.equal((await LIC.getUsage()).count, 1);

  store.usage = { month: "2020-01", count: 49 };
  const u = await LIC.getUsage();
  assert.equal(u.count, 0, "a stale month must reset, not carry over");
  assert.notEqual(u.month, "2020-01");
});

test("going Pro raises the ceiling without clearing usage", async () => {
  const { LIC } = load({ activate: () => activeVerdict() });
  for (let i = 0; i < 50; i++) await LIC.recordSubmission();

  let s = await LIC.status();
  assert.equal(s.remaining, 0, "free tier is spent");

  await LIC.activate("OA-4K2P-9XQR-7M3V");
  s = await LIC.status();
  assert.equal(s.used, 50, "usage carries across the upgrade");
  assert.equal(s.quota, 250);
  assert.equal(s.remaining, 200);
});

test("remaining never goes negative", async () => {
  const { LIC, store } = load();
  store.usage = { month: new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0"), count: 80 };
  const s = await LIC.status();
  assert.equal(s.remaining, 0);
});

/* -------------------------------------------------------------- install id */

test("the install id is generated once and reused", async () => {
  const { LIC } = load();
  const a = await LIC.installId();
  const b = await LIC.installId();
  assert.equal(a, b);
  assert.ok(a.length > 8);
});

test("verify sends the key and install id", async () => {
  let seen = null;
  const { LIC, store } = load({
    activate: () => activeVerdict(),
    verify: (body) => { seen = body; return activeVerdict(); },
  });
  await LIC.activate("OA-4K2P-9XQR-7M3V");
  store.license.cache.checkedAt = 0;
  await LIC.getLicense();

  assert.equal(seen.key, "OA-4K2P-9XQR-7M3V");
  assert.equal(seen.installId, await LIC.installId());
});
