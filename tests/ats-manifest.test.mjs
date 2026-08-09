/* ats.js ↔ manifest.json parity.
 *
 * ats.js's own header says the two lists "must never disagree", and then they did: it
 * matched any subdomain of wellfound.com and of linkedin.com while the manifest granted
 * only `wellfound.com` and `www.linkedin.com/jobs/*`. On www.wellfound.com the popup's
 * Fill button therefore lit up, injected nothing, and closed — the precise failure the
 * v1.2.0 popup work was meant to end.
 *
 * A comment cannot enforce that. This file can: every ATS entry must be reachable under
 * the permissions the manifest actually asks for, and every job host the manifest asks
 * for must belong to an ATS entry. Adding a host to one file and not the other fails here.
 *
 * It also pins the shape bridge.js depends on — the list has to survive postMessage, so
 * no entry may hold a RegExp.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), "utf8");

// ats.js is a content script, not a module: run it and read what it hangs on `self`.
// URL must be in the sandbox — without it fromUrl() throws into its own catch and
// reports that nothing anywhere is fillable.
const ctx = { self: {}, URL };
vm.createContext(ctx);
vm.runInContext(read("extension/ats.js"), ctx);
const ATS = ctx.self.OfferAIOATS;

const manifest = JSON.parse(read("extension/manifest.json"));
const jobScript = manifest.content_scripts.find((c) =>
  c.matches.some((m) => m.includes("greenhouse")),
);

/* ---- Chrome match patterns, enough of them for these tests ---- */
const patHost = (p) => p.replace(/^https?:\/\//, "").split("/")[0];
const patPath = (p) => {
  const rest = p.replace(/^https?:\/\//, "");
  const i = rest.indexOf("/");
  return i < 0 ? "/*" : rest.slice(i);
};
const hostOk = (ph, h) =>
  ph.startsWith("*.") ? h === ph.slice(2) || h.endsWith("." + ph.slice(2)) : h === ph;
const pathOk = (pp, path) =>
  new RegExp(
    "^" + pp.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$",
  ).test(path);
const covers = (pattern, host, path) => hostOk(patHost(pattern), host) && pathOk(patPath(pattern), path);

/** A URL a real user could be on for this ATS entry, plus a subdomain variant. */
function samples(a) {
  const path = a.pathPrefix ? a.pathPrefix + "senior-intern" : "/jobs/123";
  const hosts = a.exactHost ? [a.exactHost] : [a.suffix, "jobs." + a.suffix];
  return hosts.map((h) => ({ host: h, path, url: `https://${h}${path}` }));
}

// Hosts in the manifest that are ours, not an employer's — the site bridge and the Worker.
const OWN = /offeraio\.com|tobyberg43\.github\.io|workers\.dev/;

test("every ATS we claim to support is inside host_permissions", () => {
  for (const a of ATS.list) {
    for (const s of samples(a)) {
      assert.ok(
        manifest.host_permissions.some((p) => covers(p, s.host, s.path)),
        `${a.name}: ${s.url} matches no host_permissions entry — the popup would offer to fill a page the extension has no access to`,
      );
    }
  }
});

test("every ATS we claim to support has a content script injected on it", () => {
  for (const a of ATS.list) {
    for (const s of samples(a)) {
      assert.ok(
        jobScript.matches.some((p) => covers(p, s.host, s.path)),
        `${a.name}: content.js does not run on ${s.url}`,
      );
    }
  }
});

test("every job host the manifest asks for belongs to a known ATS", () => {
  for (const p of manifest.host_permissions) {
    if (OWN.test(p)) continue;
    const ph = patHost(p);
    const host = ph.startsWith("*.") ? "jobs." + ph.slice(2) : ph;
    const path = patPath(p).replace(/\*$/, "example");
    assert.ok(
      ATS.fromUrl(`https://${host}${path}`),
      `${p} is granted but ats.js does not recognise it — an unjustifiable permission at Web Store review`,
    );
  }
});

test("the ATS list survives postMessage (bridge.js hands it to the dashboard)", () => {
  // A RegExp would come out the far side as {} and the dashboard would quietly decide
  // nothing on the board is fillable. Compared field by field rather than with deepEqual:
  // these objects are built inside the vm realm, so their prototype is not this realm's
  // Object.prototype and a strict deepEqual rejects them for a reason that has nothing to
  // do with the product.
  const round = JSON.parse(JSON.stringify(ATS.list));
  assert.equal(round.length, ATS.list.length);
  round.forEach((r, i) => {
    const a = ATS.list[i];
    assert.deepEqual(Object.keys(r).sort(), Object.keys(a).sort(), `${a.id} lost a field`);
    for (const k of Object.keys(r)) {
      assert.equal(typeof r[k], "string", `${a.id}.${k} is not a plain string`);
      assert.equal(r[k], a[k]);
    }
    assert.ok(r.exactHost || r.suffix, `${r.id} has neither suffix nor exactHost`);
  });
});

test("EU-hosted instances still match — they carry US roles (PROJECT.md §15)", () => {
  assert.equal(ATS.fromUrl("https://job-boards.eu.greenhouse.io/veeamsoftware/jobs/1")?.id, "greenhouse");
  assert.equal(ATS.fromUrl("https://jobs.eu.lever.co/imc/abc")?.id, "lever");
});

test("the two hosts that motivated this file", () => {
  assert.equal(ATS.fromUrl("https://www.wellfound.com/jobs/123")?.id, "wellfound");
  assert.equal(ATS.fromUrl("https://wellfound.com/jobs/123")?.id, "wellfound");
  // LinkedIn is deliberately www-only and jobs-path-only: everything else on that domain
  // is someone's feed, and we neither ask for it nor should light the button up on it.
  assert.equal(ATS.fromUrl("https://www.linkedin.com/jobs/view/1")?.id, "linkedin");
  assert.equal(ATS.fromUrl("https://www.linkedin.com/feed/"), null);
  assert.equal(ATS.fromUrl("https://ca.linkedin.com/jobs/view/1"), null);
});

test("a suffix match never matches a lookalike domain", () => {
  assert.equal(ATS.fromUrl("https://notgreenhouse.io/jobs/1"), null);
  assert.equal(ATS.fromUrl("https://greenhouse.io.evil.example/jobs/1"), null);
});

test("non-web URLs are never an application form", () => {
  for (const u of ["chrome://extensions", "about:blank", "file:///c:/tmp/a.html", "", "not a url"]) {
    assert.equal(ATS.fromUrl(u), null);
  }
});
