/* One version number, four places.
 *
 * PROJECT.md §7: "manifest.json is the single source of truth for the version." It had
 * disagreed four ways at once — manifest 1.1.2, landing page v3.1.0, dashboard sidebar
 * "build 2027.1", PROJECT.md 1.1.1 — which is how you end up debugging a bug report
 * against a build nobody can identify. The rule was written down; nothing enforced it.
 *
 * This does. Bump manifest.json and the rest must follow in the same commit.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), "utf8");

const version = JSON.parse(read("extension/manifest.json")).version;

test("the manifest version looks like a version", () => {
  assert.match(version, /^\d+\.\d+\.\d+$/);
});

for (const file of ["landing.html", "OfferAIO.html", "dashboard/index.html"]) {
  test(`${file} shows the manifest's version and no other`, () => {
    const src = read(file);
    assert.ok(src.includes("v" + version), `${file} never mentions v${version}`);
    // Any other vN.N.N on the page is a stale copy someone forgot — the failure mode
    // this file exists for, so catch it rather than only checking the right one is present.
    const stale = [...new Set(src.match(/\bv\d+\.\d+\.\d+\b/g) || [])].filter((v) => v !== "v" + version);
    assert.deepEqual(stale, [], `${file} still shows ${stale.join(", ")}`);
  });
}

test("the dashboard copy is byte-identical to its source", () => {
  // generate_pages.js copies OfferAIO.html to dashboard/index.html. Everything on the
  // site links to /dashboard/, so an edit to the canonical file that never got
  // regenerated ships the old dashboard to every user while the repo looks correct.
  assert.equal(
    read("dashboard/index.html"),
    read("OfferAIO.html"),
    "dashboard/index.html is out of date — run `node generate_pages.js`",
  );
});
