/* Fill REAL, live application forms with the real extension, and report what happened.
 *
 *   node tests/browser-real-ats.mjs                 # a default sample across three ATSes
 *   node tests/browser-real-ats.mjs <url> [<url>…]  # specific postings
 *   node tests/browser-real-ats.mjs --head          # watch it
 *
 * ⚠️ THIS NEVER SUBMITS ANYTHING. It calls OfferAIOFill.run() and reads the DOM back.
 * `doSubmit` is never called and no button is ever clicked, so nothing reaches an
 * employer. Keep it that way: the moment this file can submit, running it costs somebody
 * a real application under their name.
 *
 * WHY IT EXISTS. tests/browser-endtoend.mjs proves §17's résumé handoff against a form we
 * wrote, which means it proves the mechanism and assumes the market. Greenhouse, Lever and
 * Ashby can each render a custom uploader, an iframe, or a React form that rejects a
 * synthetic FileList — and PROJECT.md §17 has "still unproven on a real ATS" as its last
 * open caveat. This closes it with evidence instead of confidence.
 *
 * The profile is a throwaway: a fake name and a mailto-only address. Nothing here
 * identifies anyone, because these are real employers' pages.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEBUG_PORT = 9337;
const HEADED = process.argv.includes("--head");
const urls = process.argv.slice(2).filter((a) => a.startsWith("http"));

const DEFAULT_URLS = [
  "https://job-boards.greenhouse.io/transmarketgroup/jobs/5212335007",
  "https://jobs.lever.co/palantir/9db71277-3a9a-481b-a2a3-25c3125b0e8a",
  "https://jobs.ashbyhq.com/modal/38888294-6bc7-4dab-b072-6d0f0c2ed79a",
];

const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
);
const RESUME = { name: "test-resume.pdf", type: "application/pdf", size: PDF.length, data: PDF.toString("base64"), savedAt: 1755200000000 };
const PROFILE = {
  name: "Testy McTestface", email: "nobody@example.invalid", phone: "555-0100",
  school: "Example University", major: "Computer Science", gpa: "3.5",
  gradDate: "May 2027", linkedin: "https://linkedin.com/in/example",
  workAuth: "US Citizen", needsSponsorship: false,
  coverLetter: "Test only — never submitted.",
};

function findChrome() {
  const c = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium",
  ].find((p) => p && existsSync(p));
  if (!c) throw new Error("Chrome not found");
  return c;
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      } else if (m.method) for (const h of this.handlers.get(m.method) || []) h(m.params);
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
  on(m, fn) { if (!this.handlers.has(m)) this.handlers.set(m, []); this.handlers.get(m).push(fn); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** How to read the payload check — see the long note at its call site. */
function describePayload(p) {
  if (!p) return "n/a (no file attached)";
  if (p.state === "noform") {
    return "no enclosing <form> element — this ATS uploads the file with its own request, " +
      "so a form payload does not exist to check (same for a hand-picked file)";
  }
  if (p.state === "present") return `in FormData as "${p.name}" ${p.size}B`;
  if (p.state === "unnamed") {
    return `${p.name} ${p.size}B — real File, but the input has no name attribute, ` +
      "so FormData excludes it for a hand-picked file too (this ATS reads input.files itself)";
  }
  return "MISSING from the form payload";
}
/* ⚠️ `fn` may be synchronous, and may throw synchronously.
 *
 * This used to read `await fn().catch(() => null)`, which requires fn() to return a
 * thenable. One of the call sites below hands it a plain synchronous callback that returns
 * null until the isolated world shows up — so on any page where the content script was not
 * already attached by the first poll, `null.catch` threw
 * "Cannot read properties of null (reading 'catch')" and the run died on the first URL.
 *
 * Two things made that worse than a normal bug. It is timing-dependent, so it passed
 * whenever the extension happened to win the race and failed on a slow real page; and the
 * TypeError replaced this function's own message, which is the one that tells you what to
 * actually check ("is this host in the manifest?"). Found 2026-08-16 pointing the harness
 * at a live DRW Greenhouse posting. */
async function waitFor(fn, what, ms = 25000) {
  const end = Date.now() + ms;
  for (;;) {
    let v = null;
    try {
      v = await fn();
    } catch {
      v = null;
    }
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting for " + what);
    await sleep(250);
  }
}

