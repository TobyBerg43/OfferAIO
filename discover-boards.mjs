#!/usr/bin/env node
/**
 * OfferAIO board discovery — maintains companies.json instead of hand-editing it.
 *
 * §21d found 29 of 56 Workday boards had been dead "for an unknown length of time", and
 * §23 recovered 13 of them by hand. Both were symptoms of the same thing: companies.json
 * was the only input nobody re-checked. A hand-curated list of 2,000 boards rots faster
 * than anyone will fix it, so this script owns the file.
 *
 * Two jobs, every run:
 *   1. RE-VALIDATE every board already listed. Failures accrue strikes in
 *      data/board-health.json; a board is dropped only after STRIKES_TO_DROP consecutive
 *      failed runs, so one flaky morning never deletes a good board.
 *   2. DISCOVER new boards from the community feeds, validate them against the live API,
 *      and add the ones that are real, public and non-empty.
 *
 * ⚠️ Validation is the whole point — see §23b. A board harvested from a URL and written
 * straight to companies.json is a board that may 404 for months without anything failing.
 * Nothing is added here that has not answered its own API in this run.
 *
 * Run: node discover-boards.mjs [--dry-run] [--no-discover] [--cache DIR]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { COMMUNITY_FEEDS, parseCSVRows } = require(join(ROOT, "scrape.js"));

const COMPANIES_FILE = join(ROOT, "companies.json");
const HEALTH_FILE = join(ROOT, "data", "board-health.json");

const DRY_RUN = process.argv.includes("--dry-run");
const NO_DISCOVER = process.argv.includes("--no-discover");
const CACHE_DIR = (process.argv.find((a) => a.startsWith("--cache=")) || "").split("=")[1] || null;

/* A board must fail this many consecutive runs before it is dropped. At the workflow's
   3-day cadence that is a week and a half of being dead — long enough to rule out an
   outage, short enough that §21d's "unknown length of time" cannot happen again. */
const STRIKES_TO_DROP = 3;
const CONCURRENCY = 12;
const TIMEOUT_MS = 20000;

const today = () => new Date().toISOString().slice(0, 10);

/* ---------------- board identity ----------------
 *
 * The board is the identity, not the company (§23e): HP runs a US and an EU board on one
 * host, and both are real. Every key below is therefore per-board.
 */
export function boardKey(c) {
  return (c.ats === "workday"
    ? `workday|${c.host}|${c.site}`
    : `${c.ats}|${c.slug}`).toLowerCase();
}

/** URL -> board identity, for every host form the four enumerable ATSes serve. */
export function boardFromUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  const h = u.hostname.toLowerCase();
  const seg = u.pathname.split("/").filter(Boolean);
  /* EU instances (jobs.eu.lever.co, job-boards.eu.greenhouse.io) carry US roles — §15. */
  if (/(^|\.)greenhouse\.io$/.test(h)) {
    if (seg[0] === "embed") {
      const forParam = u.searchParams.get("for");
      return forParam ? { ats: "greenhouse", slug: forParam } : null;
    }
    return seg[0] ? { ats: "greenhouse", slug: seg[0] } : null;
  }
  if (/(^|\.)lever\.co$/.test(h)) return seg[0] ? { ats: "lever", slug: seg[0] } : null;
  if (/(^|\.)ashbyhq\.com$/.test(h)) return seg[0] ? { ats: "ashby", slug: seg[0] } : null;
  if (/(^|\.)myworkdayjobs\.com$/.test(h)) {
    /* Only the region-suffixed form is a locale. A bare two-letter segment can be a real
       site slug — Nightwing's is "nw" and answers with 329 jobs — and the §23 harvester's
       broader regex would have skipped it. */
    const site = seg.find((s) => !/^[a-z]{2}[-_][A-Za-z]{2}$/.test(s) && s !== "job");
    return site ? { ats: "workday", host: h, tenant: h.split(".")[0], site } : null;
  }
  return null;
}

