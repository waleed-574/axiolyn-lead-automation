#!/usr/bin/env node
/**
 * The US/UK lead pipeline. Entirely separate from the Pakistan one: its own
 * spreadsheet, its own sweep cursor, its own schedule. Nothing it does can
 * touch the Pakistan sheet.
 *
 *   node scripts/run-intl-pipeline.js --stage=all
 *   node scripts/run-intl-pipeline.js --stage=discover --sweeps=3
 *   node scripts/run-intl-pipeline.js --stage=enrich --batch=25
 *   node scripts/run-intl-pipeline.js --stage=score
 *   node scripts/run-intl-pipeline.js --stage=all --dry-run
 *
 * Credentials: GOOGLE_SERVICE_ACCOUNT_JSON (CI) or GOOGLE_SERVICE_ACCOUNT_FILE.
 * Spreadsheet: SHEET_ID_INTL, or config.json -> sheetIntl.spreadsheetId.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { Sheet } = require(path.join(ROOT, 'workflows/src/sheets'));
const { atCursor, combinations } = require(path.join(ROOT, 'workflows/src/targets-intl'));
const { normalizeIntl } = require(path.join(ROOT, 'workflows/src/normalize-intl'));
const { extractFromPage, candidateUrls } = require(path.join(ROOT, 'workflows/src/extract-contacts'));
const { scoreIntlLead } = require(path.join(ROOT, 'workflows/src/score-intl'));

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const flag = (n) => process.argv.includes(`--${n}`);

const STAGE = arg('stage', 'all');
const SWEEPS = parseInt(arg('sweeps', '3'), 10);
const BATCH = parseInt(arg('batch', '25'), 10);
const DRY = flag('dry-run');

function loadSheetId() {
  if (process.env.SHEET_ID_INTL) return process.env.SHEET_ID_INTL;
  const p = path.join(ROOT, 'config.json');
  if (fs.existsSync(p)) {
    const c = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (c.sheetIntl && c.sheetIntl.spreadsheetId) return c.sheetIntl.spreadsheetId;
  }
  throw new Error('No US/UK spreadsheet id: set SHEET_ID_INTL or add sheetIntl to config.json');
}
const SHEET_ID = loadSheetId();

const TAB = { US: 'Leads_US', GB: 'Leads_UK' };
const CURSOR_KEY = 'intl_cursor';

const UA = 'AxiolynLeadBot/1.0 (business research; contact via axiolyn.com)';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const MIRRORS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// ---------------------------------------------------------------- discovery

async function overpass(query) {
  const errors = [];
  for (const url of MIRRORS) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(180000),
      });
      if (!res.ok) { errors.push(`${url.split('/')[2]} ${res.status}`); continue; }
      const json = await res.json();
      return { json, ms: Date.now() - t0, mirror: url.split('/')[2] };
    } catch (e) {
      errors.push(`${url.split('/')[2]} ${e.name === 'TimeoutError' ? 'timeout' : e.message.slice(0, 30)}`);
    }
  }
  return { error: errors.join('; ') };
}

async function stageDiscover(sheet) {
  const started = new Date().toISOString();
  const runId = String(Date.now());
  let totalNew = 0;
  let totalFound = 0;
  const notes = [];

  // Existing ids from both country tabs, read once. Deduplication spans
  // countries so the same multinational cannot land in both.
  const known = new Set();
  const headers = {};
  for (const [country, tab] of Object.entries(TAB)) {
    const { header, rows } = await sheet.readObjects(tab);
    headers[country] = header;
    rows.forEach((r) => { if (r.lead_id) known.add(String(r.lead_id).trim()); });
  }
  log(`  ${known.size} leads already known`);

  // Several sweep steps per run: 544 combinations at one an hour would take
  // 23 days for a single pass.
  for (let n = 0; n < SWEEPS; n++) {
    const cursor = parseInt(await sheet.getState(CURSOR_KEY, '0'), 10) || 0;
    const target = atCursor(cursor);
    log(`  [${n + 1}/${SWEEPS}] cursor ${target.index}/${target.total}: ${target.sourceQuery}`);

    // Advance first, so a combination that always fails cannot block the sweep.
    if (!DRY) await sheet.setState(CURSOR_KEY, target.nextCursor);

    const { json, error, ms, mirror } = await overpass(target.query);
    if (error) {
      log(`      all mirrors failed: ${error}`);
      notes.push(`FAIL ${target.sourceQuery}: ${error}`);
      continue;
    }

    const { rows, stats } = normalizeIntl(json.elements || [], {
      country: target.country,
      city: target.city,
      sourceQuery: target.sourceQuery,
    });
    totalFound += rows.length;
    log(`      ${mirror} ${ms}ms → ${stats.received} elements, ${rows.length} usable ` +
        `(web ${stats.web} / phone ${stats.phoneOnly}, dropped ${stats.chain} chains, ${stats.institutional} public)`);

    const fresh = rows.filter((r) => !known.has(r.lead_id));
    fresh.forEach((r) => known.add(r.lead_id));
    if (!fresh.length) { log('      nothing new'); continue; }

    const tab = TAB[target.country];
    const toWrite = fresh.map((r) => {
      const { __sourceQuery, __hasWebsite, ...row } = r;
      return row;
    });

    if (DRY) {
      log(`      DRY RUN: would append ${toWrite.length} to ${tab}`);
    } else {
      const n2 = await sheet.appendObjects(tab, headers[target.country], toWrite);
      totalNew += n2;
      log(`      appended ${n2} to ${tab}`);
    }
    notes.push(`${target.sourceQuery}: +${toWrite.length}`);
  }

  if (!DRY) {
    await sheet.appendRunLog({
      run_id: runId, workflow: 'discover-intl', started_at: started,
      finished_at: new Date().toISOString(),
      candidates_found: String(totalFound), new_leads: String(totalNew),
      errors: String(notes.filter((x) => x.startsWith('FAIL')).length),
      notes: notes.join(' | ').slice(0, 480),
    });
  }
  return { found: totalFound, added: totalNew };
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
    if (!/text\/html/i.test(res.headers.get('content-type') || '')) return '';
    return await res.text();
  } catch (e) {
    return '';
  }
}

const mxCache = new Map();
async function hasMx(domain) {
  if (mxCache.has(domain)) return mxCache.get(domain);
  const dnsmod = require('dns');
  // Some runtimes resolve against 127.0.0.1 with nothing listening, failing
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
  let done = 0;
  let found = 0;

  // Split the batch across both countries so neither starves the other.
  const perCountry = Math.max(1, Math.floor(BATCH / 2));

  for (const [country, tab] of Object.entries(TAB)) {
    const { rows } = await sheet.readObjects(tab);
    const todo = rows.filter((r) =>
      r.lead_id &&
      String(r.normalized_domain || '').trim() &&
      !String(r.email_valid || '').trim());
    log(`  ${tab}: backlog ${todo.length}, taking ${Math.min(perCountry, todo.length)}`);
    if (!todo.length) continue;

    const updates = [];
    for (const lead of todo.slice(0, perCountry)) {
      const domain = String(lead.normalized_domain).trim();
      let html = '';
      for (const u of candidateUrls(domain).slice(0, 3)) {
        const body = await fetchPage(u);
        if (body) html += '\n' + body;
        await sleep(1200); // polite gap
        if (html.length > 400000) break;
      }

      if (!html.trim()) {
        updates.push({ lead_id: lead.lead_id, email: '', email_valid: 'fetch_failed',
                       tech_detected: '', last_seen: new Date().toISOString() });
        log(`    ${domain.padEnd(34)} unreachable`);
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
      log(`    ${domain.padEnd(34)}${(best ? best.email : '-').padEnd(32)}${verdict}`);
    }

    if (DRY) { log(`    DRY RUN: would update ${updates.length} in ${tab}`); }
    else if (updates.length) {
      await sheet.updateByKey(tab, 'lead_id', updates);
      log(`    updated ${updates.length} in ${tab}`);
    }
    done += updates.length;
  }

  if (!DRY) {
    await sheet.appendRunLog({
      run_id: runId, workflow: 'enrich-intl', started_at: started,
      finished_at: new Date().toISOString(), candidates_found: String(done),
      new_leads: String(found), errors: '0',
      notes: `${found}/${done} yielded a verified email`,
    });
  }
  return { done, found };
}

// ------------------------------------------------------------------ scoring

async function stageScore(sheet) {
  const started = new Date().toISOString();
  const runId = String(Date.now());
  let total = 0;
  let pending = 0;

  for (const [country, tab] of Object.entries(TAB)) {
    const { rows } = await sheet.readObjects(tab);
    const updates = [];
    for (const lead of rows) {
      if (!lead.lead_id) continue;
      const r = scoreIntlLead(lead);
      // A lead with a website that has not been crawled yet stays unscored, so
      // the top of the sheet is the best known leads rather than the ones that
      // happened to be processed first.
      if (r.pending) { pending++; continue; }
      updates.push({
        lead_id: lead.lead_id, score: r.score,
        score_reasons: r.reasons, service_fit: r.service_fit,
      });
    }
    log(`  ${tab}: scored ${updates.length}, ${rows.length - updates.length} awaiting crawl`);
    if (!DRY && updates.length) await sheet.updateByKey(tab, 'lead_id', updates);
    total += updates.length;
  }

  if (!DRY) {
    await sheet.appendRunLog({
      run_id: runId, workflow: 'score-intl', started_at: started,
      finished_at: new Date().toISOString(), candidates_found: String(total + pending),
      new_leads: String(total), errors: '0',
      notes: `${pending} leads still awaiting crawl`,
    });
  }
  return { total };
}

// --------------------------------------------------------------------- main

(async () => {
  const t0 = Date.now();
  log(`Axiolyn US/UK pipeline — stage=${STAGE}${DRY ? ' (dry run)' : ''}`);
  log(`sheet: ${SHEET_ID}`);
  log(`sweep: ${combinations().length} combinations`);

  const sheet = await Sheet.open(SHEET_ID, process.env.GOOGLE_SERVICE_ACCOUNT_FILE);
  const run = (s) => STAGE === 'all' || STAGE === s;
  let failures = 0;

  // Stages are independent: enrichment still runs when Overpass is down, and
  // scoring still runs when a site refuses to load.
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
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
