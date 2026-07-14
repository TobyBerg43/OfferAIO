#!/usr/bin/env node
/*
 * OfferAIO programmatic SEO page generator.
 * Runs in CI after scrape.js. Reads data/listings.json, emits static pages:
 *   /internships/                     hub
 *   /internships/<category>/          6 category hubs
 *   /internships/companies/           A-Z directory
 *   /internships/companies/<slug>/    per-company pages (kept when roles close)
 * Also regenerates sitemap.xml. State in data/companies_seen.json so company
 * URLs persist after their roles expire (marked closed, never 404).
 */
const fs = require('fs');
const path = require('path');

const SITE = 'https://offeraio.com';
const TODAY = new Date().toISOString().slice(0, 10);

const listings = JSON.parse(fs.readFileSync('data/listings.json', 'utf8'))
  .filter(l => l && l.company_name && l.title && l.url);

const CATS = [
  { slug: 'software-engineering', name: 'Software Engineering', re: /(software|\bswe\b|engineer|developer|front.?end|back.?end|full.?stack|mobile|\bios\b|android|devops|security|infrastructure|platform)/i },
  { slug: 'quant', name: 'Quant and Trading', re: /(quant|trading|trader|markets)/i },
  { slug: 'investment-banking', name: 'Investment Banking', re: /(investment bank|banking|m&a|capital markets|\bib\b)/i },
  { slug: 'consulting', name: 'Consulting', re: /consult/i },
  { slug: 'product', name: 'Product', re: /(product manage|product intern|program manage|\bapm\b)/i },
  { slug: 'data', name: 'Data and AI', re: /(data scien|data analy|data engineer|machine learning|ai\/ml|\bai\b|analytics)/i },
];

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slugify = s => String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'company';
const dstr = ts => ts ? new Date(ts * 1000).toISOString().slice(0, 10) : TODAY;

const CSS = `<style>
:root{--bg:#efe8d9;--ink:#2b2823;--soft:#5c5546;--dim:#786f5e;--card:#fffdf8;--line:rgba(88,74,52,.15);--line2:rgba(88,74,52,.28);--blue:#33528c;--blue2:#4a72b8;--green:#2e9d68;--w-line:#e7dece;--w-line2:#d7cbb4;--w-dim:#726a5c;--w-dim2:#a89d89;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;--mono:"SF Mono","Cascadia Code",Consolas,ui-monospace,Menlo,monospace;--ease:cubic-bezier(.22,.61,.36,1)}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased;overflow-x:hidden}
body::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background:radial-gradient(1100px 520px at 50% -80px,rgba(255,250,238,.75),transparent 65%),linear-gradient(96deg,transparent 0 38%,rgba(146,128,100,.08) 38.3%,transparent 38.9%),linear-gradient(113deg,transparent 0 69%,rgba(146,128,100,.09) 69.3%,transparent 69.8%)}
a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
.container{max-width:1080px;margin:0 auto;padding:0 20px}
main.container{padding-top:56px;padding-bottom:96px}
h1{font-size:clamp(28px,4.6vw,42px);letter-spacing:-.022em;line-height:1.12;text-wrap:balance}
h2{font-size:clamp(20px,3vw,27px);letter-spacing:-.018em;margin:56px 0 16px}
.sub{color:var(--soft);font-size:17px;max-width:640px;margin:14px 0 0}
:focus-visible{outline:2px solid var(--blue2);outline-offset:2px;border-radius:4px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:10px;padding:12px 22px;font:600 15px var(--sans);cursor:pointer;border:1px solid transparent;text-decoration:none;transition:transform .18s var(--ease),filter .18s var(--ease);white-space:nowrap}
.btn:hover{text-decoration:none;transform:translateY(-1px);filter:brightness(1.03)}
.btn-gold{background:linear-gradient(135deg,#c8862f,#e0a548);color:#3a2a10}
.btn-blue{background:#33528c;color:#fff}
.btn-ghost{background:transparent;border-color:var(--line2);color:var(--ink)}
.btn.sm{padding:8px 14px;font-size:13px}
.nav{position:sticky;top:0;z-index:50;background:rgba(239,232,217,.88);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.nav-in{display:flex;align-items:center;gap:26px;height:62px}
.logo{display:flex;align-items:center;gap:10px;font-weight:700;font-size:17px;color:var(--ink)}
.logo:hover{text-decoration:none}
.logo-mark{width:30px;height:30px;flex:0 0 auto;display:block}
.logo .acc{color:var(--blue)}
.nav-links{display:flex;gap:22px;margin-left:auto;align-items:center}
.nav-links a{color:var(--soft);font-size:14.5px;font-weight:500}
.nav-links a:hover{color:var(--ink);text-decoration:none}
.nav-links a.btn-blue{color:#fff}
.nav .btn{padding:9px 16px;font-size:14px}
@media(max-width:700px){.nav-links a:not(.btn){display:none}}
.crumbs{font:12px var(--mono);color:var(--dim);margin-bottom:26px}
.crumbs a{color:var(--dim)}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:36px}
@media(max-width:860px){.grid{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 22px;min-width:0}
.card h3{font-size:16px;margin-bottom:4px}
.card .cnt{font:11px var(--mono);color:var(--dim)}
.lrow{display:flex;align-items:center;gap:14px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin-bottom:10px;min-width:0}
.lmain{flex:1;min-width:0}
.lt{font-weight:600;font-size:15px;color:var(--ink);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lm{font:11px var(--mono);color:var(--dim);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pill{display:inline-flex;align-items:center;gap:9px;border:1px solid var(--line2);border-radius:999px;background:var(--card);padding:6px 14px;font:12px var(--mono);color:var(--soft);margin-top:18px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--green)}
.closed{border:1px solid var(--line);background:var(--card);border-radius:14px;padding:28px;color:var(--soft)}
.az{columns:3;column-gap:24px;margin-top:30px}
@media(max-width:700px){.az{columns:1}}
.az a{display:block;padding:6px 0;font-size:14.5px;border-bottom:1px dashed var(--line)}
.cta-band{margin-top:56px;border:1px solid var(--line);background:var(--card);border-radius:16px;padding:36px 28px;text-align:center}
.cta-band p{color:var(--soft);margin:8px auto 20px;max-width:520px}
footer{border-top:1px solid var(--line);padding:36px 0 44px;margin-top:80px}
.foot-links{display:flex;gap:20px;flex-wrap:wrap;margin-bottom:16px}
.foot-links a{color:var(--soft);font-size:13.5px}
.compliance{color:var(--dim);font-size:12.5px;max-width:760px;line-height:1.6}
@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation:none !important;transition:none !important}}
</style>`;

