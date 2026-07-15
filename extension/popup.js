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
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  } catch (e) {}
  window.close();
};
