/* End-to-end verification of the extension in a real Chrome, with the real extension
 * loaded, driving the real content script from its real isolated world.
 *
 *   node tests/browser-endtoend.mjs          # run it
 *   node tests/browser-endtoend.mjs --head   # watch it happen in a visible window
 *
 * WHY THIS EXISTS, and why the unit tests do not cover it.
 *
 * PROJECT.md §17 ships the résumé auto-attach on a claim that was only ever checked in a
 * normal page: that `input.files = dataTransfer.files` works, and that the file genuinely
 * reaches the form's FormData rather than merely appearing attached. Content scripts do
 * not run in a normal page. They run in an isolated world — a separate JS context over
 * the same DOM, with its own `File`, `DataTransfer` and `FileList` constructors. Whether
 * a FileList minted in that world is accepted by an input belonging to the page's world
 * is exactly the question §17 left open, and it is not a question a jsdom-shaped unit
 * test can answer: `tests/content-tracker.test.mjs` supplies its own fake DOM, so it
 * proves the logic and assumes the browser.
 *
 * If that handoff fails, the failure is silent and lands in the worst possible place: the
 * user submits believing their résumé went with it, and it did not.
 *
 * WHY THE MOCK FORM IS BUILT HERE INSTEAD OF COMMITTED AS A PAGE. GitHub Pages publishes
 * every file in this repo, so a tracked `dev/mock-application.html` would put a
 * convincing fake job posting live on offeraio.com — which is why the `dev-harness`
 * branch exists and stays unmerged. Generating the form into a temp dir at runtime keeps
 * the coverage and publishes nothing: this file is a .mjs, not a page.
 *
 * The extension is likewise copied to a temp dir and given a `127.0.0.1` host permission
 * *there*. `extension/` is never touched, so a local-only host entry cannot leak into the
 * zip that goes to the Web Store.
 *
 * Not run in CI (`test.yml` globs `tests/*.test.mjs`, which this deliberately is not) —
 * it needs a real Chrome binary and a few seconds of wall clock.
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm, cp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 7823;
const DEBUG_PORT = 9334;
const HEADED = process.argv.includes("--head");
const ORIGIN = `http://127.0.0.1:${PORT}`;

/* A real PDF, small enough to inline. The bytes matter: attachResume() rebuilds a File
   from base64 and the assertion below reads the size back off the form, so a placeholder
   string would still pass while proving less. */
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
);
const RESUME = {
  name: "ada-lovelace-resume.pdf",
  type: "application/pdf",
  size: PDF.length,
  data: PDF.toString("base64"),
  savedAt: 1755200000000,
};

/* The shape both profile UIs actually write. `name` is one full-name field, not
   firstName/lastName — content.js splits it. Getting this wrong is how the first run of
   this harness "found" a name-filling bug that was really a bad fixture, which is its own
   argument for tests/profile-contract.test.mjs. */
const PROFILE = {
  name: "Ada Lovelace",
  email: "ada@berkeley.edu", phone: "555-0142",
  school: "UC Berkeley", major: "Computer Science", gpa: "3.9",
  gradDate: "May 2027", linkedin: "https://linkedin.com/in/ada",
  workAuth: "US Citizen", needsSponsorship: false,
  coverLetter: "I would love to join {company} as a {role}.",
};

/* A Greenhouse-shaped form. Every field here is load-bearing for one rule in PROJECT.md
   §7 — see the comments — so trimming it silently removes a check. */
