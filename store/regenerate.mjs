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
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, extname, resolve } from "node:path";

const run = promisify(execFile);
const ROOT = resolve(process.cwd());
const PORT = 8099;

// [source, output path relative to repo root, label, width, height]
const SHOTS = [
  ["screenshot-1-source.html", "store/store-screenshot-1.png", "extension popup", 1280, 800],
  ["screenshot-2-source.html", "store/store-screenshot-2.png", "in-page fill bar", 1280, 800],
  ["screenshot-3-source.html", "store/store-screenshot-3.png", "dashboard", 1280, 800],
  ["og-source.html", "og.png", "social share card", 1200, 630],
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
  const url = new URL(req.url, "http://localhost");
  // icons-source.html canvases each icon size and POSTs the PNG bytes here, so the
  // images never have to travel as base64 through anything.
  if (req.method === "POST" && url.pathname === "/save") {
    const name = url.searchParams.get("name");
    if (!name || !/^[\w./-]+$/.test(name) || name.includes("..")) {
      res.writeHead(400).end("bad name");
      return;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    await writeFile(join(ROOT, name), Buffer.concat(chunks));
    res.writeHead(200).end("ok");
    return;
  }
  let p = decodeURIComponent(url.pathname);
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

/* Icons first — the screenshot and og sources render logo-96.png, so cutting the icons
   before capturing means a new logo-master.png propagates everywhere in one run. */
await run(chrome, [
  "--headless=new", "--disable-gpu", "--virtual-time-budget=20000",
  "--dump-dom", `http://localhost:${PORT}/store/icons-source.html`,
]).then(({ stdout }) => {
  const m = stdout.match(/<pre id="out">([\s\S]*?)<\/pre>/);
  const body = m ? m[1].trim() : "";
  if (!body.endsWith("DONE") || body.includes("FAILED")) {
    throw new Error("icon generation did not complete:\n" + body);
  }
  console.log(body.replace(/\nDONE$/, ""));
}).catch((e) => { console.error(String(e.message || e)); process.exitCode = 1; });

/* favicon.svg is what every generated internships/ page links to, so it has to be
   rebuilt from the fresh raster in the same pass — otherwise a logo change updates the
   hand-written pages and silently leaves hundreds of generated ones on the old mark. */
{
  const b64 = (await readFile(join(ROOT, "favicon-180.png"))).toString("base64");
  await writeFile(join(ROOT, "favicon.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">' +
    `<image href="data:image/png;base64,${b64}" width="180" height="180"/></svg>`);
  console.log("favicon.svg".padEnd(30) + "rebuilt from favicon-180.png");
}

let failed = false;
for (const [source, out, label, W, H] of SHOTS) {
  const target = join(ROOT, out);
  await run(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    // The sources fetch files and wait for the extension's own UI to mount before the
    // capture is meaningful; virtual time lets that finish without a real-time sleep.
    "--virtual-time-budget=10000",
    "--screenshot=" + target,
    `--window-size=${W},${H}`,
    `http://localhost:${PORT}/store/${source}`,
  ]).catch(() => {}); // chrome exits non-zero on some platforms even when it wrote the file

  const [w, h] = await dimensions(target);
  const ok = w === W && h === H;
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"} ${out.padEnd(30)} ${w}x${h}  (${label})`);
}

server.close();
if (failed) {
  console.error("\nAt least one image came out the wrong size — the Web Store rejects anything but 1280x800.");
  process.exit(1);
}
console.log("\nRegenerated. Upload the three store-screenshot files in the Developer Dashboard listing.");
