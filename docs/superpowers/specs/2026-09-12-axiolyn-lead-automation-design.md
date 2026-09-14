# Axiolyn Lead-Hunting Automation — Design Spec

**Date:** 2026-09-12
**Status:** Approved for planning
**Supersedes:** `Axiolyn_Lead_Automation_Brief.pdf` (original 3-page brief)

---

## 1. Purpose

Axiolyn sells three service lines — Business Management, Software Solutions, and AI Automation. Client acquisition is currently manual. This project replaces manual prospecting with a scheduled pipeline that discovers Pakistani businesses matching Axiolyn's ideal customer profile, enriches them with public contact information, scores them by fit, and writes only new leads to a Google Sheet the team works from.

Success means: the team opens a sheet each morning, sorted best-first, and spends its time calling rather than searching.

### Scope boundary

This project ends when a scored, deduplicated lead lands in the Google Sheet. Contacting prospects is done by the team, manually, outside this system. No outreach is automated, drafted, or sent.

## 2. Constraints

These are fixed and non-negotiable.

| Constraint | Detail |
|---|---|
| Self-hosted n8n | Local instance (n8n 2.35.7 via global npm). No n8n Cloud subscription. |
| Zero budget | No paid APIs, no paid tiers, no subscriptions. Free tiers and open tools only. |
| Google Sheets storage | Team-facing lead database, via a personal Google account. |
| Idempotent | Re-running any workflow must never create a duplicate row. |
| Resumable | A failed or interrupted run resumes without losing or re-processing work. |

## 3. Decisions Made

| Decision | Choice | Rationale |
|---|---|---|
| Target market | Pakistan first, international from Phase 3 | Pakistan proves the machine fastest: strong OpenStreetMap coverage, businesses reachable by phone, easy verification. International is a **priority second lane, not an exclusion** — it carries the larger deal sizes and is built into WF1 as soon as the pipeline works end to end. |
| No-website businesses | Separate track (`Leads_NoWeb`) | "No website in 2026" is a strong buy signal, not a disqualifier — but these leads need different scoring and a different pitch, so they get their own tab. |
| Google auth | Service Account, not OAuth2 | OAuth apps left in "Testing" publishing status expire their refresh token every 7 days. A service account with the sheet shared to its address never expires. |
| Filtering model | 0–100 score, not binary keep/drop | Turns the sheet from a list into a priority queue. The team calls the best 10, not the newest 10. |
| Category coverage | Every business category | Discovery sweeps all commercial OSM tags and, later, all directory categories. The eight priority verticals raise a score; they never exclude a candidate. |
| Workflow structure | Four workflows, not one chain | Independently testable and debuggable. Re-running enrichment costs zero search quota. |
| Primary contact channel | Phone / WhatsApp, email secondary | Pakistani SMBs respond to WhatsApp far more reliably than to cold email. This shapes which fields the pipeline works hardest to find, not any sending behaviour — the team contacts prospects manually. |
| Throughput target | ~50 new qualified leads/week | Matches realistic follow-up capacity for a small team. Sets rate limits and query volume. |
| AI provider | Ollama local, Gemini Flash free tier as fallback | Zero cost, no rate limit, fully private. Fallback if hardware is insufficient. |

## 4. Architecture

Four workflows connected by Google Sheet tabs acting as durable queues. Tabs as queues — rather than direct node-to-node connections — is what makes the pipeline resumable: each stage's output survives the next stage crashing.

```
WF1 Discovery  ──►  raw_candidates  ──►  WF2 Enrichment  ──►  enriched
                                                                  │
                            ┌─────────────────────────────────────┘
                            ▼
                       WF3 Score + Write
                            ├──►  Leads         (website present)
                            └──►  Leads_NoWeb   (phone-first)
                                      │
                                      ▼
                                WF4 Digest + run log
```

### WF1 — Discovery

Gathers candidate companies from multiple independent free sources, normalizes them to a common shape, and appends to `raw_candidates`.

