# Project Status — resume here

**Last updated:** 2026-09-14
**Current phase:** Phases 0 and 1 complete. Phase 2 is next and needs nothing from Waleed.

---

## ⏭️ NEXT ACTION — Phase 2, the thin vertical slice

No manual setup left. Phase 2 builds WF1's first source end to end:

1. OSM Overpass query for one vertical in one city (clinics in Lahore)
2. Normalise results to the  schema
3. Split web-bearing from no-website businesses
4. Deduplicate on  against what is already in the sheet
5. Batch-append to  and 
**Exit criteria:** 20 real Pakistani companies in the sheet, and a second run
that appends exactly zero rows.

Overpass is first because it is keyless, free, and returns name, website, phone
and address already structured — no scraping and no parsing fragility to debug
while the rest of the pipeline is still unproven.

## Before doing anything else in a new session

**Start n8n first.** Nothing works without it:

```powershell
cd "C:\Users\Muhammad Waleed\Desktop\Axiolyn Lead Automation"
powershell -ExecutionPolicy Bypass -File .\scripts\start-n8n.ps1
```

Leave that window open. Then verify with `n8n_health_check` — expect `status: ok`.

---

## ✅ Phases 0 and 1 — done

| Item | State |
|---|---|
| n8n | 2.35.7, global npm, `http://127.0.0.1:5678` |
| n8n account | Recreated (old password was lost; no SMTP, so CLI reset was the only route) |
| API key | Created and verified — 200 with key, 401 without |
| n8n-mcp 2.84.4 | Installed globally, connected, `status: ok` |
| Instance contents | 0 workflows, 0 credentials — clean slate |
| Git repo | Initialised, spec + setup docs + launcher committed |

Three problems solved along the way, all written up in `docs/SETUP.md`:
`npx` first-run timeout, the `WEBHOOK_SECURITY_MODE` localhost block, and the
no-SMTP password recovery path.

---

## Decisions locked so far

| Decision | Choice |
|---|---|
| Target market | Pakistan first; international is a Phase 3 lane, not excluded |
| Industries | All 8 from the brief, including real estate and education |
| No-website businesses | Separate `Leads_NoWeb` track, phone-first |
| Google auth | Service Account (never expires) rather than OAuth2 |
| Filtering | 0–100 score, not binary keep/drop |
| Architecture | Four workflows joined by Sheet tabs as queues |
| **Scope** | **Leads into the sheet only. All outreach is manual — no sending, drafting, or templates.** |
| Throughput target | ~50 qualified leads/week |

Full reasoning in `docs/superpowers/specs/2026-09-12-axiolyn-lead-automation-design.md`.

---

## Open items for later

- **Ollama (Phase 6)** — check available RAM. 8 GB+ free means a local model; otherwise Gemini Flash free tier.
- **Hosting (Phase 9)** — a Schedule Trigger only fires while the laptop is awake. Oracle Cloud Always Free is the recommended target.
- **API key hygiene** — the n8n API key was pasted into the session transcript. Fine for local dev, but revoke and reissue before sharing or exporting that transcript.

---

## ✅ Phase 1 — done (2026-09-14)

| Item | State |
|---|---|
| Google Cloud project | `n8n-resumed` (an existing project — the account had hit its project-creation limit) |
| Service account | `n8n-leads@n8n-resumed.iam.gserviceaccount.com` |
| Sheets API | Enabled, verified by minting a token and calling the API directly |
| Key file | `credentials/n8n-resumed-93ee2bf3f267.json` (gitignored) |
| n8n credential | `Axiolyn Google Sheets (Service Account)`, id `mx8TrhfzPvlkUeIJ` |
| Spreadsheet | "Axiolyn Leads", shared with the service account as Editor |
| Tabs | All 7 created with spec headers, frozen and bolded; verified column-by-column |
| End-to-end write | n8n appended a row to `_runlog`, confirmed by reading the sheet back independently |

Timestamps came back as `+05:00`, confirming `GENERIC_TIMEZONE=Asia/Karachi`
is applying — scheduled runs will fire at Pakistan time rather than UTC.

The sheet is reproducible: `node scripts/setup-sheet.js <key.json> <spreadsheetId>`
recreates every tab and header, and is safe to re-run (it never touches data rows).

Identifiers live in `config.json`; secrets stay in `credentials/`.
