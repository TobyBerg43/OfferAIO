/* Tests for the daily cap and the randomized pacing gap in extension/license.js.
 *
 * These are the rails the landing page's trust panel claims, and until 2026-08-16 the
 * panel claimed them while nothing in extension/ implemented either — the copy said
 * "PACING humanized · randomized" and "DAILY CAP 12 applications" and a grep for
 * dailyCap|pacing|humaniz|randomDelay across the extension returned nothing at all.
 * So these tests exist as much to keep the claim true as to keep the code correct.
 *
 * The rails govern automatic submission only. Nothing here should ever be read as
 * blocking a user who clicks Submit — see the comments in license.js and content.js.
 *
 * Run: node --test tests/pacing.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { webcrypto } from "node:crypto";

const SRC = readFileSync(new URL("../extension/license.js", import.meta.url), "utf8");

/** Isolated copy of the module over a plain object store, with no network needed. */
function load(seed = {}) {
  const store = { ...seed };
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
  const sandbox = {
    self: {},
    chrome,
    fetch: async () => {
      throw new Error("no network expected in these tests");
    },
    crypto: webcrypto,
    console,
  };
  createContext(sandbox);
  runInContext(SRC, sandbox);
  return { LIC: sandbox.self.OfferAIOLicense, store };
}

const today = () => {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
};

/* ------------------------------------------------------------- the daily cap */

test("a fresh install has the full daily cap available", async () => {
  const { LIC } = load();
  const d = await LIC.getDaily();
  assert.equal(d.cap, 12);
  assert.equal(d.count, 0);
  assert.equal(d.remaining, 12);
});

test("recording a submission spends one from today's cap", async () => {
  const { LIC } = load();
  await LIC.recordSubmission();
  const d = await LIC.getDaily();
  assert.equal(d.count, 1);
  assert.equal(d.remaining, 11);
});

test("yesterday's count does not carry into today", async () => {
  const { LIC } = load({ daily: { day: "2020-01-01", count: 12 } });
  const d = await LIC.getDaily();
  assert.equal(d.count, 0, "a stale day key must read as zero, not as spent");
  assert.equal(d.remaining, 12);
});

test("the cap is reported as reached, and never as negative", async () => {
  const { LIC } = load({ daily: { day: today(), count: 30 } });
  const d = await LIC.getDaily();
  assert.equal(d.remaining, 0, "remaining must floor at zero");
  assert.ok(d.count > d.cap, "and the raw count is still reported honestly");
});

test("a stored dailyCap overrides the default", async () => {
  const { LIC } = load({ dailyCap: 4 });
  assert.equal((await LIC.getDaily()).cap, 4);
});

test("a nonsense dailyCap falls back to the default, not to no limit", async () => {
  for (const bad of [0, -5, "banana", null, NaN, Infinity]) {
    const { LIC } = load({ dailyCap: bad });
    const d = await LIC.getDaily();
    assert.equal(d.cap, 12, "dailyCap " + String(bad) + " must fall back to 12");
    assert.ok(d.remaining <= 12);
  }
});

test("the monthly counter and the daily counter both advance, independently", async () => {
  const { LIC } = load({ daily: { day: "2020-01-01", count: 9 } });
  const before = await LIC.getUsage();
  await LIC.recordSubmission();
  const after = await LIC.getUsage();
  assert.equal(after.count, before.count + 1, "the month keeps counting across a day roll");
  assert.equal((await LIC.getDaily()).count, 1, "the day started over");
});

/* ----------------------------------------------------------------- the pacing */

test("nothing to wait for before the first submission", async () => {
  const { LIC } = load();
  assert.equal(await LIC.paceWaitMs(), 0);
});

test("a submission opens a gap inside the advertised range", async () => {
  const { LIC } = load();
  await LIC.recordSubmission();
  const wait = await LIC.paceWaitMs();
  assert.ok(wait > 0, "there must be a gap after a send");
  assert.ok(
    wait <= LIC.PACE_MAX_MS,
    "gap " + wait + "ms must not exceed PACE_MAX_MS " + LIC.PACE_MAX_MS,
  );
  // A little slack under the minimum: real time passes between the two calls.
  assert.ok(wait > LIC.PACE_MIN_MS - 5000, "gap " + wait + "ms is under the advertised floor");
});

test("the gap is a stored deadline, not re-rolled on every read", async () => {
  const { LIC } = load();
  await LIC.recordSubmission();
  const a = await LIC.paceWaitMs();
  const b = await LIC.paceWaitMs();
  // Same deadline, so the second read is equal or very slightly smaller. Re-rolling would
  // let the wait jump back up, and it would then never elapse.
  assert.ok(b <= a, "a re-rolled gap could grow between reads");
  assert.ok(a - b < 2000, "and both reads must describe the same deadline");
});

test("the gap is actually randomized across submissions", async () => {
  const seen = new Set();
  for (let i = 0; i < 25; i++) {
    const { LIC, store } = load();
    await LIC.recordSubmission();
    seen.add(store.paceUntil - store.lastSubmitAt);
  }
  assert.ok(
    seen.size > 5,
    "25 submissions produced only " + seen.size + " distinct gaps — that is not randomized",
  );
});

test("an elapsed deadline reads as clear", async () => {
  const { LIC } = load({ paceUntil: Date.now() - 1000 });
  assert.equal(await LIC.paceWaitMs(), 0);
});

test("a clock knocked forward cannot strand full-auto forever", async () => {
  // Without the clamp, full-auto would sit waiting out a deadline months away.
  const { LIC } = load({ paceUntil: Date.now() + 400 * 86400 * 1000 });
  const wait = await LIC.paceWaitMs();
  assert.equal(wait, LIC.PACE_MAX_MS, "an absurd deadline must clamp to one normal gap");
});

test("a missing or corrupt paceUntil reads as clear rather than as forever", async () => {
  for (const bad of [undefined, null, "soon", NaN, {}]) {
    const { LIC } = load(bad === undefined ? {} : { paceUntil: bad });
    assert.equal(await LIC.paceWaitMs(), 0, "paceUntil " + String(bad) + " must not block");
  }
});

/* ------------------------------------------------------- what the UI is handed */

test("status() carries the daily and pacing numbers the bar and popup print", async () => {
  const { LIC } = load();
  await LIC.recordSubmission();
  const s = await LIC.status();
  assert.equal(s.dailyUsed, 1);
  assert.equal(s.dailyCap, 12);
  assert.equal(s.dailyRemaining, 11);
  assert.ok(s.paceWaitMs > 0);
  // The monthly numbers must survive the addition — the bar prints both.
  assert.equal(s.used, 1);
  assert.equal(s.quota, 50);
  assert.equal(s.remaining, 49);
});

test("the advertised constants are what the code actually uses", async () => {
  // The landing page prints these numbers. If they change here, that copy is now a lie,
  // which is exactly the failure this file was added to prevent.
  const { LIC } = load();
  assert.equal(LIC.DAILY_CAP, 12);
  assert.equal(LIC.PACE_MIN_MS, 45000);
  assert.equal(LIC.PACE_MAX_MS, 90000);
});
