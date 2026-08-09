/* OfferAIO site bridge — relays your profile from the OfferAIO website
 * (offeraio.com) straight into the extension's storage, so you manage
 * everything on the site and the extension just executes.
 *
 * It also hands the dashboard the licence key + install id on request, so
 * offeraio.com/dashboard can call the Worker's /cover endpoint directly.
 * The dashboard deliberately does NOT mint its own install id: keys are
 * bound to at most 3 installs, and one browser must not eat two slots just
 * because the user opened the dashboard in it. */
window.addEventListener("message", (e) => {
  // Only trust messages this page posted to itself. Without this an embedded
  // third-party iframe could ask for the licence key and read the reply.
  if (e.source !== window) return;
  const d = e.data;
  if (!d || d.source !== "offeraio-site") return;
  if (d.type === "profile" && d.profile) {
    chrome.storage.local.set({ profile: d.profile, mode: d.mode || "semi" }, () => {
      window.postMessage({ source: "offeraio-ext", type: "saved" }, "*");
    });
  }
  if (d.type === "ping") window.postMessage({ source: "offeraio-ext", type: "pong" }, "*");
  if (d.type === "license") sendLicense();
  if (d.type === "identity") sendIdentity();
  if (d.type === "applications") sendApplications();
  if (d.type === "ats") sendAts();
});

/* Everything below answers the dashboard's "who is signed in and what have they
 * actually done?" — the questions it used to answer with hardcoded demo values.
 * There is no account system by design, so the extension IS the identity: the profile
 * the user saved, the plan their key entitles them to, and the applications the content
 * script genuinely recorded. Same `e.source !== window` guard as the licence reply. */

const FREE_QUOTA = 50;
const PRO_QUOTA = 250;
const monthKey = (d = new Date()) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");

/** Reply with {profile, usage:{plan,used,quota}}. */
function sendIdentity() {
  chrome.storage.local.get(["profile", "license", "usage"], async (s) => {
    // license.js is loaded alongside this script, so prefer its answer — it knows about
    // the 24h verify cache and the offline grace period. Fall back to reading storage
    // directly if it isn't there, rather than reporting nothing.
    let usage = null;
    const LIC = typeof self !== "undefined" && self.OfferAIOLicense;
    if (LIC && typeof LIC.status === "function") {
      try {
        const st = await LIC.status();
        usage = { plan: st.plan, used: st.used, quota: st.quota, stale: !!st.stale };
      } catch (e) { /* fall through to the storage read */ }
    }
    if (!usage) {
      const pro = !!(s.license && s.license.cache && s.license.cache.active);
      // The counter resets on the local-time month boundary, same rule as license.js.
      const used = s.usage && s.usage.month === monthKey() ? s.usage.count || 0 : 0;
      usage = { plan: pro ? "pro" : "free", used, quota: pro ? PRO_QUOTA : FREE_QUOTA };
    }
    window.postMessage(
      { source: "offeraio-ext", type: "identity", profile: s.profile || null, usage },
      "*",
    );
  });
}

/** Reply with every application the content script recorded on a real submit. */
function sendApplications() {
  chrome.storage.local.get(["applications"], (s) => {
    window.postMessage(
      {
        source: "offeraio-ext",
        type: "applications",
        applications: Array.isArray(s.applications) ? s.applications : [],
      },
      "*",
    );
  });
}

/** Reply with the applicant tracking systems this build can actually fill.
 *
 * The dashboard lists postings from a community board, and roughly half of them sit on
 * hosts no extension content script runs on — company career sites, TikTok, Rippling.
 * Before this, every one of those rows offered "Open & fill" and the fill silently never
 * happened, which is the same lie the 2026-08-06 pass took out of the task list.
 *
 * It answers from `ats.js` rather than letting the dashboard keep its own copy, so the
 * page describes the extension the user has installed instead of the one that was
 * current when the page shipped. An older extension answers with an older list and the
 * dashboard is still right; one that predates this message never answers, and the
 * dashboard falls back to promising nothing (see canFill() in OfferAIO.html). */
function sendAts() {
  const A = typeof self !== "undefined" && self.OfferAIOATS;
  window.postMessage(
    { source: "offeraio-ext", type: "ats", ats: (A && A.list) || [] },
    "*",
  );
}

/** Reply with {key, installId}, minting the install id if it doesn't exist yet.
 *  The same `installId` storage slot license.js reads, so the extension and the
 *  dashboard always present the same install to the Worker. */
function sendLicense() {
  chrome.storage.local.get(["license", "installId"], (s) => {
    const key = (s.license && s.license.key) || null;
    const reply = (installId) =>
      window.postMessage({ source: "offeraio-ext", type: "license", key, installId }, "*");
    if (s.installId) return reply(s.installId);
    const id =
      (crypto.randomUUID && crypto.randomUUID()) ||
      String(Date.now()) + Math.random().toString(16).slice(2);
    chrome.storage.local.set({ installId: id }, () => reply(id));
  });
}

// announce the extension is installed so the site can show "connected"
window.postMessage({ source: "offeraio-ext", type: "ready" }, "*");
