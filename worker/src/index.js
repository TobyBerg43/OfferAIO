/* OfferAIO Cloudflare Worker — holds the AI API key server-side so the website and
 * extension can request cover letters + resume ranking without exposing it.
 * Deploy: set OPENAI_API_KEY as a secret, then deploy.
 * Free tier = 100,000 requests/day.
 *
 * OpenAI is the only AI vendor: one key covers both paths (chat for /cover,
 * embeddings for /rank). Anthropic has no embeddings API, so keeping it would have
 * meant a second provider or a Workers AI binding purely for ranking. */

import {
  handleWebhook,
  verifyLicense,
  activateLicense,
  licenseBySession,
  checkAI,
  recordAI,
} from "./billing.js";

/* Cover letters are the quality-critical path: the output has to read like a real
 * 19-21 year old, dodge a banned-phrase list, and mirror the user's writing samples.
 * A mini/nano model is precisely where that collapses into the generic AI voice the
 * product sells against, so /cover runs on a mid-tier model. At ~1.5k in / 200 out
 * that's ~$0.007 a letter — under 6% of a $30 subscription even if someone burns the
 * full 250/month cap. Upgrade to gpt-5.6-sol here if the voice still isn't right.
 * Ranking stays on the cheap embedding model; it's similarity maths, not prose. */
const COVER_MODEL = "gpt-5.6-terra";
const EMBED_MODEL = "text-embedding-3-small";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });

export default {
  async fetch(request, env) {
    // Before the OPTIONS/CORS handling below: the webhook is server-to-server, needs no
    // CORS, and must consume the raw body itself so the HMAC matches the exact bytes
    // Stripe signed.
    if (new URL(request.url).pathname === "/stripe/webhook") {
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      return handleWebhook(request, env);
    }

    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const { pathname } = new URL(request.url);
    try {
      if (pathname === "/health") return json({ ok: true, service: "offeraio-worker/1.0" });

      if (pathname === "/license/verify" && request.method === "POST") {
        return json(await verifyLicense(env, await request.json()));
      }
      if (pathname === "/license/activate" && request.method === "POST") {
        return json(await activateLicense(env, await request.json()));
      }
      if (pathname === "/license/by-session" && request.method === "GET") {
        const sid = new URL(request.url).searchParams.get("session_id");
        return json(await licenseBySession(env, sid));
      }

      // /cover and /rank spend real money on the Anthropic and OpenAI keys, so they
      // require an active licence and are metered server-side. This is the only
      // enforcement that isn't client-side and therefore bypassable.
      if (pathname === "/cover" && request.method === "POST") {
        const body = await request.json();
        const gate = await checkAI(env, body);
        if (!gate.allowed) return json({ ok: false, error: "Pro required", ...gate }, gate.status);
        const { company, role, description = "", profile = {} } = body;
        const letter = await writeCover({ company, role, description, profile }, env);
        const m = await recordAI(env, gate); // only bill what actually generated
        return json({ ok: true, letter, used: m.used, limit: m.limit });
      }
      if (pathname === "/rank" && request.method === "POST") {
        const body = await request.json();
        const gate = await checkAI(env, body);
        if (!gate.allowed) return json({ ok: false, error: "Pro required", ...gate }, gate.status);
        const { resumeText = "", listings = [] } = body;
        const order = await rank(resumeText, listings, env);
        const m = await recordAI(env, gate);
        return json({ ok: true, order, used: m.used, limit: m.limit });
      }
      return json({ ok: false, error: "Not found" }, 404);
    } catch (e) {
      return json({ ok: false, error: e.message }, 500);
    }
  },
};

async function llm(system, user, env) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("No API key set. Add OPENAI_API_KEY as a secret in Settings > Variables.");
  }
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: "Bearer " + env.OPENAI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      model: COVER_MODEL,
      max_tokens: 700,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.choices[0].message.content.trim();
}

async function writeCover({ company, role, description, profile }, env) {
  const samples = (profile.samples || []).slice(0, 3).join("\n\n---\n\n");
  const system =
    "You ghost-write cover letters for a college student. Sound like a real 19-21 year old who writes well, " +
    "NOT like an AI. Banned phrases: 'I am excited to apply', 'I am confident that', 'aligns with my passion', " +
    "'leverage', 'fast-paced environment', 'unique opportunity', 'delve'. Vary sentence length. Include one " +
    "concrete real detail from the background. 130-190 words. Use the company name, no 'Dear Hiring Manager'. " +
    "Never invent experiences not present in the background.";
  const user =
    "Company: " + company + "\nRole: " + role + "\n" +
    (description ? "Job description excerpt: " + description.slice(0, 1000) + "\n" : "") +
    "Student background: " + String(profile.resumeText || JSON.stringify(profile)).slice(0, 1500) + "\n" +
    (samples ? "Writing samples — match this person's rhythm and quirks:\n" + samples + "\n" : "") +
    "Write the cover letter now. Output only the letter.";
  return llm(system, user, env);
}

async function rank(resumeText, listings, env) {
  if (!env.OPENAI_API_KEY) throw new Error("Ranking needs OPENAI_API_KEY (embeddings).");
  if (!resumeText || !listings.length) return [];
  const embed = async (input) => {
    const r = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { authorization: "Bearer " + env.OPENAI_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.data.map((d) => d.embedding);
  };
  const cos = (a, b) => {
    let d = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return d / (Math.sqrt(na) * Math.sqrt(nb));
  };
  const [rv] = await embed([resumeText.slice(0, 8000)]);
  const vecs = await embed(listings.slice(0, 200).map((l) => l.role + " at " + l.company));
  return vecs.map((v, i) => ({ index: i, score: +cos(rv, v).toFixed(4) })).sort((a, b) => b.score - a.score);
}
