# Axiolyn Lead Automation

An automated B2B lead pipeline covering **Pakistan, the United States and the
United Kingdom**. It discovers businesses, digs their contact details out of
their own websites, checks that the addresses actually receive mail, and ranks
everything into a call list. It runs on a schedule, with no paid API, no
subscription and no server.

Built for [Axiolyn](https://axiolyn.com), an automation agency that needed to
stop prospecting by hand.

---

## Results so far

| | Leads | Verified emails |
|---|---:|---:|
| Pakistan | 4,975 | 406 |
| United States | 5,633 | 1,341 |
| United Kingdom | 6,403 | 1,510 |
| **Total** | **17,011** | **3,257** |

Another 3,575 Pakistani businesses with no website are reachable on WhatsApp.
Figures are from 22 November 2026. The pipeline keeps adding to them several
times a day, and running it costs **$0 a month**.

## What it does

```
   ┌─ discover ──────────────────────────────────────────────┐
   │  OpenStreetMap (Overpass) → 1,372 city × category sweeps │
   │  normalise → deduplicate → split web / phone-only        │
   └──────────────────────────┬──────────────────────────────┘
                              ▼
   ┌─ enrich ────────────────────────────────────────────────┐
   │  crawl homepage + /contact                              │
   │  mailto → Cloudflare-obfuscated → JSON-LD → regex        │
   │  fingerprint tech stack · verify MX                     │
   └──────────────────────────┬──────────────────────────────┘
                              ▼
   ┌─ score ─────────────────────────────────────────────────┐
   │  0-100 with a plain-language reason for every rule      │
   └──────────────────────────┬──────────────────────────────┘
                              ▼
                      Google Sheet, sorted best-first
```

There are two independent pipelines. Each has its own spreadsheet, its own
sweep cursor and its own schedule, so neither can touch the other's data.

| Pipeline | Sweep | Writes to |
|---|---|---|
| Pakistan | 9 cities × 28 category groups = 252 | `Leads`, `Leads_NoWeb` |
| US & UK | 23 cities, split into 35 map tiles × 32 category groups = 1,120 | `Leads_US`, `Leads_UK` |

A finished row looks like this:

| score | company | email | verdict | reasons |
|---|---|---|---|---|
| 86 | Hearing Clinic | info@hearingclinic.com.pk | `ok:mailto:own` | no CRM or booking tool on site; runs an online store (woocommerce); email verified; official company address; WhatsApp reachable; priority vertical: Healthcare |

The reasons are the point. People don't trust a score they can't question, so
every rule that fires writes down why.

## The core idea

The strongest buy signal for an automation agency is **a working business with
no automation**. A clinic running a WooCommerce store with no CRM, no booking
tool and no chat widget is taking appointments by hand. That is a specific,
recognisable problem to open a conversation with.

So the pipeline fingerprints each site's tech stack and scores the *absence* of
HubSpot, Salesforce, Calendly, Intercom and friends.

## Running it

Everything runs on free infrastructure:

| Piece | What it costs |
|---|---|
| OpenStreetMap Overpass | free, no key |
| Google Sheets (service account) | free |
| MX verification via DNS | free, no verification API |
| GitHub Actions scheduler | free |
| n8n (local, optional) | free, self-hosted |

### Unattended, on GitHub Actions

1. Add these repository secrets (Settings → Secrets and variables → Actions):
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: your Google service account key
   - `SHEET_ID`: the Pakistan spreadsheet id
   - `SHEET_ID_INTL`: the US & UK spreadsheet id
2. Share both sheets with the service account's email address, as Editor.

Three workflows then take over:

| Workflow | Schedule | Does |
|---|---|---|
| `leads-pipeline.yml` | hourly cron | one Pakistan sweep step, then enrich 35 and re-score |
| `leads-intl.yml` | hourly cron | six US/UK sweep steps, then enrich 60 and re-score |
| `keepalive.yml` | monthly | stops GitHub from disabling the schedules (see below) |

GitHub throttles scheduled jobs, so "hourly" really means about five or six runs
a day. Offline tests run before every pipeline run, so broken extraction logic
fails the job instead of writing bad data into the sheet.

### By hand

```bash
export GOOGLE_SERVICE_ACCOUNT_FILE=credentials/key.json

npm test                    # offline, no credentials needed
npm run pipeline            # Pakistan: all three stages
npm run pipeline:intl       # US & UK: all three stages
npm run stats               # Pakistan sheet snapshot
npm run stats:intl          # US & UK sheet snapshot

node scripts/run-pipeline.js --stage=all --dry-run   # writes nothing
```

### In n8n

The same logic also runs as n8n workflows (three for Pakistan, three for the
US & UK), for visual editing and step-by-step debugging:

```bash
npm run build:workflows     # regenerates the workflow JSON
```

The Code nodes are assembled from the modules in `workflows/src`, so the n8n
path and the scheduled path execute identical code. Change the logic once and
both follow.

## Repository layout

| Path | What lives there |
|---|---|
| `workflows/src/targets.js` | Pakistan sweep: cities, category groups, cursor, query builder |
| `workflows/src/targets-intl.js` | US & UK sweep, with dense areas split into smaller tiles |
| `workflows/src/normalize-overpass.js` | Overpass → lead rows, phone E.164, deterministic ids |
| `workflows/src/normalize-intl.js` | The same for US and UK addresses and phone formats |
| `workflows/src/extract-contacts.js` | Contact extraction, tech fingerprinting, spam defence |
| `workflows/src/score-leads.js` | The 0-100 model and its reasons (Pakistan) |
| `workflows/src/score-intl.js` | The 0-100 model for US and UK leads |
| `workflows/src/sheets.js` | Dependency-free Google Sheets client |
| `scripts/run-pipeline.js` | Scheduled runner, Pakistan |
| `scripts/run-intl-pipeline.js` | Scheduled runner, US & UK |
| `scripts/sheet-stats*.js` | Readable snapshots of each sheet |
| `scripts/build-wf*.js` | Generate the n8n workflows from the same sources |
| `scripts/test-*.js` | Offline tests against captured fixtures |
| `fixtures/` | Real captured responses, so tests need no network |

## Testing

Tests run offline against real captured data: a 103 KB Overpass response and
eight real company pages. They are repeatable and don't depend on a flaky
public API being up.

```bash
npm test
```

Covers Cloudflare de-obfuscation, junk filtering, spam-domain rejection, phone
normalisation for all three countries, domain classification, tech
fingerprinting, scoring rules, and end-to-end extraction against the captured
pages.

## Things learned the hard way

Each of these came from running against real data, not from reading the code.

**A mirror that returns `200 OK` with nothing is worse than one that errors.**
`overpass.osm.ch` holds Switzerland only and answers Pakistani queries with
zero elements in about a second. Unguarded, a run looks successful but writes
nothing and logs nothing, which looks exactly like "no new businesses today".
There is now an explicit guard for empty responses.

**Hacked sites serve spam addresses that decode perfectly.** A Pakistani sports
site carried a Cloudflare-obfuscated `info@breitlingreplica.is`. It survives
every naive filter and ranks first when the site publishes nothing of its own.

**But over-correcting is worse.** The first fix rejected any address whose
domain differed from the site's. That threw away `info@dhmc.com.pk` on
`doctorshospital.com.pk` (the same organisation) and kept a personal Gmail
instead. The real signal was the TLD, not the fact that the domains differed.

**Google Sheets will silently destroy a phone number.** The default
`USER_ENTERED` cell format parses `+923001234567` as arithmetic and stores
`923001234567`. Writing `RAW` is not optional.

**n8n nodes run once per input item unless told otherwise.** 39 candidates
turned into 546, then 13,650 items and several hundred needless API calls,
before `executeOnce` was set.

**Query shape decides whether a source is any good.** An unfiltered Overpass
query for clinics returned only 3% with websites, which nearly got the source
written off. A contact-filtered query against commercial categories returned
82%.

**Dense areas need smaller questions.** Overpass refused every query for the
City of London tile, run after run. Splitting it in half fixed it, so a tile
that keeps failing is now halved rather than retried.

**Free schedulers have fine print.** GitHub runs an "hourly" cron about five or
six times a day, and it disables scheduled workflows in a public repository
after 60 days without a commit. The pipelines only write to Google Sheets, so
they would have stopped silently. `keepalive.yml` re-enables them every month.

## Scope

Ends when a scored lead lands in the sheet. Contact is made by humans, so
nothing here sends, drafts or templates a message.

## Licence

Unlicensed: internal project, published as a reference.
