# Local test harness

`mock-application.html` is a fake Greenhouse-style application form. It exists so the
extension can be tested end to end — fill, submit, quota, and the dashboard's application
table — **without sending anything to a real employer.**

## ⚠️ This requires a temporary change to the extension, which must be reverted

`extension/manifest.json` and `extension/ats.js` have been given local-only entries so the
extension will run on `127.0.0.1` and `localhost`. **Do not ship these.** One command undoes
both:

```
git checkout extension/
```

Run it before merging or packaging. `zip-extension.yml` ships `extension/` wholesale to the
Chrome Web Store, and a listing that requests `http://localhost/*` invites a rejection and a
"why does this need my local network?" question you don't want to answer.

## Why two hostnames

Chrome match patterns can't distinguish ports, but `127.0.0.1` and `localhost` are different
hosts. So:

| URL | What runs | What you're testing |
| --- | --- | --- |
| `http://127.0.0.1:8899/dev/mock-application.html` | `content.js` (fill + tracker) | the extension |
| `http://localhost:8899/OfferAIO.html` | `bridge.js` (site relay) | the dashboard |

Using the wrong hostname is the most likely reason something "doesn't work" — the fill bar
won't appear on `localhost`, and the dashboard won't connect on `127.0.0.1`.

## Setup

```
cd C:\Users\Tobyb\OfferAIO
python -m http.server 8899
```

Then in `chrome://extensions`: Developer mode on → **Load unpacked** →
`C:\Users\Tobyb\OfferAIO\extension`. It must read **1.2.0**.

After any change to `extension/`, press the **↻ reload** arrow on the extension card.
Manifest changes are not picked up without it.

## What to check

### 1. The popup only offers what it can do

| Where | Expected |
| --- | --- |
| a blank new tab | **greyed out** — "Open a job application, then click here." |
| `localhost:8899/OfferAIO.html` | **greyed out** — same |
| the mock form on `127.0.0.1` | **enabled** — "Mock ATS (dev) · Northwind Systems — Software Engineering Intern…" |

### 2. Fill, and what it refuses to fill

Save a profile in the popup first (name and email at minimum), then hit Fill on the mock
form. Expected:

- name, email, phone, school and LinkedIn filled
- the résumé box outlined **blue** and scrolled to — scripts cannot attach files
- **"Are you authorized to work without sponsorship?" left empty and outlined amber**, and
  named in the bar. This is the one that matters most: it contains both "without" and
  "sponsor", and answering it wrongly makes an international student assert the opposite of
  the truth on a legal declaration.
- the two questions in the dense block (no `for=`) **both left empty** — the extension
  should decline to guess rather than write one answer into the other's box
- the popup reports `Filled N of M fields · K need you` and **stays open**

### 3. The submit outcomes

Pick a mode at the top of the mock form, then submit from the page's own button or the
extension's bar.

| Mode | Expected |
| --- | --- |
| Show a confirmation message | recorded, quota **+1** |
| Replace the form | recorded, quota **+1** |
| Navigate | recorded, quota **+1** |
| **Reject it** | **nothing recorded, quota unchanged**, bar explains why |
| **Do nothing** | recorded as **unconfirmed**, **quota unchanged** |

Leave "Why do you want to work at Northwind?" empty and try to submit: the extension should
refuse *before* clicking and count nothing. That is the bug that used to burn a submission on
an application the employer never saw.

### 4. Reading the stored records

Right-click the extension icon → **Inspect popup** → Console:

```js
chrome.storage.local.get(['applications', 'usage'], console.log)
```

`applications` is what the dashboard renders. `usage.count` is the quota — check it moves
only on the three success modes.

### 5. The dashboard

Open `http://localhost:8899/OfferAIO.html`.

- Before the extension connects: a single **connect card**, no stats, no demo data.
- Once connected: your real name, your real plan and usage (`Free · N of 50 this month`).
- Your mock submissions appear under **Applications** with the company, the ATS, the time and
  an honest `filled N of M`. The unconfirmed one is labelled as such.
- **Refresh the page** — everything should still be there, and the KPI row and the 14-day
  chart should match the number of records exactly.

## When you're done

```
git checkout extension/
rm -r dev
```

The `dev/` folder is untracked, so it will not reach the PR or the live site either way.
