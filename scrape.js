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

/* ---------------- Phase 1 feeds ----------------
 *
 * ⚠️ These used to be a fallback chain, not a merge: `communityListings()` took the FIRST
 * reachable source and `return`ed. vanshb03 is reachable, so SimplifyJobs — 46k stars, the
 * largest Summer 2027 list there is — was listed here for weeks and **never once read**.
 * Measured 2026-08-16: vanshb03 carries 401 rows, SimplifyJobs 14,286 (919 tagged Summer
 * 2027), and merging the two adds **291 listings the board did not have**.
 *
 * So: every feed is fetched, every feed is merged, and dedupe sorts it out downstream —
 * which it can, because the dedupe below is URL-first and therefore catches the same
 * posting arriving from three different aggregators under three spellings of the company
 * name.
 *
 * Each feed has its own parser, because they are not the same shape: two serve the
 * Simplify JSON schema, one a CSV, one a markdown table. `mirrors` are tried in order
 * until one answers — that IS a fallback chain, correctly, because they are copies of one
 * source rather than different sources.
 */
const COMMUNITY_FEEDS = [
  {
    name: "vanshb03",
    mirrors: [
      "https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/dev/.github/scripts/listings.json",
      "https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/main/.github/scripts/listings.json",
    ],
    parse: parseSimplifySchema,
  },
  {
    name: "SimplifyJobs",
    mirrors: [
      "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json",
      "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/main/.github/scripts/listings.json",
    ],
    parse: parseSimplifySchema,
  },
  {
    // Aggregates ~4,300 employer boards every 30 minutes and publishes a clean CSV with a
    // season column, so it needs no season guessing. Smaller than the others but the
    // highest fillable share of any feed here (72%), because its rows come from ATS hosts
    // rather than from employer careers pages.
    name: "zshah101",
    mirrors: ["https://raw.githubusercontent.com/zshah101/Automated-List-Of-Summer-2027-and-Fall-2026-Tech-Internships/main/data/internships.csv"],
    text: true,
    parse: parseZshahCsv,
  },
  {
    // 8.8k stars, updated daily. Its generator reads a private API, so the only public
    // copy of the data is the markdown table in the README — hence the fragile parser and
    // the sanity gate in fetchFeed(). 75% fillable.
    name: "speedyapply",
    mirrors: ["https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/README.md"],
    text: true,
    parse: parseSpeedyapplyTable,
  },
];

/* A feed is discarded wholesale unless it looks like what we expect. A parser pointed at a
 * changed format does not fail loudly — it returns rows with the columns shifted, which is
 * far worse than returning nothing, because junk would reach the board and every row of it
 * would be a posting we advertise and cannot open. */
const FEED_MIN_ROWS = 20;
const FEED_MIN_INTERN_RATIO = 0.5;

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

async function getText(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "OfferAIO-pipeline/1.0" } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (i === retries) { console.warn(`  ! ${url} — ${e.message}`); return null; }
      await sleep(800 * (i + 1) + Math.random() * 500);
    }
  }
}

/* ---------------- Phase 1 parsers ----------------
 *
 * Each takes the raw body and returns rows in the listing schema. None of them filter for
 * season or country — that is one job done once, in fetchFeed(), so a new feed cannot
 * quietly apply weaker rules than the others.
 */

/** vanshb03 and SimplifyJobs both publish the Simplify listings.json schema. */
function parseSimplifySchema(data, feedName) {
  if (!Array.isArray(data)) return [];
  return data
    .filter((l) => l && l.active !== false && l.is_visible !== false && l.url && l.title && l.company_name)
    // When the entry states its terms, at least one must mention 2027. Rows with no terms
    // at all are kept and left to the title rules — vanshb03 tags nothing, so requiring a
    // term here would discard that feed entirely.
    .filter((l) => !Array.isArray(l.terms) || !l.terms.length || l.terms.some((t) => /2027/.test(t)))
    .map((l) => ({ ...l, source: l.source || feedName }));
}

/** Minimal RFC4180 reader: quoted fields, embedded commas, doubled quotes. */
function parseCSVRows(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); cell = ""; if (row.length > 1) rows.push(row); row = []; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); if (row.length > 1) rows.push(row); }
  const head = rows.shift();
  if (!head) return [];
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

/** zshah101's data/internships.csv — carries an explicit season, and sometimes a salary. */
function parseZshahCsv(text, feedName) {
  return parseCSVRows(text)
    .filter((r) => r.url && r.title && r.company)
    // This feed states the season outright, so trust it rather than re-deriving it. Its
    // "Not stated" and "Fall 2026" rows are exactly the ones we do not want.
    .filter((r) => /2027/.test(r.season) && /summer/i.test(r.season))
    .map((r) => listing({
      company: r.company,
      title: r.title,
      url: r.url,
      locations: r.location ? [r.location] : [],
      source: feedName,
      posted: r.posted_at ? Math.floor(Date.parse(r.posted_at) / 1000) || null : null,
    }));
}

