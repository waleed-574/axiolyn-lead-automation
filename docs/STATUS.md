# Project Status — resume here

**Last updated:** 2026-09-12, end of session
**Current phase:** Phase 0 complete. Phase 1 blocked on a manual Google Cloud step.

---

## ⏭️ NEXT ACTION — Google Cloud setup

This is the only thing blocking progress. It takes about 7 minutes and must be
done by Waleed, using the **personal Google account** that will own the lead sheet.

### A. Service account (~5 min)

1. https://console.cloud.google.com — sign in with the personal Google account
2. Top bar dropdown → **New Project** → name `axiolyn-leads` → Create
3. With that project selected: **APIs & Services → Library**
4. Search **Google Sheets API** → **Enable**
5. **APIs & Services → Credentials**
6. **+ Create Credentials → Service account**
   - Name: `n8n-leads`
   - Skip the optional role/access steps → **Done**
7. Click the new service account → **Keys** tab → **Add Key → Create new key → JSON** → Create
8. Move the downloaded `.json` into `credentials/` in this repo

Do not paste the JSON contents into chat — it holds a private key. `credentials/`
is gitignored; Claude reads it from disk.

### B. The sheet (~2 min)

9. Open the JSON, copy the `client_email` value
   (looks like `n8n-leads@axiolyn-leads.iam.gserviceaccount.com`)
10. https://sheets.new — name it **Axiolyn Leads**
11. **Share** → paste the service account email → **Editor** → untick "Notify people" → Share
12. Copy the sheet URL and give it to Claude

The sheet is created by Waleed rather than by the service account on purpose: a
service account that creates a spreadsheet owns it in its own Drive, where it
would be invisible in Waleed's Drive.

### C. Then Claude does the rest

1. Read `client_email` + `private_key` from the JSON, create the `googleApi`
   credential in n8n over MCP
2. Build a setup workflow that creates all 7 tabs with the exact headers from
   the spec, so the schema provably matches rather than being hand-typed
3. Run it, verify tabs and headers
4. Write a test row — **Phase 1 exit criteria met**

Then straight into **Phase 2**, the milestone that matters: 20 real Pakistani
companies in the sheet from OSM Overpass, and a re-run that appends zero
duplicates.

---

## Before doing anything else in a new session

**Start n8n first.** Nothing works without it:

```powershell
cd "C:\Users\Muhammad Waleed\Desktop\Axiolyn Lead Automation"
powershell -ExecutionPolicy Bypass -File .\scripts\start-n8n.ps1
```

Leave that window open. Then verify with `n8n_health_check` — expect `status: ok`.

---

## ✅ Phase 0 — done

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
