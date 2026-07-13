#!/usr/bin/env python3
"""
OfferAIO — Phase 3: broad-net scraping via JobSpy (LinkedIn, Indeed, Glassdoor, ZipRecruiter).

Covers what ATS APIs miss: business/finance/marketing internships posted only to job
boards, plus smaller companies. Output goes to data/listings-extra.json in the same
Simplify-compatible schema; scrape.js merges + dedupes it.

Install: pip install python-jobspy pandas
Run:     python jobspy_scrape.py
Note:    LinkedIn rate-limits aggressively — keep results_wanted modest per query and
         let the 6h cron accumulate coverage over time. `continue-on-error` in the
         workflow means a bad day here never blocks Phases 1-2.
"""
import json
import re
import time
from pathlib import Path

from jobspy import scrape_jobs

QUERIES = [
    # tech
    "software engineering intern summer 2027",
    "data science intern summer 2027",
    "machine learning intern 2027",
    "product management intern 2027",
    # business / finance
    "investment banking summer analyst 2027",
    "private equity intern 2027",
    "consulting intern summer 2027",
    "accounting intern summer 2027",
    "real estate analyst intern 2027",
    "venture capital intern 2027",
    "marketing intern summer 2027",
]

SITES = ["indeed", "linkedin"]  # add "glassdoor", "zip_recruiter" once stable
WRONG_YEAR = re.compile(r"\b(2024|2025|2026)\b")
INTERN = re.compile(r"\bintern(ship)?\b|\bsummer analyst\b", re.I)

rows = []
for q in QUERIES:
    for site in SITES:
        try:
            df = scrape_jobs(
                site_name=site,
                search_term=q,
                location="United States",
                results_wanted=40,
                hours_old=24 * 7,   # only postings from the last week — cron keeps it fresh
                country_indeed="USA",
            )
            rows.append(df)
            print(f"{site}: {len(df)} rows for '{q}'")
        except Exception as e:  # noqa: BLE001 — never let one query kill the run
            print(f"{site} failed for '{q}': {e}")
        time.sleep(4)  # pacing between queries

out = []
seen = set()
for df in rows:
    for _, r in df.iterrows():
        title = str(r.get("title") or "")
        url = str(r.get("job_url") or "")
        company = str(r.get("company") or "")
        if not (title and url and company):
            continue
        if not INTERN.search(title) or WRONG_YEAR.search(title):
            continue
        key = url.split("?")[0].lower()
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "company_name": company,
            "title": title,
            "url": url,
            "locations": [str(r.get("location") or "")],
            "active": True,
            "is_visible": True,
            "date_posted": int(time.time()),
            "terms": ["Summer 2027"],
            "source": f"jobspy-{r.get('site', 'board')}",
            "id": f"{company}::{title}".lower(),
        })

Path("data").mkdir(exist_ok=True)
Path("data/listings-extra.json").write_text(json.dumps(out, indent=1))
print(f"DONE: {len(out)} phase-3 listings -> data/listings-extra.json")
