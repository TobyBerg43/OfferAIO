/* Mint a licence key by hand, without Stripe.
 *
 *   node worker/mint-license.mjs                          # print the key + the command
 *   node worker/mint-license.mjs --write                  # …and write it to KV
 *   node worker/mint-license.mjs --write --months 6 --email you@example.com --note "beta"
 *   node worker/mint-license.mjs --check OA-XXXX-XXXX-XXXX   # verify one against the live Worker
 *
 * WHAT IT IS FOR. Three real cases, none of which Stripe covers:
 *   - **Dogfooding.** The owner needs Pro to exercise `/cover`, and buying from yourself to
 *     read your own product is silly.
 *   - **Support.** A customer whose webhook was dropped, or who lost their key. §10's
 *     known KV race says the first symptom is "a key that stopped working a month after
 *     purchase" — this is how you hand them a working one while you investigate.
 *   - **Comps.** A friend, a beta tester, a refund you'd rather settle in access.
 *
 * ⚠️ A key minted here has **no Stripe subscription behind it**, so nothing will ever
 * renew or cancel it — it simply expires at `periodEnd` and that is the only thing that
 * stops it. Keep the term short unless you mean it. `customerId` is null on purpose: the
 * `cust:` reverse index exists so subscription webhooks can find a key, and there is no
 * subscription here to find it from.
 *
 * ⚠️ It does NOT test the purchase path. Checkout → webhook → key minted → license.html
 * has still never run with a real Stripe event (PROJECT.md §12 item 4). Minting by hand
 * skips exactly the part that has never been exercised, so it is the right tool for
 * getting Pro and the wrong tool for proving Pro works.
 *
 * Writing needs wrangler auth on this machine (`npx wrangler whoami`).
 */

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = "https://offeraio-worker.tobybergerbusiness.workers.dev";

// Crockford base32, exactly as in src/billing.js — no I, L, O or U, so the key survives
// normalizeKey() unchanged and a customer reading it aloud cannot produce a different one.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf("--" + name);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes("--" + name);

/** The namespace id, read from wrangler.toml so it cannot drift from what deploys. */
function namespaceId() {
  const toml = readFileSync(join(HERE, "wrangler.toml"), "utf8");
  const block = /binding\s*=\s*"LICENSES"[\s\S]*?id\s*=\s*"([0-9a-f]+)"/.exec(toml);
  if (!block) throw new Error("LICENSES namespace id not found in wrangler.toml");
  return block[1];
}

function generateKey() {
  const b = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) {
    if (i && i % 4 === 0) out += "-";
    out += ALPHABET[b[i] % 32];
  }
  return "OA-" + out;
}

/* ------------------------------------------------------------------- --check */

if (has("check")) {
  const key = flag("check");
  const installId = "mint-license-check";
  const r = await fetch(WORKER + "/license/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, installId }),
  });
  const j = await r.json().catch(() => ({}));
  console.log("HTTP " + r.status);
  console.log(JSON.stringify(j, null, 2));
  console.log(
    j.active
      ? `\n✅ active — plan ${j.plan}, quota ${j.quota}/month, expires ${new Date(j.periodEnd).toDateString()}`
      : `\n❌ not active${j.reason ? " — " + j.reason : ""}`,
  );
  // The check itself consumed an install slot if the key was real; say so rather than
  // letting the owner wonder why 1 of 3 is used on a key they have not installed yet.
  if (j.active && typeof j.installs === "number") {
    console.log(`   (this check registered as an install: ${j.installs} of ${j.maxInstalls})`);
  }
  process.exit(j.active ? 0 : 1);
}

/* -------------------------------------------------------------------- mint */

const months = Number(flag("months", 12));
if (!Number.isFinite(months) || months <= 0 || months > 60) {
  console.error("--months must be a number between 1 and 60");
  process.exit(1);
}

const key = generateKey();
const now = Date.now();
const rec = {
  email: flag("email", null),
  status: "active",
  plan: "pro",
  periodEnd: now + months * 30 * 86400 * 1000,
  // Not provisional: a Stripe-minted record flags its 35-day guess so the first real
  // invoice can shorten it. Nothing here will ever be corrected, so the value is final.
  customerId: null,
  subscriptionId: null,
  installs: [],
  createdAt: now,
  mintedByHand: true,
  note: flag("note", "minted with worker/mint-license.mjs — no Stripe subscription behind it"),
};

const nsId = namespaceId();
const args = ["wrangler", "kv", "key", "put", `key:${key}`, JSON.stringify(rec),
  "--namespace-id", nsId, "--remote"];

console.log("key:      " + key);
console.log("plan:     pro · 250/month");
console.log("expires:  " + new Date(rec.periodEnd).toDateString() + `  (${months} months)`);
console.log("email:    " + (rec.email || "(none)"));
console.log("");

if (!has("write")) {
  console.log("Nothing was written. To write it:\n");
  console.log("  npx " + args.map((a) => (/[\s{"]/.test(a) ? `'${a}'` : a)).join(" "));
  console.log("\nOr re-run this with --write.");
  process.exit(0);
}

console.log("writing to KV " + nsId + " …");
const res = spawnSync("npx", args, { stdio: "inherit", shell: process.platform === "win32", cwd: HERE });
if (res.status !== 0) {
  console.error("\nwrangler failed. Is this machine logged in? `npx wrangler whoami`");
  process.exit(res.status || 1);
}

console.log("\nverifying against the live Worker …");
const r = await fetch(WORKER + "/license/verify", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ key, installId: "mint-license-verify" }),
});
const j = await r.json().catch(() => ({}));
if (j.active) {
  console.log(`✅ ${key} is live — plan ${j.plan}, quota ${j.quota}/month.`);
  console.log("   Paste it into the extension popup under License, or on /license.html.");
  console.log(`   Note this verify used one of the ${j.maxInstalls} install slots.`);
} else {
  console.log("❌ written, but the Worker does not consider it active:");
  console.log(JSON.stringify(j, null, 2));
  process.exit(1);
}
