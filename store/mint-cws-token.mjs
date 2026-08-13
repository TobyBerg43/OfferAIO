/* Mint a Chrome Web Store API refresh token, once, on this machine.
 *
 *   node store/mint-cws-token.mjs
 *
 * Reads CWS_CLIENT_ID and CWS_CLIENT_SECRET from the environment (or from argv[2]/argv[3]),
 * opens Google's consent screen, catches the redirect on 127.0.0.1, exchanges the code, and
 * writes all four credentials to a file OUTSIDE the repo:
 *
 *   %USERPROFILE%\.offeraio-cws.env      (override with --out <path>)
 *
 * It writes the token to disk rather than printing it, so the secret never lands in a
 * terminal transcript that someone might paste somewhere. Nothing here touches the repo.
 *
 * Google deprecated the out-of-band (urn:ietf:wg:oauth:2.0:oob) flow in 2022, so this uses
 * the loopback redirect, which is why the OAuth client must be created as an
 * "Application type: Desktop app" client. A Web application client will reject the
 * http://127.0.0.1 redirect unless you register it by hand.
 *
 * ⚠️ If the OAuth consent screen is left in "Testing", Google expires the refresh token
 * after 7 days and every later publish fails with invalid_grant. Set it to "In production"
 * before running this. That is the single most common way this breaks.
 */

import http from "node:http";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const outFlag = argv.indexOf("--out");
const OUT = outFlag !== -1 ? argv[outFlag + 1] : join(homedir(), ".offeraio-cws.env");
const positional = argv.filter((a, i) => !a.startsWith("--") && i !== outFlag + 1);

const CLIENT_ID = process.env.CWS_CLIENT_ID || positional[0];
const CLIENT_SECRET = process.env.CWS_CLIENT_SECRET || positional[1];
const SCOPE = "https://www.googleapis.com/auth/chromewebstore";
const PORT = 8976;
const REDIRECT = `http://127.0.0.1:${PORT}`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Need the OAuth client id and secret.\n\n" +
      "  node store/mint-cws-token.mjs <client-id> <client-secret>\n\n" +
      "Create them at console.cloud.google.com -> APIs & Services -> Credentials ->\n" +
      "Create credentials -> OAuth client ID -> Application type: Desktop app.\n" +
      "Sign in as the developer account that owns the listing."
  );
  process.exit(1);
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    // offline + consent together are what make Google return a refresh_token. Without
    // prompt=consent it returns one only on the very first authorisation ever, so a
    // re-run after a mistake silently yields no token at all.
    access_type: "offline",
    prompt: "consent",
  });

const code = await new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, REDIRECT);
    const c = url.searchParams.get("code");
    const err = url.searchParams.get("error");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      `<body style="font:16px system-ui;padding:40px">${
        c ? "Authorised. Close this tab and return to the terminal." : "Failed: " + err
      }</body>`
    );
    server.close();
    c ? resolve(c) : reject(new Error("authorisation denied: " + err));
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.log("Opening Google's consent screen in your browser.");
    console.log("If it does not open, paste this in yourself:\n\n" + authUrl + "\n");
    // Windows: `start` is a cmd builtin, so it needs a shell.
    spawn("cmd", ["/c", "start", "", authUrl], { detached: true, stdio: "ignore" }).unref();
  });
  setTimeout(() => { server.close(); reject(new Error("timed out after 5 minutes")); }, 300_000);
});

const res = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT,
  }),
});
const tok = await res.json();
if (!tok.refresh_token) {
  console.error("No refresh token came back:", JSON.stringify(tok));
  console.error(
    "\nIf this says invalid_grant, the code expired — just re-run.\n" +
      "If it returned an access_token but no refresh_token, the consent screen was skipped;\n" +
      "revoke the app at myaccount.google.com/permissions and run this again."
  );
  process.exit(1);
}

const pub = process.env.CWS_PUBLISHER_ID || "PASTE_PUBLISHER_ID_HERE";
writeFileSync(
  OUT,
  [
    "# Chrome Web Store API credentials for OfferAIO. NOT in the repo. Do not commit.",
    `CWS_CLIENT_ID=${CLIENT_ID}`,
    `CWS_CLIENT_SECRET=${CLIENT_SECRET}`,
    `CWS_REFRESH_TOKEN=${tok.refresh_token}`,
    `CWS_PUBLISHER_ID=${pub}`,
    "",
  ].join("\n"),
  { mode: 0o600 }
);

console.log(`\nRefresh token written to ${OUT}`);
if (pub === "PASTE_PUBLISHER_ID_HERE") {
  console.log(
    "Still needed: CWS_PUBLISHER_ID. Chrome Web Store Developer Dashboard -> the gear\n" +
      "(Account) -> Publisher ID. Paste it into that file."
  );
}
console.log("\nThen, to use it in a PowerShell session:\n");
console.log(`  Get-Content "${OUT}" | Where-Object { $_ -match '^CWS_' } |`);
console.log(`    ForEach-Object { $k,$v = $_ -split '=',2; Set-Item "env:$k" $v }`);
console.log("  node store/publish-extension.mjs --dry-run");
