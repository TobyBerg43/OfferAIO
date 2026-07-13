/**
 * OfferAIO Engine — local companion server (repo location: server.js)
 * Run: npm install && npm start   →  listens on http://127.0.0.1:7717
 *
 * The OfferAIO.html dashboard auto-detects this engine and routes real work here:
 *   GET  /health                       → {ok, features}
 *   GET  /profile                      → stored profile
 *   POST /profile                      → save profile (name, email, phone, school, linkedin, qa{}, samples[])
 *   POST /resume/parse  {path}         → parse resume PDF into structured profile fields
 *   POST /cover         {company,role,description?} → AI cover letter in YOUR voice
 *   POST /apply         {url, mode, coverLetter?}   → Playwright fills the actual application
 *   POST /rank          {listings:[{company,role,url}]} → resume-similarity ranking (embeddings)
 *   GET  /radar/events                 → Gmail-detected responses since last poll
 *   POST /radar/start                  → begin Gmail polling (requires google-credentials.json)
 *
 * Env: ANTHROPIC_API_KEY or OPENAI_API_KEY  (cover letters + ranking)
 */
const express = require("express");
const fs = require("fs");
const path = require("path");
const { applyToJob } = require("./apply");
const { writeCover } = require("./cover");
const { parseResume } = require("./resume");
const { rankListings } = require("./rank");
const radar = require("./gmail");

const PORT = 7717;
const DATA = path.join(__dirname, "engine-data");
fs.mkdirSync(DATA, { recursive: true });
const PROFILE_FILE = path.join(DATA, "profile.json");

const app = express();
app.use(express.json({ limit: "10mb" }));
// The dashboard is opened as a local file — allow it.
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "content-type");
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const loadProfile = () => (fs.existsSync(PROFILE_FILE) ? JSON.parse(fs.readFileSync(PROFILE_FILE, "utf8")) : {});
const saveProfile = (p) => fs.writeFileSync(PROFILE_FILE, JSON.stringify(p, null, 2));

// Serve the dashboard itself at http://127.0.0.1:7717/ — pulls the latest from the
// repo each start (so product updates ship via git), caches to disk for offline use.
const DASH_FILE = path.join(DATA, "dashboard.html");
const DASH_URL = "https://raw.githubusercontent.com/TobyBerg43/OfferAIO/main/OfferAIO.html";
app.get("/", async (_req, res) => {
  try {
    const html = await fetch(DASH_URL, { signal: AbortSignal.timeout(4000) }).then((r) => r.text());
    if (html && html.includes("OfferAIO")) fs.writeFileSync(DASH_FILE, html);
  } catch (_) { /* offline — fall back to cache below */ }
  if (fs.existsSync(DASH_FILE)) return res.type("html").send(fs.readFileSync(DASH_FILE, "utf8"));
  res.status(503).send("Dashboard not cached yet and repo unreachable. Check your connection and reload.");
});

app.get("/health", (_req, res) => {
  const hasLLM = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
  res.json({
    ok: true, engine: "offeraio-engine/1.0.0",
    features: {
      apply: true,
      cover: hasLLM,
      rank: !!process.env.OPENAI_API_KEY, // embeddings need OpenAI
      radar: radar.isConfigured(),
      resume: true,
    },
  });
});

app.get("/profile", (_req, res) => res.json(loadProfile()));
app.post("/profile", (req, res) => {
  const merged = { ...loadProfile(), ...req.body };
  saveProfile(merged);
  res.json({ ok: true, profile: merged });
});

app.post("/resume/parse", async (req, res) => {
  try {
    const parsed = await parseResume(req.body.path);
    const merged = { ...loadProfile(), ...parsed, resumePath: req.body.path };
    saveProfile(merged);
    res.json({ ok: true, parsed });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.post("/cover", async (req, res) => {
  try {
    const letter = await writeCover({ ...req.body, profile: loadProfile() });
    res.json({ ok: true, letter });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.post("/apply", async (req, res) => {
  const { url, mode = "semi", coverLetter = "" } = req.body;
  if (!url) return res.status(400).json({ ok: false, error: "url required" });
  const profile = loadProfile();
  if (!profile.email) return res.status(400).json({ ok: false, error: "Save your profile first (POST /profile)" });
  try {
    const result = await applyToJob({ url, mode, coverLetter, profile });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post("/rank", async (req, res) => {
  try {
    const profile = loadProfile();
    const order = await rankListings(profile.resumeText || "", req.body.listings || []);
    res.json({ ok: true, order });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.post("/radar/start", async (_req, res) => {
  try { await radar.start(DATA); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.get("/radar/events", (_req, res) => res.json({ ok: true, events: radar.drainEvents() }));

app.listen(PORT, "127.0.0.1", () =>
  console.log(`\n  OfferAIO Engine ready.\n  >>> Open your dashboard here:  http://127.0.0.1:${PORT}  <<<\n  (leave this window open)\n`));
