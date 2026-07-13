/**
 * OfferAIO Engine — resume parsing (repo location: resume.js)
 * Extracts text with pdf-parse, then pulls structured fields with regex heuristics.
 * If an LLM key is set, upgrades to LLM extraction for higher accuracy.
 */
const fs = require("fs");
const pdf = require("pdf-parse");

async function parseResume(pdfPath) {
  if (!pdfPath || !fs.existsSync(pdfPath)) throw new Error("Resume PDF not found at: " + pdfPath);
  const { text } = await pdf(fs.readFileSync(pdfPath));
  const clean = text.replace(/\r/g, "").trim();

  const out = { resumeText: clean };
  const email = clean.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (email) out.email = email[0];
  const phone = clean.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  if (phone) out.phone = phone[0].trim();
  const linkedin = clean.match(/linkedin\.com\/in\/[\w-]+/i);
  if (linkedin) out.linkedin = "https://" + linkedin[0];
  const gpa = clean.match(/GPA[:\s]*([0-4]\.\d{1,2})/i);
  if (gpa) out.gpa = gpa[1];
  const grad = clean.match(/(expected|graduat\w*)[^\n]*?((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*20\d{2}|20\d{2})/i);
  if (grad) out.gradDate = grad[2];
  const school = clean.match(/(University|College|Institute|School) of [A-Z][\w\s]+|[A-Z][\w\s]+ (University|College|Institute)/);
  if (school) out.school = school[0].trim().split("\n")[0];
  // first non-empty line is usually the name
  const firstLine = clean.split("\n").map((s) => s.trim()).find((s) => s.length > 2 && s.length < 60);
  if (firstLine && !/resume|curriculum/i.test(firstLine)) out.name = firstLine;

  // LLM upgrade if available
  if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) {
    try {
      const { llm } = require("./cover");
      const j = await llm(
        "Extract resume fields. Reply with ONLY minified JSON: {name,email,phone,school,major,gradDate,gpa,linkedin,skills:[],stories:[3 one-line specific accomplishments]}. Use null for unknown.",
        clean.slice(0, 6000)
      );
      const parsed = JSON.parse(j.replace(/^```json?|```$/g, "").trim());
      for (const [k, v] of Object.entries(parsed)) if (v) out[k] = v;
    } catch (_) { /* heuristics already populated */ }
  }
  return out;
}

module.exports = { parseResume };
