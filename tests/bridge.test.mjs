/* Tests for extension/bridge.js — the site <-> extension relay.
 *
 * bridge.js is a plain content script, so like license.js it loads into a vm context
 * with fakes for `window` and chrome.storage. Lives outside extension/ because
 * zip-extension.yml ships that whole folder to the Chrome Web Store.
 *
 * What matters here:
 *   - the licence reply reuses the extension's existing installId, so opening the
 *     dashboard never eats a second of the 3 install slots bound to a key;
 *   - a missing installId is minted once and persisted, not regenerated per request;
 *   - messages from anything other than this window are ignored, so an embedded
 *     third-party iframe can't ask for the licence key.
 *
 * Run: node --test tests/bridge.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { webcrypto } from "node:crypto";

const SRC = readFileSync(new URL("../extension/bridge.js", import.meta.url), "utf8");

/** Load bridge.js with a fake window + chrome.storage. */
function load(initialStore = {}) {
  const store = { ...initialStore };
  const posted = [];
  const listeners = [];

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

  const window = {
    addEventListener(type, fn) {
      if (type === "message") listeners.push(fn);
    },
    postMessage(data) {
      posted.push(data);
    },
  };

  // A content script's global is `self`; bridge.js reads self.OfferAIOLicense to get the
  // real plan/quota when license.js is loaded alongside it (manifest.json declares both).
  // Tests deliberately load bridge.js WITHOUT it, exercising the storage fallback.
  const sandbox = { window, chrome, crypto: webcrypto, console };
  sandbox.self = sandbox;
  createContext(sandbox);
  runInContext(SRC, sandbox);

  /** Deliver a message as if the page posted it to itself. */
  const send = (data, source = window) => listeners.forEach((fn) => fn({ data, source }));
  return { send, posted, store, window };
}

const site = (type, extra = {}) => ({ source: "offeraio-site", type, ...extra });
const lastOfType = (posted, type) => [...posted].reverse().find((m) => m.type === type);

test("announces itself on load", () => {
  const { posted } = load();
  assert.equal(posted[0].source, "offeraio-ext");
  assert.equal(posted[0].type, "ready");
});

test("ping is answered with pong", () => {
  const { send, posted } = load();
  send(site("ping"));
  assert.ok(lastOfType(posted, "pong"));
});

test("profile is stored and acknowledged", () => {
  const { send, posted, store } = load();
  send(site("profile", { profile: { name: "Toby" }, mode: "auto" }));
  assert.deepEqual(store.profile, { name: "Toby" });
  assert.equal(store.mode, "auto");
  assert.ok(lastOfType(posted, "saved"));
});

test("profile mode defaults to semi", () => {
  const { send, store } = load();
  send(site("profile", { profile: { name: "Toby" } }));
  assert.equal(store.mode, "semi");
});

test("licence reply reuses the extension's existing installId", () => {
  const { send, posted } = load({ license: { key: "OA-AAAA-BBBB-CCCC" }, installId: "install-1" });
  send(site("license"));
  const reply = lastOfType(posted, "license");
  assert.equal(reply.key, "OA-AAAA-BBBB-CCCC");
  assert.equal(reply.installId, "install-1"); // NOT a fresh id — that would burn an install slot
});

test("a missing installId is minted once and persisted", () => {
  const { send, posted, store } = load({ license: { key: "OA-AAAA-BBBB-CCCC" } });
  send(site("license"));
  const first = lastOfType(posted, "license").installId;
  assert.ok(first);
  assert.equal(store.installId, first);

  send(site("license"));
  assert.equal(lastOfType(posted, "license").installId, first); // stable across requests
});

test("no key yet reports null but still returns an installId", () => {
  const { send, posted } = load({ installId: "install-1" });
  send(site("license"));
  const reply = lastOfType(posted, "license");
  assert.equal(reply.key, null);
  assert.equal(reply.installId, "install-1");
});

