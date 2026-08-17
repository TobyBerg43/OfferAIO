/* OfferAIO targets undergraduates going into their junior and senior years.
 *
 * A graduate-only posting on the board is not a harmless extra. The free tier is 50
 * submissions a month, so every req the user cannot be hired for is one of those fifty
 * spent — and §16's argument is that offering what you cannot deliver is worse than
 * offering nothing. Measured 2026-08-17, straight after board discovery (§24) took the
 * board to 1,806 rows: 205 graduate-only rows, 155 of them the same "Pharmacy Intern - Grad"
 * req from one employer.
 *
 * Two things are tested here, and the second is the one that rots:
 *   1. the rule itself, over the real cases from the live board;
 *   2. that `scrape.js` and `OfferAIO.html` still agree. The dashboard re-filters whatever
 *      listings.json contains, so it carries its own copy of the rule — and a duplicated
 *      rule with no test comparing the copies is a rule that is already drifting.
 *
 * Run: node --test tests/undergrad.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isUndergrad, isIntern } = require("../scrape.js");

const root = new URL("../", import.meta.url);
const HTML = fs.readFileSync(new URL("OfferAIO.html", root), "utf8");

/* Lift the dashboard's own copy out of the inline <script>, the way category.test.mjs does,
   so this compares the shipped function rather than a restatement of it. */
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > -1, `${name}() is missing from OfferAIO.html`);
  let i = src.indexOf("{", start), depth = 0, end = -1;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) { end = j + 1; break; }
  }
  assert.ok(end > -1, `could not find the end of ${name}()`);
  return src.slice(start, end);
}
const ctx = vm.createContext({});
vm.runInContext(extractFn(HTML, "isUndergradTitle") + "; this.dash = isUndergradTitle;", ctx);
const dashboardRule = ctx.dash;

/* Real titles, taken from the live board on 2026-08-17. */
const OPEN_TO_UNDERGRADS = [
  /* ⚠️ The override, and the reason this is not just a list of banned words. This names a
     bachelor's path alongside graduate ones and is open to exactly our user. A rule that
     only looked for "PhD" would throw it away. */
  "Research Intern (BS/MS/PhD)",
  "Data Science Intern (BS or MS)",
  "Undergraduate Research Intern",
  "Summer 2027 Finance Intern",
  "2027 Investment Banking Summer Analyst",
  "Software Engineer Intern",
  "Accounting Intern",
  "2027 Summer Intern - Finance & Accounting Analyst",
  "Internship - Commissions & Advisory Billing",
  /* "Master" as a job word, not a degree — these must survive. */
  "Master Data Management Intern",
  "Scrum Master Intern",
];

const GRADUATE_ONLY = [
  "Pharmacy Intern - Grad",
  "Pharmacy Intern",
  "Foreign Pharmacy Grad - International Pharmacy Intern",
  "MBA Intern, Marketing - Summer 2027",
  "Finance Intern (MBA - Austin, TX)",
  "Quantitative Research Intern (PhD) - Summer 2027",
  "Software Developer - Ph.D. Intern - New York - Summer 2027",
  "Machine Learning PhD Software Engineer Intern",
  "Quantitative Systematic Trading Intern - Master's: Summer 2027",
  "Software Engineering Intern, Masters",
  "Summer 2027 Actuarial Science Graduate Intern",
  "Graduate Intern - Statistical Analysis",
  "Master's Level Internship - Macro MSW Leadership",
  "Summer 2027 Graduate Engineer Internship",
  "2027 Quantitative Analytics Summer Internship Capital Markets (PhD) – Early Careers",
  /* Not graduate, but equally not our user. */
  "HCAD Intern- High School",
];

test("postings open to undergraduates are kept", () => {
  for (const t of OPEN_TO_UNDERGRADS) assert.ok(isUndergrad(t), `wrongly dropped: ${t}`);
});

test("graduate-only and high-school postings are dropped", () => {
  for (const t of GRADUATE_ONLY) assert.ok(!isUndergrad(t), `wrongly kept: ${t}`);
});

/* "Undergraduate" contains "graduate". If \bgrad… ever loses its word boundary, this rule
   inverts precisely where it matters most and every undergraduate posting disappears. */
test("'undergraduate' is never read as 'graduate'", () => {
  for (const t of ["Undergraduate Intern", "Undergraduate Student Researcher Intern", "undergrad intern"]) {
    assert.ok(isUndergrad(t), t);
  }
});

test("the filter runs inside isIntern, so every source is covered", () => {
  /* Phase 1 feeds and Phase 2 boards both funnel through isIntern — applying this rule
     anywhere else would let one source in with weaker rules, which is §21a's bug. */
  assert.ok(!isIntern("MBA Intern, Marketing - Summer 2027"));
  assert.ok(!isIntern("Pharmacy Intern - Grad"));
  assert.ok(isIntern("2027 Investment Banking Summer Analyst"));
  assert.ok(isIntern("Research Intern (BS/MS/PhD)"));
});

test("the dashboard's copy of the rule agrees with the pipeline's", () => {
  const corpus = [
    ...OPEN_TO_UNDERGRADS, ...GRADUATE_ONLY,
    "Undergraduate Intern", "", "  ", "Intern",
    "Summer Analyst", "PhD", "MBA", "bachelor of science intern", "Grad Intern",
  ];
  for (const t of corpus) {
    assert.equal(
      dashboardRule(t), isUndergrad(t),
      `OfferAIO.html and scrape.js disagree about "${t}" — the two copies have drifted`,
    );
  }
});

test("the rule survives junk input", () => {
  for (const t of [undefined, null, "", 0, {}, []]) {
    assert.doesNotThrow(() => isUndergrad(t));
    assert.doesNotThrow(() => dashboardRule(t));
  }
});

/* The live board must not contain what this rule forbids — the check that would have caught
   155 pharmacy reqs sitting on a board aimed at finance undergraduates. */
test("no graduate-only row is on the live board", () => {
  const data = JSON.parse(fs.readFileSync(new URL("data/listings.json", root), "utf8"));
  const rows = (Array.isArray(data) ? data : data.listings).filter((r) => r.active !== false);
  const offenders = rows.filter((r) => !isUndergrad(r.title));
  assert.equal(
    offenders.length, 0,
    `${offenders.length} graduate-only rows on the board, e.g. ${offenders.slice(0, 3).map((r) => `"${r.title}"`).join(", ")}`,
  );
});