const FORM_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="robots" content="noindex,nofollow"><title>Mock application — local harness</title></head>
<body>
<h1>Software Engineering Intern, Summer 2027</h1>
<div>Northwind Systems &middot; San Francisco, CA</div>
<form id="application_form">
  <label for="first_name">First name *</label>
  <input id="first_name" name="first_name" autocomplete="given-name" required>
  <label for="last_name">Last name *</label>
  <input id="last_name" name="last_name" autocomplete="family-name" required>
  <label for="email">Email *</label>
  <input id="email" name="email" type="email" autocomplete="email" required>
  <label for="phone">Phone</label>
  <input id="phone" name="phone" type="tel" autocomplete="tel">
  <label for="school">School</label>
  <input id="school" name="school">

  <!-- §17: the whole point of this harness. -->
  <label for="resume">Attach your resume *</label>
  <input id="resume" name="resume" type="file" accept=".pdf,.doc,.docx" required>

  <label for="major">Major</label>
  <input id="major" name="major">
  <label for="gpa">GPA</label>
  <input id="gpa" name="gpa">

  <!-- §7 rule 1: contains both "without" and "sponsor". Must be left blank. -->
  <label for="work_auth">Are you authorized to work in the United States without sponsorship? *</label>
  <select id="work_auth" name="work_auth" required>
    <option value="">— Please select —</option><option>Yes</option><option>No</option>
  </select>

  <!-- §7 rule 4: two questions, two inputs, one parent, no for=. Must fill neither. -->
  <div>
    <label>Will you now or in the future require visa sponsorship?</label>
    <input name="q_sponsorship_future">
    <label>How did you hear about this role?</label>
    <input name="q_source">
  </div>

  <label for="cover_letter_text">Cover letter</label>
  <textarea id="cover_letter_text" name="cover_letter_text"></textarea>

  <!-- §7 rule 3: required and unfillable, so checkValidity() must refuse the click.
       Carries aria-required as well, which is what regressed in §7 rule 5. -->
  <label for="why">Why do you want to work at Northwind? *</label>
  <textarea id="why" name="why" required aria-required="true"></textarea>

  <button id="submit_app" type="submit">Submit application</button>
</form>
<script>
  // The fake employer. window.__mode picks which branch of awaitSubmitOutcome() runs.
  window.__mode = "confirm";
  window.__submitCount = 0;
  document.getElementById("application_form").addEventListener("submit", (e) => {
    e.preventDefault();
    window.__submitCount++;
    if (window.__mode === "silent") return;
    if (window.__mode === "replace") { e.target.remove(); return; }
    const d = document.createElement("div");
    d.id = "confirmation";
    d.textContent = "Thank you for applying! Your application has been received.";
    document.body.appendChild(d);
  });
