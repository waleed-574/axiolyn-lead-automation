# Project Status — resume here

**Last updated:** 2026-09-14, end of session
**Current phase:** Phases 0, 1 and 2 complete. Phase 3 in progress.

---

## ⏭️ NEXT ACTION — wire the cursor into WF1

Everything needed is already written and tested. The remaining work is plumbing,
and needs nothing from Waleed beyond starting n8n.

`workflows/src/targets.js` defines the full sweep — 9 cities x 14 category
groups = **126 combinations** covering every commercial OSM tag. It is written
and unit-checked, but **WF1 does not use it yet**: the Config node still holds
the hardcoded Lahore-healthcare query from Phase 2.

To finish:

1. Add a `Read _state` node (Sheets read, `executeOnce`) before Config
2. Config reads `wf1_cursor`, calls `atCursor(n)`, emits that combination's query
3. After the appends, write `wf1_cursor = nextCursor` back to `_state`
   (Sheets appendOrUpdate, matching on the `key` column)
4. Change the schedule from daily 5am to **hourly**

Hourly matters: at one combination per run, a daily schedule needs 126 days for
a full sweep. Hourly completes it in about five days, keeps each query small
enough that Overpass answers, stays polite at 24 queries a day, and gives more
chances to run while the laptop happens to be awake.

### Then verify

- Run twice; the second run must use the *next* combination, not repeat the first
- Confirm `_state` holds the advanced cursor
- Confirm new cities and categories produce rows in both tabs

---

## Before doing anything else in a new session

**Start n8n first.** Nothing works without it:

```powershell
cd "C:\Users\Muhammad Waleed\Desktop\Axiolyn Lead Automation"
powershell -ExecutionPolicy Bypass -File .\scripts\start-n8n.ps1
```

Leave that window open. Then verify with `n8n_health_check` — expect
`status: ok` and `officialMcp.reachable: true`.

**No workflow is active.** Nothing runs on a schedule yet, so the machine can be
shut down freely. Activation is deliberately deferred until the cursor works and
the hosting question (Phase 9) is settled — a Schedule Trigger only fires while
the machine is awake.

---

## ✅ Phase 2 — done (2026-09-14)

| Exit criterion | Target | Result |
|---|---|---|
| Real Pakistani companies in the sheet | 20 | **40** |
| Re-run appends duplicates | 0 | **0**, proven with fixed input |

40 real Lahore businesses: 14 with websites in `Leads`, 26 phone-first in
`Leads_NoWeb`. Every `lead_id` unique, every phone valid E.164.

### Four bugs found by running against real data

| Bug | Consequence | Fix |
|---|---|---|
| Sheets read nodes ran once **per input item** | 39 candidates became 546 then 13,650 items — hundreds of API calls, certain rate-limit failure at scale | `executeOnce: true` |
| `alwaysOutputData` on the dedup node | Emitted a placeholder `{}` when nothing was new, which reached the appenders as a blank row | Removed it; zero items now stops the branch |
| `cellFormat: USER_ENTERED` (the default) | Sheets parsed `+923001234567` as arithmetic and stored `923001234567`, destroying the `+` | `cellFormat: 'RAW'`; `scripts/repair-phones.js` fixed the 33 existing rows |
| `overpass.osm.ch` in the mirror list | Switzerland-only instance: answers Pakistani queries with HTTP 200 and **zero elements** in ~1s. The run would look successful, append nothing, log nothing | Mirror dropped; added a `Got Data?` branch that logs any empty success from any mirror |

That last one is the dangerous class of bug — a silent zero is indistinguishable
from "no new businesses today", and would have gone unnoticed indefinitely.

### Verified working

- **Mirror failover in production** — on one run `Overpass 1` failed and
  `Overpass 2` completed the run
- **Idempotency**, proven properly: running the workflow twice could not prove it
  (different mirrors returned 39 vs 40 businesses), so
  `scripts/test-idempotency.js` holds the input fixed and checks against live
  sheet state instead

---

## What Overpass actually delivers

