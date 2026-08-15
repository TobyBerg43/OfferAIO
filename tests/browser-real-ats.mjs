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
async function waitFor(fn, what, ms = 25000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
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
      contexts.length = 0;
      await cdp.send("Page.navigate", { url });
      const ctx = await waitFor(
        () => contexts.find((c) => c.auxData && c.auxData.type === "isolated") || null,
        "the content script (is this host in the manifest?)");
      await waitFor(() => evalIn(ctx.id, "return !!self.OfferAIOFill").then((v) => v === true), "OfferAIOFill");

      // Give a React/SPA form time to render its fields before judging what is there.
      const form = await evalIn(ctx.id, `
        for (let i = 0; i < 40; i++) {
          if (document.querySelector('input[type=file], input[type=email], input[autocomplete=email]')) break;
          await new Promise(r => setTimeout(r, 500));
        }
        return {
          fileInputs: document.querySelectorAll('input[type=file]').length,
          textInputs: document.querySelectorAll('input:not([type=hidden]):not([type=submit])').length,
          iframes: document.querySelectorAll('iframe').length,
        };`);

      if (!form.textInputs) {
        console.log("   no application form on this URL (apply may be behind a link) — skipped\n");
        continue;
      }

      await evalIn(ctx.id, `
        await chrome.storage.local.clear();
        await chrome.storage.local.set(${JSON.stringify({ profile: PROFILE, resume: RESUME, mode: "semi" })});
        return true;`);

      // run() only. doSubmit is never called and no button is clicked.
      const out = await evalIn(ctx.id, `
        const r = await self.OfferAIOFill.run();
        const rf = document.querySelector('input[type=file]');
        let inFormData = null;
        const f = rf && rf.closest('form');
        if (f) { const v = new FormData(f).get(rf.name); if (v && typeof v === 'object') inFormData = { name: v.name, size: v.size }; }
        const filled = [...document.querySelectorAll('input,select,textarea')]
          .filter(el => el.value && el.type !== 'hidden' && el.type !== 'submit')
          .map(el => (el.name || el.id || el.type) + '=' + String(el.value).slice(0, 28));
        return {
          ok: r && r.ok, reason: r && r.reason,
          fieldsFilled: r && r.fieldsFilled, fieldsTotal: r && r.fieldsTotal,
          resumeAttached: r && r.resumeAttached,
          resumeOnInput: rf ? rf.files.length : null,
          resumeName: rf && rf.files[0] ? rf.files[0].name : null,
          inFormData,
          needsUser: (r && r.needsUser) || [],
          status: (document.getElementById('oa-status') || {}).textContent,
          filled,
        };`);

      console.log(`   form: ${form.textInputs} inputs, ${form.fileInputs} file input(s), ${form.iframes} iframe(s)`);
      console.log(`   filled ${out.fieldsFilled} of ${out.fieldsTotal}`);
      if (form.fileInputs) {
        const ok = out.resumeOnInput === 1;
        console.log(`   résumé: ${ok ? "ATTACHED" : "NOT attached"}` +
          (ok ? ` (${out.resumeName})` : "") +
          `  · reported: ${out.resumeAttached}` +
          `  · in FormData: ${out.inFormData ? out.inFormData.name + " " + out.inFormData.size + "B" : "no"}`);
        if (out.resumeAttached !== ok) console.log("   ⚠️  report disagrees with the DOM — that is the one thing §17 must never do");
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
