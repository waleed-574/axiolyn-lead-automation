# Project Status — resume here

**Last updated:** 2026-09-23
**State:** Pakistan pipeline finished and running unattended. US/UK expansion in progress.

---

## ⏭️ NEXT ACTION — Waleed creates the US/UK spreadsheet

Everything else for the expansion is written, tested and pushed. This is the
only blocker, and it needs a human because a service account outside a Workspace
domain has no Drive storage quota — it returns `403 PERMISSION_DENIED` on
creating a file, though it can read and write files shared with it.

1. https://sheets.new → name it **Axiolyn Leads — US & UK**
2. **Share** → `<service-account>@<project>.iam.gserviceaccount.com` → **Editor**, untick "Notify people"
3. Give Claude the URL

Then Claude runs:

```bash
node scripts/setup-intl-sheet.js credentials/<key>.json waleednadeem789@gmail.com <spreadsheet-id>
```

…which builds the four tabs (`Leads_US`, `Leads_UK`, `_state`, `_runlog`) with
headers, freezing and formatting.

### Then, to finish the expansion

1. **`scripts/run-intl-pipeline.js`** — a separate runner, modelled on
   `scripts/run-pipeline.js`, but using `targets-intl.js` + `normalize-intl.js`,
   writing to `Leads_US` / `Leads_UK` by the lead's `country`, with its own
   cursor key in the new sheet's `_state`.
   Take **2–3 sweep combinations per run**: 544 combinations at one per hour is
   23 days for a full pass.
2. **`.github/workflows/leads-intl.yml`** — its own schedule and its own
   `SHEET_ID_INTL` secret, so it never touches the Pakistan sheet.
3. **Scoring** — `score-leads.js` currently hardcodes Pakistani tier-1 cities
   and `.edu.pk`/`.gov.pk` domain rules. Either generalise per country or add an
   intl variant. `.gov`/`.edu` already match generically; the city list does not.
4. Live run, then verify real New York and London leads land in the right tabs.

---

## Decisions locked for the expansion

| Decision | Choice |
|---|---|
| Sheet | **A separate spreadsheet**, not mixed with Pakistan |
| Layout | **Two tabs — `Leads_US` and `Leads_UK`**, each one list per country, web and phone-only together (simpler than the PK web/no-web split) |
| Workflow | **Separate** GitHub Actions workflow and schedule |
| Cost | Free only — same OSM + own-website + DNS + Sheets stack |

---

## Already built and tested for the expansion

| File | What it does |
|---|---|
| `workflows/src/phone.js` | Country-aware E.164 for PK/GB/US. 30 tests. |
| `workflows/src/targets-intl.js` | 544 combinations: 12 US + 11 UK cities, **tiled**, × 16 category groups |
| `workflows/src/normalize-intl.js` | Overpass → US/UK rows; drops chains and public bodies. 30 tests. |
| `scripts/setup-intl-sheet.js` | Builds the tabs; takes an existing sheet id as argv[4] |
| `scripts/test-phone.js`, `scripts/test-normalize-intl.js` | Offline, in `npm test` |

### Two findings that shaped the design

**Dense markets need tiling.** Measured on `office_prof` over the City of
London: a ~4.5 km box returns 504 from every mirror; ~2.2 km returns 26
businesses; ~1.1 km returns 6. So cities get several ~2 km tiles over their real
business districts rather than one box covering mostly housing. New York by
contrast answered a larger box in 4 seconds with 110 businesses.

**Overpass flakiness is load, not query shape.** The identical London box
succeeded, then 504'd ten minutes later, then succeeded on a different mirror at
103 s. Mirror failover already handles it; failures cost one combination and the
cursor moves on.

---

## ✅ Pakistan pipeline — done and running

Live at https://github.com/waleed-574/axiolyn-lead-automation, on GitHub Actions
**hourly**, no laptop involved.

As of 2026-09-23: **3,755 leads** — 795 with websites, 2,960 phone-only, 328
MX-verified emails, 2,809 WhatsApp-reachable, zero crawl backlog. Sweep at
cursor 50 of 126. Karachi 3,041 · Lahore 381 · Islamabad 271 · Rawalpindi 62.

Top leads score 86 and carry both a verified email and a WhatsApp number —
SOFTBEATS, Bit Links Tech, Dev Entities, Adviry Digital, EB Logistics.

`npm run stats` prints a full snapshot at any time.

### Sources — all of them

Every one of the 3,755 leads came from **OpenStreetMap via the Overpass API**
(three mirrors). Emails come from crawling **the companies' own websites**.
Verification is a **DNS MX lookup**. Storage is **Google Sheets**. Scheduling is
**GitHub Actions**. Nothing else — no LinkedIn, Apollo, Hunter or ZoomInfo.

The original spec listed five further discovery sources (SearXNG, Google CSE, PK
directories, job boards, News RSS). **None were built** — Overpass turned out to
carry it alone once the query shape was fixed.

---

## Before doing anything in a new session

n8n is **optional now**. The pipeline runs on GitHub Actions; n8n is only for
visually editing or debugging workflows. To start it:

```powershell
cd "C:\Users\Muhammad Waleed\Desktop\Axiolyn Lead Automation"
powershell -ExecutionPolicy Bypass -File .\scripts\start-n8n.ps1
```

---

## Open items

- **Tune scoring against real call outcomes.** The current weights were tuned against data defects, not results. Once Waleed has called 10–20 leads, ask which converted and reweight — re-scoring takes seconds and never re-crawls.
- **GitHub disables scheduled workflows after 60 days of repo inactivity.** Any commit resets it.
- **Secrets** live in `credentials/` (gitignored) and as GitHub repository secrets `GOOGLE_SERVICE_ACCOUNT_JSON` and `SHEET_ID`. The expansion needs a third: `SHEET_ID_INTL`.
