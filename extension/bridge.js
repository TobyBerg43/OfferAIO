/* OfferAIO site bridge — relays your profile from the OfferAIO website
 * (offeraio.com) straight into the extension's storage, so you manage
 * everything on the site and the extension just executes. */
window.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || d.source !== "offeraio-site") return;
  if (d.type === "profile" && d.profile) {
    chrome.storage.local.set({ profile: d.profile, mode: d.mode || "semi" }, () => {
      window.postMessage({ source: "offeraio-ext", type: "saved" }, "*");
    });
  }
  if (d.type === "ping") window.postMessage({ source: "offeraio-ext", type: "pong" }, "*");
});
// announce the extension is installed so the site can show "connected"
window.postMessage({ source: "offeraio-ext", type: "ready" }, "*");
