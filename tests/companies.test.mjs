/* companies.json is the pipeline's only hand-maintained input, and nothing checked it.
 *
 * §21d found 29 of 56 Workday boards had been returning 422/404 "for an unknown length of
 * time" — ~87 wasted requests every six hours, and enough log noise to hide a real failure.
 * A board dies quietly: `scrape.js` catches the error, contributes nothing, and the run
 * still reports success. So the cost of a bad row here is not a crash, it is months of
 * silence, which is precisely the failure mode a consistency test catches and a comment
 * does not.
 *
 * This asserts the SHAPE of every row, not its liveness — a network test would fail on a
 * flaky morning and teach everyone to ignore it. Liveness is `audit-listings.mjs` (§22).
 *
 * ⚠️ Two invariants that look obvious are deliberately NOT asserted, because real rows
 * disprove them. Both were checked against the live API before being ruled out:
 *   - "host starts with tenant" — Wells Fargo is tenant `wf` on host `wellsfargo.wd1…`
 *     and answers with 1,618 jobs. Workday's tenant id and its subdomain are independent.
 *   - "names are unique" — HP has two real boards, a US one and an EU one, on the same
 *     host with different sites. The board is the identity here, not the company.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const companies = JSON.parse(readFileSync(join(root, "companies.json"), "utf8"));
const require = createRequire(import.meta.url);
const scrape = require(join(root, "scrape.js"));

/* The ATSes scrape.js can actually enumerate. An `ats` outside this set is a row that will
   never be fetched by anything — a silent no-op rather than an error. */
const ENUMERABLE = new Set(["greenhouse", "lever", "ashby", "workday"]);

test("companies.json is a non-empty array", () => {
  assert.ok(Array.isArray(companies));
  assert.ok(companies.length > 100, `only ${companies.length} boards`);
});

test("every row has a name and an ats the pipeline can enumerate", () => {
  for (const [i, c] of companies.entries()) {
    assert.ok(c.name && typeof c.name === "string", `row ${i}: missing name`);
    assert.ok(ENUMERABLE.has(c.ats), `${c.name}: ats "${c.ats}" is not enumerable`);
  }
});

test("every workday row carries host, tenant and site", () => {
  for (const c of companies.filter((x) => x.ats === "workday")) {
    for (const k of ["host", "tenant", "site"]) {
      assert.ok(c[k] && typeof c[k] === "string", `${c.name}: missing ${k}`);
      assert.ok(!/^\s|\s$/.test(c[k]), `${c.name}: ${k} has surrounding whitespace`);
    }
    assert.match(c.host, /\.myworkdayjobs\.com$/, `${c.name}: host is not a Workday host`);
    assert.ok(!c.host.includes("/"), `${c.name}: host must be a bare hostname`);
  }
});

test("every non-workday row carries a slug", () => {
  for (const c of companies.filter((x) => x.ats !== "workday")) {
    assert.ok(c.slug && typeof c.slug === "string", `${c.name}: missing slug`);
    assert.ok(!c.slug.includes("/"), `${c.name}: slug must not be a path`);
  }
});

/* A Workday posting URL is /{locale}/{site}/job/… and the locale segment is easy to mistake
   for the site slug when harvesting URLs (§21e). A row whose site is "en-US" builds a URL
   that 404s on every run, and looks perfectly reasonable in a diff.
   ⚠️ Match only the region-suffixed form Workday actually puts in a path. A bare two-letter
   slug is NOT a locale: Nightwing's site is genuinely "nw" and answers with 329 jobs, and
   the first version of this test failed on it. */
test("no workday site is a locale segment or a job path", () => {
  for (const c of companies.filter((x) => x.ats === "workday")) {
    assert.doesNotMatch(c.site, /^[a-z]{2}[-_][A-Za-z]{2}$/, `${c.name}: site "${c.site}" is a locale`);
    assert.notEqual(c.site.toLowerCase(), "job", `${c.name}: site is "job"`);
  }
});

/* §21e dropped recruiter-only and existing-staff boards after harvesting them: they answer
   the API perfectly and carry nothing a student can apply to. */
test("no internal-only boards", () => {
  const INTERNAL = /(^|[_-])(private|redeployment|sourcer_on_req|internal)([_-]|$)/i;
  for (const c of companies.filter((x) => x.ats === "workday")) {
    assert.doesNotMatch(c.site, INTERNAL, `${c.name}: "${c.site}" looks like an internal board`);
  }
});

/* Two rows pointing at one board double its request cost and duplicate every posting it
   carries, which the URL-first dedupe then has to clean up downstream (§21b). */
test("no two rows describe the same board", () => {
  const seen = new Map();
  for (const c of companies) {
    const key = c.ats === "workday"
      ? `workday|${c.host}|${c.site}`.toLowerCase()
      : `${c.ats}|${c.slug}`.toLowerCase();
    assert.ok(!seen.has(key), `duplicate board ${key}: "${c.name}" and "${seen.get(key)}"`);
    seen.set(key, c.name);
  }
});

/* The recovered boards of §21d/§23 are the reason this file is worth testing; assert the
   pipeline can still see them as the finance-lane coverage they were added for. */
test("scrape.js exports the predicate these boards are filtered by", () => {
  assert.equal(typeof scrape.isIntern, "function");
  /* Investment-banking programmes are called "Summer Analyst", not "intern" — a finance
     user's whole lane depends on that alternation staying in INTERN_RE. */
  assert.ok(scrape.isIntern("2027 Investment Banking Summer Analyst"));
  assert.ok(scrape.isIntern("Summer 2027 Internship - Finance"));
  assert.ok(!scrape.isIntern("Investment Banking Analyst Program 2027"), "full-time analyst is not an internship");
});
