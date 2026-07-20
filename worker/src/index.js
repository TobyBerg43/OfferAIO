/* OfferAIO Cloudflare Worker — holds your AI API key server-side so the website and
 * extension can request cover letters + resume ranking without exposing the key.
 * Deploy: set ANTHROPIC_API_KEY (or OPENAI_API_KEY) as a secret, then deploy.
 * Free tier = 100,000 requests/day. */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const { pathname } = new URL(request.url);
    try {
      if (pathname === "/health") return json({ ok: true, service: "offeraio-worker/1.0" });
      if (pathname === "/cover" && request.method === "POST") {
        const { company, role, description = "", profile = {} } = await request.json();
        return json({ ok: true, letter: await writeCover({ company, role, description, profile }, env) });
      }
      if (pathname === "/rank" && request.method === "POST") {
        const { resumeText = "", listings = [] } = await request.json();
        return json({ ok: true, order: await rank(resumeText, listings, env) });
      }
      return json({ ok: false, error: "Not found" }, 404);
    } catch (e) {
      return json({ ok: false, error: e.message }, 500);
    }
  },
};

async function llm(system, user, env) {
  if (env.ANTHROPIC_API_KEY) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 700,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.content[0].text.trim();
  }
  if (env.OPENAI_API_KEY) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer " + env.OPENAI_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 700,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.choices[0].message.content.trim();
  }
  throw new Error("No API key set. Add ANTHROPIC_API_KEY as a secret in Settings > Variables.");
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
      body: JSON.stringify({ model: "text-embedding-3-small", input }),
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
