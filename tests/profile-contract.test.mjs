/* The profile is a contract between three files that cannot import each other, and it
 * broke silently once already.
 *
 *   extension/popup.html + popup.js   the profile the user types into the extension
 *   OfferAIO.html                     the profile the user types into the website
 *   extension/content.js              the only consumer, on someone's job application
 *
 * The website pushes its profile into the extension over the bridge, so both writers have
 * to produce a shape the single reader understands — and one of the fields they write is
 * a legal declaration. On 2026-08-15 both writers derived
 * `needsSponsorship = (workAuth === "Requires sponsorship")`, which stored **false** for
 * "F-1 (CPT/OPT)", and content.js read that boolean as an answer. Every test in
 * content-workauth.test.mjs was green, because they all tested the reader against
 * fixtures no writer produced.
 *
 * So this file tests the writers, and tests them against the reader.
 *
 * Run: node --test tests/profile-contract.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const POPUP_JS = read("extension/popup.js");
const POPUP_HTML = read("extension/popup.html");
const CONTENT_JS = read("extension/content.js");
const DASH = read("OfferAIO.html");

/** Lift one function's source out of a file and make it callable. */
function lift(src, name) {
  const i = src.indexOf("function " + name);
  assert.notEqual(i, -1, `${name}() not found — did it get renamed?`);
  // Walk braces from the first { after the signature to find the function's end.
  let depth = 0, start = src.indexOf("{", i), j = start;
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) break;
  }
  const sandbox = {};
  createContext(sandbox);
  runInContext(src.slice(i, j + 1) + `;this.__f = ${name};`, sandbox);
  return sandbox.__f;
}

/** Every <option> value a <select id="…"> offers, in document order. */
function optionsOf(html, id) {
  const sel = new RegExp(`<select[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)</select>`).exec(html);
  assert.ok(sel, `<select id="${id}"> not found`);
  return [...sel[1].matchAll(/<option([^>]*)>([^<]*)</g)].map(([, attrs, text]) => {
    const v = /value=["']([^"']*)["']/.exec(attrs);
    return v ? v[1] : text.trim();
  });
}

const popupFlag = lift(POPUP_JS, "sponsorshipFlag");
const dashFlag = lift(DASH, "sponsorshipFlag");
const need = lift(CONTENT_JS, "sponsorshipNeed");

const POPUP_OPTS = optionsOf(POPUP_HTML, "workAuth");
const DASH_OPTS = optionsOf(DASH, "setWorkAuth");

/* Each lifted function runs in its own vm context, so its `{}` has a different prototype
   and assert.deepEqual would fail on two empty objects. Compare the meaning instead —
   which is a three-state value, and saying so is clearer than comparing shapes anyway. */
const flagOf = (o) => (o && "needsSponsorship" in o ? o.needsSponsorship : "absent");

/* -------------------------------------------------------- the two writers agree */

test("both profile UIs offer exactly the same work-authorisation choices", () => {
  // A choice on one and not the other is a profile the reader has never seen.
  assert.deepEqual(POPUP_OPTS, DASH_OPTS);
});

test("both offer a blank default, so 'not answered' is reachable and is where you start", () => {
  for (const [what, opts, html, id] of [
    ["popup", POPUP_OPTS, POPUP_HTML, "workAuth"],
    ["dashboard", DASH_OPTS, DASH, "setWorkAuth"],
  ]) {
    assert.equal(opts[0], "", `${what}: the first option must be blank`);
    const sel = new RegExp(`<select[^>]*id=["']${id}["'][^>]*>\\s*<option[^>]*selected`).test(html)
      || new RegExp(`<select[^>]*id=["']${id}["'][^>]*>\\s*<option value=["']["'][^>]*selected`).test(html);
    assert.ok(sel, `${what}: the blank option must be the selected one`);
  }
});

test("both derive the sponsorship flag identically, for every option either one offers", () => {
  for (const opt of [...new Set([...POPUP_OPTS, ...DASH_OPTS, "", "  ", "something else"])]) {
    assert.equal(flagOf(popupFlag(opt)), flagOf(dashFlag(opt)), `disagreed on ${JSON.stringify(opt)}`);
  }
});

/* --------------------------------------------- the writers agree with the reader */

test("what the writers store is what content.js concludes", () => {
  for (const opt of POPUP_OPTS) {
    const stored = { workAuth: opt, ...popupFlag(opt) };
    const conclusion = need(stored);
    const expected = flagOf(popupFlag(opt));
    assert.equal(
      conclusion,
      expected === "absent" ? null : expected,
      `content.js read ${JSON.stringify(opt)} as ${conclusion}, the writers stored ${JSON.stringify(popupFlag(opt))}`,
    );
  }
});

test("F-1 is stored as unknown, not as 'needs no sponsorship'", () => {
  const f1 = POPUP_OPTS.find((o) => /F-1/i.test(o));
  assert.ok(f1, "the F-1 option is gone — that is the option this whole file is about");
  assert.equal(flagOf(popupFlag(f1)), "absent", "F-1 must not carry a sponsorship boolean at all");
  assert.equal(need({ workAuth: f1, ...popupFlag(f1) }), null);
});

test("a boolean with no selection behind it is not trusted", () => {
  // The old popup default. `false` here was a value nobody chose.
  assert.equal(need({ needsSponsorship: false }), null);
  // An explicit `true` is kept: it only ever came from a deliberate pick, and
  // over-declaring a need for sponsorship is not the dangerous direction.
  assert.equal(need({ needsSponsorship: true }), true);
});

/* ------------------------------------- the popup cannot crash on its own save button */

test("every field popup.js saves exists in popup.html", () => {
  // `F.forEach(k => document.getElementById(k).value)` throws on a missing id, which
  // would take out the Save button entirely — no profile, no fill, no error the user
  // can see. Renaming a control without renaming its key is a one-character outage.
  const F = /const F = \[([^\]]*)\]/.exec(POPUP_JS);
  assert.ok(F, "popup.js's field list has moved");
  const keys = [...F[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length >= 8, "suspiciously short field list: " + keys.join(","));
  for (const k of keys) {
    assert.match(POPUP_HTML, new RegExp(`id=["']${k}["']`), `popup.html has no #${k}, but popup.js saves it`);
  }
});

test("the popup no longer carries the binary control that caused this", () => {
  assert.doesNotMatch(POPUP_HTML, /id=["']needsSponsorship["']/,
    "the binary Sponsorship? select is back — it cannot express F-1 or 'unanswered'");
});

/* ------------------------------------------------- the dashboard writes what it reads */

test("the dashboard's collectProfile writes the keys content.js reads", () => {
  const block = /function collectProfile\(\)\{[\s\S]*?\n\}/.exec(DASH);
  assert.ok(block, "collectProfile() has moved");
  for (const k of ["name", "email", "phone", "school", "major", "minor", "gradDate", "workAuth", "linkedin"]) {
    assert.match(block[0], new RegExp(`\\b${k}\\s*:`), `collectProfile() no longer writes ${k}`);
  }
  // It must NOT write the boolean directly any more — that is what got it wrong.
  assert.doesNotMatch(block[0], /needsSponsorship\s*:/,
    "collectProfile() is comparing its way to needsSponsorship again; derive it via sponsorshipFlag()");
});