const profileDir = await mkdtemp(join(tmpdir(), "offeraio-real-"));
let chromeProc;
try {
  const chrome = findChrome();
  chromeProc = spawn(chrome, [
    HEADED ? "--new-window" : "--headless=new",
    "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--enable-unsafe-extension-debugging",
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profileDir}`,
    "about:blank",
  ], { stdio: "ignore" });

  const version = await waitFor(
    () => fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).then((r) => r.json()),
    "Chrome");
  const browser = await CDP.connect(version.webSocketDebuggerUrl);
  // extension/ unmodified — greenhouse, lever and ashby are already in host_permissions.
  const loaded = await browser.send("Extensions.loadUnpacked", { path: join(ROOT, "extension") });
  console.log("chrome " + version.Browser.replace("Chrome/", "") + " · extension " + loaded.id + "\n");

  const wsUrl = await waitFor(async () => {
    const list = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json());
    const p = list.find((t) => t.type === "page" && !t.url.startsWith("chrome-extension:"));
    return p && p.webSocketDebuggerUrl;
  }, "a page target");

  const cdp = await CDP.connect(wsUrl);
  const contexts = [];
  cdp.on("Runtime.executionContextCreated", (p) => contexts.push(p.context));
  cdp.on("Runtime.executionContextsCleared", () => (contexts.length = 0));
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");

  async function evalIn(contextId, expression) {
    const r = await cdp.send("Runtime.evaluate", {
      expression: `(async () => { ${expression} })()`,
      contextId, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }

  for (const url of (urls.length ? urls : DEFAULT_URLS)) {
    const host = new URL(url).hostname;
    console.log("── " + host + "\n   " + url);
    try {
      /* Lever and Ashby keep the posting and the application on separate URLs, so a bare
       * posting link renders a description with no fields and the run used to skip it —
       * which quietly meant §17 was only ever verified on Greenhouse, one ATS of three,
       * while the summary line read like all three had been covered. Both use a fixed
       * suffix, so try the posting first and fall through to the apply page. */
      const candidates = [url];
      if (/jobs\.lever\.co/.test(host) && !/\/apply\/?$/.test(url)) {
        candidates.push(url.replace(/\/$/, "") + "/apply");
      }
      if (/jobs\.ashbyhq\.com/.test(host) && !/\/application\/?$/.test(url)) {
        candidates.push(url.replace(/\/$/, "") + "/application");
      }

      let ctx = null, form = null, usedUrl = null;
      for (const candidate of candidates) {
        contexts.length = 0;
        await cdp.send("Page.navigate", { url: candidate });
        ctx = await waitFor(
          () => contexts.find((c) => c.auxData && c.auxData.type === "isolated") || null,
          "the content script (is this host in the manifest?)");
        await waitFor(() => evalIn(ctx.id, "return !!self.OfferAIOFill").then((v) => v === true), "OfferAIOFill");

        // Give a React/SPA form time to render its fields before judging what is there.
        form = await evalIn(ctx.id, `
          for (let i = 0; i < 40; i++) {
            if (document.querySelector('input[type=file], input[type=email], input[autocomplete=email]')) break;
            await new Promise(r => setTimeout(r, 500));
          }
          return {
            fileInputs: document.querySelectorAll('input[type=file]').length,
            textInputs: document.querySelectorAll('input:not([type=hidden]):not([type=submit])').length,
            iframes: document.querySelectorAll('iframe').length,
          };`);
        usedUrl = candidate;
        if (form.textInputs) break;
      }

      if (!form || !form.textInputs) {
        console.log("   no application form found, including at the apply path — skipped\n");
        continue;
      }
      if (usedUrl !== url) console.log("   → form found at " + usedUrl);

      await evalIn(ctx.id, `
        await chrome.storage.local.clear();
        await chrome.storage.local.set(${JSON.stringify({ profile: PROFILE, resume: RESUME, mode: "semi" })});
        return true;`);

      // run() only. doSubmit is never called and no button is clicked.
      const out = await evalIn(ctx.id, `
        const r = await self.OfferAIOFill.run();
        /* The input the extension actually used, not merely the first one on the page.
         * Ashby renders two file inputs and the resume goes into the second, so the old
         * querySelector reported "no file to check" on a form where the handoff had in fact
         * worked — understating the result on the one ATS hardest to verify. */
        const fileInputs = [...document.querySelectorAll('input[type=file]')];
        const rf = fileInputs.find(el => el.files && el.files.length) || fileInputs[0] || null;
        /* Is the file in the form's payload?
         *
         * ⚠️ This used to be new FormData(f).get(rf.name) and reported "no" on every real
         * Greenhouse posting — because Greenhouse's résumé input carries id=resume and NO
         * name attribute, FormData only serialises *named* controls, and FormData.get("")
         * is null. So the one line §17 calls "the one that matters" was answering a
         * question about the markup while looking like a verdict on our attachment.
         *
         * The three cases below are genuinely different, and only the last is a problem:
         *   unnamed  — the browser cannot include it whoever attached it. A human picking
         *              the file by hand produces the identical DOM, so this says nothing
         *              about us. Greenhouse reads input.files itself and uploads it.
         *   present  — named, and serialised. Fully proven.
         *   MISSING  — named, and absent anyway. That is the §17 nightmare: a file we
         *              believe is attached that the form would not send. */
        let inFormData = null;
        const f = rf && rf.closest('form');
        // Ashby renders its uploader outside any form element and posts the file with its
        // own request, so no form payload exists to inspect. That is a different answer from
        // "the file is missing" and has to read differently.
        if (rf && rf.files.length && !f) inFormData = { state: 'noform' };
        if (f && rf.files.length) {
          if (rf.name) {
            const v = new FormData(f).get(rf.name);
            inFormData = (v && typeof v === 'object')
              ? { state: 'present', name: v.name, size: v.size }
              : { state: 'MISSING' };
          } else {
            // Prove the File itself is real and serialisable by naming the input just long
            // enough to look, then putting the markup back exactly as it was.
            rf.setAttribute('name', '__oa_probe');
            const v = new FormData(f).get('__oa_probe');
            rf.removeAttribute('name');
            inFormData = (v && typeof v === 'object')
              ? { state: 'unnamed', name: v.name, size: v.size }
              : { state: 'MISSING' };
          }
        }
        const filled = [...document.querySelectorAll('input,select,textarea')]
          .filter(el => el.value && el.type !== 'hidden' && el.type !== 'submit')
          .map(el => (el.name || el.id || el.type) + '=' + String(el.value).slice(0, 28));
        /* Greenhouse's uploader CONSUMES the input: it reads the file, starts its own S3
           upload, clears input.files, and renders the filename as a chip in the page. So
           an empty input is what success looks like there, and the chip is the DOM truth
           to hold the report against — the same evidence content.js now uses. */
        const chipVisible = ${JSON.stringify(RESUME.name)} &&
          (document.body.innerText || '').includes(${JSON.stringify(RESUME.name)});
        return {
          ok: r && r.ok, reason: r && r.reason,
          fieldsFilled: r && r.fieldsFilled, fieldsTotal: r && r.fieldsTotal,
          resumeAttached: r && r.resumeAttached,
          resumeOnInput: rf ? rf.files.length : null,
          resumeName: rf && rf.files[0] ? rf.files[0].name : null,
          chipVisible,
          inFormData,
          needsUser: (r && r.needsUser) || [],
          status: (document.getElementById('oa-status') || {}).textContent,
          filled,
        };`);

      console.log(`   form: ${form.textInputs} inputs, ${form.fileInputs} file input(s), ${form.iframes} iframe(s)`);
      console.log(`   filled ${out.fieldsFilled} of ${out.fieldsTotal}`);
      if (form.fileInputs) {
        const ok = out.resumeOnInput === 1 || out.chipVisible;
        const how = out.resumeOnInput === 1 ? out.resumeName : "consumed by the uploader, chip rendered";
        console.log(`   résumé: ${ok ? "ATTACHED" : "NOT attached"}` +
          (ok ? ` (${how})` : "") +
          `  · reported: ${out.resumeAttached}` +
          `  · payload: ${out.chipVisible && !out.inFormData
            ? "uploaded by the page's own request (input consumed)"
            : describePayload(out.inFormData)}`);
        if (out.resumeAttached !== ok) console.log("   ⚠️  report disagrees with the DOM — that is the one thing §17 must never do");
        if (out.inFormData && out.inFormData.state === "MISSING") {
          console.log("   ⚠️  the file is on a NAMED input and still absent from the form payload —");
          console.log("       this is the case §17 fails safe against; do not ship a build that does this");
        }
      } else {
        console.log("   résumé: no file input on this page");
      }
      if (out.needsUser.length) console.log("   left for the user: " + out.needsUser.join(" · "));
      console.log("   bar: " + (out.status || "(no bar)"));
      console.log("   values: " + (out.filled.slice(0, 8).join("  ") || "(none)") + "\n");
    } catch (e) {
      console.log("   ERROR: " + e.message + "\n");
    }
  }
  console.log("Nothing was submitted. doSubmit() was never called.");
} finally {
  if (chromeProc) chromeProc.kill();
  await sleep(300);
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}
