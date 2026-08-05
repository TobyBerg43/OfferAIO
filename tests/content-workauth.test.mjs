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
