/**
 * OfferAIO Engine — Gmail Response Radar (repo location: gmail.js)
 * Official Gmail API + OAuth (no scraping). One-time setup:
 *   1. console.cloud.google.com → create project → enable Gmail API
 *   2. OAuth consent screen (External, test user = your gmail)
 *   3. Credentials → OAuth client ID → Desktop app → download JSON
 *      → save as engine-data/google-credentials.json
 * First /radar/start prints an auth URL; paste the code → token cached. Polls every 90s.
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const { google } = require("googleapis");

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
let events = [];       // queued detections for the dashboard to drain
let timer = null;
let dataDir = null;

const credsPath = () => path.join(dataDir, "google-credentials.json");
const tokenPath = () => path.join(dataDir, "google-token.json");

function isConfigured() { return dataDir ? fs.existsSync(credsPath()) : false; }
function drainEvents() { const e = events; events = []; return e; }

async function authorize() {
  const creds = JSON.parse(fs.readFileSync(credsPath(), "utf8"));
  const { client_id, client_secret } = creds.installed || creds.web;
  const redirect = "http://127.0.0.1:7719/oauth";
  const oauth = new google.auth.OAuth2(client_id, client_secret, redirect);
  if (fs.existsSync(tokenPath())) {
    oauth.setCredentials(JSON.parse(fs.readFileSync(tokenPath(), "utf8")));
    return oauth;
  }
  const url = oauth.generateAuthUrl({ access_type: "offline", scope: SCOPES });
  console.log("\n[radar] Authorize Gmail access — open this URL:\n" + url + "\n");
  const code = await new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const c = new URL(req.url, redirect).searchParams.get("code");
      res.end("OfferAIO Radar connected. You can close this tab.");
      if (c) { srv.close(); resolve(c); }
    }).listen(7719);
  });
  const { tokens } = await oauth.getToken(code);
  oauth.setCredentials(tokens);
  fs.writeFileSync(tokenPath(), JSON.stringify(tokens));
  return oauth;
}

function classify(subject, snippet) {
  const t = (subject + " " + snippet).toLowerCase();
  if (/interview|schedule a (call|time|chat)|next (round|step)|assessment|hackerrank|codility|hirevue|coding challenge/.test(t)) return "interview";
  if (/unfortunately|not (be )?moving forward|other candidates|regret to inform|will not be proceeding/.test(t)) return "rejection";
  if (/received your application|thank you for applying|application (was )?submitted|confirm your application/.test(t)) return "confirmation";
  return "reply";
}

async function poll(oauth) {
  const gmail = google.gmail({ version: "v1", auth: oauth });
  const q = 'newer_than:2d category:primary (subject:(application OR interview OR "next steps" OR assessment) OR "thank you for applying" OR "your application")';
  const list = await gmail.users.messages.list({ userId: "me", q, maxResults: 25 });
  const seenFile = path.join(dataDir, "radar-seen.json");
  const seen = new Set(fs.existsSync(seenFile) ? JSON.parse(fs.readFileSync(seenFile, "utf8")) : []);
  for (const m of list.data.messages || []) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    const full = await gmail.users.messages.get({ userId: "me", id: m.id, format: "metadata", metadataHeaders: ["Subject", "From"] });
    const headers = Object.fromEntries(full.data.payload.headers.map((h) => [h.name, h.value]));
    const type = classify(headers.Subject || "", full.data.snippet || "");
    events.push({
      type, via: "Gmail",
      from: headers.From || "", subject: headers.Subject || "",
      snippet: (full.data.snippet || "").slice(0, 180),
      time: new Date(+full.data.internalDate).toISOString(),
    });
  }
  fs.writeFileSync(seenFile, JSON.stringify([...seen].slice(-2000)));
}

async function start(dir) {
  dataDir = dir;
  if (!isConfigured()) throw new Error("Missing engine-data/google-credentials.json — see setup steps in gmail.js header.");
  const oauth = await authorize();
  if (timer) clearInterval(timer);
  await poll(oauth);
  timer = setInterval(() => poll(oauth).catch((e) => console.warn("[radar]", e.message)), 90_000);
  console.log("[radar] Gmail polling active (every 90s)");
}

module.exports = { start, drainEvents, isConfigured };
