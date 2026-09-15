# Axiolyn Lead Automation

An automated B2B lead pipeline for the Pakistani market. It discovers
businesses, digs their contact details out of their own websites, verifies the
addresses actually receive mail, and ranks everything into a call list — on a
schedule, with no paid API, no subscription and no server.

Built for [Axiolyn](https://axiolyn.com), which sells business process
automation and needed to stop prospecting by hand.

---

## What it does

```
   ┌─ discover ──────────────────────────────────────────────┐
   │  OpenStreetMap (Overpass) → 126 city × category sweeps   │
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

A finished row looks like this:

| score | company | email | verdict | reasons |
|---|---|---|---|---|
| 86 | Hearing Clinic | info@hearingclinic.com.pk | `ok:mailto:own` | no CRM or booking tool on site; runs an online store (woocommerce); email verified; official company address; WhatsApp reachable; priority vertical: Healthcare |

The reasons are the point. A score you cannot argue with is a score nobody
trusts, so every rule that fires writes why.

## The core idea

The strongest buy signal for an automation agency is **a working business with
no automation**. A clinic running a WooCommerce store with no CRM, no booking
tool and no chat widget is taking appointments by hand — and that is a specific,
recognisable problem to lead a conversation with.

So the pipeline fingerprints each site's tech stack and scores the *absence* of
HubSpot, Salesforce, Calendly, Intercom and friends.

## Running it

Everything runs on free infrastructure:

| Piece | What it costs |
|---|---|
| OpenStreetMap Overpass | free, no key |
| Google Sheets (service account) | free |
| MX verification via DNS | free — no verification API |
| GitHub Actions scheduler | free |
| n8n (local, optional) | free, self-hosted |

### Unattended, on GitHub Actions

1. Add a repository secret `GOOGLE_SERVICE_ACCOUNT_JSON` containing your Google
   service account key (Settings → Secrets and variables → Actions).
2. Share your Google Sheet with the service account's email address, as Editor.
3. Set your sheet id in `config.json`.

`.github/workflows/leads-pipeline.yml` then runs every three hours. Offline
tests run first — broken extraction logic fails the job rather than writing bad
data into the sheet.

### By hand

```bash
export GOOGLE_SERVICE_ACCOUNT_FILE=credentials/key.json

npm test                    # offline, no credentials needed
npm run pipeline            # all three stages
npm run discover            # one sweep step
npm run enrich              # crawl the backlog
npm run score               # re-rank everything

node scripts/run-pipeline.js --stage=all --dry-run   # writes nothing
```

### In n8n

The same logic also runs as three n8n workflows, for visual editing and
step-by-step debugging:

```bash
npm run build:workflows     # regenerates the workflow JSON
```

The Code nodes are assembled from the modules in `workflows/src`, so the n8n
path and the scheduled path execute identical code. Change the logic once and
both follow.

## Repository layout

| Path | What lives there |
|---|---|
| `workflows/src/targets.js` | The sweep: 9 cities × 14 category groups, cursor, query builder |
| `workflows/src/normalize-overpass.js` | Overpass → lead rows, phone E.164, deterministic ids |
| `workflows/src/extract-contacts.js` | Contact extraction, tech fingerprinting, spam defence |
| `workflows/src/score-leads.js` | The 0-100 model and its reasons |
| `workflows/src/sheets.js` | Dependency-free Google Sheets client |
| `scripts/run-pipeline.js` | The scheduled runner |
| `scripts/build-wf*.js` | Generate the n8n workflows from the same sources |
| `scripts/test-*.js` | Offline tests against captured fixtures |
| `fixtures/` | Real captured responses, so tests need no network |

## Testing

Tests run offline against real captured data — a 103 KB Overpass response and
eight real Pakistani company pages — so they are repeatable and do not depend on
a flaky public API being up.

```bash
npm test
```

Covers Cloudflare de-obfuscation, junk filtering, spam-domain rejection, phone
normalisation, domain classification, tech fingerprinting, and end-to-end
extraction against the captured pages.

## Things learned the hard way

Each of these was found by running against real data, not by reading the code.

**A mirror that returns `200 OK` with nothing is worse than one that errors.**
`overpass.osm.ch` is Switzerland-only and answers Pakistani queries with zero
elements in about a second. Unguarded, a run looks successful, writes nothing
and logs nothing — indistinguishable from "no new businesses today". There is
now an explicit empty-response guard.

**Hacked sites serve spam addresses that decode perfectly.** A Pakistani sports
site carried a Cloudflare-obfuscated `info@breitlingreplica.is`. It survives
every naive filter and ranks first when the site publishes nothing of its own.

**But over-correcting is worse.** The first fix rejected any address whose
domain differed from the site's — which threw away `info@dhmc.com.pk` on
`doctorshospital.com.pk` (the same organisation) and kept a personal Gmail
instead. The real signal was the TLD, not the domain differing.

**Google Sheets will silently destroy a phone number.** The default
`USER_ENTERED` cell format parses `+923001234567` as arithmetic and stores
`923001234567`. Writing `RAW` is not optional.

**n8n nodes run once per input item unless told otherwise.** 39 candidates
turned into 546 then 13,650 items, and several hundred needless API calls,
before `executeOnce` was set.

**Query shape decides whether a source is any good.** An unfiltered Overpass
query for clinics returned 3% with websites, which nearly got the source written
off. A contact-filtered query against commercial categories returned 82%.

## Scope

Ends when a scored lead lands in the sheet. Contact is made by humans, so
nothing here sends, drafts or templates a message.

## Licence

Unlicensed — internal project, published as a reference.