| Source | Yields | Cost | Notes |
|---|---|---|---|
| OSM Overpass API | name, website, phone, address | Free, no key | Primary source. Query by `amenity`, `office`, `shop`, `healthcare` tags bounded to PK cities. |
| Self-hosted SearXNG | search results across Google/Bing/DDG/Brave | Free, no key | Removes the 100/day query cap. Runs as a second Docker container, JSON output enabled. |
| Google CSE JSON API | long-tail `site:.pk` results | 100 queries/day free | Quota tracked in `_state`. |
| PK directories | bulk SMB listings | Free, scraped | businesslist.pk, yellowpages.com.pk, pakbiz, findpk, Chamber of Commerce lists. |
| Job boards | hiring signals | Free | Rozee.pk, Mustakbil, BrightSpyre. Roles like *data entry operator*, *admin coordinator*, *inventory clerk* indicate manual process load. |
| Google News RSS | expansion / funding announcements | Free, no key | `news.google.com/rss/search?q=` — indicates budget and growth pain. |

Target cities: Lahore, Karachi, Islamabad/Rawalpindi, Faisalabad, Multan, Peshawar.

**Discovery targets every business category, without exception.** Queries sweep broadly — all `office:*`, `shop:*`, `craft:*`, commercial `amenity:*`, `healthcare:*`, `tourism:*` and `leisure:*` — rather than an enumerated allow-list. Any business running manual processes is a prospect, so a curated list would discard leads for no reason.

The eight verticals below are therefore a **scoring input, never a filter**: a match raises a lead's score, a non-match does not drop it.

Priority verticals: e-commerce and retail, healthcare and clinics, logistics and supply chain, real estate, professional services, agencies and consultancies, education and training, SaaS and tech startups.

Real estate and education/training earn their place: in Pakistan both run on WhatsApp and spreadsheets — property agencies on manual lead chasing, academies on manual admissions and fee collection.

**Explicitly excluded:** LinkedIn. Aggressive anti-scraping, terms-of-service violation, and account-ban risk outweigh any value.

#### International lane (added Phase 3)

Pakistan is the sequencing choice, not the scope. International sources run in the same WF1 as a second lane, tagged by `region`, scored by the same web-track model, and written to the same `Leads` tab. Larger deal sizes justify building this as soon as the pipeline is proven rather than "someday".

| Source | Region | Yields | Cost |
|---|---|---|---|
| Clutch, GoodFirms public listings | Global | Agencies and SMBs already shopping for digital transformation | Free, scraped |
| Google News RSS | Global | Funding rounds, expansions, new market entries | Free, no key |
| Job boards (We Work Remotely, Remote OK, HN "Who is hiring") | US / EU / Global | Companies hiring for roles automation reduces | Free, RSS |
| SearXNG / CSE with region operators | Targeted | `site:.ae`, `site:.co.uk`, city + industry combos | Free |
| OSM Overpass, other bounding boxes | UAE, Gulf, UK | Same tag queries, different geography | Free, no key |

Recommended priority order for international: **UAE and Gulf** first (same time zone, large Pakistani-run business community, high budgets), then **US**, then **UK and EU**. Because the team contacts every prospect manually, this ordering reflects deal quality and reachability rather than any sending-compliance constraint.

A `region` column records which contact channel suits each lead, so this stays a data attribute rather than separate workflows.

### WF2 — Enrichment

For each candidate with a website, fetch contact information. Ordered by precision, highest first:

1. Fetch `/contact`, `/contact-us`, `/about` before falling back to the homepage.
2. Parse `mailto:` and `tel:` links from the DOM. Near-total precision versus free-text regex.
3. Decode Cloudflare `data-cfemail` obfuscation (XOR with the first byte). Recovers addresses most scrapers miss entirely.
4. Free-text regex as last resort.
5. Junk filter: `example.com`, `sentry.io`, `wixpress`, `godaddy`, image filenames, `@2x.png`.
6. Rank role addresses: `info@` > `sales@` > `contact@` > `hello@` > personal.
7. Validate deliverability by MX record lookup (Node built-in `dns`). This is the free equivalent of a paid verification API.
8. Normalize phones to E.164 via `libphonenumber-js`. PK mobile `03xx-xxxxxxx` becomes `+923xx…`.

Requires on the n8n container: `NODE_FUNCTION_ALLOW_BUILTIN=dns,crypto,url` and `NODE_FUNCTION_ALLOW_EXTERNAL=libphonenumber-js,cheerio`. Only possible because the instance is self-hosted.

**Politeness policy.** Realistic User-Agent, randomized 2–5s delay between fetches, 10s timeout, capped concurrency, `robots.txt` respected, local response cache so re-runs do not re-hammer the same sites. Every HTTP node set to continue-on-fail. Failed URLs are written to the `_state` dead-letter list for retry, never silently dropped.

