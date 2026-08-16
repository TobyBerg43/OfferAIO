/* data/listings.json must obey, on disk, the rules scrape.js applies on the way in.
 *
 * This is a consistency test in the same family as ats-manifest, dashboard-canfill and
 * version-sync: it reads the committed data and asserts the repo agrees with itself. It
 * touches no network, so it runs on every push — the daily audit (audit-listings.mjs +
 * .github/workflows/verify-listings.yml) is the one that goes out and pokes real employers.
 *
 * Why the split matters: a filter can regress and the board keeps serving stale-but-plausible
 * rows for days. Every failure below means either a filter broke or something wrote to
 * listings.json without going through the pipeline.
 *
 * Run: node --test tests/listings-integrity.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const S = require("../scrape.js"); // safe: main is behind require.main === module

const root = new URL("../", import.meta.url);
const rows = JSON.parse(fs.readFileSync(new URL("data/listings.json", root), "utf8"));
const meta = JSON.parse(fs.readFileSync(new URL("data/meta.json", root), "utf8"));
const active = rows.filter((l) => l.active !== false);

const sample = (list, n = 3) =>
  list.slice(0, n).map((l) => `${l.company_name} — ${String(l.title).slice(0, 48)}`).join("\n      ");

/* ------------------------------------------------------------- shape */

test("the board is a non-trivial array of well-formed rows", () => {
  assert.ok(Array.isArray(rows), "listings.json must be an array");
  assert.ok(active.length > 300, `only ${active.length} active listings — the board collapsed`);
  const bad = active.filter((l) => !l.company_name || !l.title || !l.url);
  assert.deepEqual(bad, [], "rows missing company_name, title or url");
});

test("every url is https and parseable", () => {
  // Not pedantry: the user types their name, phone and email into that page and attaches a
  // résumé. Over http all of it goes in the clear. scrape.js upgrades http at ingest.
  const bad = active.filter((l) => {
    try { return new URL(l.url).protocol !== "https:"; } catch (e) { return true; }
  });
  assert.deepEqual(
    bad.map((l) => `${l.company_name}: ${l.url}`), [],
    "non-https or unparseable urls reached the board",
  );
});

/* ------------------------------------------- the ingest filters, re-applied */

test("every row still passes isIntern()", () => {
  const bad = active.filter((l) => !S.isIntern(l.title));
  assert.equal(bad.length, 0,
    `${bad.length} rows would not pass the season/role filter:\n      ${sample(bad)}`);
});

test("every row still passes isUS()", () => {
  const bad = active.filter((l) => !S.isUS(l));
  assert.equal(bad.length, 0,
    `${bad.length} non-US rows reached the board:\n      ${sample(bad)}`);
});

test("no row states a term that fails to mention 2027", () => {
  const bad = active.filter(
    (l) => Array.isArray(l.terms) && l.terms.length && !l.terms.some((t) => /2027/.test(t)));
  assert.equal(bad.length, 0, `${bad.length} rows carry the wrong season in terms`);
});

test("no row advertises a past season in its title", () => {
  // A separate assertion from isIntern even though it overlaps, because this is the one a
  // user notices: being sent to a Summer 2025 req.
  const bad = active.filter((l) => /\b202[0-6]\b/.test(l.title));
  assert.equal(bad.length, 0, `${bad.length} rows name a 2020–2026 season:\n      ${sample(bad)}`);
});

/* ------------------------------------------------------------- duplicates */

