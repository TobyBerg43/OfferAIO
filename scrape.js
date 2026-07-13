#!/usr/bin/env node
/**
 * OfferAIO listings pipeline — Phases 1 + 2 (+ merges Phase 3 output if present)
 *
 * Phase 1: aggregates community-maintained Summer 2027 repos (already updated daily)
 * Phase 2: enumerates public ATS APIs (Greenhouse, Lever, Ashby, Workday) for the
 *          companies in companies.json — no HTML scraping, no auth, no API keys
 * Phase 3: if data/listings-extra.json exists (produced by jobspy_scrape.py),
 *          it gets merged in
 *
 * Output: data/listings.json — Simplify-compatible schema, consumed directly by OfferAIO.html
 * Run: node scrape.js   (Node 18+, zero dependencies)
 */

const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "data");
const OUT_FILE = path.join(OUT_DIR, "listings.json");
const EXTRA_FILE = path.join(OUT_DIR, "listings-extra.json");
const COMPANIES = JSON.parse(fs.readFileSync(path.join(__dirname, "companies.json"), "utf8"));

const COMMUNITY_SOURCES = [
  "https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/dev/.github/scripts/listings.json",
  "https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/main/.github/scripts/listings.json",
  "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json",
];

const INTERN_RE = /\bintern(ship)?\b|\bsummer analyst\b/i;
const EXCLUDE_RE = /\binternal\b/i;
// drop postings that target past seasons (2020–2026); keep 2027 or year-less (evergreen)
const WRONG_YEAR_RE = /\b202[0-6]\b/;
// drop fall/spring/winter/co-op roles unless they also mention summer
const OTHER_SEASON_RE = /\b(fall|autumn|spring|winter|off.?cycle|co-?op)\b/i;
const SUMMER_RE = /\bsummer\b/i;
// US-only: reject listings whose title or location mentions a non-US country/city
const NON_US_RE = /\b(Canada|Toronto|Vancouver|Montreal|Ottawa|Calgary|United Kingdom|UK|London|Dublin|Ireland|Germany|Berlin|Munich|France|Paris|Netherlands|Amsterdam|Spain|Madrid|Barcelona|Poland|Warsaw|Krakow|India|Bangalore|Bengaluru|Hyderabad|Mumbai|Pune|Gurgaon|Noida|Chennai|Singapore|Japan|Tokyo|China|Shanghai|Beijing|Shenzhen|Hong Kong|Taiwan|Taipei|Korea|Seoul|Australia|Sydney|Melbourne|Brazil|S[ãa]o Paulo|Mexico|Chile|Santiago|Argentina|Buenos Aires|Colombia|Bogot[áa]|Peru|Lima|Costa Rica|Israel|Tel Aviv|Dubai|UAE|Switzerland|Zurich|Geneva|Sweden|Stockholm|Finland|Helsinki|Norway|Oslo|Denmark|Copenhagen|Italy|Milan|Rome|Portugal|Lisbon|Belgium|Brussels|Austria|Vienna|Prague|Budapest|Bucharest|Luxembourg|LATAM|EMEA|APAC|FIN|GBR|DEU|CAN|MEX|BRA|IND|CHN|JPN|SGP|AUS|POL|ESP|FRA|NLD|CHE|ITA)\b/;
const isUS = (l) => !NON_US_RE.test(`${l.title} ${(l.locations || []).join(" ")}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, opts = {}, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, {
        ...opts,
        headers: { "User-Agent": "OfferAIO-pipeline/1.0", accept: "application/json", ...(opts.headers || {}) },
      });
      if (r.status === 404) return null; // bad slug — skip quietly
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === retries) { console.warn(`  ! ${url} — ${e.message}`); return null; }
      await sleep(800 * (i + 1) + Math.random() * 500); // backoff + jitter
    }
  }
}

function isIntern(t) {
  if (!INTERN_RE.test(t) || EXCLUDE_RE.test(t)) return false;
  if (WRONG_YEAR_RE.test(t)) return false;                          // 2020–2026 seasons
  if (OTHER_SEASON_RE.test(t) && !SUMMER_RE.test(t)) return false;  // fall/spring/co-op only
  return true;
}

function listing({ company, title, url, locations = [], source, posted = null }) {
  return {
    company_name: company,
    title,
    url,
    locations: locations.filter(Boolean),
    active: true,
    is_visible: true,
    date_posted: posted || Math.floor(Date.now() / 1000),
    date_updated: Math.floor(Date.now() / 1000),
    terms: ["Summer 2027"],
    source,
    id: `${company}::${title}::${(locations[0] || "").slice(0, 40)}`.toLowerCase(),
  };
}

/* ---------------- Phase 2 fetchers (all public JSON APIs) ---------------- */

async function greenhouse(c) {
  const data = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${c.slug}/jobs`);
  if (!data || !data.jobs) return [];
  return data.jobs.filter((j) => isIntern(j.title)).map((j) =>
    listing({
      company: c.name, title: j.title, url: j.absolute_url,
      locations: [j.location && j.location.name], source: "greenhouse",
      posted: j.updated_at ? Math.floor(new Date(j.updated_at) / 1000) : null,
    }));
}