const LOGO = `<svg class="logo-mark" viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#33528c"/><stop offset="1" stop-color="#4a72b8"/></linearGradient></defs><rect width="48" height="48" rx="12" fill="url(#lg)"/><path d="M33.5 20.5 A11 11 0 1 1 26.9 15.4" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/><path d="M29 19 L35 13" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/><path d="M29.5 12 H36 V18.5" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const NAV = `<nav class="nav"><div class="container nav-in"><a class="logo" href="/" aria-label="OfferAIO home">${LOGO}<span>Offer<span class="acc">AIO</span></span></a><div class="nav-links"><a href="/internships/">Internships</a><a href="/pricing/">Pricing</a><a href="/employers/">For Employers</a><a class="btn btn-blue" href="/dashboard/">Open the dashboard</a></div></div></nav>`;

const FOOT = `<footer><div class="container"><div class="foot-links"><a href="/">Home</a><a href="/internships/">Live internships</a><a href="/dashboard/">Dashboard</a><a href="/pricing/">Pricing</a><a href="/employers/">For Employers</a></div><p class="compliance">Listings refresh every 6 hours from public company job boards and community sources. OfferAIO is not affiliated with any employer, university, or applicant tracking system. Applications are always reviewed and authorized by you before submission. No outcomes are guaranteed. © 2026 OfferAIO.</p></div></footer>`;

const CTA = `<div class="cta-band"><h2 style="margin-top:0">Stop applying one tab at a time</h2><p>OfferAIO watches these listings and applies for you, in your own browser. 100 submissions a month, free.</p><a class="btn btn-gold" href="/dashboard/">Start free</a></div>`;

function page(title, desc, canonPath, body, jsonld) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}${canonPath}">
<link rel="icon" href="/favicon.svg">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}${canonPath}">
<meta property="og:site_name" content="OfferAIO">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${SITE}/og.png">
<meta name="twitter:card" content="summary_large_image">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-QP59EKE1BS"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-QP59EKE1BS');</script>
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ''}
${CSS}
</head>
<body>
${NAV}
<main class="container">
${body}
</main>
${FOOT}
</body>
</html>
`;
}

function crumbs(items) {
  const html = items.map((c, i) => c.href ? `<a href="${c.href}">${esc(c.name)}</a>` : esc(c.name)).join(' / ');
  const ld = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: SITE + (c.href || '') }))
  };
  return { html: `<p class="crumbs">${html}</p>`, ld };
}

