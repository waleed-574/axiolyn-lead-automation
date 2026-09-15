# LinkedIn post — draft

Edit freely. The numbers are real as of 2026-09-15; update them before posting
if the sweep has moved on.

---

We were finding clients by hand. So I built something to stop doing that.

Axiolyn sells business process automation — which made prospecting by
spreadsheet a slightly embarrassing way to spend our evenings. Over the last few
days I built a pipeline that does it for us.

It runs every 3 hours, unattended, and costs nothing:

→ **Finds** Pakistani businesses from OpenStreetMap — 126 city × category
sweeps covering every commercial category, not a curated shortlist
→ **Crawls** each company's own site for contact details
→ **Verifies** the email domain actually accepts mail, via DNS MX lookup
→ **Scores** every lead 0-100 and writes a plain-English reason for each rule
→ **Writes** it all to a Google Sheet, sorted best-first

188 leads so far, and it keeps going while I sleep.

**The idea it's built on:** the strongest buy signal for an automation agency is
a working business with no automation. So the pipeline fingerprints each site's
tech stack and scores the *absence* of a CRM, chat widget or booking tool.

A clinic running a WooCommerce store with no CRM and no booking system is
taking appointments by hand. That's not a cold lead — that's a specific problem
I can open a conversation with.

**Total infrastructure cost: £0.**
OpenStreetMap (free), Google Sheets (free), DNS for email verification (free),
GitHub Actions as the scheduler (free). No Apollo, no Hunter, no ZoomInfo, no
server to rent.

**What actually taught me something** — every one of these was found by running
against real data, not by reading my own code:

• One Overpass mirror answers Pakistani queries with `200 OK` and zero results
in under a second. It's a Switzerland-only instance. Unguarded, the run looks
successful, writes nothing, and logs nothing — indistinguishable from "no new
businesses today". **A silent success is more dangerous than a loud failure.**

• A hacked Pakistani site was serving a Cloudflare-obfuscated spam address. It
decoded perfectly and ranked first, because the site published nothing of its
own.

• My fix for that was worse than the bug. Rejecting any unfamiliar domain threw
away `info@dhmc.com.pk` on `doctorshospital.com.pk` — the same organisation —
and kept somebody's personal Gmail instead. The real signal was the TLD, not the
domain differing.

• Google Sheets silently destroys phone numbers. Its default cell format parses
`+923001234567` as arithmetic and stores `923001234567`.

• An unfiltered query for clinics returned 3% with websites and nearly got the
whole data source written off. A contact-filtered query against commercial
categories returned 82%. **Query shape decided whether the source was viable.**

Built with n8n for the visual side and plain Node for the scheduled runs — both
executing the same modules, so the two paths can't drift apart.

Code, tests and the full write-up of what broke:
https://github.com/waleed-574/axiolyn-lead-automation

#automation #n8n #leadgeneration #opensource #pakistan #startups

---

## Shorter variant, if the above runs long

We sell automation but were finding clients by hand. So I fixed that.

A pipeline that runs every 3 hours, unattended, for £0:
→ finds Pakistani businesses from OpenStreetMap
→ crawls their sites for contact details
→ verifies the email domain accepts mail (DNS, not a paid API)
→ scores each lead 0-100 with a reason you can argue with

188 leads so far.

The core idea: **the strongest buy signal for an automation agency is a working
business with no automation.** So it fingerprints each site's tech stack and
scores the absence of a CRM, chat widget or booking tool. A clinic running a
WooCommerce store with no booking system is taking appointments by hand — that's
a conversation, not a cold call.

Hardest lesson: one data-source mirror returns `200 OK` with zero results
because it only holds Swiss data. The run looks like a success, writes nothing,
logs nothing. **A silent success is worse than a loud failure** — it took a
timing anomaly to notice.

Code and the full list of what broke:
https://github.com/waleed-574/axiolyn-lead-automation

#automation #leadgeneration #n8n #opensource
