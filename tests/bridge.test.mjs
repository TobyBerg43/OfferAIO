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

  const sandbox = { window, chrome, crypto: webcrypto, console };
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