function row(l) {
  const loc = (l.locations && l.locations[0]) || 'United States';
  return `<div class="lrow"><div class="lmain"><a class="lt" href="${esc(l.url)}" target="_blank" rel="nofollow noopener">${esc(l.title)}</a><div class="lm">${esc(l.company_name)} · ${esc(loc)} · posted ${dstr(l.date_posted)}</div></div><a class="btn btn-gold sm" href="/dashboard/">Auto apply</a></div>`;
}

function write(p, html) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, html);
}

/* ---------- data prep ---------- */
const sorted = listings.slice().sort((a, b) => (b.date_posted || 0) - (a.date_posted || 0));
const byCat = {};
for (const c of CATS) byCat[c.slug] = sorted.filter(l => c.re.test(l.title));

const byCompany = {};
for (const l of sorted) {
  const s = slugify(l.company_name);
  (byCompany[s] = byCompany[s] || { name: l.company_name, roles: [] }).roles.push(l);
}

let seen = {};
try { seen = JSON.parse(fs.readFileSync('data/companies_seen.json', 'utf8')); } catch (e) {}
for (const [s, c] of Object.entries(byCompany)) seen[s] = { name: c.name, lastSeen: TODAY, roles: c.roles.length };
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/companies_seen.json', JSON.stringify(seen, null, 1));

const N = sorted.length;
const NC = Object.keys(byCompany).length;

/* ---------- hub ---------- */
{
  const c = crumbs([{ name: 'Home', href: '/' }, { name: 'Internships', href: '/internships/' }]);
  const catCards = CATS.map(cat => `<a class="card" href="/internships/${cat.slug}/"><h3>${esc(cat.name)}</h3><span class="cnt">${byCat[cat.slug].length} live roles</span></a>`).join('');
  const body = `${c.html}
<h1>Live Summer 2027 internships, updated every 6 hours</h1>
<p class="sub">${N} open internship roles across ${NC} companies, pulled from public job boards and deduped. Every listing links to the real application.</p>
<span class="pill"><span class="dot"></span>${N} live listings · refreshed every 6h</span>
<h2>Browse by category</h2>
<div class="grid">${catCards}</div>
<h2>Newest listings</h2>
${sorted.slice(0, 20).map(row).join('')}
<p style="margin-top:18px"><a href="/internships/companies/">Browse all ${NC} companies →</a></p>
${CTA}`;
  const ld = { '@context': 'https://schema.org', '@graph': [c.ld, { '@type': 'ItemList', name: 'Summer 2027 internship categories', itemListElement: CATS.map((cat, i) => ({ '@type': 'ListItem', position: i + 1, name: cat.name + ' Internships', url: `${SITE}/internships/${cat.slug}/` })) }] };
  write('internships/index.html', page(`Summer 2027 Internships: ${N} Live Openings | OfferAIO`, `Browse ${N} live Summer 2027 internship openings across ${NC} companies. Refreshed every 6 hours. SWE, quant, IB, consulting, product, and data roles.`, '/internships/', body, ld));
}

/* ---------- categories ---------- */
for (const cat of CATS) {
  const roles = byCat[cat.slug];
  const c = crumbs([{ name: 'Home', href: '/' }, { name: 'Internships', href: '/internships/' }, { name: cat.name, href: `/internships/${cat.slug}/` }]);
  const list = roles.length
    ? roles.map(row).join('')
    : `<div class="closed"><b>No live ${esc(cat.name.toLowerCase())} roles at this refresh.</b><p style="margin-top:8px">Postings ramp through fall 2026. Check the <a href="/internships/">full live board</a> or set a task in the <a href="/dashboard/">dashboard</a> to catch the next one.</p></div>`;
  const others = CATS.filter(x => x.slug !== cat.slug).map(x => `<a href="/internships/${x.slug}/">${esc(x.name)}</a>`).join(' · ');
  const body = `${c.html}
<h1>${esc(cat.name)} internships for Summer 2027</h1>
<p class="sub">${roles.length} live ${esc(cat.name.toLowerCase())} internship openings, refreshed every 6 hours from public company job boards.</p>
<span class="pill"><span class="dot"></span>${roles.length} live roles</span>
<h2>Open roles</h2>
${list}
<p style="margin-top:24px">Other categories: ${others}</p>
${CTA}`;
  write(`internships/${cat.slug}/index.html`, page(`${cat.name} Internships Summer 2027 (${roles.length} Open) | OfferAIO`, `${roles.length} live ${cat.name.toLowerCase()} internships for Summer 2027, refreshed every 6 hours. Direct application links plus one-click auto apply.`, `/internships/${cat.slug}/`, body, { '@context': 'https://schema.org', '@graph': [c.ld] }));
}

