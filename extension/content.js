/* OfferAIO content script — fills Greenhouse & Lever applications in the user's own browser.
 * Runs in YOUR browser (your IP, your session), so it behaves like a normal applicant — no
 * datacenter-IP bot flags. It never bypasses CAPTCHAs. Resume upload stays manual (browsers
 * forbid scripts from attaching files), so we highlight that field for you. */
(() => {
  const HOST = location.hostname;
  const isLever = /lever\.co$/.test(HOST);
  const isGH = /greenhouse\.io$/.test(HOST);
  if (!isLever && !isGH) return;

  const q = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => [...r.querySelectorAll(s)];

  function setValue(el, value) {
    if (!el || value == null || value === "") return 0;
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return 1;
  }

  function answerFor(label, p) {
    const l = (label || "").toLowerCase();
    if (/sponsor|visa/.test(l)) return p.needsSponsorship ? "Yes" : "No";
    if (/authoriz|eligible to work|work authorization|legally/.test(l)) return "Yes";
    if (/\blinkedin\b/.test(l)) return p.linkedin;
    if (/graduat/.test(l)) return p.gradDate;
    if (/gpa/.test(l)) return p.gpa;
    if (/school|university|college/.test(l)) return p.school;
    if (/\bmajor\b|field of study/.test(l)) return p.major;
    if (/hear about|how did you find/.test(l)) return "Company website";
    return null;
  }

  const companyName = () => {
    if (isLever) return (location.pathname.split("/")[1] || "your team").trim();
    const c = q(".company-name");
    return ((c && c.textContent) || document.title.split(/[-|@]/).pop() || "your team").trim();
  };
  const roleName = () => {
    const h = q(".app-title") || q(".posting-headline h2") || q("h1") || q("h2");
    return (h ? h.textContent : "the role").trim();
  };

  function fillGreenhouse(p) {
    let n = 0;
    const parts = (p.name || "").split(" ");
    n += setValue(q('#first_name, input[autocomplete="given-name"], input[name*="first_name"]'), parts[0]);
    n += setValue(q('#last_name, input[autocomplete="family-name"], input[name*="last_name"]'), parts.slice(1).join(" "));
    n += setValue(q('#email, input[type="email"], input[name*="email"]'), p.email);
    n += setValue(q('#phone, input[type="tel"], input[name*="phone"]'), p.phone);
    qa("label").forEach((lab) => {
      const ans = answerFor(lab.textContent, p);
      if (!ans) return;
      const id = lab.getAttribute("for");
      const inp = id && document.getElementById(id);
      if (inp && (inp.tagName === "INPUT" || inp.tagName === "TEXTAREA")) n += setValue(inp, ans);
    });
    return n;
  }

  function fillLever(p) {
    let n = 0;
    n += setValue(q('input[name="name"]'), p.name);
    n += setValue(q('input[name="email"]'), p.email);
    n += setValue(q('input[name="phone"]'), p.phone);
    n += setValue(q('input[name="org"]'), p.school);
    n += setValue(q('input[name="urls[LinkedIn]"], input[name="urls[Linkedin]"]'), p.linkedin);
    qa(".application-question, .application-field").forEach((card) => {
      const lab = q(".application-label, label", card);
      const ans = answerFor(lab && lab.textContent, p);
      if (!ans) return;
      const inp = q('input[type="text"], textarea', card);
      if (inp) n += setValue(inp, ans);
    });
    return n;
  }

  const findCover = () => q('#cover_letter_text, textarea[name*="cover"], textarea[name="comments"]');
  const findResume = () => q('input[type="file"]');
  const findSubmit = () =>
    q("#submit_app") || q("#btn-submit") ||
    qa('button, input[type="submit"]').find((b) => /submit application|submit|apply now/i.test((b.textContent || b.value || "")));

  const CSS =
    "#offeraio-bar{position:fixed;left:0;right:0;bottom:0;z-index:2147483647;display:flex;align-items:center;" +
    "justify-content:space-between;padding:10px 18px;background:linear-gradient(90deg,#0c0c16,#11111f);" +
    "border-top:1px solid #2e2e4d;color:#e8e8f4;font:14px/1.4 -apple-system,'Segoe UI',sans-serif;box-shadow:0 -8px 30px rgba(0,0,0,.5)}" +
    "#offeraio-bar .oa-left{display:flex;align-items:center;gap:10px}" +
    "#offeraio-bar .oa-logo{width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,#7c5cff,#4c8dff);display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff}" +
    "#offeraio-bar .oa-title{font-weight:700}#offeraio-bar .oa-status{color:#8b8ba8;font-size:12.5px;margin-left:6px}" +
    "#offeraio-bar .oa-right{display:flex;gap:8px}" +
    "#offeraio-bar button{border:1px solid #2e2e4d;background:#161628;color:#e8e8f4;padding:8px 16px;border-radius:9px;font-weight:600;font-size:13px;cursor:pointer}" +
    "#offeraio-bar button:hover{border-color:#7c5cff}" +
    "#offeraio-bar button.oa-primary{background:linear-gradient(135deg,#7c5cff,#4c8dff);border:none}" +
    "#offeraio-bar button.oa-green{background:linear-gradient(135deg,#1eb873,#2fe08d);border:none;color:#04150c}";

  let bar;
  function buildBar() {
    if (document.getElementById("offeraio-bar")) return;
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    bar = document.createElement("div");
    bar.id = "offeraio-bar";
    bar.innerHTML =
      '<div class="oa-left"><span class="oa-logo">O</span><span class="oa-title">OfferAIO</span>' +
      '<span class="oa-status" id="oa-status">Ready - click Fill</span></div>' +
      '<div class="oa-right"><button id="oa-fill" class="oa-primary">Fill application</button>' +
      '<button id="oa-submit" class="oa-green" style="display:none">Submit</button></div>';
    document.body.appendChild(bar);
    q("#oa-fill", bar).onclick = run;
    q("#oa-submit", bar).onclick = doSubmit;
  }
  const status = (t) => { const s = document.getElementById("oa-status"); if (s) s.textContent = t; };

  const getData = () => new Promise((r) => chrome.storage.local.get(["profile", "mode"], (d) => r(d)));

  async function run() {
    const d = await getData();
    const profile = d.profile || {};
    const mode = d.mode || "semi";
    if (!profile.email) { status("Open the OfferAIO extension and save your profile first"); return; }
    const n = isLever ? fillLever(profile) : fillGreenhouse(profile);
    const cl = findCover();
    if (cl && profile.coverLetter)
      setValue(cl, profile.coverLetter.split("{company}").join(companyName()).split("{role}").join(roleName()));
    const rf = findResume();
    if (rf) {
      rf.style.outline = "3px solid #7c5cff";
      (rf.closest("div,section,fieldset") || rf).scrollIntoView({ behavior: "smooth", block: "center" });
    }
    status("Filled " + n + " fields" + (rf ? " - attach your resume (highlighted), then Submit" : " - review, then Submit"));
    const sb = document.getElementById("oa-submit");
    if (sb) sb.style.display = "inline-block";
    if (mode === "auto") { status("Full-auto - submitting in 2s..."); setTimeout(doSubmit, 2000); }
  }

  function doSubmit() {
    if (q('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha')) {
      status("CAPTCHA present - solve it yourself, then click Submit (never bypassed).");
      return;
    }
    const btn = findSubmit();
    if (!btn) { status("Could not find the Submit button - please submit manually."); return; }
    btn.click();
    status("Submitted via OfferAIO");
  }

  if (document.body) buildBar();
  else window.addEventListener("DOMContentLoaded", buildBar);
})();
