/**
 * OfferAIO Engine — AI cover letters in the user's voice (repo location: cover.js)
 * Uses ANTHROPIC_API_KEY (preferred) or OPENAI_API_KEY. Plain fetch, no SDK.
 */
async function llm(system, user) {
  if (process.env.ANTHROPIC_API_KEY) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5", max_tokens: 700,
        system, messages: [{ role: "user", content: user }],
      }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.content[0].text.trim();
  }
  if (process.env.OPENAI_API_KEY) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini", max_tokens: 700,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.choices[0].message.content.trim();
  }
  throw new Error("Set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable AI cover letters.");
}

async function writeCover({ company, role, description = "", profile = {} }) {
  const samples = (profile.samples || []).slice(0, 3).join("\n\n---\n\n");
  const stories = (profile.stories || []).join("\n- ");
  const system = `You ghost-write cover letters for a college student. Absolute rules:
- Sound like a real 19-21 year old who writes well, NOT like an AI. Banned: "I am excited to apply", "I am confident that", "aligns with my passion", "leverage", "fast-paced environment", "unique opportunity", "delve", em-dash overuse, tricolon lists, and any sentence structure that repeats.
- Vary sentence length. Include one specific, concrete detail from the student's real experiences. One tasteful, slightly informal touch is good.
- 130-190 words. No address block, no "Dear Hiring Manager" if company known — use the company name.
- Never invent experiences not present in the provided background.`;
  const user = `Company: ${company}\nRole: ${role}\n${description ? `Job description excerpt: ${description.slice(0, 1200)}\n` : ""}
Student background (from resume): ${profile.resumeText ? profile.resumeText.slice(0, 1500) : "(none provided)"}
Real stories/experiences to optionally draw on:\n- ${stories || "(none)"}
${samples ? `\nWriting samples — MATCH this person's rhythm, vocabulary and quirks:\n${samples}` : ""}
Write the cover letter now. Output only the letter.`;
  return llm(system, user);
}

module.exports = { writeCover, llm };