/* ---------- companies index ---------- */
{
  const all = Object.entries(seen).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const c = crumbs([{ name: 'Home', href: '/' }, { name: 'Internships', href: '/internships/' }, { name: 'Companies', href: '/internships/companies/' }]);
  const az = all.map(([s, v]) => {
    const live = byCompany[s] ? byCompany[s].roles.length : 0;
    return `<a href="/internships/companies/${s}/">${esc(v.name)} <span style="color:var(--dim);font:11px var(--mono)">(${live ? live + ' live' : 'closed'})</span></a>`;
  }).join('');
  const body = `${c.html}
<h1>Companies hiring Summer 2027 interns</h1>
<p class="sub">${NC} companies with live internship listings right now, out of ${all.length} tracked this season.</p>
<div class="az">${az}</div>
${CTA}`;
  write('internships/companies/index.html', page(`Companies Hiring Summer 2027 Interns (${NC} Live) | OfferAIO`, `Directory of ${all.length} companies with Summer 2027 internship programs. ${NC} hiring right now. Updated every 6 hours.`, '/internships/companies/', body, { '@context': 'https://schema.org', '@graph': [c.ld] }));
}

/* ---------- company pages ---------- */
for (const [s, v] of Object.entries(seen)) {
  const live = byCompany[s] ? byCompany[s].roles : [];
  const c = crumbs([{ name: 'Home', href: '/' }, { name: 'Internships', href: '/internships/' }, { name: 'Companies', href: '/internships/companies/' }, { name: v.name, href: `/internships/companies/${s}/` }]);
  const jobsLd = live.slice(0, 25).map(l => ({
    '@type': 'JobPosting',
    title: l.title,
    datePosted: dstr(l.date_posted),
    employmentType: 'INTERN',
    hiringOrganization: { '@type': 'Organization', name: l.company_name },
    jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: (l.locations && l.locations[0]) || 'United States', addressCountry: 'US' } },
    description: `<p>${esc(l.title)} at ${esc(l.company_name)} for Summer 2027. Apply directly on the company job board.</p>`,
    url: l.url,
  }));
  const list = live.length
    ? live.map(row).join('')
    : `<div class="closed"><b>${esc(v.name)} has no live Summer 2027 internship listings at this refresh.</b><p style="margin-top:8px">Their roles from this season closed or filled. Set a task in the <a href="/dashboard/">dashboard</a> and OfferAIO will apply the moment a new one opens, or browse <a href="/internships/">all live internships</a>.</p></div>`;
  const body = `${c.html}
<h1>${esc(v.name)} internships for Summer 2027</h1>
<p class="sub">${live.length ? `${live.length} live internship ${live.length === 1 ? 'role' : 'roles'} at ${esc(v.name)}, with direct application links.` : `Tracking ${esc(v.name)} Summer 2027 internship openings.`} Refreshed every 6 hours.</p>
<span class="pill"><span class="dot"${live.length ? '' : ' style="background:var(--dim)"'}></span>${live.length ? live.length + ' live roles' : 'no live roles · last seen ' + v.lastSeen}</span>
<h2>${live.length ? 'Open roles' : 'Status'}</h2>
${list}
${CTA}`;
  const ld = { '@context': 'https://schema.org', '@graph': [c.ld, ...jobsLd] };
  write(`internships/companies/${s}/index.html`, page(`${v.name} Internships Summer 2027 ${live.length ? `(${live.length} Open)` : '(Status)'} | OfferAIO`.slice(0, 70), `${v.name} Summer 2027 internships: ${live.length ? live.length + ' live openings with direct application links.' : 'no live openings right now, tracked for new postings.'} Updated every 6 hours.`, `/internships/companies/${s}/`, body, ld));
}

/* ---------- sitemap ---------- */
{
  const stat = ['/', '/pricing/', '/employers/', '/employers/apply/'];
  const urls = [
    ...stat.map(u => ({ u, f: 'weekly', p: u === '/' ? '1.0' : '0.8' })),
    { u: '/internships/', f: 'hourly', p: '0.9' },
    ...CATS.map(c => ({ u: `/internships/${c.slug}/`, f: 'hourly', p: '0.8' })),
    { u: '/internships/companies/', f: 'daily', p: '0.7' },
    ...Object.keys(seen).map(s => ({ u: `/internships/companies/${s}/`, f: 'daily', p: '0.6' })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(x => `  <url><loc>${SITE}${x.u}</loc><lastmod>${TODAY}</lastmod><changefreq>${x.f}</changefreq><priority>${x.p}</priority></url>`).join('\n') +
    `\n</urlset>\n`;
  fs.writeFileSync('sitemap.xml', xml);
}

console.log(`generated: hub + ${CATS.length} categories + companies index + ${Object.keys(seen).length} company pages + sitemap (${N} listings, ${NC} live companies)`);
