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

/* ---------------- who this product is for ----------------
 *
 * Undergraduates going into their junior and senior years. A graduate-only posting on the
 * board is not a harmless extra: the free tier is 50 submissions a month, so every req the
 * user cannot be hired for is one of those fifty spent, and §16's whole argument is that
 * offering something you cannot deliver is worse than offering nothing.
 *
 * Measured 2026-08-17, after board discovery: 155 identical "Pharmacy Intern - Grad" reqs
 * from one employer, plus MBA, PhD and Master's-only programmes — ~190 rows of a 1,806-row
 * board, and the pharmacy block alone was a third of the 'other' category.
 *
 * ⚠️ The override is the important half. "Research Intern (BS/MS/PhD)" names a bachelor's
 * path and is open to exactly our user; "Quantitative Research Intern (PhD)" is not. A rule
 * that only looked for grad words would drop both. So an explicit undergraduate signal wins.
 */
const GRAD_ONLY_RE =
  /\bmba\b|\bph\.?\s?d\b|\bdoctoral\b|\bdoctorate\b|\bpharm\.?d\b|pharmacy intern|pharmacy grad|\bmaster'?s\b|\bmsw\b|\bjd\b|law student|\bgrad\b|\bgraduate\s+(intern|student|engineer|program|analyst|associate)/i;
/* "Undergraduate" contains "graduate" but not at a word boundary, so \bgrad… never matches
   inside it — checked, because that would invert this rule exactly where it matters. */
const UNDERGRAD_OK_RE = /\bb\.?s\.?\b|\bb\.?a\.?\b|bachelor|undergrad|rising\s+(junior|senior|sophomore)/i;
const HIGH_SCHOOL_RE = /high school|\bhigh-school\b/i;

/** Is this posting open to an undergraduate? An explicit bachelor's signal beats a grad one. */
function isUndergrad(t) {
  const s = String(t || "");
  if (HIGH_SCHOOL_RE.test(s)) return false;
  if (UNDERGRAD_OK_RE.test(s)) return true;
  return !GRAD_ONLY_RE.test(s);
}

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
      // The row survived the filter above, so the feed stated Summer 2027 for it.
      terms: ["Summer 2027"],
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
  if (!isUndergrad(t)) return false;                                // grad-only or high-school
  if (WRONG_YEAR_RE.test(t)) return false;                          // 2020–2026 seasons
  if (OTHER_SEASON_RE.test(t) && !SUMMER_RE.test(t)) return false;  // fall/spring/co-op only
  if (MONTH_RANGE_RE.test(t)) return false;                         // e.g. "Jan to Jun 2027"
  if (NON_ENGLISH_RE.test(t)) return false;                         // non-English posting
  return true;
}

/**
 * The season a posting actually states, not the season we wish it stated.
 *
 * ⚠️ `listing()` used to hard-code `terms: ["Summer 2027"]` on every Phase 2 row. That was
 * roughly true at 206 curated boards; at 2,015 it is not. Measured 2026-08-17: **759 of
 * 1,153 Phase 2 rows carry no year in the title at all** — evergreen reqs like "Accounting
 * Intern" — and every one of them was being labelled Summer 2027 on the user's board. That
 * is §2's rule broken in the pipeline instead of the dashboard: a claim printed next to a
 * real company that the data does not support.
 *
 * An empty `terms` is honest and costs nothing: both the dashboard filter
 * (`OfferAIO.html`) and `parseSimplifySchema` keep rows that state no term, and `richness()`
 * then prefers a feed row that *does* state Summer 2027 when the two describe one job.
 *
 * isIntern() has already dropped 2020–2026 and non-summer seasons by this point, so a title
 * carrying "2027" is genuinely a 2027 summer role.
 */
function termsFor(title) {
  return /\b2027\b/.test(String(title || "")) ? ["Summer 2027"] : [];
}

