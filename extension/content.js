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
    "#offeraio-bar .oa-logo{width:26px;height:26px;border-radius:7px;background:url('data:image/png;base64,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') center/contain no-repeat;flex:0 0 auto}",
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
    const left = '<div class="oa-left"><span class="oa-logo"></span><span class="oa-title">OfferAIO</span><span class="oa-status" id="oa-status">Ready - click Fill</span></div>';
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
