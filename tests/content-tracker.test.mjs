/* Tests for the application tracker in extension/content.js.
 *
 * The bug this replaces: doSubmit() clicked the Submit button, immediately incremented
 * the quota, and reported "Submitted via OfferAIO" — with no idea whether anything had
 * left the page. A blocked submit therefore burned one of the user's 50 monthly
 * submissions AND told them it had succeeded, for an application the employer never saw.
 * That is also how the dashboard came to print "✓ Submitted" beside a Veeam req that had
 * already closed.
 *
 * The rules now under test:
 *   - a submission is only counted once the page gives real evidence it went (a
 *     navigation, the form being replaced, or a confirmation message);
 *   - a form that bounces back with validation errors counts nothing and records nothing;
 *   - a submit with no signal either way is recorded as UNCONFIRMED and still counts
 *     nothing — a metering guess must never cost someone a submission (PROJECT.md §7);
 *   - the label→input binding refuses to guess on a dense form.
 *
 * content.js is a browser content script, so it's loaded into a vm context with a small
 * hand-rolled DOM rather than a real one — enough to exercise the decision logic without
 * pulling in a headless browser.
 *
 * Run: node --test tests/content-tracker.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const SRC = readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");

/* ------------------------------------------------------------------ tiny DOM */

class El {
  constructor(tag, props = {}) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.style = {};
    this.value = "";
    this.type = "text";
    this.files = [];
    this.offsetParent = {};          // "visible"
    this.textContent = "";
    this.attrs = {};
    this.parentElement = null;
    Object.assign(this, props);
  }
  getAttribute(k) { return this.attrs[k] ?? null; }
  setAttribute(k, v) { this.attrs[k] = v; }
  append(...kids) {
    for (const k of kids) { k.parentElement = this; this.children.push(k); }
    return this;
  }
  get descendants() {
    return this.children.flatMap((c) => [c, ...c.descendants]);
  }
  matchesSel(sel) {
    // Only the handful of selector shapes content.js actually uses.
    const s = sel.trim();
    if (s === "input" || s === "textarea" || s === "select") return this.tagName === s.toUpperCase();
    if (s.startsWith("#")) return this.attrs.id === s.slice(1);
    // tag[attr="value"] — `type` is a property on this fake element, everything else
    // (notably label[for=…], which fieldLabel resolves) is a real attribute.
    const m = s.match(/^(\w+)\[([\w-]+)="([^"]+)"\]$/);
    if (m) {
      if (this.tagName !== m[1].toUpperCase()) return false;
      return m[2] === "type" ? this.type === m[3] : this.getAttribute(m[2]) === m[3];
    }
    return false;
  }
  querySelectorAll(sel) {
    const sels = sel.split(",").map((x) => x.trim());
    return this.descendants.filter((d) => sels.some((s) => d.matchesSel(s)));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  contains(n) { return n === this || this.descendants.includes(n); }
  closest() { return null; }
  scrollIntoView() {}
  click() { if (this.onclick) this.onclick(); }
  addEventListener(t, fn) { (this._ls ||= {})[t] = (this._ls[t] || []).concat(fn); }
  dispatchEvent(e) { ((this._ls || {})[e.type] || []).forEach((fn) => fn(e)); return true; }
}

function makeDoc() {
  const body = new El("body");
  const head = new El("head");
  const doc = {
    body, head,
    _byId: new Map(),
    getElementById(id) { return doc._byId.get(id) || body.descendants.find((d) => d.attrs.id === id) || null; },
    querySelector(s) { return body.querySelector(s); },
    querySelectorAll(s) { return body.querySelectorAll(s); },
    createElement(t) { return new El(t); },
    contains(n) { return body.contains(n); },
    addEventListener() {},
    title: "Stripe — Software Engineering Intern",
  };
  return doc;
}

