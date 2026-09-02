#!/usr/bin/env node
/**
 * Audit data/listings.json: is it internally sound, is it being verified, and do the links
 * actually resolve?
 *
 *   node audit-listings.mjs              # full audit, samples 40 live URLs
 *   node audit-listings.mjs --sample 0   # data + coverage only, no network
 *   node audit-listings.mjs --sample 120 # deeper link sample
 *   node audit-listings.mjs --json       # machine-readable, for a workflow artifact
 *
 * WHY THIS EXISTS. The pipeline had a liveness checker and a filter chain, and nothing
 * checked either of them. Two things went wrong that way and neither announced itself: a
 * feed listed in scrape.js was never read for weeks (§21), and `verifyStillOpen` covered
 * 23% of the board while `meta.json` reported the coverage honestly and nobody looked. An
 * unverified pipeline is a pipeline that is wrong in a way you have not measured yet.
 *
 * Exits non-zero when a HARD invariant breaks or a threshold is breached, so the daily
 * workflow goes red and somebody finds out. Exits 0 with warnings for the soft stuff.
 *
 * ⚠️ It never marks a listing closed. Reading is all it does; scrape.js owns writes.
 */
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const S = require("./scrape.js"); // safe: main is behind require.main === module

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(name);
  return i === -1 ? dflt : (argv[i + 1] ?? dflt);
};
const SAMPLE = Number(flag("--sample", 40));
const AS_JSON = argv.includes("--json");

/* ---------------------------------------------------------------- thresholds
 *
 * Set from what the board actually looks like today, not from ambition. Each one is a
 * floor the pipeline already clears, so a breach means something changed.
 */
const T = {
  minRows: 300,             // the board has never been smaller than ~380
  minCheckableShare: 0.45,  // 60.5% today; a big drop means a host stopped answering
  minCheckedShare: 0.80,    // of CHECKABLE rows, how many carry a recent check
  recentMs: 36 * 60 * 60 * 1000, // "recent" = a day and a half, so one skipped run is fine
  maxDeadShareInSample: 0.15,     // >15% of sampled links gone = the board is going stale
  maxClosedShare: 0.10,
  maxSingleSourceShare: 0.60,     // no one feed should be the whole board
};

const rows = JSON.parse(fs.readFileSync(new URL("./data/listings.json", import.meta.url), "utf8"));
const meta = JSON.parse(fs.readFileSync(new URL("./data/meta.json", import.meta.url), "utf8"));
const active = rows.filter((l) => l.active !== false);

const fail = [], warn = [], info = [];
const F = (m) => fail.push(m);
const W = (m) => warn.push(m);
const I = (m) => info.push(m);

/* ============================ 1. is every row well formed? ============================ */

const missing = active.filter((l) => !l.company_name || !l.title || !l.url);
if (missing.length) F(`${missing.length} rows missing company_name, title or url`);

const badUrl = active.filter((l) => {
  try { const u = new URL(l.url); return u.protocol !== "https:"; } catch (e) { return true; }
});
if (badUrl.length) {
  F(`${badUrl.length} rows have an unparseable or non-https url` +
    ` (e.g. ${JSON.stringify(badUrl[0].url).slice(0, 70)})`);
}

const noLoc = active.filter((l) => !Array.isArray(l.locations) || !l.locations.length).length;
if (noLoc > active.length * 0.25) W(`${noLoc} rows carry no location at all`);

/* ==================== 2. do the ingest filters actually hold on disk? ==================== */
/* These are the rules scrape.js applies. If a row on disk breaks one, either a filter
   regressed or something wrote to listings.json without going through the pipeline. */

const notIntern = active.filter((l) => !S.isIntern(l.title));
if (notIntern.length) {
  F(`${notIntern.length} rows would not pass isIntern() — the season/role filter regressed` +
    `\n      e.g. ${notIntern.slice(0, 3).map((l) => `"${l.title}"`).join(", ")}`);
}

const notUS = active.filter((l) => !S.isUS(l));
if (notUS.length) {
  F(`${notUS.length} rows would not pass isUS() — non-US postings reached the board` +
    `\n      e.g. ${notUS.slice(0, 3).map((l) => `${l.company_name}: ${(l.locations || [])[0]}`).join(", ")}`);
}

const wrongTerms = active.filter(
  (l) => Array.isArray(l.terms) && l.terms.length && !l.terms.some((t) => /2027/.test(t)));
if (wrongTerms.length) F(`${wrongTerms.length} rows state terms that never mention 2027`);

/* ============================== 3. duplicates ============================== */

