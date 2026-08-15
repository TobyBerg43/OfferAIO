/* The secret sanitiser, and why it is not paranoia.
 *
 * OPENAI_API_KEY was set on 2026-08-08 with a UTF-8 BOM in front of it. PowerShell's `>`
 * and Out-File both write one by default, `wrangler secret put` stored it faithfully, and
 * `wrangler secret list` showed the name — so every check anyone could run said the key
 * was present. Every /cover call returned:
 *
 *     500  Incorrect API key provided: <BOM>sk-pr…
 *
 * It went undetected for a week because nothing ever called it: /cover requires an active
 * licence and nobody had bought. The first person to hit it would have been a customer who
 * had just paid $30.
 *
 * Run: node --test worker/test/secret.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const SRC = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

/** Lift `secret` out of the module — index.js exports a fetch handler, not this. */
function lift() {
  const i = SRC.indexOf("const secret = (v)");
  assert.notEqual(i, -1, "secret() not found — did it get renamed?");
  let depth = 0, j = SRC.indexOf("{", i);
  for (; j < SRC.length; j++) {
    if (SRC[j] === "{") depth++;
    else if (SRC[j] === "}" && --depth === 0) break;
  }
  const sandbox = {};
  createContext(sandbox);
  runInContext(SRC.slice(i, j + 1) + ";this.__f = secret;", sandbox);
  return sandbox.__f;
}

const secret = lift();
const BOM = String.fromCharCode(65279);
const KEY = "sk-proj-abc123";

test("a BOM-prefixed key is usable", () => {
  assert.equal(secret(BOM + KEY), KEY);
});

test("the exact shape that broke production", () => {
  // What wrangler actually stored: BOM from Out-File, newline from the redirect.
  assert.equal(secret(BOM + KEY + "\r\n"), KEY);
});

test("whitespace either side is stripped", () => {
  assert.equal(secret("  " + KEY + "  "), KEY);
  assert.equal(secret(KEY + "\n"), KEY);
});

test("a clean key is returned unchanged", () => {
  assert.equal(secret(KEY), KEY);
});

test("only a LEADING bom is stripped, and only one", () => {
  // A BOM in the middle is not a paste artefact — it is a corrupt secret, and quietly
  // repairing it would hide that. Fail loudly at OpenAI instead.
  assert.equal(secret("sk-" + BOM + "proj"), "sk-" + BOM + "proj");
});

test("non-strings pass through, so a missing secret still reads as missing", () => {
  assert.equal(secret(undefined), undefined);
  assert.equal(secret(null), null);
});

test("an empty or whitespace-only secret is falsy, so the callers still throw", () => {
  // llm() and rank() both branch on `if (!apiKey) throw` — a secret of "\n" must not
  // sneak past that check and turn into an `Authorization: Bearer` with nothing in it.
  assert.equal(secret("   \n"), "");
  assert.equal(secret(BOM), "");
});

test("both OpenAI callers sanitise, not just the one that broke", () => {
  // /rank was reading env.OPENAI_API_KEY raw. It has no caller today (§12 item 6), so it
  // would have failed the same way the first time it got one.
  const raw = [...SRC.matchAll(/env\.OPENAI_API_KEY/g)];
  const wrapped = [...SRC.matchAll(/secret\(env\.OPENAI_API_KEY\)/g)];
  assert.equal(raw.length, wrapped.length,
    "env.OPENAI_API_KEY is read raw somewhere — wrap it in secret()");
});