/** speedyapply's README table. Rows carry the apply URL inside an <img> anchor. */
function parseSpeedyapplyTable(text, feedName) {
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 4) continue;
    const company = (cells[0].match(/<strong>(.*?)<\/strong>/) || [])[1];
    if (!company) continue;                       // header, separator, or a prose row
    const href = (cells.find((c) => /<img/.test(c)) || "").match(/href="([^"]+)"/);
    if (!href) continue;                          // no apply link = nothing to offer
    const strip = (s) => s.replace(/<br\s*\/?>/gi, ", ").replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").trim();
    out.push(listing({
      company: strip(cells[0]),
      title: strip(cells[1]),
      url: href[1],
      locations: cells[2] ? [strip(cells[2])] : [],
      source: feedName,
    }));
  }
  return out;
}

// month-range programs like "Jan to Jun 2027" that aren't summer terms
const MONTH_RANGE_RE = /\b(jan|feb|mar|apr|sep|oct|nov|dec)[a-z]*\.?\s*(to|through|thru|[-–])\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
// non-English titles (accented/Nordic letters) = almost certainly not a US posting
const NON_ENGLISH_RE = /[À-ÖØ-öø-ÿĀ-ž]/;
function isIntern(t) {
  if (!INTERN_RE.test(t) || EXCLUDE_RE.test(t)) return false;
  if (WRONG_YEAR_RE.test(t)) return false;                          // 2020–2026 seasons
  if (OTHER_SEASON_RE.test(t) && !SUMMER_RE.test(t)) return false;  // fall/spring/co-op only
  if (MONTH_RANGE_RE.test(t)) return false;                         // e.g. "Jan to Jun 2027"
  if (NON_ENGLISH_RE.test(t)) return false;                         // non-English posting
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

/* ---------------- dedupe ----------------
 *
 * Both old keys were exact-match, so the same role survived twice whenever a title
 * picked up a season suffix or a city was spelled differently — 25 duplicate groups and
 * 28 redundant rows, about 7% of the database:
 *
 *   Point72  Quantitative Developer Intern    New York     / New York, NY
 *   DRW      Quantitative Trading Analyst     Chicago, IL  / Chicago, Illinois
 *   Akuna    Software Engineer Intern, C++    …            / … - C++, Summer 2027
 *
 * So normalise before comparing. One caution learned the hard way: strip trailing season
 * suffixes ONLY. Wells Fargo titles their roles "2027 Audit Summer Internship — Early
 * Careers", and a rule that eats everything after a year collapses Audit, Finance, HR and
 * Risk into one row — four distinct internships silently deleted.
 */
const normUrl = (u) => String(u || "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();

function normTitle(t) {
  return String(t || "")
    .toLowerCase()
    // A LEADING season/year — "Summer 2027 Quantitative Research Internship". Strip the
    // token only, never the remainder: Wells Fargo's titles start with the year too
    // ("2027 Audit Summer Internship — Early Careers") and the words after it are the
    // entire difference between four separate internships.
    .replace(/^\s*(summer|fall|spring|winter)?\s*20\d\d\s*[-–—:,]?\s*/, "")
    // "- Summer 2027", ", 2027", "(Summer 2027)" at the END only
    .replace(/[\s\-–—,(|]+(summer|fall|spring|winter)?\s*20\d\d\s*\)?\s*$/, "")
    // "- Summer 2027 - Chicago" — a trailing season plus a trailing city
    .replace(/[\s\-–—,(|]+(summer\s*)?20\d\d\s*[-–—]\s*[a-z ]+$/, "")
    .replace(/\b(summer|internship|intern|programme|program)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}
// "Chicago, IL", "Chicago, Illinois" and "Chicago, United States" are one city.
const normLoc = (locs) =>
  String((locs || [])[0] || "").toLowerCase().split(",")[0].replace(/[^a-z0-9]+/g, "");
const normCompany = (c) => String(c || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const dedupeKey = (l) => `${normCompany(l.company_name)}::${normTitle(l.title)}::${normLoc(l.locations)}`;

/** How much a row actually tells a user — used to pick a winner between duplicates. */
const richness = (l) =>
  (l.locations || []).length * 2 +
  (l.salary || l.compensation || l.pay ? 3 : 0) +
  (l.date_posted ? 1 : 0) +
  (Array.isArray(l.terms) && l.terms.length ? 1 : 0);

/* ---------------- liveness ----------------
 *
 * Nothing was ever marked inactive — 0 of 394 rows — so a req that closed between
 * refreshes stayed listed forever. That is how a dead Veeam posting was still being
 * offered as applicable: the link resolved to
 * job-boards.eu.greenhouse.io/veeamsoftware?error=true, "The job you are looking for is
 * no longer open."
 *
 * Greenhouse, Lever and Ashby all answer honestly for a dead req — 404, 410, or a
 * redirect to the board root carrying ?error=true — so a HEAD is enough. Budgeted so the
 * 6-hourly workflow stays well inside its time limit: the newest N per run, plus anything
 * not verified in 48h.
 *
 * Anything ambiguous (a timeout, a 5xx, a 405 because the host dislikes HEAD) leaves the
 * listing exactly as it was. Dropping a live posting because their server hiccuped costs
 * a user a job; leaving a dead one listed for six more hours costs a wasted click.
 */
const CHECKABLE_HOST = /(^|\.)greenhouse\.io$|(^|\.)lever\.co$|(^|\.)ashbyhq\.com$/;
const CHECK_BUDGET = 120;
const RECHECK_MS = 48 * 60 * 60 * 1000;
const CHECK_CONCURRENCY = 6;
// Forget a dead req after a fortnight, so listings.json doesn't grow without bound.
const FORGET_CLOSED_MS = 14 * 24 * 60 * 60 * 1000;

const isCheckable = (l) => {
  try { return CHECKABLE_HOST.test(new URL(l.url).hostname); } catch (e) { return false; }
};

/** true = open, false = definitely closed, null = couldn't tell (leave it alone). */
async function isStillOpen(url) {
  try {
    const r = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: { "User-Agent": "OfferAIO-pipeline/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (r.status === 404 || r.status === 410) return false;
    // The exact redirect the founder landed on.
    if (/[?&]error=true/.test(r.url || "")) return false;
    // Redirected off the posting and back to the board root — the req is gone.
    if (r.url && /greenhouse\.io|lever\.co|ashbyhq\.com/.test(r.url)) {
      const path = new URL(r.url).pathname.replace(/\/+$/, "");
      if (path.split("/").filter(Boolean).length <= 1 && normUrl(r.url) !== normUrl(url)) return false;
    }
    return r.ok ? true : null;
  } catch (e) {
    return null;
  }
}

/** Read the previous run's output so a check result survives between runs. */
function readPrevious() {
  const map = new Map();
  try {
    const rows = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
    for (const l of rows) map.set(normUrl(l.url), l);
  } catch (e) { /* first run */ }
  return map;
}

/** HEAD-check the postings that are due, mutating `rows` in place. */
async function verifyStillOpen(rows) {
  const now = Date.now();
  const due = rows.filter(
    (l) => isCheckable(l) && (!l.date_checked || now - l.date_checked * 1000 > RECHECK_MS),
  );
  const batch = due.slice(0, CHECK_BUDGET);
  if (due.length > batch.length) {
    // Never let a budget cap look like full coverage.
    console.log(`Liveness: ${due.length} due, checking the newest ${batch.length} this run`);
  }

  const queue = [...batch];
  let closedCount = 0;
  async function worker() {
    while (queue.length) {
      const l = queue.shift();
      const open = await isStillOpen(l.url);
      l.date_checked = Math.floor(Date.now() / 1000);
      if (open === false) {
        l.active = false;
        l.date_closed = l.date_closed || Math.floor(Date.now() / 1000);
        closedCount++;
        console.log(`  ✗ closed: ${l.company_name} — ${l.title}`);
      } else if (open === true) {
        l.active = true;
        delete l.date_closed;
      }
      await sleep(120);
    }
  }
  await Promise.all(Array.from({ length: CHECK_CONCURRENCY }, worker));
  console.log(`Liveness: checked ${batch.length}, newly closed ${closedCount}`);
}

/* ---------------- Phase 1 aggregation ---------------- */

/** Fetch and parse one feed, or return [] — never throw, never half-apply. */
async function fetchFeed(feed) {
  let body = null, used = null;
  for (const url of feed.mirrors) {
    body = feed.text ? await getText(url) : await getJSON(url);
    if (body) { used = url; break; }
  }
  if (!body) { console.warn(`  ! ${feed.name}: no mirror reachable`); return []; }

  let rows;
  try {
    rows = feed.parse(body, feed.name) || [];
  } catch (e) {
    console.warn(`  ! ${feed.name}: parser threw — ${e.message}`);
    return [];
  }

  /* The sanity gate. A parser aimed at a format that has moved on returns rows with the
   * columns shifted rather than an error, and that is worse than nothing: every junk row
   * becomes a posting we advertise and the user cannot open. So require a plausible volume
   * AND that most titles actually look like internships before trusting any of it. */
  if (rows.length < FEED_MIN_ROWS) {
    console.warn(`  ! ${feed.name}: only ${rows.length} rows (< ${FEED_MIN_ROWS}) — discarded, format may have changed`);
    return [];
  }
  const internish = rows.filter((l) => l.title && isIntern(l.title)).length;
  const ratio = internish / rows.length;
  if (ratio < FEED_MIN_INTERN_RATIO) {
    console.warn(`  ! ${feed.name}: only ${(ratio * 100).toFixed(0)}% of ${rows.length} rows look like internships — discarded`);
    return [];
  }

  const kept = rows.filter((l) => l.title && isIntern(l.title) && isUS(l));
  console.log(`  ${feed.name}: ${rows.length} rows → ${kept.length} kept   (${used.split("/")[3]})`);
  return kept;
}

/**
 * Every feed, merged. Not a fallback chain — see the note on COMMUNITY_FEEDS for why that
 * distinction cost the board 291 listings.
 */
async function communityListings() {
  console.log("Phase 1: aggregating community feeds");
  const results = await Promise.all(COMMUNITY_FEEDS.map((f) => fetchFeed(f)));
  const all = results.flat();
  if (!all.length) console.warn("Phase 1: every feed failed — falling back to Phase 2 and the previous run");
  else console.log(`Phase 1: ${all.length} listings from ${results.filter((r) => r.length).length}/${COMMUNITY_FEEDS.length} feeds`);
  return all;
}

/* ---------------- main ----------------
 *
 * Guarded so this file can be required by a test without running the pipeline. The Phase 1
 * parsers are the fragile part of this program — one reads a CSV, one reads a markdown
 * table somebody else maintains — and until 2026-08-16 nothing in the repo exercised any of
 * it. That is how a feed listed in this very file went unread for weeks.
 */
module.exports = {
  COMMUNITY_FEEDS, FEED_MIN_ROWS, FEED_MIN_INTERN_RATIO,
  parseSimplifySchema, parseZshahCsv, parseSpeedyapplyTable, parseCSVRows,
  isIntern, isUS, dedupeKey, normUrl, normTitle, normCompany, normLoc, listing,
};

if (require.main === module) (async () => {
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

  // Dedupe: exact URL, then normalised company+title+location
  const seen = new Map();
  const deduped = [];
  for (const l of all) {
    if (!isUS(l)) continue; // US-only
    const key1 = normUrl(l.url);
    const key2 = dedupeKey(l);
    const prevIdx = seen.has(key1) ? seen.get(key1) : seen.has(key2) ? seen.get(key2) : -1;
    if (prevIdx >= 0) {
      // Same role seen twice. Keep whichever row carries more — the community feed often
      // has the salary and every location, the direct ATS pull often has neither.
      if (richness(l) > richness(deduped[prevIdx])) deduped[prevIdx] = l;
      continue;
    }
    deduped.push(l);
    const idx = deduped.length - 1;
    seen.set(key1, idx);
    seen.set(key2, idx);
  }
  deduped.sort((a, b) => (b.date_posted || 0) - (a.date_posted || 0));

  // Carry forward what the last run learned, then re-check what's due.
  const previous = readPrevious();
  for (const l of deduped) {
    const p = previous.get(normUrl(l.url));
    if (p) {
      if (p.date_checked) l.date_checked = p.date_checked;
      if (p.active === false) l.active = false;
    }
  }
  await verifyStillOpen(deduped);

  const closed = deduped.filter((l) => l.active === false);
  const open = deduped.filter((l) => l.active !== false);
  console.log(`Liveness: ${open.length} open, ${closed.length} flagged closed`);

  // Closed reqs stay in the file rather than being deleted: consumers already skip
  // `active === false`, and keeping the row is what stops the next run re-importing the
  // same dead posting from a community feed that hasn't noticed yet. Drop them once
  // they're old enough that nobody is going to re-list them.
  const cutoff = Math.floor((Date.now() - FORGET_CLOSED_MS) / 1000);
  const kept = deduped.filter((l) => l.active !== false || (l.date_closed || 0) > cutoff);
  const forgotten = deduped.length - kept.length;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(kept, null, 1));
  fs.writeFileSync(path.join(OUT_DIR, "meta.json"), JSON.stringify({
    updated: new Date().toISOString(),
    total: open.length,
    closed: kept.length - open.length,
    // How much of the board has actually been verified recently, so a shrinking number
    // here is visible rather than being mistaken for "everything is fine".
    checked: kept.filter((l) => l.date_checked).length,
    checkable: kept.filter(isCheckable).length,
    bySource: open.reduce((m, l) => ((m[l.source] = (m[l.source] || 0) + 1), m), {}),
  }, null, 2));
  console.log(
    `DONE: ${open.length} live listings → data/listings.json` +
    ` (${kept.length - open.length} retained as closed, ${forgotten} forgotten)`,
  );
})();
