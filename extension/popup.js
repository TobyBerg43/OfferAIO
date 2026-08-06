const F = ["name","email","phone","school","major","minor","gradDate","gpa","linkedin","needsSponsorship","coverLetter"];
const seg = document.getElementById("modeSeg");

seg.querySelectorAll("button").forEach((b) => {
  b.onclick = () => {
    seg.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    chrome.storage.local.set({ mode: b.dataset.v });
  };
});

chrome.storage.local.get(["profile","mode"], (d) => {
  const p = d.profile || {};
  F.forEach((k) => { if (p[k] != null) document.getElementById(k).value = p[k]; });
  const mode = d.mode || "semi";
  seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === mode));
});

document.getElementById("save").onclick = () => {
  const profile = {};
  F.forEach((k) => profile[k] = document.getElementById(k).value.trim());
  profile.needsSponsorship = document.getElementById("needsSponsorship").value === "true";
  const mode = seg.querySelector("button.on").dataset.v;
  chrome.storage.local.set({ profile, mode }, () => {
    const ok = document.getElementById("ok");
    ok.classList.add("show");
    setTimeout(() => ok.classList.remove("show"), 2500);
  });
};

/* ------------------------------------------------------------- the Fill button
 *
 * This button used to read the same on a Greenhouse form, on a new tab and on the
 * dashboard, inject two scripts, and close the popup — so on two of those three it
 * silently did nothing and never said so. Now it answers three questions before the
 * user clicks: is this an ATS we support, is there actually a form on it, and what
 * exactly am I about to fill. And after filling it reports what it managed.
 */

const fillBtn = document.getElementById("fillPage");
const fillNote = document.getElementById("fillNote");

function note(html, kind) {
  fillNote.innerHTML = html;
  fillNote.className = "note" + (kind ? " " + kind : "");
}

const ATS = self.OfferAIOATS;
const SUPPORTED_SUMMARY =
  "Works on Greenhouse, Lever, Ashby, Workday and " + (ATS.count - 4) + " more.";

/* Runs in the page. Deliberately self-contained rather than calling into content.js:
   merely opening the popup must not inject the in-page bar onto someone's screen.
   The form test mirrors content.js's buildBar() check so the two never disagree. */
function probePage() {
  const q = (s) => document.querySelector(s);
  const hasForm = !!q(
    'input[type="email"], input[name*="email" i], input[type="file"], input[name="name"]',
  );
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 70);
  const head = q(".app-title") || q(".posting-headline h2") || q("h1") || q("h2");
  let company = "";
  if (/lever\.co$/.test(location.hostname)) company = location.pathname.split("/")[1] || "";
  if (!company) {
    const c = q(".company-name") || q('[class*="company" i]');
    company = (c && c.textContent) || document.title.split(/[-|@]/).pop() || "";
  }
  return { hasForm, company: clean(company), role: clean(head && head.textContent) };
}

let activeTabId = null;

async function paintFillButton() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  activeTabId = tab.id;

  const ats = ATS.fromUrl(tab.url);
  if (!ats) {
    fillBtn.disabled = true;
    note("Open a job application, then click here. " + SUPPORTED_SUMMARY);
    return;
  }

  let probe = null;
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: probePage });
    probe = res && res.result;
  } catch (e) {
    // No access to this tab (a restricted page, or the user hasn't granted the host).
  }

  if (!probe || !probe.hasForm) {
    fillBtn.disabled = true;
    note("No application form on this page — open the Apply page first.");
    return;
  }

  fillBtn.disabled = false;
  fillBtn.textContent = "⚡ Fill this application";
  const who = [probe.company, probe.role].filter(Boolean).join(" — ");
  note("<b>" + ats.name + "</b>" + (who ? " · " + esc(who) : ""), "ready");
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

/** Drive content.js's fill and hand back what it achieved. */
function runFill() {
  return self.OfferAIOFill ? self.OfferAIOFill.run() : { ok: false, reason: "not_loaded" };
}

