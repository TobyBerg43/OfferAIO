/* discover-boards.mjs now owns companies.json, so its parsing and filtering decide what the
 * whole pipeline enumerates. These are the pure parts — no network. Liveness against the
 * real APIs is the script's own job at run time (§24b); asserting it here would make the
 * suite fail on someone else's outage and teach everyone to ignore a red build.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { boardFromUrl, boardKey, looksInternal, plausibleSlug } from "../discover-boards.mjs";

const require = createRequire(import.meta.url);
const { termsFor, isIntern } = require("../scrape.js");

test("board identity is parsed from every host form the four ATSes serve", () => {
  const cases = [
    ["https://job-boards.greenhouse.io/anthropic/jobs/4012", { ats: "greenhouse", slug: "anthropic" }],
    ["https://boards.greenhouse.io/stripe", { ats: "greenhouse", slug: "stripe" }],
    /* The embed form carries the board in ?for=, not in the path — reading the path would
       file every embedded board on earth under the slug "embed". */
    ["https://boards.greenhouse.io/embed/job_app?for=acme&token=9", { ats: "greenhouse", slug: "acme" }],
    ["https://jobs.lever.co/scaleai/abc-123", { ats: "lever", slug: "scaleai" }],
    ["https://jobs.ashbyhq.com/ramp/uuid-1", { ats: "ashby", slug: "ramp" }],
    /* EU instances carry US roles — §15. */
    ["https://job-boards.eu.greenhouse.io/eucorp/jobs/9", { ats: "greenhouse", slug: "eucorp" }],
    ["https://jobs.eu.lever.co/eufirm/x", { ats: "lever", slug: "eufirm" }],
  ];
  for (const [url, want] of cases) {
    assert.deepEqual(boardFromUrl(url), want, url);
  }
});

test("a workday url yields host, tenant and site", () => {
  const b = boardFromUrl("https://ms.wd5.myworkdayjobs.com/en-US/External/job/New-York/Thing_R2");
  assert.deepEqual(b, {
    ats: "workday", host: "ms.wd5.myworkdayjobs.com", tenant: "ms", site: "External",
  });
});

/* ⚠️ The §23 harvester skipped locale segments with /^[a-z]{2}([-_][A-Z]{2})?$/, which also
   skips a REAL site named "nw" (Nightwing's, 329 live jobs) and silently files the board
   under whatever segment came next. Only the region-suffixed form is a locale. */
test("a two-letter site is kept; only a region-suffixed locale is skipped", () => {
  assert.equal(boardFromUrl("https://nwis.wd12.myworkdayjobs.com/en-US/nw/job/Foo_R1").site, "nw");
  assert.equal(boardFromUrl("https://x.wd1.myworkdayjobs.com/en_US/Careers/job/Y").site, "Careers");
  assert.equal(boardFromUrl("https://x.wd1.myworkdayjobs.com/fr-CA/Careers/job/Y").site, "Careers");
});

test("non-ATS urls yield nothing", () => {
  for (const u of ["https://example.com/careers", "https://careers.amd.com/jobs", "not a url", ""]) {
    assert.equal(boardFromUrl(u), null, u);
  }
});

test("the board is the identity, not the company", () => {
  /* HP runs a US and an EU board on one host and both are real (§23e). */
  const us = { ats: "workday", host: "hp.wd5.myworkdayjobs.com", site: "ExternalCareerSite" };
  const eu = { ats: "workday", host: "hp.wd5.myworkdayjobs.com", site: "exteu-ac-careersite" };
  assert.notEqual(boardKey(us), boardKey(eu));
  /* Case differences are the same board, not two — §21e had to drop case-duplicate slugs. */
  assert.equal(boardKey({ ats: "greenhouse", slug: "Gumloop" }), boardKey({ ats: "greenhouse", slug: "gumloop" }));
});

test("internal and talent-pool boards are refused", () => {
  const internal = ["Private_Posting_No_TMP", "Privileged", "sourcer_on_req", "redeployment",
    "Cadastro-de-Candidatos", "confidential_exec", "talent_pool"];
  for (const site of internal) {
    assert.ok(looksInternal({ ats: "workday", site }), `${site} should be refused`);
  }
  /* Real boards that merely contain a scary substring must survive. */
  for (const site of ["External", "nw", "Campus_Careers", "University-Hires", "Internships"]) {
    assert.ok(!looksInternal({ ats: "workday", site }), `${site} should be kept`);
  }
});

test("a slug that could not survive a url is refused", () => {
  for (const s of ["a/b", "x?y", "", "  ", "-leading", null, undefined]) assert.ok(!plausibleSlug(s), String(s));
  for (const s of ["anthropic", "geocomply-2", "tahoebio-ai", "1800contacts"]) assert.ok(plausibleSlug(s), s);
});

/* ⚠️ listing() hard-coded terms:["Summer 2027"] on every Phase 2 row. At 206 curated boards
   that was roughly true; at 2,015 it was not — 759 of 1,153 rows carried no year at all and
   were being labelled Summer 2027 on the user's board anyway (§24c). */
test("a posting claims a season only when it states one", () => {
  assert.deepEqual(termsFor("Summer 2027 Internship - Finance"), ["Summer 2027"]);
  assert.deepEqual(termsFor("2027 Investment Banking Summer Analyst"), ["Summer 2027"]);
  assert.deepEqual(termsFor("Accounting Intern"), []);
  assert.deepEqual(termsFor("Software Engineer Intern"), []);
  assert.deepEqual(termsFor(undefined), []);
});

test("an unstated season is still an intern role worth listing", () => {
  /* The honest empty terms must not cost the row its place: both the dashboard filter and
     parseSimplifySchema keep rows that state no term. If this ever inverts, 733 real
     postings vanish from the board. */
  assert.ok(isIntern("Accounting Intern"));
  assert.deepEqual(termsFor("Accounting Intern"), []);
});
