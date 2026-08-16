/* Phase 1's feeds and their parsers.
 *
 * ⚠️ Why this file exists. `communityListings()` used to take the FIRST reachable source and
 * `return`. vanshb03 is reachable, so SimplifyJobs — the largest Summer 2027 list there is —
 * sat in COMMUNITY_SOURCES for weeks and **was never once read**. Nothing failed, nothing
 * logged, and the board was missing 291 listings. A fallback chain and a merge look almost
 * identical in code and are completely different in effect.
 *
 * Two of the four parsers are also structurally fragile: one reads a CSV, one reads a
 * markdown table maintained by strangers. A parser aimed at a format that has moved on does
 * not throw — it returns rows with the columns shifted, and every junk row becomes a posting
 * the product advertises and the user cannot open. That is the failure this file guards.
 *
 * Run: node --test tests/feeds.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const S = require("../scrape.js"); // safe: main is behind require.main === module
const SRC = readFileSync(new URL("../scrape.js", import.meta.url), "utf8");

/* ------------------------------------------------------- the feeds are a merge */

test("there is more than one feed, and every one is fetched", () => {
  assert.ok(S.COMMUNITY_FEEDS.length >= 2, "a single feed is a single point of failure");
  // The bug was structural: a `return` inside the loop over sources. Assert the aggregator
  // gathers every feed rather than stopping at the first.
  const fn = SRC.slice(SRC.indexOf("async function communityListings"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.ok(
    /Promise\.all\(COMMUNITY_FEEDS\.map/.test(body),
    "communityListings must fan out over every feed, not fall back through them",
  );
  assert.ok(
    !/\breturn\b[\s\S]*?COMMUNITY_FEEDS/.test(body.split("Promise.all")[0]),
    "nothing may return before the fan-out — that is the bug this file exists for",
  );
});

test("every feed is well formed", () => {
  for (const f of S.COMMUNITY_FEEDS) {
    assert.ok(f.name, "a feed needs a name — it is what lands in bySource");
    assert.ok(Array.isArray(f.mirrors) && f.mirrors.length, `${f.name}: needs at least one mirror`);
    f.mirrors.forEach((u) => assert.match(u, /^https:\/\//, `${f.name}: mirrors must be https`));
    assert.equal(typeof f.parse, "function", `${f.name}: needs a parser`);
  }
  const names = S.COMMUNITY_FEEDS.map((f) => f.name);
  assert.equal(new Set(names).size, names.length, "feed names must be unique for bySource to mean anything");
});

test("the feeds that matter are still wired up", () => {
  const names = S.COMMUNITY_FEEDS.map((f) => f.name);
  // SimplifyJobs is the one that was silently unread. Losing it again is the regression.
  assert.ok(names.includes("SimplifyJobs"), "SimplifyJobs is the largest feed — do not drop it");
  assert.ok(names.includes("vanshb03"));
});

/* --------------------------------------------------------- the Simplify schema */

test("parseSimplifySchema keeps live 2027 rows and drops the rest", () => {
  const rows = S.parseSimplifySchema([
    { company_name: "Acme", title: "Software Engineer Intern", url: "https://boards.greenhouse.io/acme/jobs/1", terms: ["Summer 2027"], active: true },
    { company_name: "Acme", title: "Software Engineer Intern", url: "https://x/2", terms: ["Summer 2026"], active: true },
    { company_name: "Acme", title: "Closed Role Intern", url: "https://x/3", terms: ["Summer 2027"], active: false },
    { company_name: "Acme", title: "Hidden Intern", url: "https://x/4", terms: ["Summer 2027"], is_visible: false },
    { company_name: "Acme", title: "No URL Intern", terms: ["Summer 2027"] },
    { company_name: "Termless", title: "Quant Intern", url: "https://x/6" },
  ], "feedname");
  const titles = rows.map((r) => r.title);
  assert.deepEqual(titles, ["Software Engineer Intern", "Quant Intern"]);
  assert.equal(rows[0].source, "feedname", "an unsourced row is credited to its feed");
});

test("parseSimplifySchema keeps a row's own source attribution", () => {
  const [r] = S.parseSimplifySchema(
    [{ company_name: "A", title: "Intern", url: "https://x/1", source: "contributor" }], "feedname");
  assert.equal(r.source, "contributor", "the per-row credit in the upstream data is preserved");
});

test("parseSimplifySchema survives junk instead of throwing", () => {
  for (const bad of [null, undefined, {}, "nope", 42]) {
    assert.deepEqual(S.parseSimplifySchema(bad, "f"), [], `input ${String(bad)}`);
  }
  assert.deepEqual(S.parseSimplifySchema([null, undefined, {}], "f"), []);
});

/* ------------------------------------------------------------------- the CSV */

test("parseCSVRows handles quoting, embedded commas and doubled quotes", () => {
  const rows = S.parseCSVRows(
    'a,b,c\n1,"New York, NY",x\n2,"say ""hi""",y\n3,plain,z\n');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].b, "New York, NY", "a quoted comma must not split the row");
  assert.equal(rows[1].b, 'say "hi"', "doubled quotes collapse to one");
  assert.equal(rows[2].c, "z");
});

test("parseZshahCsv trusts the season column and drops everything else", () => {
  const csv = [
    "company,title,season,location,url,posted_at",
    "Acme,Software Engineer Intern,Summer 2027,\"Austin, TX\",https://job-boards.greenhouse.io/acme/jobs/9,2026-08-15T18:49:00.000+00:00",
    "Acme,Fall Intern,Fall 2026,\"Austin, TX\",https://x/2,",
    "Acme,Mystery Intern,Not stated,\"Austin, TX\",https://x/3,",
    "Acme,Old Intern,Summer 2026,\"Austin, TX\",https://x/4,",
  ].join("\n");
  const rows = S.parseZshahCsv(csv, "zshah101");
  assert.equal(rows.length, 1, "only the stated Summer 2027 row survives");
  const r = rows[0];
  assert.equal(r.company_name, "Acme");
  assert.equal(r.title, "Software Engineer Intern");
  assert.deepEqual(r.locations, ["Austin, TX"]);
  assert.equal(r.source, "zshah101");
  assert.ok(r.date_posted > 1600000000, "posted_at is carried across as a unix seconds value");
  assert.deepEqual(r.terms, ["Summer 2027"]);
});

test("parseZshahCsv drops rows missing a url, title or company", () => {
  const csv = [
    "company,title,season,location,url",
    ",Headless Intern,Summer 2027,NY,https://x/1",
    "Acme,,Summer 2027,NY,https://x/2",
    "Acme,No Link Intern,Summer 2027,NY,",
  ].join("\n");
  assert.deepEqual(S.parseZshahCsv(csv, "z"), []);
});

/* -------------------------------------------------------- the markdown table */

const SPEEDY_ROW = (co, title, loc, url) =>
  `| <a href="https://co/${co}"><strong>${co}</strong></a> | ${title} | ${loc} | ` +
  `<a href="${url}"><img src="https://img" alt="Apply" width="70"/></a> | 3d |`;

test("parseSpeedyapplyTable pulls the apply URL out of the image anchor", () => {
  const md = [
    "# Some heading",
    "| Company | Role | Location | Apply | Age |",
    "|---|---|---|---|---|",
    SPEEDY_ROW("Acme", "Software Engineer Intern", "Austin, TX", "https://job-boards.greenhouse.io/acme/jobs/7"),
    SPEEDY_ROW("Globex", "Quant Trading Intern", "New York, NY<br>Chicago, IL", "https://jobs.lever.co/globex/abc"),
    "some prose that is not a table row",
  ].join("\n");
  const rows = S.parseSpeedyapplyTable(md, "speedyapply");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].company_name, "Acme", "the company comes from the <strong>, not the link text");
  assert.equal(rows[0].url, "https://job-boards.greenhouse.io/acme/jobs/7",
    "the URL must be the apply link, never the company link in the first cell");
  assert.equal(rows[1].locations[0], "New York, NY, Chicago, IL", "<br> becomes a comma, not a jam");
  assert.equal(rows[0].source, "speedyapply");
});

test("parseSpeedyapplyTable ignores the header, the separator and any row with no apply link", () => {
  const md = [
    "| Company | Role | Location | Apply | Age |",
    "|---|---|---|---|---|",
    "| <strong>NoLink</strong> | Intern | NY | | 1d |",
    "| plain text | Intern | NY | x | 1d |",
  ].join("\n");
  assert.deepEqual(S.parseSpeedyapplyTable(md, "s"), []);
});

test("parseSpeedyapplyTable decodes the entities a README actually contains", () => {
  const md = [
    "|h|h|h|h|h|", "|---|---|---|---|---|",
    SPEEDY_ROW("D. E. Shaw &amp; Co.", "Intern, Research &amp; Trading", "New&nbsp;York", "https://x/1"),
  ].join("\n");
  const [r] = S.parseSpeedyapplyTable(md, "s");
  assert.equal(r.company_name, "D. E. Shaw & Co.");
  assert.equal(r.title, "Intern, Research & Trading");
});

test("parseSpeedyapplyTable returns nothing for a document with no table", () => {
  assert.deepEqual(S.parseSpeedyapplyTable("# Just a readme\n\nNo tables here.\n", "s"), []);
});

/* ------------------------------------------------------------- the sanity gate */

test("the sanity gate thresholds are set to something meaningful", () => {
  assert.ok(S.FEED_MIN_ROWS >= 10, "too low a floor lets a broken parser through");
  assert.ok(S.FEED_MIN_INTERN_RATIO > 0.3 && S.FEED_MIN_INTERN_RATIO <= 1);
});

test("a shifted-column parse would be rejected by the ratio gate", () => {
  // What a real format change looks like: the parser still returns rows, but the title
  // column now holds a location. Nothing throws — the ratio is what catches it.
  const shifted = Array.from({ length: 60 }, (_, i) => ({ title: `Austin, TX ${i}` }));
  const internish = shifted.filter((l) => l.title && S.isIntern(l.title)).length;
  assert.ok(
    internish / shifted.length < S.FEED_MIN_INTERN_RATIO,
    "garbage rows must fall below the intern ratio, or the gate does not protect anything",
  );
  const genuine = Array.from({ length: 60 }, (_, i) => ({ title: `Software Engineer Intern ${i}` }));
  assert.ok(
    genuine.filter((l) => S.isIntern(l.title)).length / genuine.length >= S.FEED_MIN_INTERN_RATIO,
    "and a healthy feed must clear it",
  );
});

/* --------------------------------------------- feeds agree with the dedupe key */

test("the same posting from two feeds collapses to one row", () => {
  // The whole merge depends on this. Different aggregators spell the company differently,
  // so URL-first dedupe is what makes merging safe.
  const a = { company_name: "Palantir", title: "Forward Deployed Software Engineer Intern", url: "https://jobs.lever.co/palantir/abc", locations: ["Palo Alto, CA"] };
  const b = { company_name: "Palantir Technologies", title: "Forward Deployed Software Engineer Intern, Summer 2027", url: "https://jobs.lever.co/palantir/abc?utm=x", locations: ["Palo Alto, California"] };
  assert.equal(S.normUrl(a.url), S.normUrl(b.url), "query strings must not defeat URL dedupe");
  const c = { ...b, url: "https://jobs.lever.co/palantir/DIFFERENT" };
  assert.notEqual(S.normUrl(a.url), S.normUrl(c.url));
  // company+title+location still differs here, because "Palantir" != "Palantir Technologies".
  // That is a known gap — see PROJECT.md §21 — and URL dedupe is what covers for it.
  assert.equal(S.normTitle(a.title), S.normTitle(b.title), "a trailing season suffix must normalise away");
  assert.equal(S.normLoc(a.locations), S.normLoc(b.locations), "CA and California are one city");
});
