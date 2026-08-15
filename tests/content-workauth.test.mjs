/* Tests for the work-authorisation answers in extension/content.js.
 *
 * This is the highest-stakes logic in the product. Every one of these questions is a
 * legal declaration on someone's job application, and the previous implementation
 * answered a flat "Yes" to anything matching /authoriz|eligible to work|legally/ while
 * routing anything containing "sponsor" through needsSponsorship. On the extremely
 * common phrasing "Are you authorized to work in the US without sponsorship?" — which
 * contains BOTH — an international student was made to assert the opposite of the truth.
 *
 * The rule these tests pin down: answer only phrasings whose meaning is unambiguous, and
 * return NEEDS_USER for everything else so the field is left blank and highlighted.
 *
 * Run: node --test tests/content-workauth.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const SRC = readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");

/* content.js is an IIFE that boots against the DOM. Stub just enough that it loads:
   with every lookup returning null, buildBar() bails before touching anything real. */
function load() {
  const noop = () => {};
  const doc = {
    body: null,                       // -> takes the DOMContentLoaded branch, boot never runs
    head: { appendChild: noop },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, setAttribute: noop, appendChild: noop }),
    addEventListener: noop,
  };
  const sandbox = {
    self: {},
    document: doc,
    window: { addEventListener: noop },
    location: { hostname: "boards.greenhouse.io", pathname: "/acme/jobs/1" },
    setTimeout: noop,
    console,
  };
  createContext(sandbox);
  runInContext(SRC, sandbox);
  return sandbox.self.OfferAIOFields;
}

const F = load();
const { answerFor, NEEDS_USER } = F;

const domestic = { needsSponsorship: false, workAuth: "US Citizen" };
const pr = { needsSponsorship: false, workAuth: "Permanent Resident" };
const intl = { needsSponsorship: true, workAuth: "Requires sponsorship" };
const f1 = { needsSponsorship: true, workAuth: "F-1 (CPT/OPT)" };
const unknown = {}; // profile saved before the field existed

/* ⚠️ The four fixtures above describe profiles the product did not build.
 *
 * Until 2026-08-15 both profile UIs derived the boolean as
 * `needsSponsorship = (workAuth === "Requires sponsorship")`, so picking "F-1 (CPT/OPT)"
 * stored **false**, not the `true` the `f1` fixture assumes — and every dashboard select
 * defaulted to "US Citizen" with no blank option, so a user who never touched the control
 * stored a confident `false` too. These tests were green the whole time, because they
 * tested workAuthAnswer against a shape nothing produced. The fixtures below are what the
 * UIs actually stored, and they are the ones that matter. */
const f1AsStored = { needsSponsorship: false, workAuth: "F-1 (CPT/OPT)" };
const untouchedDashboard = { needsSponsorship: false, workAuth: "US Citizen" }; // never opened
const untouchedPopup = { needsSponsorship: false };                              // no workAuth at all

/* ---------------------------------------------- the bug that started this */

test('"authorized to work without sponsorship" is answered by need, not by the word sponsor', () => {
  const q = "Are you authorized to work in the US without sponsorship?";
  // The old code hit the /sponsor/ branch and returned "Yes" here — a false declaration.
  assert.equal(answerFor(q, intl), "No");
  assert.equal(answerFor(q, domestic), "Yes");
});

test("the same question in its other common phrasings", () => {
  for (const q of [
    "Are you legally authorized to work in the United States without sponsorship?",
    "Can you work in the U.S. without requiring sponsorship now or in the future?",
    "Are you eligible to work in the US without visa sponsorship?",
  ]) {
    assert.equal(answerFor(q, intl), "No", q);
    assert.equal(answerFor(q, domestic), "Yes", q);
  }
});

/* ---------------------------------------------------- requires-sponsorship */

test('"will you require sponsorship" is answered directly', () => {
  for (const q of [
    "Will you now or in the future require sponsorship for employment visa status?",
    "Do you need sponsorship to work in the United States?",
    "Will you require visa sponsorship?",
  ]) {
    assert.equal(answerFor(q, intl), "Yes", q);
    assert.equal(answerFor(q, domestic), "No", q);
  }
});

