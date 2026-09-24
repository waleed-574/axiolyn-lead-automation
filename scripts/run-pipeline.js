#!/usr/bin/env node
/**
 * Runs the lead pipeline without n8n, so it can run unattended on a schedule.
 *
 *   node scripts/run-pipeline.js --stage=all
 *   node scripts/run-pipeline.js --stage=discover
 *   node scripts/run-pipeline.js --stage=enrich --batch=20
 *   node scripts/run-pipeline.js --stage=score
 *   node scripts/run-pipeline.js --stage=all --dry-run
 *
 * Every stage calls the same modules under workflows/src that the n8n
 * workflows are generated from, so the two execution paths cannot drift:
 * change the logic once and both follow.
 *
 * Credentials come from GOOGLE_SERVICE_ACCOUNT_JSON (a GitHub Actions secret)
 * or GOOGLE_SERVICE_ACCOUNT_FILE (a local path).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { Sheet } = require(path.join(ROOT, 'workflows/src/sheets'));
const { atCursor } = require(path.join(ROOT, 'workflows/src/targets'));
const { normalizeOverpass } = require(path.join(ROOT, 'workflows/src/normalize-overpass'));
const { extractFromPage, candidateUrls } = require(path.join(ROOT, 'workflows/src/extract-contacts'));
const { scoreWebLead, scoreNoWebLead } = require(path.join(ROOT, 'workflows/src/score-leads'));
const { parseSheetId } = require(path.join(ROOT, 'workflows/src/sheet-id'));

// config.json holds local identifiers and is gitignored, so CI supplies the
// same values through the environment instead.
function loadConfig() {
  const p = path.join(ROOT, 'config.json');
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  return { sheet: {} };
}
const cfg = loadConfig();
// Accepts a full Sheets URL as well as a bare id; see workflows/src/sheet-id.js.
const SHEET_ID = parseSheetId(process.env.SHEET_ID || cfg.sheet.spreadsheetId);
if (!SHEET_ID) {
  console.error('No usable spreadsheet id: set SHEET_ID, or copy config.example.json to config.json');
  process.exit(1);
}

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const STAGE = arg('stage', 'all');
const ENRICH_BATCH = parseInt(arg('batch', '25'), 10);
const DRY = flag('dry-run');

const UA = 'AxiolynLeadBot/1.0 (business research; contact via axiolyn.com)';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

/** Overpass mirrors must serve the whole planet; regional instances answer
 *  Pakistani queries with an empty 200, which reads as success. */
const MIRRORS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// ---------------------------------------------------------------- discovery

// Catch-all queries are given a shorter client deadline as well as a shorter
// Overpass timeout: one office_other query over Manhattan spent fifty minutes
// across three mirrors and returned nothing, which alone would exhaust a CI job.
async function overpass(query, clientTimeoutMs) {
  const errors = [];
  for (const url of MIRRORS) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(clientTimeoutMs || 180000),
      });
      if (!res.ok) { errors.push(`${url.split('/')[2]} ${res.status}`); continue; }
      const json = await res.json();
      log(`    ${url.split('/')[2]} -> ${json.elements ? json.elements.length : 0} elements in ${Date.now() - t0}ms`);
      return { json, mirror: url };
    } catch (e) {
      errors.push(`${url.split('/')[2]} ${e.name === 'TimeoutError' ? 'timeout' : e.message.slice(0, 40)}`);
    }
  }
  return { error: errors.join('; ') };
}

