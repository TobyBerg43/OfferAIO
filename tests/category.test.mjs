/* catForTitle() must not use Software Engineering as a dumping ground.
 *
 * Until 2026-08-16 the last line of catForTitle() was `return 'swe'`, so every title that
 * matched none of the nine rules above it was labelled Software Engineering. Measured
 * against the 387-row live board: 73.4% of all listings landed in that one bucket, and 49
 * of those rows contained no engineering or tech word at all — Wells Fargo's Human
 * Resources internship, Marsh McLennan's Insurance req, Oliver Wyman's Actuarial
 * programme, Commercial Banking, Wealth Management, Corporate Risk.
 *
 * "Pick your lanes" is the feature that broke. A student who selects Software Engineering
 * and is handed an insurance req has been told something false about the board, and it is
 * the §16 problem in another costume: a confident wrong answer where an honest "Other"
 * would do.
 *
 * Like ats-manifest and dashboard-canfill, this is a consistency test — it reads
 * OfferAIO.html and data/listings.json off disk and asserts the repo agrees with itself.
 *
 * Run: node --test tests/category.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), "utf8");
const HTML = read("OfferAIO.html");

/* ---- lift the real function and the real label map out of the inline <script> ---- */
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name}() is gone from OfferAIO.html — this test is stale`);
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error(`unbalanced braces in ${name}()`);
}

const ctx = {};
vm.createContext(ctx);
vm.runInContext(extractFn(HTML, "catForTitle"), ctx);
const catForTitle = (t) => vm.runInContext("catForTitle", ctx)(t);

const CAT_KEYS = (() => {
  const m = HTML.match(/const CATS = \{([\s\S]*?)\n\};/);
  assert.ok(m, "could not find the CATS map in OfferAIO.html");
  return [...m[1].matchAll(/^\s*([a-z]+)\s*:\s*\{/gm)].map((x) => x[1]);
})();

const LIVE = JSON.parse(read("data/listings.json")).filter((r) => r && r.active !== false);

/* Any word that would justify the Software Engineering label. Deliberately generous: the
   test is looking for rows with NO engineering signal whatsoever, so a false negative here
   weakens the assertion rather than causing a spurious failure. */
const TECH =
  /software|\bswe\b|engineer|developer|programm|coding|front.?end|back.?end|full.?stack|mobile|\bios\b|android|devops|infrastructure|platform|computer scien|technolog|technical|cyber|security|cloud|systems|hardware|firmware|robotic|\bqa\b|\bsre\b|\bdata\b|\bit\b|network|linux|windows|compiler|gameplay|graphics/i;

/* --------------------------------------------------- the labels are real labels */

test("every category catForTitle can return exists in CATS", () => {
  const returned = new Set(LIVE.map((r) => catForTitle(r.title)));
  returned.add(catForTitle("something that matches absolutely nothing at all"));
  for (const key of returned) {
    assert.ok(
      CAT_KEYS.includes(key),
      `catForTitle returned "${key}", which has no entry in CATS — the chip would render the raw key`,
    );
  }
});

test("there is an explicit Other category, so nothing has to be mislabelled", () => {
  assert.ok(CAT_KEYS.includes("other"), "CATS needs an 'other' bucket");
  assert.equal(
    catForTitle("Summer 2027 Internship"),
    "other",
    "a title with no signal at all must say other, not swe",
  );
});

/* ------------------------------------------- the 49 rows that used to be wrong */

test("non-technical roles are not labelled Software Engineering", () => {
  const cases = [
    ["Summer 2027 Intern - Insurance", "risk"],
    ["Oliver Wyman Actuarial - Internship - Summer 2027", "risk"],
    ["2027 Corporate Risk Development Program Summer Internship", "risk"],
    ["2027 COO Business Risk Control and Regulatory Oversight Summer Internship", "risk"],
    ["2027 Human Resources Internship – Early Careers", "hr"],
    ["2027 Commercial Banking Summer Internship – Early Careers", "finance"],
    ["2027 Consumer Banking and Lending Summer Internship", "finance"],
    ["2027 Wealth & Investment Management Summer Internship", "finance"],
    ["2027 Global Payments & Liquidity Internship", "finance"],
    ["2027 Finance Summer Internship - Early Careers", "finance"],
    ["Fundamental Research Analyst Intern", "finance"],
  ];
  for (const [title, want] of cases) {
    assert.equal(catForTitle(title), want, `"${title}" should be ${want}`);
  }
});

test("the whole live board yields no Software Engineering row without a tech word", () => {
  const bogus = LIVE.filter((r) => catForTitle(r.title) === "swe" && !TECH.test(r.title));
  assert.deepEqual(
    bogus.map((r) => `${r.company_name} — ${r.title}`),
    [],
    "these rows are labelled Software Engineering with nothing technical in the title",
  );
});

/* ------------------------------------------------ swe is a category, not a default */

test("Software Engineering is not a majority of the board", () => {
  const swe = LIVE.filter((r) => catForTitle(r.title) === "swe").length;
  const share = swe / LIVE.length;
  // It was 73.4% when swe was the fallback. A real board of Summer 2027 internships is
  // tech-heavy but not three-quarters software, and a regression to the old fallback
  // shows up here first.
  assert.ok(
    share < 0.6,
    `Software Engineering holds ${(share * 100).toFixed(1)}% of the board (${swe}/${LIVE.length}) — that reads like a fallback, not a category`,
  );
});

test("the board spreads over many categories, and no single one swallows it", () => {
  const counts = {};
  for (const r of LIVE) counts[catForTitle(r.title)] = (counts[catForTitle(r.title)] || 0) + 1;
  const used = Object.keys(counts).length;
  assert.ok(used >= 8, `only ${used} categories are ever produced across ${LIVE.length} rows`);
  const biggest = Math.max(...Object.values(counts));
  assert.ok(
    biggest < LIVE.length * 0.6,
    "one category holds most of the board, which is what a broken classifier looks like",
  );
});

test("'other' is a small remainder, not the new dumping ground", () => {
  const other = LIVE.filter((r) => catForTitle(r.title) === "other").length;
  assert.ok(
    other / LIVE.length < 0.2,
    `'other' holds ${((other / LIVE.length) * 100).toFixed(1)}% of the board — the rules above it are too narrow`,
  );
});

/* ------------------------------------------------------- the ordering invariants */

test("colliding titles resolve to the more specific category", () => {
  // Each of these matches two or more rules. They invert if the rules are reordered, which
  // is the same class of bug as §7 rule 1's "without sponsorship" ordering.
  const collisions = [
    ["Trading Desk Operations Engineer Intern", "quant", "trading beats operations and engineer"],
    ["Sales and Trading Intern", "quant", "trading beats sales"],
    ["Markets - Quantitative Analysis, Summer Analyst", "quant", "quant beats summer analyst"],
    ["2027 Corporate Risk Development Program", "risk", "risk beats developer-ish wording"],
    ["Data Engineering Intern", "data", "data engineering is data, not swe"],
    ["Machine Learning Researcher - Intern", "ai", "ML beats research"],
    ["Product Designer, Internship - US Government", "product", "product design is product"],
    ["Hardware Engineer (FPGA) Intern", "hardware", "FPGA beats the bare engineer test"],
    ["Electrical Engineer Intern", "hardware", "electrical engineer is not software"],
    ["Intern - DRAM PI", "hardware", "DRAM is semiconductor work"],
    ["Software Engineering Intern", "swe", "and plain software still lands on swe"],
  ];
  for (const [title, want, why] of collisions) {
    assert.equal(catForTitle(title), want, `${why} — "${title}"`);
  }
});

test("catForTitle survives junk input without throwing", () => {
  for (const bad of [undefined, null, "", 0, "   "]) {
    assert.ok(CAT_KEYS.includes(catForTitle(bad)), `catForTitle(${String(bad)}) must still return a real key`);
  }
});
