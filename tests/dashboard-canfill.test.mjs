/* The dashboard's canFill() must agree with the extension's ats.fromUrl().
 *
 * canFill() decides whether a listing row says "✋ manual apply" and whether the button
 * reads "Open & fill" or just "Open". It reads the ATS list the extension sends over the
 * bridge, but it applies the matching rules itself — so it is a second implementation of
 * the same logic, in a different file, in a different language runtime. Those drift.
 *
 * A disagreement is not cosmetic in either direction: claiming a fill that never comes is
 * the failure PROJECT.md §2 is about, and labelling a Greenhouse posting "manual apply"
 * tells the user their working extension is broken. So: same answer, every URL on the
 * live board, plus the edges.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), "utf8");

/* ---- the extension's answer ---- */
const extCtx = { self: {}, URL };
vm.createContext(extCtx);
vm.runInContext(read("extension/ats.js"), extCtx);
const ATS = extCtx.self.OfferAIOATS;

/* ---- the dashboard's answer, lifted out of the inline <script> ---- */
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name}() is gone from OfferAIO.html — this test is stale`);
  let i = src.indexOf("{", start), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error(`unbalanced braces in ${name}()`);
}
const dashCtx = { URL, extAts: null };
vm.createContext(dashCtx);
vm.runInContext(extractFn(read("OfferAIO.html"), "canFill"), dashCtx);
const canFill = (url) => vm.runInContext("canFill", dashCtx)(url);

const liveList = () => {
  dashCtx.extAts = JSON.parse(JSON.stringify(ATS.list));
};

test("with no list from the extension, the answer is 'unknown' — never a guess", () => {
  dashCtx.extAts = null;
  // null, not false: an extension too old to answer the `ats` message is not evidence
  // that nothing is fillable, and the UI must not tell the user their extension is dead.
  assert.equal(canFill("https://job-boards.greenhouse.io/x/jobs/1"), null);
  dashCtx.extAts = [];
  assert.equal(canFill("https://job-boards.greenhouse.io/x/jobs/1"), null);
});

test("agrees with ats.fromUrl on every listing on the live board", () => {
  liveList();
  const rows = JSON.parse(read("data/listings.json"));
  assert.ok(rows.length > 100, "listings.json looks empty — is the scrape pipeline broken?");
  const disagree = [];
  for (const r of rows) {
    if (!r.url) continue;
    const ext = !!ATS.fromUrl(r.url);
    const dash = canFill(r.url);
    if (ext !== dash) disagree.push(`${r.url}  extension=${ext} dashboard=${dash}`);
  }
  assert.deepEqual(disagree, [], `dashboard and extension disagree on:\n${disagree.join("\n")}`);
});

test("agrees on the edges too", () => {
  liveList();
  const urls = [
    "https://job-boards.eu.greenhouse.io/veeamsoftware/jobs/1",
    "https://jobs.eu.lever.co/imc/abc",
    "https://www.wellfound.com/jobs/1",
    "https://wellfound.com/jobs/1",
    "https://www.linkedin.com/jobs/view/1",
    "https://www.linkedin.com/feed/",
    "https://ca.linkedin.com/jobs/view/1",
    "https://notgreenhouse.io/jobs/1",
    "https://greenhouse.io.evil.example/jobs/1",
    "https://lifeattiktok.com/search/123",
    "https://www.tesla.com/careers/search/job/1",
    "https://ats.rippling.com/x/jobs/1",
    "https://careers.snowflake.com/us/en/job/1",
    "https://wellsfargo.wd1.myworkdayjobs.com/en-US/x/job/1",
  ];
  for (const u of urls) {
    assert.equal(canFill(u), !!ATS.fromUrl(u), u);
  }
});

test("junk input is 'no', not a crash", () => {
  liveList();
  for (const u of ["", "not a url", "chrome://extensions", "about:blank", "file:///c:/a.html"]) {
    assert.equal(canFill(u), false, JSON.stringify(u));
  }
});

test("the board is not silently all-manual or all-fillable", () => {
  // A regression that made canFill() return one answer for everything would keep every
  // test above green while making the badge meaningless. Assert the real split instead.
  liveList();
  const rows = JSON.parse(read("data/listings.json")).filter((r) => r.url);
  const yes = rows.filter((r) => canFill(r.url)).length;
  assert.ok(yes > rows.length * 0.2, `only ${yes}/${rows.length} fillable — matching looks broken`);
  assert.ok(yes < rows.length * 0.95, `${yes}/${rows.length} fillable — matching looks too permissive`);
});

/* ---- what the row actually RENDERS, not just what canFill() returns ----

   Every test above asserts canFill()'s return value, and all of them passed while the
   three call sites rendered `canFill(url) === false ? '' : ' & fill'` — so null, the
   "we were never told" state, printed the fill promise. canFill() was right and the page
   still lied. That is why these assert the rendered strings. */

vm.runInContext(extractFn(read("OfferAIO.html"), "fillSuffix"), dashCtx);
vm.runInContext(extractFn(read("OfferAIO.html"), "fillTitle"), dashCtx);
const fillSuffix = (url) => vm.runInContext("fillSuffix", dashCtx)(url);
const fillTitle = (url) => vm.runInContext("fillTitle", dashCtx)(url);

const GH = "https://job-boards.greenhouse.io/acme/jobs/1";
const TESLA = "https://www.tesla.com/careers/search/job/123";

test("a fillable posting promises the fill", () => {
  liveList();
  assert.equal(fillSuffix(GH), " &amp; fill");
  assert.match(fillTitle(GH), /extension fills it there/);
});

test("a posting we cannot fill promises nothing", () => {
  liveList();
  assert.equal(fillSuffix(TESLA), "");
  assert.match(fillTitle(TESLA), /you fill it yourself/);
});

test("an extension that never sent its ATS list promises nothing either", () => {
  // The null state: canFill() returns null for every URL, including Greenhouse. The button
  // must not offer to fill, and must not claim "manual apply" — we do not know either way.
  dashCtx.extAts = null;
  assert.equal(canFill(GH), null);
  assert.equal(fillSuffix(GH), "", "null rendered the fill promise — §16 regression");
  assert.equal(fillSuffix(TESLA), "");
  assert.match(fillTitle(GH), /hasn't told us/);
  assert.doesNotMatch(fillTitle(GH), /fills it there/);
});

test("an empty ATS list is treated as unknown, not as 'nothing is fillable'", () => {
  dashCtx.extAts = [];
  assert.equal(canFill(GH), null);
  assert.equal(fillSuffix(GH), "");
  assert.match(fillTitle(GH), /hasn't told us/);
});