async function lever(c) {
  const data = await getJSON(`https://api.lever.co/v0/postings/${c.slug}?mode=json`);
  if (!Array.isArray(data)) return [];
  return data.filter((j) => isIntern(j.text)).map((j) =>
    listing({
      company: c.name, title: j.text, url: j.hostedUrl,
      locations: [j.categories && j.categories.location], source: "lever",
      posted: j.createdAt ? Math.floor(j.createdAt / 1000) : null,
    }));
}

async function ashby(c) {
  const data = await getJSON(`https://api.ashbyhq.com/posting-api/job-board/${c.slug}?includeCompensation=false`);
  if (!data || !data.jobs) return [];
  return data.jobs.filter((j) => isIntern(j.title)).map((j) =>
    listing({
      company: c.name, title: j.title, url: j.jobUrl || j.applyUrl,
      locations: [j.location], source: "ashby",
    }));
}

async function workday(c) {
  // Workday career sites expose a public JSON search endpoint per tenant:
  // POST https://{host}/wday/cxs/{tenant}/{site}/jobs
  const base = `https://${c.host}/wday/cxs/${c.tenant}/${c.site}/jobs`;
  const out = [];
  for (let offset = 0; offset < 200; offset += 20) {
    const data = await getJSON(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: "intern 2027" }),
    });
    const jobs = data && data.jobPostings;
    if (!jobs || !jobs.length) break;
    for (const j of jobs) {
      if (!j.title || !isIntern(j.title)) continue;
      out.push(listing({
        company: c.name, title: j.title,
        url: `https://${c.host}/${c.site}${j.externalPath}`,
        locations: [j.locationsText], source: "workday",
      }));
    }
    if (jobs.length < 20) break;
    await sleep(300);
  }
  return out;
}

const FETCHERS = { greenhouse, lever, ashby, workday };

/* ---------------- Phase 1 aggregation ---------------- */

async function communityListings() {
  for (const url of COMMUNITY_SOURCES) {
    const data = await getJSON(url);
    if (Array.isArray(data) && data.length > 50) {
      console.log(`Phase 1: ${data.length} listings from ${url.split("/")[3]}`);
      return data
        .filter((l) => l.active !== false && l.is_visible !== false && l.url && l.title && l.company_name)
        // Summer 2027 double-check: title must pass season rules AND, when the
        // entry carries explicit terms, at least one must mention 2027
        .filter((l) => isIntern(l.title) &&
          (!Array.isArray(l.terms) || !l.terms.length || l.terms.some((t) => /2027/.test(t))))
        .map((l) => ({ ...l, source: l.source || "community" }));
    }
  }
  console.warn("Phase 1: no community source reachable");
  return [];
}

/* ---------------- main ---------------- */

(async () => {
  console.log(`OfferAIO pipeline — ${new Date().toISOString()}`);
  const all = [];

  // Phase 1
  all.push(...(await communityListings()));

  // Phase 2 — concurrency-limited sweep over company boards
  const queue = [...COMPANIES];
  let done = 0, found = 0;
  async function worker() {
    while (queue.length) {
      const c = queue.shift();
      const fn = FETCHERS[c.ats];
      if (!fn) continue;
      const rows = (await fn(c)) || [];
      found += rows.length;
      all.push(...rows);
      if (++done % 25 === 0) console.log(`Phase 2: ${done}/${COMPANIES.length} companies, ${found} intern roles`);
      await sleep(150); // be polite
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`Phase 2: complete — ${found} roles from ${COMPANIES.length} company boards`);

  // Phase 3 — merge JobSpy output if present
  if (fs.existsSync(EXTRA_FILE)) {
    try {
      const extra = JSON.parse(fs.readFileSync(EXTRA_FILE, "utf8"));
      console.log(`Phase 3: merging ${extra.length} extra listings`);
      all.push(...extra);
    } catch (e) { console.warn("Phase 3: bad listings-extra.json — skipped"); }
  }

  // Dedupe by URL, then by company+title+location id
  const seen = new Set();
  const deduped = [];
  for (const l of all) {
    if (!isUS(l)) continue; // US-only
    const key1 = (l.url || "").replace(/[?#].*$/, "").toLowerCase();
    const key2 = l.id || `${l.company_name}::${l.title}`.toLowerCase();
    if (seen.has(key1) || seen.has(key2)) continue;
    seen.add(key1); seen.add(key2);
    deduped.push(l);
  }
  deduped.sort((a, b) => (b.date_posted || 0) - (a.date_posted || 0));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(deduped, null, 1));
  fs.writeFileSync(path.join(OUT_DIR, "meta.json"), JSON.stringify({
    updated: new Date().toISOString(),
    total: deduped.length,
    bySource: deduped.reduce((m, l) => ((m[l.source] = (m[l.source] || 0) + 1), m), {}),
  }, null, 2));
  console.log(`DONE: ${deduped.length} unique listings → data/listings.json`);
})();