const byUrl = new Map(), byKey = new Map();
for (const l of active) {
  const u = S.normUrl(l.url), k = S.dedupeKey(l);
  byUrl.set(u, (byUrl.get(u) || 0) + 1);
  byKey.set(k, (byKey.get(k) || 0) + 1);
}
const dupUrl = [...byUrl.values()].filter((n) => n > 1).length;
const dupKey = [...byKey.values()].filter((n) => n > 1).length;
if (dupUrl) F(`${dupUrl} urls appear more than once — URL dedupe is not holding`);
if (dupKey) {
  // Softer: two genuinely different reqs can share company+title+city (different teams).
  W(`${dupKey} company+title+location groups appear more than once`);
}

/* ==================== 4. is the board being verified at all? ==================== */

const checkable = active.filter(S.isCheckable);
const share = checkable.length / (active.length || 1);
I(`checkable: ${checkable.length} of ${active.length} (${(share * 100).toFixed(1)}%)`);
if (share < T.minCheckableShare) {
  F(`only ${(share * 100).toFixed(1)}% of the board is on a host that answers honestly` +
    ` (floor ${(T.minCheckableShare * 100).toFixed(0)}%) — a host may have stopped reporting closure`);
}

const now = Date.now();
/* Only rows that have had the chance to be checked count towards coverage. A listing that
 * arrived twenty minutes ago is not evidence of a broken checker, and scoring it as such
 * makes every board expansion look like a failure — which would train everyone to ignore
 * this audit, the exact fate of the coverage numbers already in meta.json. */
const DUE_AGE_MS = T.recentMs;
const settled = checkable.filter(
  (l) => l.date_first_seen && now - l.date_first_seen * 1000 > DUE_AGE_MS);
const fresh = checkable.length - settled.length;
const recent = settled.filter((l) => l.date_checked && now - l.date_checked * 1000 < T.recentMs);
const never = checkable.filter((l) => !l.date_checked);
const checkedShare = settled.length ? recent.length / settled.length : 1;

I(`checkable rows on the board longer than ${Math.round(DUE_AGE_MS / 3.6e6)}h: ${settled.length}` +
  (fresh ? ` (${fresh} arrived too recently to be due yet)` : ""));
I(`of those, verified within ${Math.round(T.recentMs / 3.6e6)}h: ${recent.length}` +
  ` (${(checkedShare * 100).toFixed(1)}%)`);
if (never.length) I(`never checked at all: ${never.length}`);

if (!settled.length) {
  W(`no checkable row is old enough to be due yet — probably a first run after a board ` +
    `expansion. Re-run this audit after the next pipeline pass before believing the coverage.`);
} else if (checkedShare < T.minCheckedShare) {
  F(`only ${(checkedShare * 100).toFixed(1)}% of settled checkable rows were verified in the ` +
    `last ${Math.round(T.recentMs / 3.6e6)}h (floor ${(T.minCheckedShare * 100).toFixed(0)}%) — ` +
    `the daily check is not keeping up. CHECK_BUDGET is ${S.CHECK_BUDGET} per run against ` +
    `${checkable.length} checkable rows.`);
}
if (checkable.some((l) => !l.date_first_seen)) {
  W(`some rows carry no date_first_seen — they predate that field, so coverage is measured ` +
    `over fewer rows than it could be. It resolves itself after one pipeline run.`);
}

/* Is the budget even capable of daily coverage? Arithmetic, not observation — this catches
   the problem the moment the board outgrows the budget, before coverage visibly rots. */
const runsPerDay = 2; // update.yml cron: 0 */12 * * * — change this WITH the cron
const capacity = S.CHECK_BUDGET * runsPerDay;
I(`budget capacity: ${S.CHECK_BUDGET} x ${runsPerDay} runs = ${capacity}/day vs ${checkable.length} checkable`);
if (capacity < checkable.length) {
  F(`CHECK_BUDGET cannot cover the board daily: ${capacity}/day < ${checkable.length} checkable. ` +
    `Raise CHECK_BUDGET to at least ${Math.ceil(checkable.length / runsPerDay)}.`);
}
if (S.RECHECK_MS >= 24 * 3600 * 1000) {
  F(`RECHECK_MS is ${Math.round(S.RECHECK_MS / 3.6e6)}h — at or over a day, so "checked daily" ` +
    `is not something the code actually does`);
}

/* ============================== 5. staleness and churn ============================== */

const closed = rows.filter((l) => l.active === false);
const closedShare = closed.length / (rows.length || 1);
I(`flagged closed and retained: ${closed.length} (${(closedShare * 100).toFixed(1)}%)`);
if (closedShare > T.maxClosedShare) {
  W(`${(closedShare * 100).toFixed(1)}% of rows are flagged closed — the board may be going stale`);
}