### WF3 — Score and Write

Two scoring models, because the two lead types need different pitches.

**Web track (`Leads`), 0–100.** Signals derived from the company's own homepage HTML:

- Absence of CRM/automation tags (HubSpot, Salesforce, Intercom, Calendly, GA) — the strongest single buy signal
- Site staleness: copyright year, `Last-Modified` header, CMS version
- Intake maturity: contact form only versus a real booking flow
- Industry match against the target verticals
- Hiring signal, joined from the job-board source
- Contact reachability: was a verified email found

**No-web track (`Leads_NoWeb`), 0–100.** Category value against the target verticals, city tier, listing completeness (opening hours, full address, specific rather than generic category), mobile phone present, and corroboration — the same business appearing in more than one independent source.

Review counts are deliberately not used. The only free source for them would be Google Maps, which is a paid API and a scraping-risk surface; OSM does not carry them.

Writes are batched into a single append call per tab, never row-by-row.

### WF4 — Digest and Observability

Daily Telegram or Discord message: count of new leads, the top three by score, and any errors. Per-run metrics written to `_runlog`. Failure alerts fire within minutes.

Without this stage a broken pipeline dies silently and nobody notices for a week.


## 5. Data Model

| Tab | Purpose |
|---|---|
| `Leads` | Main lead database — website-bearing companies, scored |
| `Leads_NoWeb` | Phone-first prospects, separate scoring model |
| `raw_candidates` | WF1 output queue |
| `enriched` | WF2 output queue |
| `_state` | Run cursor, query-index cursor, quota counters, dead-letter URLs |
| `_suppression` | Exclusion list — companies here are filtered out and never re-appear in `Leads` |
| `_runlog` | Per-run metrics and errors |

### `Leads` columns

`lead_id`, `company_name`, `website`, `normalized_domain`, `email`, `email_valid`, `phone_e164`, `whatsapp_ready`, `city`, `country`, `region`, `industry`, `service_fit`, `score`, `score_reasons`, `tech_detected`, `hiring_signal`, `source`, `date_found`, `last_seen`, `contact_status`, `ai_summary`, `notes`

### `Leads_NoWeb` columns

`lead_id`, `company_name`, `phone_e164`, `whatsapp_ready`, `address`, `city`, `country`, `region`, `category`, `score`, `score_reasons`, `source`, `date_found`, `last_seen`, `contact_status`, `notes`

### Identity and deduplication

- Web leads: `lead_id = sha1(normalized_domain)`
- No-web leads: `lead_id = sha1(name|city|phone)`, where `name` is lowercased and stripped of punctuation and common suffixes (`pvt`, `ltd`, `co`), and `phone` is the E.164 form

`whatsapp_ready` is `true` when `phone_e164` is a Pakistani mobile number — E.164 form `+923XXXXXXXXX`, i.e. national format `03XX-XXXXXXX`. Landlines are marked `false`.

Domain normalization strips protocol, `www`, path, query parameters, and trailing slash, lowercases, and reduces to the registrable domain (eTLD+1).

Dedup procedure per run:

1. Read the target tab once into an in-memory Set of `lead_id`. One API call, not one per lead.
2. Deduplicate within the run before comparing — the same company appears across multiple sources.
3. Batch-append only unseen IDs.
4. For already-seen IDs, update `last_seen` only. Never overwrite `contact_status` or `notes` — those are human-owned columns.

n8n's native Remove Duplicates node, in "keep items where value is new" mode, provides a second layer backed by workflow static data.

Reading the whole tab once is deliberate: per-lead lookups would exceed the Sheets read quota of roughly 60 requests per minute per user.

## 6. Error Handling

| Failure | Handling |
|---|---|
| Site unreachable or times out | Continue-on-fail; URL to dead-letter list; run proceeds |
| Contact page missing | Fall back to homepage, then accept no email and score accordingly |
| Sheets rate limit | Exponential backoff and retry |
| CSE quota exhausted | Skip CSE for the day; `_state` records it; other sources continue |
| SearXNG container down | Skip that source, log, continue |
| Ollama unavailable | Skip AI enrichment; leads still written without `ai_summary` |
| Malformed source HTML | Extraction returns empty rather than throwing |

Principle: no single source or single company may abort a run. Partial results are always better than none.

## 7. Testing Strategy

