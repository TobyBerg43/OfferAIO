/* answerFor()'s test chain is order-sensitive, and getting the order wrong puts a
 * confident wrong answer on somebody's job application.
 *
 * ⚠️ Found on a live form, not in a test. On 2026-08-16 a real fill against DRW's
 * Greenhouse postings (Strategy Intern and Leadership Rotation Network Intern) answered
 *
 *     "Please confirm when you will complete your university studies."
 *
 * with **"Indiana University"**. The label contains the word "university", and the
 * school test sat above any test for a date, so a WHEN question was answered with a
 * WHERE. It reproduced on both postings.
 *
 * That is §7 rule 4's failure by another route. Rule 4 stops a label from binding to the
 * wrong control; this bound the right control to the wrong answer. The consequence is
 * identical and it is the one this project cares most about: something untrue, in the
 * user's name, on a form an employer reads.
 *
 * §7 rule 1 already documents an ordering trap in this same function ("without sponsor"
 * must be tested before "requires sponsor"). This file exists so the chain's order is
 * covered by something other than a comment.
 *
 * Run: node --test tests/content-fieldorder.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const SRC = readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");

/* Same stub as content-workauth.test.mjs: with every lookup null, boot never runs. */
function load() {
  const noop = () => {};
  const doc = {
    body: null,
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

const { answerFor, NEEDS_USER } = load();

/* Toby Berger's real profile shape, which is what found the bug. */
const P = {
  name: "Toby Berger",
  email: "tobybergerbusiness@gmail.com",
  phone: "(201) 284-0149",
  school: "Indiana University",
  major: "Economics",
  minor: "Finance",
  gradDate: "2028",
  needsSponsorship: false,
  workAuth: "US Citizen",
};

/* ------------------------------------------- the regression, in the words that caused it */

test("a WHEN question is never answered with the school name", () => {
  const whenQuestions = [
    "Please confirm when you will complete your university studies.",
    "When will you complete your university studies?",
    "When do you expect to complete your degree?",
    "Expected graduation date",
    "Anticipated completion date of your college program",
    "Date you will finish your studies",
  ];
  for (const q of whenQuestions) {
    const a = answerFor(q, P);
    assert.notEqual(
      a,
      P.school,
      `"${q}" was answered with the school name — this is the DRW bug back`,
    );
    assert.equal(a, P.gradDate, `"${q}" should be answered with the grad date`);
  }
});

test("a WHERE question is still answered with the school name", () => {
  for (const q of ["School*", "University", "College attended", "Institution name"]) {
    assert.equal(answerFor(q, P), P.school, q);
  }
});

test("with no grad date stored, a WHEN question is handed back rather than guessed", () => {
  const noDate = { ...P, gradDate: "" };
  assert.equal(
    answerFor("Please confirm when you will complete your university studies.", noDate),
    NEEDS_USER,
    "an unanswerable date question must be flagged, not filled with whatever is nearby",
  );
});

/* ------------------------------------------------- the fields the DRW forms left empty */

test("Greenhouse's education block wording maps to the major", () => {
  for (const q of ["Discipline*", "Field of Study", "Course of study", "Major"]) {
    assert.equal(answerFor(q, P), P.major, q);
  }
});

test("a name asked as a custom question is answered", () => {
  // Greenhouse names these question_<id>, so fill()'s SEL.first/SEL.last cannot see them
  // and "Legal First Name*" sat empty and required on both DRW forms.
  assert.equal(answerFor("Legal First Name*", P), "Toby");
  assert.equal(answerFor("Legal Last Name*", P), "Berger");
  assert.equal(answerFor("Given name", P), "Toby");
  assert.equal(answerFor("Surname", P), "Berger");
  assert.equal(answerFor("Family Name", P), "Berger");
});

test("a multi-part surname stays whole, and matches how fill() splits it", () => {
  const p = { ...P, name: "Ada King van der Lovelace" };
  assert.equal(answerFor("First Name", p), "Ada");
  assert.equal(answerFor("Last Name", p), "King van der Lovelace");
});

test("a one-word name does not invent a surname", () => {
  const p = { ...P, name: "Prince" };
  assert.equal(answerFor("First Name", p), "Prince");
  assert.equal(answerFor("Last Name", p), null, "an absent surname must be null, not ''");
});

/* ------------------------------------------------------ the order itself, stated plainly */

test("work authorisation still wins over every other test", () => {
  // §7 rule 1. These contain "date"/"when"-adjacent words in real forms; the work-auth
  // branch must still claim them, and must still decline the ambiguous ones.
  assert.equal(answerFor("Are you legally authorized to work in the United States?*", P), "Yes");
  assert.equal(
    answerFor("Will you now or in the future require sponsorship for employment?", P),
    "No",
  );
  const f1 = { ...P, workAuth: "F-1 (CPT/OPT)", needsSponsorship: undefined };
  delete f1.needsSponsorship;
  assert.equal(
    answerFor("Are you authorized to work in the US without sponsorship?", f1),
    NEEDS_USER,
    "F-1 must still be handed back — §7 rule 1 and §18",
  );
});

test("a visa question is never answered from the profile", () => {
  // This is what actually paused full-auto on the live DRW form, correctly.
  assert.equal(
    answerFor("Please provide visa status and expiration if applicable.", P),
    NEEDS_USER,
  );
});

test("GPA and LinkedIn are not displaced by the new date test", () => {
  assert.equal(answerFor("Please list your most recent cumulative GPA.*", P), undefined);
  assert.equal(answerFor("LinkedIn Profile", P), undefined);
  // Both are absent from this profile, so they read as "nothing to give" rather than
  // being answered with something adjacent.
  const withBoth = { ...P, gpa: "3.8", linkedin: "linkedin.com/in/x" };
  assert.equal(answerFor("Please list your most recent cumulative GPA.*", withBoth), "3.8");
  assert.equal(answerFor("LinkedIn Profile", withBoth), "linkedin.com/in/x");
});

test("an unrecognised question is left alone", () => {
  for (const q of ["Gender", "Veteran Status", "Why do you want to work here?", ""]) {
    assert.equal(answerFor(q, P), null, q);
  }
});