test("messages from another window are ignored", () => {
  const { send, posted, store } = load({ license: { key: "OA-AAAA-BBBB-CCCC" }, installId: "install-1" });
  const before = posted.length;
  const iframe = {}; // some other window object — an embedded frame
  send(site("license"), iframe);
  send(site("profile", { profile: { name: "attacker" } }), iframe);
  assert.equal(posted.length, before, "nothing should be posted back");
  assert.equal(store.profile, undefined, "profile must not be overwritten");
});

test("foreign messages are ignored", () => {
  const { send, posted } = load({ installId: "install-1" });
  const before = posted.length;
  send({ source: "somebody-else", type: "license" });
  send(null);
  assert.equal(posted.length, before);
});

/* ------------------------------------------------------- identity + applications
 *
 * The dashboard used to open with a hardcoded name, a plan nobody chose and 14
 * applications nobody sent, while the extension popup simultaneously and correctly read
 * "0 of 50 submissions used". These two relays are what let the dashboard show the same
 * truth the popup does — there is no account system, so the extension IS the identity.
 */

const settle = () => new Promise((r) => setTimeout(r, 0));

test("identity reports the saved profile and the real usage", async () => {
  const { send, posted } = load({
    profile: { name: "Ada Lovelace", email: "ada@school.edu" },
    usage: { month: monthNow(), count: 12 },
  });
  send(site("identity"));
  await settle();
  const reply = lastOfType(posted, "identity");
  assert.equal(reply.profile.name, "Ada Lovelace");
  assert.equal(reply.usage.plan, "free");
  assert.equal(reply.usage.used, 12);
  assert.equal(reply.usage.quota, 50);
});

test("a licensed install reports Pro and the 250 quota", async () => {
  const { send, posted } = load({
    profile: { name: "Ada" },
    license: { key: "OA-AAAA-BBBB-CCCC", cache: { active: true } },
    usage: { month: monthNow(), count: 3 },
  });
  send(site("identity"));
  await settle();
  const reply = lastOfType(posted, "identity");
  assert.equal(reply.usage.plan, "pro");
  assert.equal(reply.usage.quota, 250);
  assert.equal(reply.usage.used, 3);
});

test("last month's counter does not carry into this month", async () => {
  const { send, posted } = load({ usage: { month: "2020-01", count: 49 } });
  send(site("identity"));
  await settle();
  assert.equal(lastOfType(posted, "identity").usage.used, 0);
});

test("no profile yet reports null rather than inventing one", async () => {
  const { send, posted } = load();
  send(site("identity"));
  await settle();
  const reply = lastOfType(posted, "identity");
  assert.equal(reply.profile, null);
  assert.equal(reply.usage.used, 0);
});

test("applications are relayed verbatim", async () => {
  const apps = [
    { company: "Stripe", role: "SWE Intern", url: "https://x/1", submittedAt: 2, confirmed: true },
    { company: "Ramp", role: "Backend Intern", url: "https://x/2", submittedAt: 1, confirmed: false },
  ];
  const { send, posted } = load({ applications: apps });
  send(site("applications"));
  await settle();
  const reply = lastOfType(posted, "applications");
  assert.deepEqual(reply.applications, apps);
});

test("no applications yet relays an empty list, never undefined", async () => {
  const { send, posted } = load();
  send(site("applications"));
  await settle();
  // The array is constructed inside the vm realm, so its prototype isn't this realm's
  // Array — compare structurally rather than with deepEqual.
  const got = lastOfType(posted, "applications").applications;
  assert.ok(Array.isArray(got), "expected an array, not undefined");
  assert.equal(got.length, 0);
});

test("identity and applications are refused to another window", async () => {
  const { send, posted } = load({ profile: { name: "Ada" }, applications: [{ company: "Stripe" }] });
  const before = posted.length;
  const iframe = {};
  send(site("identity"), iframe);
  send(site("applications"), iframe);
  await settle();
  assert.equal(posted.length, before, "an embedded iframe must not be able to read either");
});

function monthNow() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