Measured, not assumed. The spec originally called it the primary source on the
assumption it returns structured contact data. It does not.

| Measure | Value |
|---|---|
| Elements returned for Lahore healthcare | 393 |
| With a name | 378 |
| **With a phone** | **31 (8%)** |
| **With a website** | **12 (3%)** |
| Usable after filtering | 37–40 |
| Response time | 60–200s, when it responds at all |
| Success rate during testing | roughly 1 in 3 |

**Implication:** Overpass is a supporting source feeding the phone-first track.
It will not supply the web track that Phases 4–6 depend on — contact-page
crawling, tech fingerprinting and CRM-absence scoring all need companies with
websites, and an entire city's healthcare sector yielded 14.

Queries now filter server-side for entries that already carry a phone or
website, which cuts the wasted 90% out of the payload.

**Still needed: a source that finds websites at volume.** SearXNG self-hosted is
the leading candidate. Of the Pakistani directories tried, `businesslist.pk`
404'd, `yellowpages.com.pk` and `findpk.com` failed to connect, and `pakbiz.com`
returned an index page with no contact data. Real research needed, not guesswork.

---

## ✅ Phases 0 and 1 — done

| Item | State |
|---|---|
| n8n | 2.35.7, global npm, `http://127.0.0.1:5678` |
| n8n-mcp 2.84.4 | Connected; instance-level MCP reachable, 34 tools |
| Google service account | `<service-account>@<project>.iam.gserviceaccount.com`, project `<your-gcp-project>` |
| n8n credential | `Axiolyn Google Sheets (Service Account)`, id `<credential-id>` |
| Spreadsheet | "Axiolyn Leads", 7 tabs, headers verified column-by-column |
| WF1 | id `<workflow-id>`, 18 nodes, inactive |

Setup gotchas are in `docs/SETUP.md` — the `WEBHOOK_SECURITY_MODE` localhost
block, the encryption-key hazard, the npx timeout, the no-SMTP recovery path,
and the instance-MCP API-key tab.

---

## Decisions locked

| Decision | Choice |
|---|---|
| Target market | Pakistan first; international is a Phase 3 lane, not excluded |
| **Category coverage** | **Every business category.** The eight verticals raise a score; they never filter a candidate out |
| No-website businesses | Separate `Leads_NoWeb` track, phone-first |
| Google auth | Service Account (never expires) |
| Filtering | 0–100 score, not binary keep/drop |
| Architecture | Four workflows joined by Sheet tabs as queues |
| Scope | Leads into the sheet only. All contact is manual |
| Throughput target | ~50 qualified leads/week |

Full reasoning in `docs/superpowers/specs/2026-09-12-axiolyn-lead-automation-design.md`.

---

## Repo map

| Path | Purpose |
|---|---|
| `workflows/src/normalize-overpass.js` | Single source of truth for the transform; shared by the tests and the n8n Code node |
| `workflows/src/targets.js` | The 126-combination sweep — cities, categories, query builder, cursor |
| `scripts/build-wf1.js` | Generates the workflow JSON from those sources |
| `scripts/test-normalize.js` | 31 checks against the captured fixture, offline |
| `scripts/test-idempotency.js` | Proves dedup against live sheet state |
| `scripts/setup-sheet.js` | Recreates all 7 tabs and headers; safe to re-run |
| `scripts/repair-phones.js` | Restores `+` prefixes lost to USER_ENTERED |
| `fixtures/overpass-lahore-healthcare.json` | Real 103KB Overpass response, so the transform can be tested without the network |

---

## Open items

- **Ollama (Phase 6)** — check free RAM. 8 GB+ means a local model; otherwise Gemini Flash free tier.
- **Hosting (Phase 9)** — a Schedule Trigger only fires while the machine is awake, which is why nothing is activated yet. Oracle Cloud Always Free is the recommended target.
- **Secret hygiene** — the n8n API key, the instance-MCP token and the service account key all exist locally. Fine for local dev; rotate before sharing any transcript.
