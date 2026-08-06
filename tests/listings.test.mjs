/* Tests for the listings pipeline's hygiene rules (scrape.js).
 *
 * Two things are being protected here, and they pull in opposite directions:
 *
 *  1. Deduplication has to be loose enough to collapse "Chicago, IL" against "Chicago,
 *     Illinois" and "… Intern" against "… Intern, Summer 2027" — 25 groups / 28 rows of
 *     the live board were redundant.
 *  2. It has to be tight enough NOT to collapse genuinely different roles. Wells Fargo
 *     titles everything "2027 <Function> Summer Internship – Early Careers", so a rule
 *     that strips from the first year onwards merges Audit, Finance, HR and Risk into a
 *     single row and silently deletes three real internships.
 *
 * And the .eu. case, which is the one a future pass is most likely to "fix" wrongly:
 * job-boards.eu.greenhouse.io and jobs.eu.lever.co carry US roles. The EU is the
 * company's ATS account region, not the job's location — IMC Trading is Amsterdam-
 * headquartered and hires in Chicago. Blocking the domain would delete seven IMC quant
 * roles, which are among the most valuable listings on the board.
 *
 * Run: node --test tests/listings.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../scrape.js", import.meta.url), "utf8");

/* scrape.js is a CommonJS script with a top-level IIFE that hits the network, so the
   pure helpers are lifted out by name rather than imported. If a helper is renamed this
   throws immediately instead of silently testing nothing. */
function lift(name) {
  const re = new RegExp(`(?:^|\\n)(?:const ${name} = [\\s\\S]*?;|function ${name}\\([\\s\\S]*?\\n\\})`, "m");
  const m = SRC.match(re);
  assert.ok(m, `helper ${name} not found in scrape.js — was it renamed?`);
  return m[0];
}

const helpers = ["normUrl", "normTitle", "normLoc", "normCompany", "dedupeKey", "richness", "NON_US_RE", "isUS"]
  .map(lift)
  .join("\n");
const { normTitle, normLoc, dedupeKey, richness, isUS, normUrl } = new Function(
  `${helpers}; return { normTitle, normLoc, dedupeKey, richness, isUS, normUrl };`,
)();

const row = (company, title, locations, extra = {}) => ({
  company_name: company, title, locations, url: `https://x/${title}`, ...extra,
});

/* ------------------------------------------------------------------ dedupe: collapse */

test("the same city written three ways is one city", () => {
  assert.equal(normLoc(["Chicago, IL"]), "chicago");
  assert.equal(normLoc(["Chicago, Illinois"]), "chicago");
  assert.equal(normLoc(["Chicago, United States"]), "chicago");
  assert.equal(normLoc(["Chicago"]), "chicago");
});

test("a trailing season suffix does not make a second role", () => {
  const a = row("Akuna Capital", "Software Engineer Intern, C++", ["Chicago, IL"]);
  const b = row("Akuna Capital", "Software Engineer Intern - C++, Summer 2027", ["Chicago, IL"]);
  assert.equal(dedupeKey(a), dedupeKey(b));
});

test("New York and New York, NY are one posting", () => {
  const a = row("Point72", "Quantitative Developer Intern", ["New York"]);
  const b = row("Point72", "Quantitative Developer Intern", ["New York, NY"]);
  assert.equal(dedupeKey(a), dedupeKey(b));
});

test("'Intern' and 'Internship' phrasings of one role collapse", () => {
  const a = row("Point72", "Quantitative Research Intern", ["New York, NY"]);
  const b = row("Point72", "Summer 2027 Quantitative Research Internship", ["New York, NY"]);
  assert.equal(dedupeKey(a), dedupeKey(b));
});

test("query strings and trailing slashes don't split one URL in two", () => {
  assert.equal(normUrl("https://x.com/job/1?src=rss"), normUrl("https://x.com/job/1/"));
});

/* ------------------------------------------------------- dedupe: must NOT collapse */

test("a leading year must not swallow the role — Wells Fargo's four internships stay four", () => {
  // Every one of these begins with "2027". A rule that strips from the year onwards
  // reduces all four to the same key and deletes three real internships.
  const titles = [
    "2027 Audit Summer Internship – Early Careers",
    "2027 Finance Summer Internship - Early Careers",
    "2027 Human Resources Internship – Early Careers",
    "2027 Corporate Risk Development Program Summer Internship (Core Risk) - Early Careers",
  ];
  const keys = new Set(titles.map((t) => dedupeKey(row("Wells Fargo", t, ["CHARLOTTE, NC"]))));
  assert.equal(keys.size, 4, "distinct Wells Fargo internships were merged");
});