/** Load content.js in a fake page and hand back its exposed internals. */
function load({ url = "https://job-boards.greenhouse.io/stripe/jobs/1", store = {} } = {}) {
  const doc = makeDoc();
  const storage = { ...store };
  const sandbox = {
    console,
    document: doc,
    location: { hostname: new URL(url).hostname, pathname: new URL(url).pathname, href: url },
    window: { addEventListener() {} },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout,
    Event: class { constructor(t) { this.type = t; } },
    CSS: { escape: (s) => s },
    atob: (b) => Buffer.from(b, "base64").toString("binary"),
    // Minimal File/DataTransfer. Real ones are browser-only, and attachResume's whole job
    // is the handoff between them, so stubs that record what they were given are what let
    // the assertions below check the handoff rather than the browser.
    File: class {
      constructor(parts, name, opts) {
        this.name = name;
        this.type = (opts && opts.type) || "";
        this.size = parts.reduce((n, p) => n + (p.length || p.byteLength || 0), 0);
      }
    },
    DataTransfer: class {
      constructor() { this._f = []; this.items = { add: (f) => this._f.push(f) }; }
      get files() { return this._f; }
    },
    HTMLInputElement: { prototype: {} },
    HTMLTextAreaElement: { prototype: {} },
    chrome: {
      storage: {
        local: {
          get(keys, cb) {
            const out = {};
            (Array.isArray(keys) ? keys : [keys]).forEach((k) => { if (k in storage) out[k] = storage[k]; });
            cb(out);
          },
          set(obj, cb) { Object.assign(storage, obj); if (cb) cb(); },
        },
      },
    },
  };
  sandbox.self = sandbox;
  // content.js writes through the native value setter; in this fake DOM a plain
  // assignment is the equivalent.
  Object.defineProperty(sandbox.HTMLInputElement.prototype, "value", {
    configurable: true, set(v) { this._v = v; }, get() { return this._v; },
  });
  createContext(sandbox);
  runInContext(SRC, sandbox);
  return { api: sandbox.OfferAIOFill, fields: sandbox.OfferAIOFields, doc, storage, sandbox };
}

/* ---------------------------------------------------- outcome detection */

test("a navigation away from the form counts as a real send", async () => {
  const { api, sandbox } = load();
  const form = new El("form");
  const p = api.awaitSubmitOutcome(form, sandbox.location.href);
  sandbox.location.href = "https://job-boards.greenhouse.io/stripe/confirmation";
  const out = await p;
  assert.equal(out.ok, true);
  assert.equal(out.signal, "navigated");
});

test("the form being replaced counts as a real send", async () => {
  const { api, doc, sandbox } = load();
  const form = new El("form");
  doc.body.append(form);
  const p = api.awaitSubmitOutcome(form, sandbox.location.href);
  doc.body.children = [];                  // SPA swapped the form for a thank-you screen
  const out = await p;
  assert.equal(out.ok, true);
  assert.equal(out.signal, "form_replaced");
});

test("a confirmation message counts as a real send", async () => {
  const { api, doc, sandbox } = load();
  doc.body.innerText = "";
  const form = new El("form");
  form.checkValidity = () => true;
  doc.body.append(form);                   // stays attached: only the message changes
  const p = api.awaitSubmitOutcome(form, sandbox.location.href);
  doc.body.innerText = "Thank you for applying! Your application has been received.";
  const out = await p;
  assert.equal(out.ok, true);
  assert.equal(out.signal, "confirmation");
});

test("a form that bounces back invalid is NOT a send", async () => {
  const { api, doc, sandbox } = load();
  doc.body.innerText = "";
  const form = new El("form");
  form.checkValidity = () => false;        // required field still empty
  doc.body.append(form);
  const out = await api.awaitSubmitOutcome(form, sandbox.location.href);
  assert.equal(out.ok, false);
  assert.equal(out.signal, "invalid");
});

test("no signal at all resolves to timeout, not to success", async () => {
  const { api, doc, sandbox } = load();
  doc.body.innerText = "nothing interesting here";
  const form = new El("form");
  form.checkValidity = () => true;
  doc.body.append(form);
  const out = await api.awaitSubmitOutcome(form, sandbox.location.href);
  assert.equal(out.ok, false);
  assert.equal(out.signal, "timeout");
  // The important half: it must not claim success.
  assert.notEqual(out.signal, "confirmation");
});

test("a confirmation phrase must actually be about an application", async () => {
  const { api, doc, sandbox } = load();
  const form = new El("form");
  form.checkValidity = () => true;
  doc.body.append(form);
  // Marketing boilerplate that happens to thank you — must not be read as a receipt.
  doc.body.innerText = "Thank you for visiting our careers page. Sign up for job alerts.";
  const out = await api.awaitSubmitOutcome(form, sandbox.location.href);
  assert.equal(out.ok, false, "generic page copy was mistaken for a submission receipt");
});

