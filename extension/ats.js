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
  /* Entries are plain data — a domain suffix, and for the whole-site hosts a path
   * prefix — rather than hand-written regexes. Two reasons. The regexes were all the
   * same shape, so writing them out fifteen times was fifteen chances to typo one.
   * And plain data survives postMessage: bridge.js hands this list to the dashboard so
   * offeraio.com can tell the user which postings we can actually fill, without keeping
   * a third copy of the list that drifts from this one.
   *
   * `suffix` matches the domain itself and any subdomain. `exactHost` pins to one
   * hostname where a wildcard would claim more of a site than the manifest grants. */
  const ATS = [
    { id: "greenhouse", name: "Greenhouse", suffix: "greenhouse.io" },
    // Lever and Greenhouse both run regional instances — jobs.eu.lever.co,
    // job-boards.eu.greenhouse.io. Those carry US roles (the company's ATS
    // account is in the EU, the job is in Chicago), so the match must not be
    // pinned to the single US hostname.
    { id: "lever", name: "Lever", suffix: "lever.co" },
    { id: "ashby", name: "Ashby", suffix: "ashbyhq.com" },
    { id: "workday", name: "Workday", suffix: "myworkdayjobs.com" },
    { id: "smartrecruiters", name: "SmartRecruiters", suffix: "smartrecruiters.com" },
    { id: "icims", name: "iCIMS", suffix: "icims.com" },
    { id: "workable", name: "Workable", suffix: "workable.com" },
    { id: "jobvite", name: "Jobvite", suffix: "jobvite.com" },
    { id: "bamboohr", name: "BambooHR", suffix: "bamboohr.com" },
    { id: "breezy", name: "Breezy", suffix: "breezy.hr" },
    { id: "taleo", name: "Taleo", suffix: "taleo.net" },
    { id: "handshake", name: "Handshake", suffix: "joinhandshake.com" },
    // LinkedIn and Indeed are whole sites; only their job paths are ours. LinkedIn is
    // pinned to www because that is all the manifest asks for — claiming *.linkedin.com
    // would request a much larger site's worth of permission for regional hosts this
    // US-only product never needs.
    { id: "linkedin", name: "LinkedIn", exactHost: "www.linkedin.com", pathPrefix: "/jobs/" },
    { id: "ziprecruiter", name: "ZipRecruiter", suffix: "ziprecruiter.com" },
    { id: "indeed", name: "Indeed", suffix: "indeed.com" },
    { id: "wellfound", name: "Wellfound", suffix: "wellfound.com" },
  ];

  /** Does `host` sit on this entry's domain (or a subdomain of it)? */
  function hostMatches(a, h) {
    if (a.exactHost) return h === a.exactHost;
    return h === a.suffix || h.endsWith("." + a.suffix);
  }

  /** The ATS serving `host`/`pathname`, or null. */
  function fromHost(host, pathname) {
    const h = String(host || "").toLowerCase();
    const p = String(pathname || "/");
    return ATS.find((a) => hostMatches(a, h) && (!a.pathPrefix || p.startsWith(a.pathPrefix))) || null;
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
