/* OfferAIO content script — fills internship applications in the user's own browser.
 * Works across the major applicant tracking systems (Greenhouse, Lever, Ashby, Workday,
 * SmartRecruiters, iCIMS, Workable, Handshake, LinkedIn, ZipRecruiter, Indeed and more)
 * by matching fields on standard autocomplete/name/label attributes rather than
 * hardcoding one site. Runs in YOUR browser (your IP, your session). Never bypasses
 * CAPTCHAs. Resume upload stays manual (browsers forbid scripts from attaching files) —
 * the field is highlighted for you. */
(() => {
  const HOST = location.hostname;
  const isLever = /lever\.co$/.test(HOST);

  const q = (s, r) => { try { return (r || document).querySelector(s); } catch (e) { return null; } };
  const qa = (s, r) => { try { return [...(r || document).querySelectorAll(s)]; } catch (e) { return []; } };

  function setValue(el, value) {
    if (!el || value == null || value === "" || el.offsetParent === null) return 0;
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return 1;
  }
  function fillFirst(selectors, value) {
    for (const sel of selectors) {
      const el = qa(sel).find((e) => e.offsetParent !== null && !e.value);
      if (el) return setValue(el, value);
    }
    return 0;
  }

  function answerFor(label, p) {
    const l = (label || "").toLowerCase();
    if (/sponsor|visa/.test(l)) return p.needsSponsorship ? "Yes" : "No";
    if (/authoriz|eligible to work|work authorization|legally/.test(l)) return "Yes";
    if (/\blinkedin\b/.test(l)) return p.linkedin;
    if (/graduat/.test(l)) return p.gradDate;
    if (/\bgpa\b/.test(l)) return p.gpa;
    if (/school|university|college/.test(l)) return p.school;
    if (/\bmajor\b|field of study/.test(l)) return p.major;
    if (/\bminor\b/.test(l)) return p.minor;
    if (/hear about|how did you find/.test(l)) return "Company website";
    return null;
  }

  const companyName = () => {
    if (isLever) return (location.pathname.split("/")[1] || "your team").trim();
    const c = q(".company-name") || q('[class*="company" i]');
    return ((c && c.textContent) || document.title.split(/[-|@]/).pop() || "your team").trim().slice(0, 60);
  };
  const roleName = () => {
    const h = q(".app-title") || q(".posting-headline h2") || q("h1") || q("h2");
    return (h ? h.textContent : "the role").trim().slice(0, 80);
  };

  // Cross-ATS field selectors
  const SEL = {
    first: ['#first_name', 'input[autocomplete="given-name"]', 'input[name*="first" i]', 'input[id*="first" i]', 'input[data-automation-id*="first" i]'],
    last: ['#last_name', 'input[autocomplete="family-name"]', 'input[name*="last" i]', 'input[id*="last" i]', 'input[data-automation-id*="last" i]'],
    full: ['input[name="name"]', 'input[autocomplete="name"]', 'input[id*="fullname" i]', 'input[name*="fullname" i]', 'input[aria-label*="full name" i]'],
    email: ['#email', 'input[type="email"]', 'input[autocomplete="email"]', 'input[name*="email" i]', 'input[id*="email" i]', 'input[data-automation-id*="email" i]'],
    phone: ['#phone', 'input[type="tel"]', 'input[autocomplete="tel"]', 'input[name*="phone" i]', 'input[id*="phone" i]', 'input[data-automation-id*="phone" i]'],
    linkedin: ['input[name*="linkedin" i]', 'input[id*="linkedin" i]', 'input[aria-label*="linkedin" i]', 'input[name="urls[LinkedIn]"]'],
    school: ['input[name*="school" i]', 'input[id*="school" i]', 'input[name="org"]', 'input[name*="university" i]'],
    minor: ['input[name*="minor" i]', 'input[id*="minor" i]', 'input[aria-label*="minor" i]'],
  };

  function selectOption(sel, val) {
    const opt = [...sel.options].find((o) => o.text.trim().toLowerCase() === String(val).toLowerCase());
    if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event("change", { bubbles: true })); return 1; }
    return 0;
  }

  function fill(p) {
    let n = 0;
    const parts = (p.name || "").split(" ");
    const gotFirst = fillFirst(SEL.first, parts[0]);
    const gotLast = fillFirst(SEL.last, parts.slice(1).join(" "));
    n += gotFirst + gotLast;
    if (!gotFirst && !gotLast) n += fillFirst(SEL.full, p.name);
    n += fillFirst(SEL.email, p.email);
    n += fillFirst(SEL.phone, p.phone);
    n += fillFirst(SEL.linkedin, p.linkedin);
    n += fillFirst(SEL.school, p.school);
    n += fillFirst(SEL.minor, p.minor);
    qa("label").forEach((lab) => {
      const ans = answerFor(lab.textContent, p);
      if (!ans) return;
      const id = lab.getAttribute("for");
      let inp = id && document.getElementById(id);
      if (!inp) inp = q("input, textarea, select", lab.parentElement || document);
      if (inp && inp.tagName === "SELECT") { n += selectOption(inp, ans); return; }
      if (inp && (inp.tagName === "INPUT" || inp.tagName === "TEXTAREA")) n += setValue(inp, ans);
    });
    return n;
  }

  const findCover = () => q('#cover_letter_text, textarea[name*="cover" i], textarea[name="comments"], textarea[id*="cover" i]');
  const findResume = () => q('input[type="file"]');
  const findSubmit = () =>
    q("#submit_app") || q("#btn-submit") ||
    qa('button, input[type="submit"], [role="button"]').find((b) => /submit application|submit|apply now|send application/i.test((b.textContent || b.value || "")));

  const CSS = [
    "#offeraio-bar{position:fixed;left:0;right:0;bottom:0;z-index:2147483647;display:flex;align-items:center;justify-content:space-between;padding:10px 18px;background:linear-gradient(90deg,#fbf8f2,#f4eee2);border-top:1px solid #d7cbb4;color:#2b2823;font:14px/1.4 -apple-system,'Segoe UI',sans-serif;box-shadow:0 -8px 30px rgba(70,55,35,.16)}",
    "#offeraio-bar .oa-left{display:flex;align-items:center;gap:10px}",
    "#offeraio-bar .oa-logo{width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,#33528c,#4a72b8);display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff}",
    "#offeraio-bar .oa-title{font-weight:700}",
    "#offeraio-bar .oa-status{color:#726a5c;font-size:12.5px;margin-left:6px}",
    "#offeraio-bar .oa-right{display:flex;gap:8px}",
    "#offeraio-bar button{border:1px solid #d7cbb4;background:#ffffff;color:#2b2823;padding:8px 16px;border-radius:9px;font-weight:600;font-size:13px;cursor:pointer}",
    "#offeraio-bar button:hover{border-color:#33528c}",
    "#offeraio-bar button.oa-primary{background:linear-gradient(135deg,#c8862f,#e0a548);border:none;color:#3a2a10}",
    "#offeraio-bar button.oa-green{background:linear-gradient(135deg,#2e9d68,#3cbd7f);border:none;color:#fff}"
  ].join("");

  let bar;
  function buildBar() {
    if (document.getElementById("offeraio-bar")) return;
    if (!q('input[type="email"], input[name*="email" i], input[type="file"], input[name="name"]')) return;
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    bar = document.createElement("div");
    bar.id = "offeraio-bar";
    const left = '<div class="oa-left"><span class="oa-logo">O</span><span class="oa-title">OfferAIO</span><span class="oa-status" id="oa-status">Ready - click Fill</span></div>';
    const right = '<div class="oa-right"><button id="oa-fill" class="oa-primary">Fill application</button><button id="oa-submit" class="oa-green" style="display:none">Submit</button></div>';
    bar.innerHTML = left + right;
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
    const n = fill(profile);
    const cl = findCover();
    if (cl && profile.coverLetter)
      setValue(cl, profile.coverLetter.split("{company}").join(companyName()).split("{role}").join(roleName()));
    const rf = findResume();
    if (rf) {
      rf.style.outline = "3px solid #33528c";
      (rf.closest("div,section,fieldset") || rf).scrollIntoView({ behavior: "smooth", block: "center" });
    }
    let tail = rf ? " - attach your resume (highlighted), then Submit" : " - review, then Submit";
    if (LIC()) {
      const s = await LIC().status();
      tail += " (" + s.remaining + " of " + s.quota + " left)";
    }
    status("Filled " + n + " fields" + tail);
    const sb = document.getElementById("oa-submit");
    if (sb) sb.style.display = "inline-block";
    if (mode === "auto") { status("Full-auto - submitting in 2s..."); setTimeout(doSubmit, 2000); }
  }

  const LIC = () => self.OfferAIOLicense;

  async function doSubmit() {
    if (q('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha')) {
      status("CAPTCHA present - solve it yourself, then click Submit (never bypassed).");
      return;
    }

    // Quota gate. If the licence module somehow isn't loaded, let the submission
    // through — a metering bug must never block someone from applying for a job.
    if (LIC()) {
      const s = await LIC().status();
      if (s.remaining <= 0) {
        status(
          s.plan === "pro"
            ? "You've used all " + s.quota + " submissions this month. Resets on the 1st."
            : "Free limit reached (" + s.quota + " this month). Upgrade to Pro for 250 - offeraio.com/pricing/",
        );
        return;
      }
    }

    const btn = findSubmit();
    if (!btn) { status("Could not find the Submit button - please submit manually."); return; }
    btn.click();

    // Counted only after the click actually happened, so a failed lookup above never
    // burns a submission.
    let note = "Submitted via OfferAIO";
    if (LIC()) {
      const u = await LIC().recordSubmission();
      const s = await LIC().status();
      note += " - " + u.count + "/" + s.quota + " this month";
    }
    status(note);
  }

  // SPA forms can render late — retry building the bar for a few seconds.
  let tries = 0;
  const boot = () => { buildBar(); if (!document.getElementById("offeraio-bar") && tries++ < 20) setTimeout(boot, 700); };
  if (document.body) boot();
  else window.addEventListener("DOMContentLoaded", boot);
})();