/* --------------------------------------------------- plain authorisation */

test("a plain authorisation question is answered only when the profile is unambiguous", () => {
  const q = "Are you legally authorized to work in the United States?";
  assert.equal(answerFor(q, domestic), "Yes");
  assert.equal(answerFor(q, pr), "Yes");
  // Someone who needs sponsorship may or may not be authorised right now. Not ours to say.
  assert.equal(answerFor(q, intl), NEEDS_USER);
});

test("F-1 is never auto-answered, even though CPT/OPT often does authorise work", () => {
  // The correct answer varies by question and by whether CPT is already approved.
  // Guessing right most of the time is not good enough on a legal declaration.
  assert.equal(answerFor("Are you legally authorized to work in the United States?", f1), NEEDS_USER);
});

/* ------------------------------------- the shapes the UIs really stored (2026-08-15) */

test("F-1 as the dashboard actually stored it is still never auto-answered", () => {
  // The bug: workAuth "F-1 (CPT/OPT)" derived needsSponsorship:false, and the
  // without-sponsorship branch reads the boolean alone — so this returned "Yes".
  // An F-1 student was made to declare they can work without sponsorship, which is
  // exactly the false declaration this whole file exists to prevent.
  for (const q of [
    "Are you authorized to work in the US without sponsorship?",
    "Will you now or in the future require sponsorship for employment visa status?",
    "Are you legally authorized to work in the United States?",
  ]) {
    assert.equal(answerFor(q, f1AsStored), NEEDS_USER, q);
  }
});

test("a default nobody chose is not an answer", () => {
  // setWorkAuth had no blank option and defaulted to "US Citizen"; the popup's
  // "Sponsorship?" select defaulted to "No". Neither is something the user said.
  // A stored `false` is only trusted when an explicit work-auth selection backs it.
  for (const q of [
    "Are you authorized to work in the US without sponsorship?",
    "Are you legally authorized to work in the United States?",
  ]) {
    assert.equal(answerFor(q, untouchedPopup), NEEDS_USER, q);
  }
});

test("an explicit citizen or permanent resident selection is still answered", () => {
  // The fix must not make the product useless for the majority case it can answer.
  assert.equal(answerFor("Are you authorized to work in the US without sponsorship?", domestic), "Yes");
  assert.equal(answerFor("Are you legally authorized to work in the United States?", pr), "Yes");
  assert.equal(answerFor("Will you require visa sponsorship?", domestic), "No");
});

test("a profile with no sponsorship answer never guesses", () => {
  assert.equal(answerFor("Are you legally authorized to work in the US?", unknown), NEEDS_USER);
  assert.equal(answerFor("Will you require sponsorship?", unknown), NEEDS_USER);
  assert.equal(answerFor("Are you authorized to work without sponsorship?", unknown), NEEDS_USER);
});

/* ------------------------------------------------------------- fall-through */

test("unusual visa phrasings are left for the user rather than guessed", () => {
  for (const q of [
    "What is your current visa status?",
    "Which visa do you hold?",
    "Are you a citizen of a country covered by the E-3 visa program?",
  ]) {
    assert.equal(answerFor(q, intl), NEEDS_USER, q);
    assert.equal(answerFor(q, domestic), NEEDS_USER, q);
  }
});

test("unrelated fields are unaffected", () => {
  const p = { ...domestic, linkedin: "linkedin.com/in/x", gradDate: "May 2028", gpa: "3.8",
              school: "State University", major: "Finance", minor: "" };
  assert.equal(answerFor("LinkedIn profile", p), "linkedin.com/in/x");
  assert.equal(answerFor("Expected graduation date", p), "May 2028");
  assert.equal(answerFor("GPA", p), "3.8");
  assert.equal(answerFor("School", p), "State University");
  assert.equal(answerFor("How did you hear about us?", p), "Company website");
  assert.equal(answerFor("Favourite colour", p), null);
});
