/**
 * OfferAIO Engine — resume↔listing ranking via embeddings (repo location: rank.js)
 * "AI picks where to apply", for real: ranks listings by cosine similarity between
 * the resume text and each listing's company+role string. Needs OPENAI_API_KEY.
 */
async function embed(texts) {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.data.map((d) => d.embedding);
}

const cos = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
};

/** Returns indices of `listings` sorted best-match-first, with scores. */
async function rankListings(resumeText, listings) {
  if (!process.env.OPENAI_API_KEY) throw new Error("Set OPENAI_API_KEY to enable ranking.");
  if (!resumeText) throw new Error("Parse a resume first — ranking compares listings against it.");
  if (!listings.length) return [];
  const batch = listings.slice(0, 300); // keep requests sane
  const [resumeVec] = await embed([resumeText.slice(0, 8000)]);
  const vecs = [];
  for (let i = 0; i < batch.length; i += 100)
    vecs.push(...await embed(batch.slice(i, i + 100).map((l) => `${l.role} at ${l.company}`)));
  return vecs
    .map((v, i) => ({ index: i, score: +cos(resumeVec, v).toFixed(4) }))
    .sort((a, b) => b.score - a.score);
}

module.exports = { rankListings };