test("no url appears twice", () => {
  // ⚠️ This failed on 2026-08-16 with three duplicates. The dedupe registered the LOSER's
  // keys but not the winner's, so a third row carrying the winner's url matched nothing and
  // was pushed as new. Optiver posting one title in one city under two req ids is the shape
  // that triggers it.
  const seen = new Map();
  for (const l of active) {
    const u = S.normUrl(l.url);
    seen.set(u, (seen.get(u) || 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1);
  assert.deepEqual(dupes.map(([u, n]) => `${n}x ${u}`), [], "URL dedupe is not holding");
});

test("company+title+location collisions stay rare", () => {
  // Softer than the URL rule: two genuinely different reqs can share all three (different
  // teams, same title, same city). A spike means normTitle stopped normalising.
  const seen = new Map();
  for (const l of active) {
    const k = S.dedupeKey(l);
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  const dupes = [...seen.values()].filter((n) => n > 1).length;
  assert.ok(dupes < active.length * 0.05,
    `${dupes} duplicate company+title+location groups across ${active.length} rows`);
});

/* --------------------------------------------------- verification is possible */

test("a meaningful share of the board is on a host that reports closure honestly", () => {
  const checkable = active.filter(S.isCheckable).length;
  const share = checkable / active.length;
  // 60.8% as of 2026-08-16, after Workday, iCIMS and SmartRecruiters were added. A sharp
  // drop means a host stopped answering or CHECKABLE_HOST was narrowed.
  assert.ok(share > 0.45,
    `only ${(share * 100).toFixed(1)}% of the board is verifiable (${checkable}/${active.length})`);
});

test("the check budget can cover every checkable row daily", () => {
  // Arithmetic, so it fails the moment the board outgrows the budget rather than after
  // coverage has already rotted. update.yml runs every 6h.
  const checkable = active.filter(S.isCheckable).length;
  const capacity = S.CHECK_BUDGET * 4;
  assert.ok(capacity >= checkable,
    `CHECK_BUDGET ${S.CHECK_BUDGET} x 4 runs = ${capacity}/day cannot cover ${checkable} ` +
    `checkable rows. Raise it to at least ${Math.ceil(checkable / 4)}.`);
});

test("the recheck window is under a day, so 'checked daily' is true", () => {
  assert.ok(S.RECHECK_MS < 24 * 3600 * 1000,
    `RECHECK_MS is ${Math.round(S.RECHECK_MS / 3.6e6)}h — a listing could go over a day unchecked`);
});

test("the hosts we claim to verify are the ones with a real checker", () => {
  // CHECKABLE_HOST decides what gets checked; isStillOpen decides how. A host in the first
  // without a strategy in the second would be counted as covered and silently HEAD-checked,
  // which is exactly wrong for Workday — its HTML answers 200 for a req that never existed.
  for (const h of ["boards.greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com",
                   "acme.wd1.myworkdayjobs.com", "careers-x.icims.com", "jobs.smartrecruiters.com"]) {
    assert.ok(S.CHECKABLE_HOST.test(h), `${h} should be checkable`);
  }
  for (const h of ["ats.rippling.com", "lifeattiktok.com", "www.tesla.com", "www.janestreet.com"]) {
    assert.ok(!S.CHECKABLE_HOST.test(h),
      `${h} answers 200 for a fabricated posting — claiming it as checkable would inflate coverage`);
  }
});

/* ----------------------------------------------------------- meta agreement */

test("meta.json agrees with listings.json", () => {
  assert.equal(meta.total, active.length, "meta.total disagrees with the active row count");
  assert.equal(meta.checkable, active.filter(S.isCheckable).length, "meta.checkable is stale");
  assert.ok(meta.checked <= meta.checkable, "more rows checked than are checkable");
  const bySource = Object.values(meta.bySource || {}).reduce((a, b) => a + b, 0);
  assert.equal(bySource, active.length, "bySource does not add up to the board");
});

test("no single feed is the whole board", () => {
  const top = Object.entries(meta.bySource || {}).sort((a, b) => b[1] - a[1])[0];
  assert.ok(top, "bySource is empty");
  assert.ok(top[1] / active.length < 0.7,
    `${top[0]} supplies ${((top[1] / active.length) * 100).toFixed(0)}% of the board — ` +
    `one feed going dark would gut it`);
});

test("closed rows are retained but not served", () => {
  const closed = rows.filter((l) => l.active === false);
  // §15a: closed rows stay in the file so the next run does not re-import them from a feed
  // that has not noticed yet. Every consumer must filter active !== false.
  assert.ok(closed.length / rows.length < 0.2,
    `${closed.length} of ${rows.length} rows are closed — the board is going stale`);
  assert.ok(closed.every((l) => l.url), "a retained closed row still needs its url for dedupe");
});

test("every closed row carries date_closed, or retention silently does not happen", () => {
  /* ⚠️ This is the invariant that makes §15a's fortnight real, and it was false until
   * 2026-08-16. The carry-forward copied `active: false` but not `date_closed`, so the forget
   * filter read `(undefined || 0) > cutoff`, dropped the row on the next run, and the feed —
   * which had not noticed the req closed — re-imported it as live. Flagged closed, forgotten,
   * re-imported, flagged closed again, forever: the two dead Veeam reqs were still being
   * re-detected every run ten days after PROJECT.md recorded them as caught.
   *
   * Without date_closed, closed-detection does nothing for any feed-sourced row. */
  const closed = rows.filter((l) => l.active === false);
  const orphaned = closed.filter((l) => !l.date_closed);
  assert.deepEqual(
    orphaned.map((l) => `${l.company_name} — ${l.title}`), [],
    "closed rows with no date_closed will be forgotten on the next run and re-imported as live",
  );
  // And a date_closed should be plausible, not a placeholder.
  const nowSec = Math.floor(Date.now() / 1000);
  for (const l of closed) {
    assert.ok(l.date_closed > 1700000000 && l.date_closed <= nowSec + 3600,
      `${l.company_name}: implausible date_closed ${l.date_closed}`);
  }
});

test("an open row never carries a stale date_closed", () => {
  // isStillOpen returning true deletes it. A live row holding a date_closed means a
  // resurrection was recorded as a closure, which would forget it a fortnight later.
  const contradictory = rows.filter((l) => l.active !== false && l.date_closed);
  assert.deepEqual(contradictory.map((l) => l.company_name), [],
    "rows that are open but still carry date_closed");
});