fillBtn.onclick = async () => {
  if (fillBtn.disabled || activeTabId == null) return;
  fillBtn.disabled = true;
  note("Filling…");
  try {
    // ats.js and license.js first — content.js reads the ATS name and the quota through
    // them, and an executeScript injection doesn't inherit the manifest's ordering.
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ["ats.js", "license.js", "content.js"],
    });
    const [res] = await chrome.scripting.executeScript({ target: { tabId: activeTabId }, func: runFill });
    const r = (res && res.result) || {};

    if (r.reason === "no_profile") {
      note("Add your name and email below first — there's nothing to fill with yet.", "warn");
      fillBtn.disabled = false;
      return;
    }
    if (!r.ok) {
      note("Couldn't fill this page. Try reloading it, then click again.", "warn");
      fillBtn.disabled = false;
      return;
    }

    const needs = (r.needsUser || []).length + (r.resumeMissing ? 1 : 0);
    let msg = "Filled <b>" + r.fieldsFilled + " of " + r.fieldsTotal + "</b> fields";
    msg += needs ? " · <b>" + needs + "</b> need you" : " · nothing left blank";
    if (r.resumeMissing) msg += "<br>Attach your resume — browsers won't let us do that one.";
    if ((r.needsUser || []).length) msg += "<br>Answer yourself: " + esc(r.needsUser.join("; "));
    msg += "<br>Review the page, then hit Submit there.";
    note(msg, needs ? "warn" : "done");
  } catch (e) {
    note("Couldn't reach that tab. Reload the page and try again.", "warn");
    fillBtn.disabled = false;
  }
};

paintFillButton();

/* ---------------------------------------------------------------- licensing */

const LIC = self.OfferAIOLicense;
const licMsg = document.getElementById("licMsg");
const licKey = document.getElementById("licKey");
const licRemove = document.getElementById("licRemove");

function say(text, kind) {
  licMsg.textContent = text;
  licMsg.className = "lic-msg show " + (kind || "");
}

const REASONS = {
  device_limit: "That key is already on the maximum number of browsers.",
  canceled: "That subscription was cancelled.",
  expired: "That key has expired.",
  unknown: "We don't recognise that key. Check it for typos.",
  malformed: "That doesn't look like a license key.",
  unreachable: "Couldn't reach OfferAIO. Check your connection and try again.",
  empty: "Paste your key first.",
};

async function paint() {
  const s = await LIC.status();
  const pro = s.plan === "pro";

  document.getElementById("planBadge").textContent = pro ? "PRO" : "FREE";
  document.getElementById("planBadge").className = "badge" + (pro ? " pro" : "");
  document.getElementById("usageText").textContent =
    s.used + " of " + s.quota + " submissions used this month";

  const pct = Math.min(100, Math.round((s.used / s.quota) * 100));
  const bar = document.getElementById("usageBar");
  bar.style.width = pct + "%";
  bar.className = pct >= 80 ? "hot" : "";

  // Only offer "Remove key" when there's actually a key stored.
  licRemove.style.display = s.reason === "no_key" ? "none" : "inline";

  if (pro && s.stale) {
    say("Pro (offline — couldn't reach OfferAIO, using your last known status).", "good");
  } else if (pro) {
    say("Pro is active on this browser.", "good");
    document.getElementById("licBlock").open = false;
  } else if (s.reason && s.reason !== "no_key") {
    say(REASONS[s.reason] || "This key isn't active.", "bad");
    document.getElementById("licBlock").open = true;
  }
}

document.getElementById("licActivate").onclick = async () => {
  const btn = document.getElementById("licActivate");
  btn.disabled = true;
  say("Checking…");
  const res = await LIC.activate(licKey.value);
  btn.disabled = false;
  if (res.ok) {
    licKey.value = "";
    say("Activated. You're on Pro — 250 submissions a month.", "good");
    await paint();
  } else {
    say(REASONS[res.reason] || "That key didn't work.", "bad");
  }
};

licKey.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("licActivate").click();
});

licRemove.onclick = async () => {
  await LIC.clearLicense();
  say("Key removed. Back to the Free limit.", "");
  await paint();
};

paint();
