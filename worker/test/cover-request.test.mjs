/* The shape of the OpenAI request, guarded because nothing else guards it.
 *
 * /cover had never successfully run — not once, from the day OPENAI_API_KEY was set on
 * 2026-08-08 until 2026-08-15 — and it was broken twice over: a BOM on the secret (see
 * secret.test.mjs) and `max_tokens`, which current OpenAI chat models reject outright.
 * Neither was noticed, because reaching this code needs an active licence and nobody had
 * bought. The first person to exercise it would have been a paying customer.
 *
 * A test cannot call OpenAI, so it checks the request we would send. That is enough to
 * catch a parameter rename, which is the failure that actually happened.
 *
 * Run: node --test worker/test/cover-request.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const llm = /async function llm\([\s\S]*?\n}/.exec(SRC);

test("llm() is still where we think it is", () => {
  assert.ok(llm, "llm() not found in src/index.js");
});

test("the token cap uses max_completion_tokens", () => {
  assert.match(llm[0], /max_completion_tokens:\s*\d+/);
});

test("max_tokens is never sent", () => {
  // "Unsupported parameter: 'max_tokens' is not supported with this model" — a 400 from
  // OpenAI, surfaced by this Worker as a 500, on every single call.
  // Comments are stripped first: the fix is explained in a comment that names the
  // parameter, and a test that fails on its own documentation teaches people to delete
  // the documentation.
  const code = llm[0].replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /(^|[^_])\bmax_tokens\b/m,
    "max_tokens is back — current chat models reject it");
});

test("the key reaches the header sanitised", () => {
  assert.match(llm[0], /Bearer " \+ apiKey/);
  assert.doesNotMatch(llm[0], /Bearer " \+ env\.OPENAI_API_KEY/,
    "the raw env value is in the header again — a BOM or newline will 401 every call");
});

test("an OpenAI error is surfaced, not swallowed", () => {
  // The 500 body is what made both bugs diagnosable in one call each. If this ever
  // becomes a generic "AI unavailable", the next failure costs a day instead of a minute.
  assert.match(llm[0], /if \(j\.error\) throw new Error\(j\.error\.message\)/);
});