/* Recruiter-only, redeployment and talent-pool boards answer the API perfectly and carry
   nothing a student can apply to (§21e). Matching is on separated words so a company whose
   real slug merely contains one of these substrings is not caught. */
const INTERNAL_RE =
  /(^|[_-])(private|privileged|redeployment|sourcer|internal|confidential|alumni|contingent|agency|referral|recruiter)([_-]|$)|onlyconfidential|talent[_-]?pool|cadastro/i;

export function looksInternal(c) {
  return c.ats === "workday" && INTERNAL_RE.test(c.site);
}

/* A slug has to survive being put in a URL. Anything with a path separator, a query or
   whitespace came out of a bad parse, not off a job board. */
export function plausibleSlug(s) {
  return typeof s === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(s);
}

/* ---------------- validation ---------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * ⚠️ Retry 429 and 5xx before believing them. Sweeping ~2,000 boards means asking Greenhouse
 * 500+ times and Ashby 300+ times in a burst, and the first version of this script recorded
 * **47 boards as rejected with "http 429"** — real boards, throttled, that would simply not
 * have been added. A throttle is a statement about our request rate, not about the board.
 *
 * 404/422/403 are answers about the board itself and are returned immediately.
 */
async function req(url, opts = {}, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    let r = null;
    try {
      r = await fetch(url, {
        ...opts,
        headers: { "User-Agent": "OfferAIO-pipeline/1.0", accept: "application/json", ...(opts.headers || {}) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch { /* network error — retried below like a 5xx */ }
    if (r && r.status !== 429 && r.status < 500) return r;
    if (i === retries) return r;
    /* Honour Retry-After when the server sends one; otherwise exponential with jitter. */
    const after = r && Number(r.headers.get("retry-after"));
    await sleep(after > 0 ? Math.min(after * 1000, 30000) : 1200 * 2 ** i + Math.random() * 600);
  }
  return null;
}

/**
 * Does this board exist, answer publicly, and carry postings today?
 *
 * ⚠️ Ask Workday TWICE (§23b). The first version of this check searched "intern 2027" and
 * returned early on a 200, so a live board with no intern req in August looked exactly like
 * a wrong slug — both read "0 jobs". The bare search is what separates them.
 *
 * Returns { ok, jobs, reason }. `ok:false` is a strike; it is never an immediate deletion.
 */
export async function validateBoard(c) {
  if (c.ats === "workday") {
    const r = await req(`https://${c.host}/wday/cxs/${c.tenant}/${c.site}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: "" }),
    });
    if (!r) return { ok: false, jobs: 0, reason: "unreachable" };
    if (!r.ok) return { ok: false, jobs: 0, reason: `http ${r.status}` };
    let d; try { d = await r.json(); } catch { return { ok: false, jobs: 0, reason: "bad json" }; }
    if (!d || !Array.isArray(d.jobPostings)) return { ok: false, jobs: 0, reason: "no jobPostings" };
    const total = d.total ?? d.jobPostings.length;
    /* Truist is live, correct, and returns 403 on the per-job endpoint the extension and the
       liveness checker both use (§23d). A board users cannot open is not a board. */
    if (d.jobPostings.length) {
      const path = d.jobPostings[0].externalPath || "";
      const jr = await req(`https://${c.host}/wday/cxs/${c.tenant}/${c.site}${path}`);
      if (jr && (jr.status === 401 || jr.status === 403)) return { ok: false, jobs: total, reason: `postings ${jr.status}` };
    }
    return { ok: total > 0, jobs: total, reason: total > 0 ? "" : "empty" };
  }

  const url = {
    greenhouse: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
    lever: (s) => `https://api.lever.co/v0/postings/${s}?mode=json`,
    ashby: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}?includeCompensation=false`,
  }[c.ats];
  if (!url) return { ok: false, jobs: 0, reason: "unknown ats" };

  const r = await req(url(c.slug));
  if (!r) return { ok: false, jobs: 0, reason: "unreachable" };
  if (!r.ok) return { ok: false, jobs: 0, reason: `http ${r.status}` };
  let d; try { d = await r.json(); } catch { return { ok: false, jobs: 0, reason: "bad json" }; }
  const jobs = c.ats === "lever" ? (Array.isArray(d) ? d : null) : (d && d.jobs);
  if (!Array.isArray(jobs)) return { ok: false, jobs: 0, reason: "no jobs array" };
  /* An empty board is the signature of a decommissioned slug — KPMG's Lever board answers
     200 with nothing on it, forever. Real boards that go quiet get their strikes back the
     moment they post again. */
  return { ok: jobs.length > 0, jobs: jobs.length, reason: jobs.length ? "" : "empty" };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

/* ---------------- feeds ---------------- */

async function feedText(feed) {
  if (CACHE_DIR) {
    const cached = join(CACHE_DIR, `${feed.name}.cache`);
    if (existsSync(cached)) return readFileSync(cached, "utf8");
  }
  for (const url of feed.mirrors) {
    const r = await req(url, { headers: { accept: "*/*" } });
    if (r && r.ok) {
      const t = await r.text();
      if (CACHE_DIR) { mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(join(CACHE_DIR, `${feed.name}.cache`), t); }
      return t;
    }
  }
  return null;
}

/**
 * (company, url) pairs from every feed — deliberately unfiltered by season or country.
 * A board carrying a Fall 2026 posting today is the same board that carries Summer 2027 in
 * September, and discovery is about the board, not the posting.
 */
async function harvestPairs() {
  const pairs = [];
  for (const feed of COMMUNITY_FEEDS) {
    const text = await feedText(feed);
    if (!text) { console.log(`  ${feed.name}: unreachable`); continue; }
    let before = pairs.length;
    try {
      if (text.trimStart().startsWith("[") || text.trimStart().startsWith("{")) {
        for (const l of JSON.parse(text)) if (l && l.company_name && l.url) pairs.push({ company: l.company_name, url: l.url });
      } else if (text.includes(",") && /(^|\n)[^\n]*\burl\b/i.test(text.slice(0, 400))) {
        for (const r of parseCSVRows(text)) if (r.company && r.url) pairs.push({ company: r.company, url: r.url });
      } else {
        for (const line of text.split("\n")) {
          const cells = line.split("|").map((s) => s.trim());
          const href = (line.match(/https?:\/\/[^\s)"'|]+/) || [])[0];
          if (cells.length > 3 && href) pairs.push({ company: cells[1].replace(/\[|\]|\*\*/g, ""), url: href });
        }
      }
    } catch (e) { console.log(`  ${feed.name}: parse failed — ${e.message}`); continue; }
    console.log(`  ${feed.name}: ${pairs.length - before} pairs`);
  }
  return pairs;
}

/** A company name good enough to show a user next to a job. */
function cleanName(n) {
  const s = String(n || "").replace(/\s+/g, " ").replace(/^[\-–—*\s]+|[\-–—*\s]+$/g, "").trim();
  if (s.length < 2 || s.length > 60) return null;
  if (!/[A-Za-z]/.test(s)) return null;
  return s;
}

/* ---------------- main ----------------
 *
 * ESM has no `require.main === module`, and this file exports its predicates so
 * tests/boards-discovery.test.mjs can exercise them. Without this guard, importing it would
 * start a network sweep over every board in companies.json.
 */
/* ⚠️ Build the comparison with pathToFileURL, not by concatenating "file://" onto the path.
   On Windows the hand-rolled form parses the drive letter as a URL host, the guard is
   silently false, and the script exits having printed nothing at all. */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {

const companies = JSON.parse(readFileSync(COMPANIES_FILE, "utf8"));
const health = existsSync(HEALTH_FILE) ? JSON.parse(readFileSync(HEALTH_FILE, "utf8")) : {};

console.log(`board discovery — ${new Date().toISOString()}`);
console.log(`${companies.length} boards listed, ${Object.keys(health).length} with health history\n`);

/* --- 1. re-validate what we already have --- */
console.log("revalidating existing boards");
const existingResults = await mapLimit(companies, CONCURRENCY, (c) => validateBoard(c));

const kept = [];
const dropped = [];
for (const [i, c] of companies.entries()) {
  const key = boardKey(c);
  const res = existingResults[i];
  const h = health[key] || { strikes: 0 };
  if (res.ok) {
    health[key] = { strikes: 0, lastOk: today(), jobs: res.jobs };
    kept.push(c);
  } else {
    const strikes = (h.strikes || 0) + 1;
    health[key] = { ...h, strikes, lastFail: today(), reason: res.reason };
    if (strikes >= STRIKES_TO_DROP) { dropped.push({ ...c, reason: res.reason, strikes }); delete health[key]; }
    else kept.push(c);
  }
}
const failing = companies.length - kept.length - dropped.length;
console.log(`  ${kept.length} ok or on strike, ${dropped.length} dropped after ${STRIKES_TO_DROP} consecutive failures`);
for (const d of dropped) console.log(`    drop  ${d.name} (${d.reason})`);

/* --- 2. discover --- */
let added = [];
if (!NO_DISCOVER) {
  console.log("\nharvesting feeds");
  const pairs = await harvestPairs();

  const seen = new Set(kept.map(boardKey));
  const candidates = new Map();
  for (const { company, url } of pairs) {
    const b = boardFromUrl(url);
    if (!b) continue;
    const name = cleanName(company);
    if (!name) continue;
    if (b.ats !== "workday" && !plausibleSlug(b.slug)) continue;
    if (looksInternal(b)) continue;
    const key = boardKey(b);
    if (seen.has(key)) continue;
    if (!candidates.has(key)) candidates.set(key, { ...b, names: new Map() });
    const rec = candidates.get(key);
    rec.names.set(name, (rec.names.get(name) || 0) + 1);
  }
  console.log(`\n${candidates.size} novel boards to validate`);

  const list = [...candidates.values()].map((b) => {
    /* The feeds disagree about spelling ("Palantir" / "Palantir Technologies Inc"), so take
       the name the most rows agree on rather than the first one seen. */
    const name = [...b.names.entries()].sort((a, c) => c[1] - a[1] || a[0].length - c[0].length)[0][0];
    const { names, ...rest } = b;
    return { name, ...rest };
  });

  const results = await mapLimit(list, CONCURRENCY, (c) => validateBoard(c));
  added = list.filter((_, i) => results[i].ok);
  const rejected = list.length - added.length;
  const why = {};
  results.filter((r) => !r.ok).forEach((r) => { why[r.reason] = (why[r.reason] || 0) + 1; });
  console.log(`  ${added.length} validated, ${rejected} rejected`);
  console.log(`  rejection reasons: ${Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);

  for (const [i, c] of list.entries()) if (results[i].ok) health[boardKey(c)] = { strikes: 0, lastOk: today(), jobs: results[i].jobs };
}

/* --- 3. write --- */
/* Sorted by ats then name so the bot's diffs stay reviewable — an append-ordered file
   re-shuffles on every run and hides what actually changed. */
const final = [...kept, ...added].sort((a, b) =>
  a.ats.localeCompare(b.ats) || a.name.localeCompare(b.name) || boardKey(a).localeCompare(boardKey(b)));

const byAts = {};
for (const c of final) byAts[c.ats] = (byAts[c.ats] || 0) + 1;

console.log(`\ncompanies.json: ${companies.length} -> ${final.length}  (+${added.length} added, -${dropped.length} dropped, ${failing} on strike)`);
console.log(Object.entries(byAts).map(([k, v]) => `  ${k.padEnd(11)} ${v}`).join("\n"));

if (DRY_RUN) {
  console.log("\n--dry-run: nothing written");
} else {
  writeFileSync(COMPANIES_FILE, JSON.stringify(final, null, 2) + "\n");
  mkdirSync(dirname(HEALTH_FILE), { recursive: true });
  writeFileSync(HEALTH_FILE, JSON.stringify(health, null, 1) + "\n");
  console.log(`\nwrote companies.json and ${HEALTH_FILE.replace(ROOT, ".")}`);
}

}