async function stageDiscover(sheet) {
  const started = new Date().toISOString();
  const runId = String(Date.now());

  const cursor = parseInt(await sheet.getState('wf1_cursor', '0'), 10) || 0;
  const target = atCursor(cursor);
  log(`  cursor ${target.index}/${target.total}: ${target.categoryKey} @ ${target.city}`);

  // Advance before querying: a combination that consistently fails must not
  // block the sweep forever.
  if (!DRY) await sheet.setState('wf1_cursor', target.nextCursor);

  const { json, error } = await overpass(target.query, target.catchAll ? 60000 : 180000);
  if (error) {
    log(`  ALL MIRRORS FAILED: ${error}`);
    if (!DRY) {
      await sheet.appendRunLog({
        run_id: runId, workflow: 'discover', started_at: started,
        finished_at: new Date().toISOString(), candidates_found: '0', new_leads: '0',
        errors: '1', notes: `all mirrors failed for ${target.sourceQuery}: ${error}`.slice(0, 400),
      });
    }
    return { found: 0, added: 0 };
  }

  const { rows, stats } = normalizeOverpass(json.elements || [], {
    city: target.city,
    sourceQuery: target.sourceQuery,
  });
  log(`  normalised ${rows.length} usable (web ${stats.web} / no-web ${stats.noWeb}) from ${stats.received}`);

  if (!rows.length) {
    if (!DRY) {
      await sheet.appendRunLog({
        run_id: runId, workflow: 'discover', started_at: started,
        finished_at: new Date().toISOString(), candidates_found: String(stats.received),
        new_leads: '0', errors: '1',
        notes: `empty result for ${target.sourceQuery}; received ${stats.received}, none usable`,
      });
    }
    return { found: 0, added: 0 };
  }

  const web = await sheet.readObjects('Leads');
  const noweb = await sheet.readObjects('Leads_NoWeb');
  const known = new Set([
    ...web.rows.map((r) => String(r.lead_id || '').trim()),
    ...noweb.rows.map((r) => String(r.lead_id || '').trim()),
  ].filter(Boolean));

  const fresh = rows.filter((r) => !known.has(r.lead_id));
  log(`  ${fresh.length} new after dedup against ${known.size} known`);

  const toWeb = fresh.filter((r) => r.has_website).map((r) => ({
    lead_id: r.lead_id, company_name: r.company_name, website: r.website,
    normalized_domain: r.normalized_domain, email: '', email_valid: '',
    phone_e164: r.phone_e164, whatsapp_ready: r.whatsapp_ready,
    city: r.city, country: r.country, region: r.region, industry: r.category,
    business_type: r.business_type,
    service_fit: '', score: '', score_reasons: '', tech_detected: '',
    hiring_signal: '', source: r.source, date_found: r.discovered_at,
    last_seen: r.discovered_at, contact_status: '', ai_summary: '', notes: r.address,
  }));

  const toNoWeb = fresh.filter((r) => !r.has_website).map((r) => ({
    lead_id: r.lead_id, company_name: r.company_name, phone_e164: r.phone_e164,
    whatsapp_ready: r.whatsapp_ready, address: r.address, city: r.city,
    country: r.country, region: r.region, category: r.category,
    business_type: r.business_type,
    score: '', score_reasons: '', source: r.source, date_found: r.discovered_at,
    last_seen: r.discovered_at, contact_status: '', notes: '',
  }));

  if (DRY) {
    log(`  DRY RUN: would append ${toWeb.length} web + ${toNoWeb.length} no-web`);
    return { found: rows.length, added: 0 };
  }

  const a = await sheet.appendObjects('Leads', web.header, toWeb);
  const b = await sheet.appendObjects('Leads_NoWeb', noweb.header, toNoWeb);
  log(`  appended ${a} web + ${b} no-web`);

  await sheet.appendRunLog({
    run_id: runId, workflow: 'discover', started_at: started,
    finished_at: new Date().toISOString(), candidates_found: String(rows.length),
    new_leads: String(a + b), errors: '0',
    notes: `${target.sourceQuery} (cursor ${target.index}/${target.total})`,
  });
  return { found: rows.length, added: a + b };
}

// --------------------------------------------------------------- enrichment

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return '';
    const ct = res.headers.get('content-type') || '';
    if (!/text\/html/i.test(ct)) return '';
    return await res.text();
  } catch (e) {
    return '';
  }
}

let mxCache = new Map();
async function hasMx(domain) {
  if (mxCache.has(domain)) return mxCache.get(domain);
  const dnsmod = require('dns');
  // Some runtimes default to 127.0.0.1 with nothing listening, which fails
  // every lookup with ECONNREFUSED. Public resolvers must be explicit.
  try { dnsmod.setServers(['8.8.8.8', '1.1.1.1']); } catch (e) { /* already set */ }
  const dns = dnsmod.promises;
  let ok = false;
  try {
    const mx = await dns.resolveMx(domain);
    ok = Array.isArray(mx) && mx.length > 0;
  } catch (e) {
    try {
      const a = await dns.resolve4(domain);
      ok = Array.isArray(a) && a.length > 0;
    } catch (e2) { ok = false; }
  }
  mxCache.set(domain, ok);
  return ok;
}

