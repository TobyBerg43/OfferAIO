/* OfferAIO — the one list of applicant tracking systems we support.
 *
 * content.js needs it to label what it just filled; popup.js needs it to decide
 * whether the Fill button can do anything at all on the current tab. Those two
 * answers must never disagree — a popup that offers to fill a page the content
 * script won't touch is exactly the "what is this indicating to?" confusion this
 * file exists to remove. So the list lives here once, as a plain IIFE on `self`
 * (content scripts can't `import`), and both sides read it.
 *
 * Keep it in step with manifest.json's `matches` / `host_permissions`. A host
 * listed here but not in the manifest is a button that lights up and then does
 * nothing.
 */
(() => {
  const ATS = [
    { id: "greenhouse", name: "Greenhouse", host: /(^|\.)greenhouse\.io$/ },
    // Lever and Greenhouse both run regional instances — jobs.eu.lever.co,
    // job-boards.eu.greenhouse.io. Those carry US roles (the company's ATS
    // account is in the EU, the job is in Chicago), so the match must not be
    // pinned to the single US hostname.
    { id: "lever", name: "Lever", host: /(^|\.)lever\.co$/ },
    { id: "ashby", name: "Ashby", host: /(^|\.)ashbyhq\.com$/ },
    { id: "workday", name: "Workday", host: /(^|\.)myworkdayjobs\.com$/ },
    { id: "smartrecruiters", name: "SmartRecruiters", host: /(^|\.)smartrecruiters\.com$/ },
    { id: "icims", name: "iCIMS", host: /(^|\.)icims\.com$/ },
    { id: "workable", name: "Workable", host: /(^|\.)workable\.com$/ },
    { id: "jobvite", name: "Jobvite", host: /(^|\.)jobvite\.com$/ },
    { id: "bamboohr", name: "BambooHR", host: /(^|\.)bamboohr\.com$/ },
    { id: "breezy", name: "Breezy", host: /(^|\.)breezy\.hr$/ },
    { id: "taleo", name: "Taleo", host: /(^|\.)taleo\.net$/ },
    { id: "handshake", name: "Handshake", host: /(^|\.)joinhandshake\.com$/ },
    // LinkedIn and Indeed are whole sites; only their job paths are ours.
    { id: "linkedin", name: "LinkedIn", host: /(^|\.)linkedin\.com$/, path: /^\/jobs\// },
    { id: "ziprecruiter", name: "ZipRecruiter", host: /(^|\.)ziprecruiter\.com$/ },
    { id: "indeed", name: "Indeed", host: /(^|\.)indeed\.com$/ },
    { id: "wellfound", name: "Wellfound", host: /(^|\.)wellfound\.com$/ },
  ];

  /** The ATS serving `host`/`pathname`, or null. */
  function fromHost(host, pathname) {
    const h = String(host || "").toLowerCase();
    const p = String(pathname || "/");
    return ATS.find((a) => a.host.test(h) && (!a.path || a.path.test(p))) || null;
  }

  /** The ATS serving a full URL, or null. Never throws on a junk URL. */
  function fromUrl(url) {
    try {
      const u = new URL(url);
      // chrome://, about:, file:// and friends are never an application form.
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      return fromHost(u.hostname, u.pathname);
    } catch (e) {
      return null;
    }
  }

  self.OfferAIOATS = { list: ATS, fromHost, fromUrl, count: ATS.length };
})();