- **Dry-run toggle.** A `DRY_RUN` flag routes all writes to test tabs. Every workflow runs end-to-end without touching live data.
- **HTML fixtures.** Saved real-world pages under `fixtures/` so extraction logic can be tested offline, repeatably, without hitting live sites.
- **Idempotency test.** Run a workflow twice against the same input; the second run must append exactly zero rows. This is the acceptance test for Phase 2 and is re-run after every change to dedup logic.
- **Quality review.** After each tuning pass, manually check a sample of leads for false positives. Target is under 10% junk.
- **Workflow JSON in git.** All workflows exported to `workflows/` and version-controlled. The n8n UI is not a backup.

## 8. Implementation Phases

| # | Phase | Exit criteria |
|---|---|---|
| 0 | Tooling and environment | n8n MCP connected; n8n running with correct env vars; git repo tracking workflows |
| 1 | Foundations | Service Account authenticated; all 7 tabs created; n8n writes a test row |
| 2 | Thin vertical slice | 20 real PK companies in the sheet from Overpass alone; a re-run appends zero duplicates |
| 3 | Discovery layer (WF1) | 100+ candidates per run from at least 3 independent sources, across both the Pakistan and international lanes |
| 4 | Enrichment (WF2) | At least 50% of web candidates yield a verified email; no single site aborts a run |
| 5 | Scoring (WF3) | Sheet sorted by score; the team agrees the top 10 are genuinely the best 10 |
| 6 | AI layer | Each lead carries an accurate one-line summary of what the company does and why it scored as it did |
| 7 | Observability (WF4) | A broken run alerts within minutes instead of failing silently |
| 8 | Tune and harden | Two consecutive clean runs; under 10% junk leads |
| 9 | Go live | Runs unattended for 7 days on always-on hosting |

Phase 2 is the confidence milestone and comes before any sophistication. Phases 3–5 are expected to be revised once real data from Phase 2 is visible; re-planning on observed data beats over-designing on assumptions.

## 9. Deployment

Development runs on the local machine with manual triggers. Hosting is deliberately deferred to Phase 10 so it never blocks the build.

At Phase 10 the instance moves to always-on hosting, because a Schedule Trigger on a laptop only fires while the laptop is awake. Oracle Cloud Always Free (4 ARM cores, 24 GB RAM, free indefinitely — not a trial) is the recommended target. Still self-hosted, still zero cost.

**Current environment.** n8n 2.35.7 is already installed globally via npm on the development machine, with data in `~/.n8n/database.sqlite` and an encryption key already generated in `~/.n8n/config`. No install is needed; it is started with `scripts/start-n8n.ps1`.

Required n8n environment variables:

- `N8N_ENCRYPTION_KEY` — **do not set on the development machine.** A key already exists in `~/.n8n/config`; overriding it with a different value renders every stored credential undecryptable. At Phase 10 the existing value is copied to the new host and set there explicitly, so that recreating the container does not break credentials.
- `GENERIC_TIMEZONE=Asia/Karachi` and `TZ=Asia/Karachi` — or schedules fire at UTC
- `NODE_FUNCTION_ALLOW_BUILTIN=dns,crypto,url`
- `NODE_FUNCTION_ALLOW_EXTERNAL=libphonenumber-js,cheerio`

## 10. Conduct and Compliance

Pakistan-first targeting avoids GDPR and the EU consent regime entirely. The following still apply:

- Public, business-facing contact information only. No personal addresses.
- Source sites' terms of service respected; rate limits honored.
- An exclusion list, so any company asking not to be contacted is filtered out of future runs.
- All contact is made manually by the team. This system sends nothing, so there is no bulk-sending or sender-reputation exposure.

When international targeting is added, note that EU and UK prospects sit under stricter rules — Germany's UWG and the EU ePrivacy regime effectively require prior consent for unsolicited B2B email. Since all contact here is manual, this is a matter for whoever writes the message, not a pipeline constraint. The `region` column exists so that distinction is visible in the sheet.

## 11. Out of Scope

Deliberately excluded to keep the first version shippable:

- Postgres or SQLite as an internal store. Multi-tab Sheets suffices well past the current volume.
- A web UI or custom CRM. The sheet is the interface.
- **All outreach automation.** No sending, no drafting, no message templates, no booking links. The team contacts prospects manually using the sheet. This is a deliberate scope boundary, not a deferral.
- LinkedIn as a source, at any stage.