/**
 * `terms` is optional and means "the source stated this season outright". zshah101 publishes
 * a season column and parseZshahCsv has already filtered on it, so re-deriving from the
 * title there would *discard* known-good data — the title "Software Engineer Intern" carries
 * no year even though the feed said Summer 2027. Stated beats derived; derived beats
 * asserted.
 */
function listing({ company, title, url, locations = [], source, posted = null, terms = null }) {
  return {
    company_name: company,
    title,
    url,
    locations: locations.filter(Boolean),
    active: true,
    is_visible: true,
    date_posted: posted || Math.floor(Date.now() / 1000),
    date_updated: Math.floor(Date.now() / 1000),
    terms: Array.isArray(terms) ? terms : termsFor(title),
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

/* Upgrade http to https.
 *
 * The community feeds carry a handful of plain-http links — JazzHR, Ashby and an Oracle
 * tenant, all of which serve https perfectly well; the http is just stale data upstream.
 * It matters because the user is about to type their name, phone number and email into that
 * page and attach a résumé, and doing that over http sends all of it in the clear. Upgrading
 * is safe: every one of these hosts answered 200 on https when checked. If a host genuinely
 * has no https, the liveness check returns null and the row simply sits there unverified —
 * which is the right outcome, and better than advertising a cleartext application form. */
const httpsUrl = (u) => String(u || "").replace(/^http:\/\//i, "https://");

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
/* Which hosts answer honestly about a dead req, and how to ask them.
 *
 * ⚠️ Measured host by host on 2026-08-16, because guessing here is dangerous in both
 * directions: a host that always says 200 makes coverage look complete when nothing is
 * verified, and a host that 404s a live posting deletes a job somebody could have had.
 *
 *   greenhouse / lever / ashby   HEAD is enough — 404, 410, or a redirect to the board root
 *   myworkdayjobs.com            the HTML is a SPA shell and returns **200 for a req that
 *                                never existed**, so HEAD is worthless. The cxs per-job
 *                                JSON endpoint returns 404 with errorCode S21 instead.
 *                                Workday is the largest host on the board (324 rows), so
 *                                this one check moved coverage from 23% to 57%
 *   icims.com                    returns a clean 410 Gone
 *   smartrecruiters.com          the public postings API 404s a missing id
 *
 * Deliberately NOT checkable, verified rather than assumed:
 *   ats.rippling.com             200 for a fabricated job id — cannot distinguish
 *   lifeattiktok.com             refuses our requests outright
 * Those, plus tesla.com / janestreet.com / oraclecloud.com / workatastartup.com, are
 * largely the same employer-owned sites §16 says cannot be filled either, so the
 * unverifiable set and the unfillable set overlap heavily. `data/meta.json` reports
 * `checkable` so that gap stays visible instead of being mistaken for full coverage.
 */
const CHECKABLE_HOST =
  /(^|\.)greenhouse\.io$|(^|\.)lever\.co$|(^|\.)ashbyhq\.com$|(^|\.)myworkdayjobs\.com$|(^|\.)icims\.com$|(^|\.)smartrecruiters\.com$/;
/* Budget per run. The workflow runs twice a day and RECHECK_MS is under a day, so each
 * listing comes due once a day and the budget spreads that across two runs.
 *
 * ⚠️ Raised 250 -> 600 on 2026-08-17, when board discovery (§24) took the board from 945 to
 * ~1,800 listings and ~1,430 checkable rows. 250x4 = 1,000/day could no longer cover them,
 * so a growing share of the board would have gone unverified — the coverage rot this budget
 * exists to prevent, arriving through the front door as a *success*. Caught by
 * `tests/listings-integrity.test.mjs`, which does the arithmetic rather than trusting this
 * comment; raise the budget with the board, and let that test tell you the floor.
 * ⚠️ Raised 600 -> 1800 on 2026-09-01, for two compounding reasons: the board had grown to
 * ~2,900 checkable rows (600x4 = 2,400/day already short, audit issue #3), and update.yml
 * moved from every 6h to twice daily, halving runs. 1800x2 = 3,600/day covers ~2,900 with
 * room for the board to keep growing. If the cron changes again, change runsPerDay in
 * audit-listings.mjs and the x2 in listings-integrity.test.mjs WITH it. */
const CHECK_BUDGET = 1800;
/* Under 24h on purpose: at 48h a "daily" check was a promise the code did not keep. */
const RECHECK_MS = 20 * 60 * 60 * 1000;
const CHECK_CONCURRENCY = 6;
// Forget a dead req after a fortnight, so listings.json doesn't grow without bound.
const FORGET_CLOSED_MS = 14 * 24 * 60 * 60 * 1000;

const isCheckable = (l) => {
  try { return CHECKABLE_HOST.test(new URL(l.url).hostname); } catch (e) { return false; }
};

/* Every checker returns the same three-valued answer, and the third value is the important
 * one: true = open, false = DEFINITELY closed, null = could not tell, leave the row alone.
 *
 * §15a's rule, restated because it is the rule that matters here: anything ambiguous — a
 * timeout, a 5xx, a 403, a shape we did not expect — must return null. Dropping a live
 * posting because a server hiccuped costs somebody a job; leaving a dead one up for another
 * six hours costs a wasted click. Only an unambiguous "gone" may return false. */

/** Greenhouse / Lever / Ashby / iCIMS: a plain HEAD is enough. */
async function headCheck(url) {
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

/**
 * Workday. The posting HTML is a SPA shell that answers 200 for a req id that never
 * existed, so HEAD proves nothing; ask the cxs endpoint that backs it instead.
 *
 *   https://{host}/{site}/job/{path}  ->  https://{host}/wday/cxs/{tenant}/{site}/job/{path}
 *
 * The tenant is not in the posting URL. It is the first host label for every board on this
 * list, which is how they were validated in the first place — and if that guess is wrong the
 * endpoint answers 422, which is ambiguous, so the row is left alone rather than deleted.
 */
async function workdayCheck(url) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  const m = u.pathname.match(/^\/(?:([a-z]{2}-[A-Z]{2})\/)?([^/]+)\/job\/(.+)$/);
  if (!m) return null;                       // not a posting URL shape we understand
  const site = m[2], jobPath = m[3];
  const tenant = u.hostname.split(".")[0];
  try {
    const r = await fetch(`https://${u.hostname}/wday/cxs/${tenant}/${site}/job/${jobPath}`, {
      headers: { accept: "application/json", "User-Agent": "OfferAIO-pipeline/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (r.status === 404 || r.status === 410) return false;   // errorCode S21, "not found"
    if (!r.ok) return null;                                    // 422 = wrong tenant, unknown
    const j = await r.json();
    // A live req carries jobPostingInfo. Anything else is a shape we did not expect.
    if (j && j.jobPostingInfo) return true;
    if (j && j.httpStatus === 404) return false;
    return null;
  } catch (e) {
    return null;
  }
}

/** SmartRecruiters: the public postings API answers for a single id. */
async function smartRecruitersCheck(url) {
  const m = String(url).match(/jobs\.smartrecruiters\.com\/([^/?#]+)\/(\d+)/);
  if (!m) return null;
  try {
    const r = await fetch(`https://api.smartrecruiters.com/v1/companies/${m[1]}/postings/${m[2]}`, {
      headers: { accept: "application/json", "User-Agent": "OfferAIO-pipeline/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (r.status === 404 || r.status === 410) return false;
    // A 400 here means the id was malformed, not that the req closed. Ambiguous.
    return r.ok ? true : null;
  } catch (e) {
    return null;
  }
}

/** Dispatch to whichever checker understands this host. */
async function isStillOpen(url) {
  let host;
  try { host = new URL(url).hostname; } catch (e) { return null; }
  if (/(^|\.)myworkdayjobs\.com$/.test(host)) return workdayCheck(url);
  if (/(^|\.)smartrecruiters\.com$/.test(host)) return smartRecruitersCheck(url);
  return headCheck(url);
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
  isIntern, isUndergrad, isUS, dedupeKey, normUrl, normTitle, normCompany, normLoc, listing, termsFor,
  // Liveness, so a test can prove each host's checker against a real posting and a
  // fabricated one rather than trusting the comment above CHECKABLE_HOST.
  isStillOpen, headCheck, workdayCheck, smartRecruitersCheck, isCheckable,
  CHECKABLE_HOST, CHECK_BUDGET, RECHECK_MS, CHECK_CONCURRENCY,
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
    // Before the keys are computed, so http and https forms of one posting cannot both land.
    l.url = httpsUrl(l.url);
    const key1 = normUrl(l.url);
    const key2 = dedupeKey(l);
    const prevIdx = seen.has(key1) ? seen.get(key1) : seen.has(key2) ? seen.get(key2) : -1;
    if (prevIdx >= 0) {
      // Same role seen twice. Keep whichever row carries more — the community feed often
      // has the salary and every location, the direct ATS pull often has neither.
      if (richness(l) > richness(deduped[prevIdx])) deduped[prevIdx] = l;
      /* ⚠️ Register THIS row's keys against the survivor, win or lose.
       *
       * Without these two lines the winner's URL was never added to `seen`, so:
       *   A (url=uA, key=k) lands at idx 0
       *   B (url=uB, key=k) collides on k, replaces A at idx 0 — and uB stays unregistered
       *   C (url=uB, key=other) matches nothing and is pushed as a NEW row
       * and the board ends up with uB twice. Optiver posts the same title in the same city
       * under two req ids, which is exactly the shape that triggers it; audit-listings.mjs
       * caught three duplicate URLs this way on 2026-08-16.
       *
       * Guarded with `has`, because a key already pointing at a different index must keep
       * pointing there — remapping it would orphan the earlier association. */
      if (!seen.has(key1)) seen.set(key1, prevIdx);
      if (!seen.has(key2)) seen.set(key2, prevIdx);
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
  const nowSec = Math.floor(Date.now() / 1000);
  for (const l of deduped) {
    const p = previous.get(normUrl(l.url));
    if (p) {
      if (p.date_checked) l.date_checked = p.date_checked;
      if (p.active === false) {
        l.active = false;
        /* ⚠️ Carry date_closed too, or §15a's fortnight of retention does not exist.
         *
         * The fresh row from the feed has no date_closed. Without this line the forget
         * filter below evaluates `(undefined || 0) > cutoff` — false — and drops the row on
         * the very next run. The community feed has not noticed the req closed, so it
         * re-imports it as live, and the whole cycle repeats: flagged closed, forgotten,
         * re-imported, flagged closed. The two dead Veeam reqs PROJECT.md says were caught
         * on 2026-08-06 were still being caught twice a run on 08-16, which is what
         * finally made this visible. Retention is the thing that stops a dead posting
         * coming back, and it was the one part not carried across. */
        l.date_closed = p.date_closed || p.date_checked || nowSec;
      }
      /* When we first saw this posting, carried across runs.
       *
       * Needed to judge liveness coverage honestly: a row that arrived twenty minutes ago
       * has not been checked because it has not had the chance, and counting it as
       * unverified makes every board expansion look like a broken checker.
       * audit-listings.mjs measures coverage only over rows old enough to have been due. */
      l.date_first_seen = p.date_first_seen || p.date_posted || nowSec;
    } else {
      l.date_first_seen = nowSec;
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
    //
    // ⚠️ Counted over `open`, not `kept`, and that is the whole point: `total` is the open
    // rows, so counting coverage over `kept` measured the ratio against a different set and
    // quietly inflated it by however many closed rows were being retained. Caught by
    // tests/listings-integrity.test.mjs.
    checked: open.filter((l) => l.date_checked).length,
    checkable: open.filter(isCheckable).length,
    bySource: open.reduce((m, l) => ((m[l.source] = (m[l.source] || 0) + 1), m), {}),
  }, null, 2));
  console.log(
    `DONE: ${open.length} live listings → data/listings.json` +
    ` (${kept.length - open.length} retained as closed, ${forgotten} forgotten)`,
  );
})();