/* ------------------------------------------------------------- the record */

test("an application is recorded, newest first", async () => {
  const { api, storage } = load();
  await api.recordApplication({ company: "Stripe", role: "SWE Intern", url: "https://x/1", submittedAt: 1000 });
  await api.recordApplication({ company: "Ramp", role: "Backend Intern", url: "https://x/2", submittedAt: 2000 });
  assert.equal(storage.applications.length, 2);
  assert.equal(storage.applications[0].company, "Ramp");
  assert.equal(storage.applications[1].company, "Stripe");
});

test("a double-submit on the same posting is one application, not two", async () => {
  const { api, storage } = load();
  await api.recordApplication({ company: "Stripe", url: "https://x/1", submittedAt: 1000 });
  await api.recordApplication({ company: "Stripe", url: "https://x/1", submittedAt: 4000 });
  assert.equal(storage.applications.length, 1);
  assert.equal(storage.applications[0].submittedAt, 4000, "the later attempt should win");
});

test("the same posting applied to weeks apart is two applications", async () => {
  const { api, storage } = load();
  await api.recordApplication({ company: "Stripe", url: "https://x/1", submittedAt: 1000 });
  await api.recordApplication({ company: "Stripe", url: "https://x/1", submittedAt: 1000 + 86400000 });
  assert.equal(storage.applications.length, 2);
});

test("the ATS is named from the host, including EU instances", () => {
  const eu = load({ url: "https://job-boards.eu.greenhouse.io/veeamsoftware/jobs/9" });
  // Without ats.js loaded the fallback is the bare hostname; with it, the friendly name.
  assert.equal(eu.api.atsName(), "job-boards.eu.greenhouse.io");
});

/* -------------------------------------------------- label → input binding */

test("a label with for= binds to that exact control", () => {
  const { fields, doc } = load();
  const wrap = new El("div");
  const lab = new El("label", { textContent: "GPA" });
  lab.setAttribute("for", "gpa");
  const input = new El("input", { attrs: { id: "gpa" } });
  wrap.append(lab, input);
  doc.body.append(wrap);
  doc._byId.set("gpa", input);
  assert.equal(fields.controlForLabel(lab), input);
});

test("a control nested inside the label is unambiguous", () => {
  const { fields, doc } = load();
  const lab = new El("label", { textContent: "School" });
  const input = new El("input");
  lab.append(input);
  doc.body.append(lab);
  assert.equal(fields.controlForLabel(lab), input);
});

test("a dense wrapper with several questions binds to NOTHING", () => {
  // The old fallback took "the first input under the parent", so on this shape every
  // label wrote into the first box — the answer to one question landing in another.
  const { fields, doc } = load();
  const wrap = new El("div");
  const l1 = new El("label", { textContent: "Are you authorized to work in the US?" });
  const i1 = new El("input");
  const l2 = new El("label", { textContent: "Do you require sponsorship?" });
  const i2 = new El("input");
  wrap.append(l1, i1, l2, i2);
  doc.body.append(wrap);
  assert.equal(fields.controlForLabel(l2), null,
    "guessed a control on an ambiguous form — this writes a false answer under the user's name");
});

test("a wrapper holding exactly one control still binds", () => {
  const { fields, doc } = load();
  const wrap = new El("div");
  const lab = new El("label", { textContent: "Major" });
  const input = new El("input");
  wrap.append(lab, input);
  doc.body.append(wrap);
  assert.equal(fields.controlForLabel(lab), input);
});

test("hidden and submit controls don't count toward ambiguity", () => {
  const { fields, doc } = load();
  const wrap = new El("div");
  const lab = new El("label", { textContent: "Major" });
  const input = new El("input");
  const hidden = new El("input", { type: "hidden" });
  const submit = new El("input", { type: "submit" });
  wrap.append(lab, input, hidden, submit);
  doc.body.append(wrap);
  assert.equal(fields.controlForLabel(lab), input);
});