const future = active.filter((l) => (l.date_posted || 0) * 1000 > now + 36e5).length;
if (future) W(`${future} rows claim a date_posted in the future`);

if (!meta.updated || now - Date.parse(meta.updated) > 3 * 24 * 3600 * 1000) {
  F(`data/meta.json says the pipeline last ran ${meta.updated} — over three days ago`);
}

const bySource = meta.bySource || {};
const top = Object.entries(bySource).sort((a, b) => b[1] - a[1])[0];
if (top && top[1] / (active.length || 1) > T.maxSingleSourceShare) {
  W(`${top[0]} supplies ${((top[1] / active.length) * 100).toFixed(0)}% of the board — ` +
    `one feed going dark would gut it`);
}
I(`sources: ${Object.entries(bySource).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${k}:${v}`).join("  ")}`);

/* ============ 6. do the links actually resolve? (sampled, hits real employers) ============ */

let sampled = { checked: 0, open: 0, dead: 0, unknown: 0, deadRows: [] };
if (SAMPLE > 0) {
  /* Stratified by host so one big host cannot dominate the sample, and deterministic in
     order so a failure is reproducible. Only checkable hosts — sampling an unverifiable
     host would produce "unknown" and tell us nothing. */
  const byHost = new Map();
  for (const l of checkable) {
    const h = new URL(l.url).hostname.split(".").slice(-2).join(".");
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h).push(l);
  }
  const picks = [];
  const hosts = [...byHost.keys()];
  for (let i = 0; picks.length < Math.min(SAMPLE, checkable.length); i++) {
    let added = false;
    for (const h of hosts) {
      const list = byHost.get(h);
      if (i < list.length && picks.length < SAMPLE) { picks.push(list[i]); added = true; }
    }
    if (!added) break;
  }

  const CONC = 6;
  const queue = [...picks];
  async function worker() {
    while (queue.length) {
      const l = queue.shift();
      const v = await S.isStillOpen(l.url);
      sampled.checked++;
      if (v === true) sampled.open++;
      else if (v === false) { sampled.dead++; sampled.deadRows.push(`${l.company_name} — ${l.title}`); }
      else sampled.unknown++;
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  const deadShare = sampled.dead / (sampled.checked || 1);
  I(`link sample: ${sampled.checked} checked — ${sampled.open} open, ${sampled.dead} gone, ` +
    `${sampled.unknown} inconclusive`);
  if (deadShare > T.maxDeadShareInSample) {
    F(`${(deadShare * 100).toFixed(0)}% of sampled links are gone (ceiling ` +
      `${(T.maxDeadShareInSample * 100).toFixed(0)}%) — the liveness pass is not keeping up` +
      `\n      ${sampled.deadRows.slice(0, 5).join("\n      ")}`);
  } else if (sampled.dead) {
    I(`gone but still listed (they will be flagged on the next pass): ` +
      sampled.deadRows.slice(0, 5).join("; "));
  }
  if (sampled.unknown > sampled.checked * 0.4) {
    W(`${sampled.unknown} of ${sampled.checked} sampled links were inconclusive — ` +
      `a host may be rate-limiting us, which reads as "cannot tell" and blocks all closure detection`);
  }
}

/* ================================== report ================================== */

if (AS_JSON) {
  console.log(JSON.stringify({
    ok: fail.length === 0,
    rows: rows.length, active: active.length,
    checkable: checkable.length, verifiedRecently: recent.length, neverChecked: never.length,
    closed: closed.length, sampled, fail, warn, info,
  }, null, 2));
} else {
  console.log(`\nOfferAIO listings audit — ${new Date().toISOString()}`);
  console.log(`${rows.length} rows, ${active.length} active\n`);
  for (const m of info) console.log(`  ·  ${m}`);
  if (warn.length) {
    console.log("\nWARNINGS (not fatal)");
    for (const m of warn) console.log(`  ⚠  ${m}`);
  }
  if (fail.length) {
    console.log("\nFAILURES");
    for (const m of fail) console.log(`  ✗  ${m}`);
  }
  console.log(fail.length ? `\nAUDIT FAILED — ${fail.length} problem(s)\n` : `\nAudit passed.\n`);
}

if (active.length < T.minRows) {
  console.error(`\n✗  only ${active.length} active listings (floor ${T.minRows}) — the board collapsed\n`);
  process.exit(1);
}
process.exit(fail.length ? 1 : 0);
