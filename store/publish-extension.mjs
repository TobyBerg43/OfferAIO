/* Submit the packaged extension to the Chrome Web Store via the Publish API.
 *
 *   node store/publish-extension.mjs            # upload the package, then submit for review
 *   node store/publish-extension.mjs --dry-run  # auth + status check only, changes nothing
 *   node store/publish-extension.mjs --upload-only
 *   node store/publish-extension.mjs --publish-only
 *
 * Credentials come from the environment so they never land in the repo or in a chat
 * transcript. Set these first (see the header of §8 in PROJECT.md for how to mint them):
 *
 *   CWS_CLIENT_ID       OAuth client id      (Google Cloud console)
 *   CWS_CLIENT_SECRET   OAuth client secret
 *   CWS_REFRESH_TOKEN   refresh token for scope https://www.googleapis.com/auth/chromewebstore
 *   CWS_PUBLISHER_ID    Developer Dashboard -> Publisher -> Settings
 *
 * IMPORTANT LIMITATION, and the reason this script cannot do the whole job: the Publish
 * API only handles the *package* and the submission itself. There is no API for the store
 * listing — description, category, screenshots, store icon — or for the Privacy practices
 * tab. Those are dashboard-only. If they are incomplete, :publish returns an error naming
 * the missing fields rather than submitting, which is the correct and safe failure.
 */

const ITEM_ID = "hcbchgpjladdfmcammhgbbmkdagcfcgd"; // PROJECT.md §8
const ZIP_URL =
  "https://github.com/TobyBerg43/OfferAIO/releases/download/extension-latest/offeraio-extension.zip";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const doUpload = !args.has("--publish-only");
const doPublish = !args.has("--upload-only");

const need = ["CWS_CLIENT_ID", "CWS_CLIENT_SECRET", "CWS_REFRESH_TOKEN", "CWS_PUBLISHER_ID"];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error("Missing environment variables:\n  " + missing.join("\n  "));
  console.error("\nNothing was sent to Google. See the header of this file for how to mint them.");
  process.exit(1);
}
const { CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_PUBLISHER_ID } = process.env;

/** Exchange the long-lived refresh token for a short-lived access token. */
async function accessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CWS_CLIENT_ID,
      client_secret: CWS_CLIENT_SECRET,
      refresh_token: CWS_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("token exchange failed: " + JSON.stringify(j));
  return j.access_token;
}

const base = `https://chromewebstore.googleapis.com/v2/publishers/${CWS_PUBLISHER_ID}/items/${ITEM_ID}`;
const uploadUrl = `https://chromewebstore.googleapis.com/upload/v2/publishers/${CWS_PUBLISHER_ID}/items/${ITEM_ID}:upload`;

async function call(url, token, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: "Bearer " + token, ...(body ? {} : { "content-length": "0" }) },
    body,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok, json };
}

const token = await accessToken();
console.log("auth ok");

// Status first — it is a read, and it tells us whether a submission is already in flight.
const status = await fetch(`${base}:fetchStatus`, { headers: { authorization: "Bearer " + token } })
  .then(async (r) => ({ status: r.status, body: await r.text() }));
console.log("fetchStatus:", status.status);

/* Print the two revision blocks, not the raw body. The body leads with a ~400-character
 * publicKey, so any fixed-length slice of it shows nothing but the key — which made
 * --dry-run useless for the one job PROJECT.md §12 asks it to do, reporting whether a
 * submission is in flight. An *absent* submittedItemRevisionStatus is the answer meaning
 * "nothing pending", so say so rather than printing nothing. */
function describeRevision(rev) {
  if (!rev) return "— none —";
  const ch = (rev.distributionChannels || [])
    .map((c) => `crx ${c.crxVersion ?? "?"} @ ${c.deployPercentage ?? "?"}%`)
    .join(", ");
  return [rev.state ?? "?", ch].filter(Boolean).join("  ");
}
try {
  const j = JSON.parse(status.body);
  console.log("  published:", describeRevision(j.publishedItemRevisionStatus));
  console.log("  submitted:", describeRevision(j.submittedItemRevisionStatus));
} catch {
  console.log("  (unparseable response)", status.body.slice(0, 500));
}

if (dryRun) {
  console.log("\n--dry-run: authenticated and read status. Nothing was uploaded or submitted.");
  process.exit(0);
}

if (doUpload) {
  console.log("\ndownloading the published zip…");
  const zip = Buffer.from(await (await fetch(ZIP_URL, { redirect: "follow" })).arrayBuffer());
  console.log("zip:", zip.length, "bytes");
  const up = await call(uploadUrl, token, zip);
  console.log("upload:", up.status, JSON.stringify(up.json).slice(0, 600));
  if (!up.ok) { console.error("\nUpload failed — not attempting to publish."); process.exit(1); }
}

if (doPublish) {
  const pub = await call(`${base}:publish`, token);
  console.log("publish:", pub.status, JSON.stringify(pub.json).slice(0, 800));
  if (!pub.ok) {
    console.error(
      "\nPublish was rejected. The usual cause is an incomplete listing: the store listing " +
      "fields, the store icon, the screenshots, or the Privacy practices tab. None of those " +
      "are settable through this API — finish them in the Developer Dashboard and re-run."
    );
    process.exit(1);
  }
  console.log("\nSubmitted for review.");
}