/* ------------------------------------------------- fieldLabel / CSS shadowing

   content.js declares `const CSS = [ ...stylesheet... ].join("")` at IIFE scope, which
   shadows the global CSS object for the whole file. fieldLabel() then calls
   CSS.escape(el.id) — a TypeError on a string.

   It hides well. `el.id && ...` short-circuits, so any field without an id skips the call
   entirely, and every test here happened to use unnamed elements. The two real call sites
   both matter:

     - doSubmit's invalid-form branch, where the throw kills the status() line that tells
       the user WHICH field still needs them. They get a silent amber box.
     - unfilledRequired(), which runs on the success path BEFORE btn.click(). A field that
       is aria-required but not required, empty, and has an id passes checkValidity() and
       reaches it — so the throw eats the click and the submission never happens at all.
       Workday and Ashby both lean on aria-required. */

test("unfilledRequired names an aria-required field that has an id", () => {
  const { api, doc } = load();
  const form = new El("form");
  const lab = new El("label", { textContent: "Why do you want to work here?" });
  lab.setAttribute("for", "why");
  const input = new El("textarea", { id: "why" });
  input.setAttribute("aria-required", "true");
  form.append(lab, input);
  doc.body.append(form);

  // Throws TypeError: CSS.escape is not a function while the stylesheet shadows the global.
  // Spread first: the array is built inside the vm context, so its prototype is that
  // realm's Array.prototype and deepEqual rejects it as not reference-equal.
  assert.deepEqual([...api.unfilledRequired()], ["Why do you want to work here?"]);
});

test("unfilledRequired still ignores fields that are filled", () => {
  const { api, doc } = load();
  const form = new El("form");
  const input = new El("input", { id: "email", value: "a@b.com", required: true });
  form.append(input);
  doc.body.append(form);
  assert.deepEqual([...api.unfilledRequired()], []);
});

/* --------------------------------------------------------------- attachResume

   content.js claimed for its whole life that "browsers forbid scripts from attaching
   files", and the resume field was left highlighted for the user on every application.
   That is a misconception: what browsers forbid is setting input.value to a path. A File
   built from bytes we already hold goes on through a DataTransfer, and input.files has
   been assignable for years. Verified in a real browser against the dev harness form —
   the file lands, change fires, and it shows up in the form's FormData.

   These tests cover the decision logic around that handoff. The part that can only be
   checked in a browser is whether a given ATS's uploader accepts it, which is exactly why
   attachResume re-reads input.files afterwards instead of assuming. */

const RESUME = {
  name: "priya-raman-resume.pdf",
  type: "application/pdf",
  data: Buffer.from("%PDF-1.4\nfake resume bytes").toString("base64"),
  size: 26,
};

test("a stored resume is attached to the form's file input", () => {
  const { api } = load();
  const rf = new El("input", { type: "file" });
  assert.equal(api.attachResume(rf, RESUME), true);
  assert.equal(rf.files.length, 1);
  assert.equal(rf.files[0].name, "priya-raman-resume.pdf");
  assert.equal(rf.files[0].type, "application/pdf");
});

test("it verifies the attach landed rather than assuming", () => {
  // A custom uploader that ignores the assignment must be reported as a failure, not a
  // success — full-auto decides whether to submit on this answer.
  const { api } = load();
  const rf = new El("input", { type: "file" });
  Object.defineProperty(rf, "files", { get: () => [], set() {}, configurable: true });
  assert.equal(api.attachResume(rf, RESUME), false);
});

test("a resume the user already attached is left alone", () => {
  const { api } = load();
  const rf = new El("input", { type: "file", files: [{ name: "their-own.pdf", size: 9 }] });
  assert.equal(api.attachResume(rf, RESUME), true);
  assert.equal(rf.files[0].name, "their-own.pdf", "overwrote the user's own file");
});

test("no stored resume, no file input, and junk data all fail honestly", () => {
  const { api } = load();
  const rf = new El("input", { type: "file" });
  assert.equal(api.attachResume(rf, null), false);
  assert.equal(api.attachResume(rf, {}), false);
  assert.equal(api.attachResume(rf, { name: "x.pdf", data: "" }), false);
  assert.equal(api.attachResume(null, RESUME), false);
  assert.equal(rf.files.length, 0);
});

test("resumeMissing stays true when the attach failed, so full-auto still stops", () => {
  const { api } = load();
  const rf = new El("input", { type: "file" });
  Object.defineProperty(rf, "files", { get: () => [], set() {}, configurable: true });
  assert.equal(api.attachResume(rf, RESUME), false);
  assert.equal(rf.files.length, 0, "an unattached resume must read as missing");
});
