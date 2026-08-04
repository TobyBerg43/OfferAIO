/* Regenerate the Chrome Web Store screenshots.
 *
 *   node store/regenerate.mjs          (from the repo root)
 *
 * Each store-screenshot-N.png is rendered from screenshot-N-source.html, and every one
 * of those frames the REAL product — the actual dashboard, the actual popup running
 * popup.js, the actual content.js filling a form — rather than a drawing of it. That is
 * the whole point: the previous screenshots were hand-drawn and silently went stale, so
 * the listing advertised a titlebar we'd deleted and a popup with no licensing UI.
 * Re-run this after any UI change and the listing tells the truth again.
 *
 * Serves the repo over http first: the sources pull popup.html / content.js / the
 * dashboard by URL, and file:// can't do that. Headless Chrome is what makes the output
 * exactly 1280x800 — the Web Store rejects anything else, and an ordinary window
 * screenshot can't hit an exact viewport.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, extname, resolve } from "node:path";

const run = promisify(execFile);
const ROOT = resolve(process.cwd());
const PORT = 8099;

const SHOTS = [
  ["screenshot-1-source.html", "store-screenshot-1.png", "extension popup"],
  ["screenshot-2-source.html", "store-screenshot-2.png", "in-page fill bar"],
  ["screenshot-3-source.html", "store-screenshot-3.png", "dashboard"],
];

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml",
};

function findChrome() {
  const candidates = [
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  const hit = candidates.find((p) => p && existsSync(p));
  if (!hit) throw new Error("Chrome not found — add its path to findChrome() in this script.");
  return hit;
}

/** PNG header check, so a silent Chrome failure can't pass as success. */
async function dimensions(path) {
  const b = await readFile(path);
  if (b.slice(1, 4).toString() !== "PNG") throw new Error(path + " is not a PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/OfferAIO.html";
  try {
    const body = await readFile(join(ROOT, p));
    res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

await new Promise((r) => server.listen(PORT, r));
const chrome = findChrome();
console.log("chrome:", chrome);

let failed = false;
for (const [source, out, label] of SHOTS) {
  const target = join(ROOT, "store", out);
  await run(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    // The sources fetch files and wait for the extension's own UI to mount before the
    // capture is meaningful; virtual time lets that finish without a real-time sleep.
    "--virtual-time-budget=10000",
    "--screenshot=" + target,
    "--window-size=1280,800",
    `http://localhost:${PORT}/store/${source}`,
  ]).catch(() => {}); // chrome exits non-zero on some platforms even when it wrote the file

  const [w, h] = await dimensions(target);
  const ok = w === 1280 && h === 800;
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"} ${out.padEnd(24)} ${w}x${h}  (${label})`);
}

server.close();
if (failed) {
  console.error("\nAt least one screenshot is not 1280x800 — the Web Store will reject it.");
  process.exit(1);
}
console.log("\nAll three regenerated. Upload them in the Developer Dashboard listing.");