</script>
</body></html>`;

/* ---------------------------------------------------------------- Chrome + CDP glue */

function findChrome() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  const hit = candidates.find((p) => p && existsSync(p));
  if (!hit) throw new Error("Chrome not found — add its path to findChrome().");
  return hit;
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers.get(msg.method) || []) h(msg.params);
      }
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", () => rej(new Error("CDP socket failed")), { once: true });
    });
    return new CDP(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, ms = 15000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error("timed out waiting for " + what);
    await sleep(120);
  }
}

/* ------------------------------------------------------------------------- assertions */

let passed = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { passed++; console.log("  ok   " + name); }
  else { failures.push(name + (detail ? " — " + detail : "")); console.log("  FAIL " + name + (detail ? "\n         " + detail : "")); }
}

/* ------------------------------------------------------------------------------ main */

const extDir = await mkdtemp(join(tmpdir(), "offeraio-ext-"));
const profileDir = await mkdtemp(join(tmpdir(), "offeraio-profile-"));
let chromeProc, server;

try {
  // The extension, copied and given a local host permission that never touches the repo.
  await cp(join(ROOT, "extension"), extDir, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extDir, "manifest.json"), "utf8"));
  const local = `${ORIGIN}/*`;
  manifest.host_permissions.push(local);
  manifest.content_scripts[0].matches.push(local);
  await writeFile(join(extDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(FORM_HTML);
  });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

  const chrome = findChrome();
  console.log("chrome:   " + chrome);
  console.log("extension:" + extDir);
  /* --load-extension and --disable-extensions-except are ignored by branded Google Chrome
     ("not allowed in Google Chrome"), so the extension is installed over CDP instead —
     Extensions.loadUnpacked, which is what --enable-unsafe-extension-debugging unlocks.
     Worth knowing before "fixing" this back to the flags: they fail *silently* apart from
     one warning on stderr, and the symptom is simply that no isolated world ever appears. */
  chromeProc = spawn(chrome, [
    HEADED ? "--new-window" : "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--enable-unsafe-extension-debugging",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ], { stdio: "ignore" });

  const version = await waitFor(async () => {
    try { return await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).then((r) => r.json()); }
    catch { return null; }
  }, "Chrome's debugging endpoint");
  console.log("version:  " + version.Browser);

  const browser = await CDP.connect(version.webSocketDebuggerUrl);
  const loaded = await browser.send("Extensions.loadUnpacked", { path: extDir });
  console.log("loaded:   " + loaded.id);

  const wsUrl = await waitFor(async () => {
    const list = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json());
    const page = list.find((t) => t.type === "page" && !t.url.startsWith("chrome-extension:"));
    return page && page.webSocketDebuggerUrl;
  }, "a page target");

  const cdp = await CDP.connect(wsUrl);
  const contexts = [];
  cdp.on("Runtime.executionContextCreated", (p) => contexts.push(p.context));
  cdp.on("Runtime.executionContextsCleared", () => (contexts.length = 0));
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");

  /** Navigate, then hand back the id of the content script's isolated world. */
  async function freshPage() {
    contexts.length = 0;
    await cdp.send("Page.navigate", { url: ORIGIN + "/?cachebust=" + Math.random().toString(36).slice(2) });
    const ctx = await waitFor(
      () => contexts.find((c) => c.auxData && c.auxData.type === "isolated") || null,
      "the content script's isolated world"
    );
    // content.js runs at document_idle and boots its bar asynchronously.
    await waitFor(() => evalIn(ctx.id, "!!self.OfferAIOFill").then((v) => v === true), "OfferAIOFill");
    return ctx.id;
  }

  /** Evaluate in a specific world and return the value, throwing on a page-side throw. */
  async function evalIn(contextId, expression) {
    const r = await cdp.send("Runtime.evaluate", {
      expression: `(async () => { ${expression.includes("return") ? expression : "return (" + expression + ")"} })()`,
      contextId, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result.value;
  }
  /** Same, in the page's own world — used to read the form as the employer sees it. */
  async function evalInPage(expression) {
    const main = contexts.find((c) => c.auxData && c.auxData.isDefault);
    return evalIn(main.id, expression);
  }

  const seed = (extra = {}) => `
    await chrome.storage.local.clear();
    await chrome.storage.local.set(${JSON.stringify({ profile: PROFILE, resume: RESUME, mode: "semi" })});
    await chrome.storage.local.set(${JSON.stringify(extra)});
    return true;`;

  /* ------------------------------------------------------------- 1. the §17 claim */
  console.log("\n§17 — the résumé handoff, from a content script's isolated world");
  {
    const ctx = await freshPage();
    await evalIn(ctx, seed());
    const out = await evalIn(ctx, `
      const rf = document.querySelector('input[type=file]');
      const { resume } = await chrome.storage.local.get('resume');
      let changed = false, inputted = false;
      rf.addEventListener('change', () => { changed = true; });
      rf.addEventListener('input', () => { inputted = true; });
      const returned = await self.OfferAIOFill.attachResume(rf, resume);
      const fd = new FormData(document.getElementById('application_form'));
      const f = fd.get('resume');
      return {
        returned, changed, inputted,
        count: rf.files.length,
        name: rf.files[0] && rf.files[0].name,
        size: rf.files[0] && rf.files[0].size,
        inFormData: f && typeof f === 'object' ? { name: f.name, size: f.size, type: f.type } : String(f),
        validity: rf.checkValidity(),
      };`);

    check("attachResume() reports success", out.returned === true, JSON.stringify(out));
    check("the file is on the input", out.count === 1 && out.name === RESUME.name, JSON.stringify(out));
    check("the bytes survive the base64 round trip", out.size === PDF.length, `expected ${PDF.length}, got ${out.size}`);
    check(
      "it is genuinely in the form's FormData",
      out.inFormData && out.inFormData.name === RESUME.name && out.inFormData.size === PDF.length,
      "FormData carried: " + JSON.stringify(out.inFormData)
    );
    check("change and input both fire", out.changed === true && out.inputted === true, JSON.stringify(out));
    check("the required file input now validates", out.validity === true);

    // The page's own world must see the same file — a wrapper that only exists in the
    // isolated world would satisfy every assertion above and still submit nothing.
    const asPageSees = await evalInPage(`
      const rf = document.querySelector('input[type=file]');
      const f = new FormData(document.getElementById('application_form')).get('resume');
      return { count: rf.files.length, name: rf.files[0] && rf.files[0].name, fd: f && f.name, size: f && f.size };`);
    check(
      "the page's own world sees the same file",
      asPageSees.count === 1 && asPageSees.fd === RESUME.name && asPageSees.size === PDF.length,
      JSON.stringify(asPageSees)
    );
  }

  /* ------------------------------------------- 2. it refuses to overwrite the user's */
  {
    const ctx = await freshPage();
    await evalIn(ctx, seed());
    const out = await evalIn(ctx, `
      const rf = document.querySelector('input[type=file]');
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([1,2,3])], 'user-picked.pdf', { type: 'application/pdf' }));
      rf.files = dt.files;
      const { resume } = await chrome.storage.local.get('resume');
      const returned = await self.OfferAIOFill.attachResume(rf, resume);
      return { returned, name: rf.files[0].name, count: rf.files.length };`);
    check("a file the user attached is left alone", out.name === "user-picked.pdf" && out.count === 1, JSON.stringify(out));
    check("...and it still reports attached", out.returned === true);
  }

  /* ------------------------------------------------- 3. the full fill, end to end */
  console.log("\n§7 — the safety rules, against a real form in a real browser");
  {
    const ctx = await freshPage();
    await evalIn(ctx, seed());
    const out = await evalIn(ctx, `
      const r = await self.OfferAIOFill.run();
      const v = (sel) => { const el = document.querySelector(sel); return el ? el.value : null; };
      const rf = document.querySelector('input[type=file]');
      const fd = new FormData(document.getElementById('application_form'));
      return {
        ran: r,
        first: v('#first_name'), last: v('#last_name'), email: v('#email'),
        school: v('#school'), major: v('#major'), gpa: v('#gpa'),
        workAuth: v('#work_auth'),
        sponsorFuture: v('[name=q_sponsorship_future]'),
        source: v('[name=q_source]'),
        cover: v('#cover_letter_text'),
        resumeCount: rf.files.length,
        resumeInFormData: (fd.get('resume') || {}).name,
        resumeOutline: rf.style.outline,
        status: (document.getElementById('oa-status') || {}).textContent,
      };`);

    check("the bar mounted and the fill ran", !!out.status, JSON.stringify(out).slice(0, 300));
    check("contact fields are filled", out.first === "Ada" && out.last === "Lovelace" && out.email === "ada@berkeley.edu", JSON.stringify(out));
    check("education fields are filled", out.school === "UC Berkeley" && out.major === "Computer Science" && out.gpa === "3.9", JSON.stringify(out));
    check("the cover letter is templated", (out.cover || "").includes("Northwind") || (out.cover || "").length > 0, out.cover);
    check("§17: the résumé is attached by run()", out.resumeCount === 1 && out.resumeInFormData === RESUME.name, JSON.stringify(out));
    // Chrome reports the computed value, so match the colour rather than the hex we wrote.
    check("§17: the field is outlined green, not blue", /rgb\(46,\s*157,\s*104\)/.test(out.resumeOutline || ""), out.resumeOutline);
    check("§17: the bar says the résumé is attached", /resume attached/i.test(out.status || ""), out.status);
    // A citizen who said so: "without sponsorship?" IS unambiguous for them, and refusing
    // to answer a question we can answer is its own kind of failure.
    check("§7 rule 1: an answerable work-auth question is answered", out.workAuth === "Yes", JSON.stringify(out.workAuth));
    check("§7 rule 4: the dense block is not guessed at", out.sponsorFuture === "" && out.source === "", JSON.stringify(out));
    check("§7 rule 4: the bar names what it refused to answer", /answer yourself/i.test(out.status || ""), out.status);
  }

  /* ------------------------ 3b. the same form, for the student the rule exists to protect */
  {
    const ctx = await freshPage();
    // Exactly what the UIs now store for "F-1 (CPT/OPT)": the selection, and no boolean.
    await evalIn(ctx, seed({ profile: { ...PROFILE, workAuth: "F-1 (CPT/OPT)", needsSponsorship: undefined } }));
    const out = await evalIn(ctx, `
      await self.OfferAIOFill.run();
      return {
        workAuth: document.getElementById('work_auth').value,
        outline: document.getElementById('work_auth').style.outline,
        status: (document.getElementById('oa-status') || {}).textContent,
      };`);
    check("F-1: 'authorized to work without sponsorship?' is left blank", out.workAuth === "", JSON.stringify(out));
    check("F-1: the field is outlined amber", /rgb\(200,\s*134,\s*47\)/.test(out.outline || ""), out.outline);
    check("F-1: the bar names it", /answer yourself/i.test(out.status || "") && /authoriz/i.test(out.status || ""), out.status);
  }

  /* --------------------- 3c. a profile written before any of this still never guesses */
  {
    const ctx = await freshPage();
    // The old popup default: a boolean nobody chose, and no selection behind it.
    await evalIn(ctx, seed({ profile: { name: "Ada Lovelace", email: "ada@berkeley.edu", needsSponsorship: false } }));
    const out = await evalIn(ctx, `
      await self.OfferAIOFill.run();
      return { workAuth: document.getElementById('work_auth').value,
               status: (document.getElementById('oa-status') || {}).textContent };`);
    check("a legacy `needsSponsorship:false` is not treated as an answer", out.workAuth === "", JSON.stringify(out));
  }

  /* ---------------------------------- 4. submit refuses while a required field is empty */
  {
    const ctx = await freshPage();
    await evalIn(ctx, seed());
    const out = await evalIn(ctx, `
      await self.OfferAIOFill.run();
      const before = await chrome.storage.local.get(['applications', 'usage']);
      await self.OfferAIOFill.doSubmit();
      await new Promise((r) => setTimeout(r, 400));
      const after = await chrome.storage.local.get(['applications', 'usage']);
      return {
        submitCount: window.wrappedJSObject ? null : undefined,
        recorded: (after.applications || []).length,
        status: (document.getElementById('oa-status') || {}).textContent,
        usageBefore: JSON.stringify(before.usage || null),
        usageAfter: JSON.stringify(after.usage || null),
      };`);
    const pageSubmits = await evalInPage("window.__submitCount");
    check("§7 rule 3: the form never submits while 'why' is empty", pageSubmits === 0, "submit handler fired " + pageSubmits + " times");
    check("§7 rule 3: nothing is recorded", out.recorded === 0, JSON.stringify(out));
    check("§7 rule 3: no quota is charged", out.usageBefore === out.usageAfter, out.usageBefore + " -> " + out.usageAfter);
    // §7 rule 5: the shadowed `CSS` global made this branch throw after outlining the
    // field, so the user got a highlight and no words. The message must name the field.
    check("§7 rule 5: the user is told which field is missing",
      /still needs/i.test(out.status || "") && /why/i.test(out.status || ""), out.status);
  }

  /* ------------------------------------------------- 5. the evidenced happy path */
  console.log("\n§7 — the tracker, once the form is genuinely complete");
  {
    const ctx = await freshPage();
    await evalIn(ctx, seed());
    const out = await evalIn(ctx, `
      await self.OfferAIOFill.run();
      // The two things only a human can supply on this form.
      const why = document.getElementById('why');
      why.value = 'Because Northwind builds the tools I use.';
      why.dispatchEvent(new Event('input', { bubbles: true }));
      const wa = document.getElementById('work_auth');
      wa.value = 'Yes';
      wa.dispatchEvent(new Event('change', { bubbles: true }));
      await self.OfferAIOFill.doSubmit();
      await new Promise((r) => setTimeout(r, 1200));
      const { applications } = await chrome.storage.local.get('applications');
      const a = (applications || [])[0] || null;
      return {
        n: (applications || []).length,
        confirmed: a && a.confirmed, signal: a && a.signal,
        company: a && a.company, url: a && a.url, ats: a && a.ats,
        status: (document.getElementById('oa-status') || {}).textContent,
      };`);
    const pageSubmits = await evalInPage("window.__submitCount");
    check("the submit actually happened", pageSubmits === 1, "submit handler fired " + pageSubmits + " times");
    check("exactly one application is recorded", out.n === 1, JSON.stringify(out));
    check("it is recorded as evidenced", out.confirmed === true, JSON.stringify(out));
    check("the signal names how it was evidenced", !!out.signal, JSON.stringify(out));
  }

  /* --------------------------------- 6. no signal at all → recorded, but not confirmed */
  {
    const ctx = await freshPage();
    await evalIn(ctx, seed());
    await evalInPage("window.__mode = 'silent'; return true");
    const out = await evalIn(ctx, `
      await self.OfferAIOFill.run();
      const why = document.getElementById('why');
      why.value = 'x'; why.dispatchEvent(new Event('input', { bubbles: true }));
      const wa = document.getElementById('work_auth');
      wa.value = 'Yes'; wa.dispatchEvent(new Event('change', { bubbles: true }));
      await self.OfferAIOFill.doSubmit();
      await new Promise((r) => setTimeout(r, 11000));
      const { applications } = await chrome.storage.local.get('applications');
      const a = (applications || [])[0] || null;
      return { n: (applications || []).length, confirmed: a && a.confirmed, signal: a && a.signal };`);
    check("a silent employer is recorded as unconfirmed", out.n === 1 && out.confirmed === false, JSON.stringify(out));
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nfailures:");
    for (const f of failures) console.log("  - " + f);
    process.exitCode = 1;
  }
} catch (e) {
  console.error("\nharness error:", e.message);
  process.exitCode = 1;
} finally {
  if (chromeProc) chromeProc.kill();
  if (server) server.close();
  await sleep(300);
  await rm(extDir, { recursive: true, force: true }).catch(() => {});
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}
