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

document.getElementById("fillPage").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    // license.js first — content.js reads the quota through it.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["license.js", "content.js"] });
  } catch (e) {}
  window.close();
};

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