test("different roles at one company in one city stay distinct", () => {
  const a = row("DRW", "Software Developer Intern", ["Chicago, IL"]);
  const b = row("DRW", "Quantitative Trading Analyst Intern", ["Chicago, IL"]);
  assert.notEqual(dedupeKey(a), dedupeKey(b));
});

test("the same role in two cities stays two postings", () => {
  const a = row("Tesla", "Software Engineer Intern", ["Palo Alto, CA"]);
  const b = row("Tesla", "Software Engineer Intern", ["Austin, TX"]);
  assert.notEqual(dedupeKey(a), dedupeKey(b));
});

test("normTitle keeps a title that is nothing but a season from becoming empty-equal", () => {
  // Two unrelated roles must not both normalise to "" and merge.
  assert.notEqual(
    dedupeKey(row("X", "Summer 2027 Intern", ["NY"])),
    dedupeKey(row("X", "Hardware Engineer Intern", ["NY"])),
  );
});

/* ------------------------------------------------------------------ richer row wins */

test("the row carrying more locations and a salary wins", () => {
  const thin = row("IMC", "Quant Trader Intern", ["Chicago"]);
  const rich = row("IMC", "Quant Trader Intern", ["Chicago, IL", "New York, NY"], {
    salary: "$120k", date_posted: 123, terms: ["Summer 2027"],
  });
  assert.ok(richness(rich) > richness(thin));
});

/* ------------------------------------------- .eu. hosts carry US roles — do not block */

test("US roles on EU ATS domains are kept — isUS reads the location, not the host", () => {
  // Exactly the rows on the live board, all US-based despite the .eu. URL.
  const euRows = [
    row("Cirrus Logic", "Embedded Software Test Engineer Intern", ["Austin, TX"]),
    row("IMC Trading", "Quantitative Trader Intern - Summer 2027", ["Chicago, United States"]),
    row("IMC Trading", "Hardware Engineer Intern - Summer 2027", ["Chicago, United States"]),
    row("Veeam Software", "Software Engineering Intern, Policy Engineering", ["San Jose, CA"]),
  ];
  for (const l of euRows) assert.equal(isUS(l), true, `${l.company_name} — ${l.title} was filtered out`);
});

test("the geographic filter is location-based only, never hostname-based", () => {
  // A guard against a future pass "fixing" the Veeam failure by blocking the domain.
  assert.ok(
    !/\.eu\.|job-boards\.eu|jobs\.eu/.test(SRC.replace(/^\s*\*.*$/gm, "")),
    "scrape.js appears to test an .eu. hostname — the EU domain is the company's ATS " +
      "region, not the job's location. Blocking it deletes 7 IMC Chicago quant roles.",
  );
});

test("a genuinely non-US posting is still rejected", () => {
  assert.equal(isUS(row("IMC Trading", "Quant Trader Intern", ["Amsterdam, Netherlands"])), false);
  assert.equal(isUS(row("Cirrus Logic", "Engineer Intern", ["Edinburgh, United Kingdom"])), false);
});

/* ---------------------------------------------- the live database, end to end */

test("deduping the live board leaves no duplicate groups and keeps all 10 .eu. rows", async (t) => {
  let rows;
  try {
    rows = JSON.parse(readFileSync(new URL("../data/listings.json", import.meta.url), "utf8"));
  } catch (e) {
    return t.skip("data/listings.json not present");
  }

  const eu = rows.filter((l) => /\.eu\./.test(l.url || ""));
  assert.ok(eu.length > 0, "expected EU-hosted rows in the fixture");
  for (const l of eu) {
    assert.equal(isUS(l), true, `EU-hosted US role dropped: ${l.company_name} — ${l.title}`);
  }

  // Apply the pipeline's own dedupe and confirm it converges.
  const seen = new Map();
  const out = [];
  for (const l of rows) {
    if (!isUS(l)) continue;
    const k1 = normUrl(l.url), k2 = dedupeKey(l);
    const at = seen.has(k1) ? seen.get(k1) : seen.has(k2) ? seen.get(k2) : -1;
    if (at >= 0) {
      if (richness(l) > richness(out[at])) out[at] = l;
      continue;
    }
    out.push(l);
    seen.set(k1, out.length - 1);
    seen.set(k2, out.length - 1);
  }

  const groups = new Map();
  for (const l of out) {
    const k = dedupeKey(l);
    groups.set(k, (groups.get(k) || 0) + 1);
  }
  const dupes = [...groups.values()].filter((c) => c > 1);
  assert.equal(dupes.length, 0, `${dupes.length} duplicate groups survived deduping`);

  // And the EU rows are still there afterwards.
  assert.equal(out.filter((l) => /\.eu\./.test(l.url || "")).length, eu.length,
    "deduping removed EU-hosted US roles");
});
