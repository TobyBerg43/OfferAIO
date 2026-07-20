/* OfferAIO billing config — the one place the Stripe Payment Link lives.
 *
 * Loaded by landing.html, pricing/index.html and license.html. When the Payment Link
 * exists, paste it into PAYMENT_LINK below; every "Get access" button picks it up.
 *
 * Until then PAYMENT_LINK is empty and the buttons keep their existing waitlist
 * behaviour — so this can ship to the live site before Stripe is set up without
 * putting a dead checkout button on the marketing page.
 */
window.OfferAIO = window.OfferAIO || {};

// Paste the Stripe Payment Link here, e.g. "https://buy.stripe.com/xxxxxxxxxxxx".
// Set the link's success URL to: https://offeraio.com/license.html?session_id={CHECKOUT_SESSION_ID}
window.OfferAIO.PAYMENT_LINK = "";

// Same-origin when developing locally, so a local stub can stand in for the Worker.
window.OfferAIO.WORKER =
  location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? location.origin
    : "https://offeraio-worker.tobybergerbusiness.workers.dev";

(function () {
  var link = window.OfferAIO.PAYMENT_LINK;
  if (!link) return; // not configured yet — leave the waitlist fallback in place

  function wire() {
    document.querySelectorAll("[data-buy-pro]").forEach(function (el) {
      var a = document.createElement("a");
      a.className = el.className;
      a.href = link;
      a.textContent = el.textContent;
      a.setAttribute("data-buy-pro", "");
      a.addEventListener("click", function () {
        if (typeof gtag === "function") gtag("event", "begin_checkout", { plan: "pro", value: 30 });
      });
      el.replaceWith(a);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
