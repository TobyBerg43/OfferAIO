/**
 * OfferAIO Engine — apply automation (repo location: apply.js)
 * Fills real applications with Playwright. Supported: Greenhouse, Lever.
 * Workday intentionally unsupported in v1 (multi-page account flows — roadmap).
 *
 * mode "semi": fills everything, brings the browser window to front, and WAITS —
 *              you review and click submit yourself (the safe default).
 * mode "auto": fills and submits, saves a confirmation screenshot.
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const SHOTS = path.join(process.env.OFFERAIO_DATA || path.join(__dirname, "engine-data"), "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });

function detectATS(url) {
  if (/greenhouse\.io/.test(url)) return "greenhouse";
  if (/lever\.co/.test(url)) return "lever";
  return null;
}

/* Heuristic answers for screener questions based on profile.qa + sane defaults */
function answerFor(labelText, profile) {
  const l = labelText.toLowerCase();
  const qa = profile.qa || {};
  for (const [k, v] of Object.entries(qa)) if (l.includes(k.toLowerCase())) return v;
  if (/sponsor/.test(l)) return profile.needsSponsorship ? "Yes" : "No";
  if (/authorized|eligible to work|work authorization/.test(l)) return "Yes";
  if (/18 years|age/.test(l)) return "Yes";
  if (/linkedin/.test(l)) return profile.linkedin || "";
  if (/graduat/.test(l)) return profile.gradDate || "May 2028";
  if (/gpa/.test(l)) return profile.gpa || "";
  if (/school|university|college/.test(l)) return profile.school || "";
  if (/hear about/.test(l)) return "Company website";
  return null; // leave unknown questions blank for human review
}

async function fillIfEmpty(locator, value) {
  try {
    if (value && (await locator.count()) && !(await locator.first().inputValue().catch(() => "x")))
      await locator.first().fill(String(value));
  } catch (_) {}
}

async function fillGreenhouse(page, { profile, coverLetter }) {
  const [first = "", ...rest] = (profile.name || "").split(" ");
  await fillIfEmpty(page.locator('#first_name, input[name*="first_name"]'), first);
  await fillIfEmpty(page.locator('#last_name, input[name*="last_name"]'), rest.join(" "));
  await fillIfEmpty(page.locator('#email, input[type="email"]'), profile.email);
  await fillIfEmpty(page.locator('#phone, input[name*="phone"]'), profile.phone);
  // resume upload
  if (profile.resumePath && fs.existsSync(profile.resumePath)) {
    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count()) await fileInput.setInputFiles(profile.resumePath).catch(() => {});
  }
  // cover letter: textarea or file — prefer textarea
  const clBox = page.locator('#cover_letter_text, textarea[name*="cover_letter"]');
  if (coverLetter && (await clBox.count())) await clBox.first().fill(coverLetter).catch(() => {});
  // LinkedIn + custom text questions
  for (const field of await page.locator("label").all()) {
    const text = (await field.textContent().catch(() => "")) || "";
    const ans = answerFor(text, profile);
    if (ans == null) continue;
    const forId = await field.getAttribute("for").catch(() => null);
    if (!forId) continue;
    const input = page.locator(`#${CSS.escape ? forId : forId}`).first();
    try {
      const tag = await input.evaluate((el) => el.tagName.toLowerCase());
      if (tag === "input" || tag === "textarea") await fillIfEmpty(input, ans);
      else if (tag === "select") await input.selectOption({ label: ans }).catch(() => {});
    } catch (_) {}
  }
  return page.locator('#submit_app, button[type="submit"]').first();
}

async function fillLever(page, { profile, coverLetter }) {
  // Lever posting pages need the /apply path
  if (!/\/apply\b/.test(page.url())) {
    const applyBtn = page.locator('a[href*="/apply"], .postings-btn').first();
    if (await applyBtn.count()) { await applyBtn.click().catch(() => {}); await page.waitForLoadState("domcontentloaded"); }
  }
  await fillIfEmpty(page.locator('input[name="name"]'), profile.name);
  await fillIfEmpty(page.locator('input[name="email"]'), profile.email);
  await fillIfEmpty(page.locator('input[name="phone"]'), profile.phone);
  await fillIfEmpty(page.locator('input[name="org"]'), profile.school);
  await fillIfEmpty(page.locator('input[name="urls[LinkedIn]"]'), profile.linkedin);
  if (profile.resumePath && fs.existsSync(profile.resumePath)) {
    const fileInput = page.locator('#resume-upload-input, input[type="file"]').first();
    if (await fileInput.count()) await fileInput.setInputFiles(profile.resumePath).catch(() => {});
  }
  const comments = page.locator('textarea[name="comments"]');
  if (coverLetter && (await comments.count())) await comments.fill(coverLetter).catch(() => {});
  // custom question cards
  for (const card of await page.locator(".application-question").all()) {
    const label = (await card.locator(".application-label").textContent().catch(() => "")) || "";
    const ans = answerFor(label, profile);
    if (ans == null) continue;
    const text = card.locator('input[type="text"], textarea').first();
    if (await text.count()) { await fillIfEmpty(text, ans); continue; }
    const radio = card.locator(`label:has-text("${ans}") input[type="radio"]`).first();
    if (await radio.count()) await radio.check().catch(() => {});
  }
  return page.locator('#btn-submit, button[type="submit"]').first();
}

async function applyToJob({ url, mode, coverLetter, profile }) {
  const ats = detectATS(url);
  if (!ats) throw new Error("Unsupported ATS for v1 (Greenhouse and Lever only). Use the posting's direct apply URL.");

  // Prefer the user's installed Chrome (no 150MB bundled browser); fall back to Playwright's.
  let browser;
  try { browser = await chromium.launch({ headless: false, channel: "chrome" }); }
  catch (_) { browser = await chromium.launch({ headless: false }); }
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1200 + Math.random() * 1500); // human pacing

  const submitBtn = ats === "greenhouse"
    ? await fillGreenhouse(page, { profile, coverLetter })
    : await fillLever(page, { profile, coverLetter });

  const shot = path.join(SHOTS, `${Date.now()}-${ats}.png`);
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});

  if (mode === "auto") {
    // NOTE: if a CAPTCHA is present we stop — never bypass it; window stays open for the user.
    const captcha = await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"]').count();
    if (captcha) return { submitted: false, ats, screenshot: shot, note: "CAPTCHA present — window left open, complete it and submit manually." };
    await page.waitForTimeout(800 + Math.random() * 1200);
    await submitBtn.click({ timeout: 10000 });
    await page.waitForTimeout(3500);
    const confirm = path.join(SHOTS, `${Date.now()}-${ats}-confirm.png`);
    await page.screenshot({ path: confirm, fullPage: true }).catch(() => {});
    await browser.close();
    return { submitted: true, ats, screenshot: confirm };
  }

  // semi mode: leave the filled application open for human review + submit
  return { submitted: false, ats, screenshot: shot, note: "Filled — review the open browser window and click submit." };
}

module.exports = { applyToJob, detectATS };