async function stageEnrich(sheet) {
  const started = new Date().toISOString();
  const runId = String(Date.now());
  const { rows } = await sheet.readObjects('Leads');

  const todo = rows.filter((r) =>
    r.lead_id &&
    String(r.normalized_domain || '').trim() &&
    !String(r.email_valid || '').trim());

  log(`  backlog: ${todo.length}, taking ${Math.min(ENRICH_BATCH, todo.length)}`);
  if (!todo.length) return { enriched: 0, found: 0 };

  const batch = todo.slice(0, ENRICH_BATCH);
  const updates = [];
  let found = 0;

  for (const lead of batch) {
    const domain = String(lead.normalized_domain).trim();
    const urls = candidateUrls(domain).slice(0, 3); // homepage, /contact, /contact-us
    let html = '';
    for (const u of urls) {
      const body = await fetchPage(u);
      if (body) html += '\n' + body;
      await sleep(1200); // polite gap between requests
      if (html.length > 400000) break; // enough to extract from
    }

    if (!html.trim()) {
      updates.push({
        lead_id: lead.lead_id, email: '', email_valid: 'fetch_failed',
        tech_detected: '', last_seen: new Date().toISOString(),
      });
      log(`    ${domain.padEnd(30)} unreachable`);
      continue;
    }

    const r = extractFromPage(html, domain);
    const best = r.emails[0];
    let verdict = 'no_email_found';
    if (best) {
      const ok = await hasMx(String(best.email).split('@')[1] || '');
      verdict = `${ok ? 'ok' : 'nomx'}:${best.source}:${best.confidence}`;
      if (ok) found++;
    }
    updates.push({
      lead_id: lead.lead_id,
      email: best ? best.email : '',
      email_valid: verdict,
      tech_detected: r.tech.join(','),
      last_seen: new Date().toISOString(),
    });
    log(`    ${domain.padEnd(30)} ${(best ? best.email : '-').padEnd(32)} ${verdict}`);
  }

  if (DRY) {
    log(`  DRY RUN: would update ${updates.length} rows`);
    return { enriched: updates.length, found };
  }

  const cells = await sheet.updateByKey('Leads', 'lead_id', updates);
  log(`  updated ${updates.length} leads (${cells} cells)`);

  await sheet.appendRunLog({
    run_id: runId, workflow: 'enrich', started_at: started,
    finished_at: new Date().toISOString(), candidates_found: String(batch.length),
    new_leads: String(found), errors: '0',
    notes: `${found}/${batch.length} yielded a verified email; ${todo.length - batch.length} left in backlog`,
  });
  return { enriched: updates.length, found };
}

// ------------------------------------------------------------------ scoring

async function stageScore(sheet) {
  const started = new Date().toISOString();
  const runId = String(Date.now());

  const web = await sheet.readObjects('Leads');
  const webUpdates = [];
  for (const lead of web.rows) {
    if (!lead.lead_id) continue;
    const r = scoreWebLead(lead);
    if (r.pending) continue; // not crawled yet — scoring it would rank on city alone
    webUpdates.push({
      lead_id: lead.lead_id, score: r.score,
      score_reasons: r.reasons, service_fit: r.service_fit,
    });
  }

  const noweb = await sheet.readObjects('Leads_NoWeb');
  const noWebUpdates = noweb.rows
    .filter((l) => l.lead_id)
    .map((l) => {
      const r = scoreNoWebLead(l);
      return { lead_id: l.lead_id, score: r.score, score_reasons: r.reasons };
    });

  log(`  scored ${webUpdates.length} web (${web.rows.length - webUpdates.length} awaiting enrichment), ${noWebUpdates.length} no-web`);

  if (DRY) {
    const top = webUpdates.slice().sort((a, b) => b.score - a.score).slice(0, 5);
    log('  DRY RUN, top 5 would be:');
    top.forEach((t) => log(`    ${String(t.score).padStart(3)}  ${t.lead_id.slice(0, 10)}...`));
    return { scored: webUpdates.length + noWebUpdates.length };
  }

  await sheet.updateByKey('Leads', 'lead_id', webUpdates);
  await sheet.updateByKey('Leads_NoWeb', 'lead_id', noWebUpdates);

  await sheet.appendRunLog({
    run_id: runId, workflow: 'score', started_at: started,
    finished_at: new Date().toISOString(),
    candidates_found: String(web.rows.length + noweb.rows.length),
    new_leads: String(webUpdates.length + noWebUpdates.length), errors: '0',
    notes: `${web.rows.length - webUpdates.length} web leads still awaiting enrichment`,
  });
  return { scored: webUpdates.length + noWebUpdates.length };
}

// --------------------------------------------------------------------- main

(async () => {
  const t0 = Date.now();
  log(`Axiolyn lead pipeline — stage=${STAGE}${DRY ? ' (dry run)' : ''}`);
  log(`sheet: ${SHEET_ID}`);

  const sheet = await Sheet.open(SHEET_ID, process.env.GOOGLE_SERVICE_ACCOUNT_FILE);
  const run = (s) => STAGE === 'all' || STAGE === s;
  let failures = 0;

  // Stages are independent: enrichment still runs when discovery's mirrors are
  // down, and scoring still runs when a site refuses to load.
  if (run('discover')) {
    log('\n[discover]');
    try { await stageDiscover(sheet); } catch (e) { failures++; log('  FAILED:', e.message); }
  }
  if (run('enrich')) {
    log('\n[enrich]');
    try { await stageEnrich(sheet); } catch (e) { failures++; log('  FAILED:', e.message); }
  }
  if (run('score')) {
    log('\n[score]');
    try { await stageScore(sheet); } catch (e) { failures++; log('  FAILED:', e.message); }
  }

  log(`\ndone in ${Math.round((Date.now() - t0) / 1000)}s, ${failures} stage failure(s)`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
