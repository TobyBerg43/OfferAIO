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
});

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
