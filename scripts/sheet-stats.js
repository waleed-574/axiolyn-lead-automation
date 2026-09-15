/**
 * A readable snapshot of the lead sheet: volume, coverage, quality and the
 * current top of the call list.
 *
 *   node scripts/sheet-stats.js [--top=10]
 *
 * Credentials come from GOOGLE_SERVICE_ACCOUNT_FILE or
 * GOOGLE_SERVICE_ACCOUNT_JSON, the same as the pipeline.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { Sheet } = require(path.join(ROOT, 'workflows/src/sheets'));

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=')[1] : d;
};
const TOP = parseInt(arg('top', '10'), 10);

function loadSheetId() {
  if (process.env.SHEET_ID) return process.env.SHEET_ID;
  const p = path.join(ROOT, 'config.json');
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')).sheet.spreadsheetId;
  throw new Error('Set SHEET_ID or create config.json');
}

const bar = (n, max, width) => '█'.repeat(Math.max(0, Math.round((n / (max || 1)) * (width || 28))));
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

(async () => {
  const sheet = await Sheet.open(loadSheetId(), process.env.GOOGLE_SERVICE_ACCOUNT_FILE);
  const web = (await sheet.readObjects('Leads')).rows;
  const noweb = (await sheet.readObjects('Leads_NoWeb')).rows;
  const runlog = (await sheet.readObjects('_runlog')).rows;
  const state = (await sheet.readObjects('_state')).rows;

  const total = web.length + noweb.length;
  const enriched = web.filter((l) => String(l.email_valid || '').trim());
  const withEmail = web.filter((l) => String(l.email || '').trim());
  const mxOk = web.filter((l) => String(l.email_valid || '').startsWith('ok:'));
  const scored = web.filter((l) => String(l.score).trim());
  const whatsapp = web.concat(noweb).filter((l) => String(l.whatsapp_ready).toLowerCase() === 'true');

  console.log('');
  console.log('  AXIOLYN LEAD SHEET');
  console.log('  ' + '='.repeat(64));
  console.log(`  Total leads            ${String(total).padStart(6)}`);
  console.log(`    with a website       ${String(web.length).padStart(6)}`);
  console.log(`    phone-only           ${String(noweb.length).padStart(6)}`);
  console.log('');
  console.log(`  Crawled                ${String(enriched.length).padStart(6)}  ${pct(enriched.length, web.length)}% of web leads`);
  console.log(`  Email found            ${String(withEmail.length).padStart(6)}  ${pct(withEmail.length, enriched.length)}% of crawled`);
  console.log(`  Email MX-verified      ${String(mxOk.length).padStart(6)}  ${pct(mxOk.length, enriched.length)}% of crawled`);
  console.log(`  Scored & ranked        ${String(scored.length + noweb.length).padStart(6)}`);
  console.log(`  Reachable on WhatsApp  ${String(whatsapp.length).padStart(6)}  ${pct(whatsapp.length, total)}% of all leads`);
  console.log(`  Awaiting crawl         ${String(web.length - enriched.length).padStart(6)}`);

  // Sweep progress
  const cursor = parseInt((state.find((r) => r.key === 'wf1_cursor') || {}).value || '0', 10);
  const doneP = pct(cursor, 126);
  console.log('');
  console.log(`  Sweep position         ${String(cursor).padStart(6)} / 126   ${bar(cursor, 126, 24).padEnd(24)} ${doneP}%`);

  // Where the leads are coming from
  const by = (list, key) => {
    const m = {};
    for (const l of list) { const k = String(l[key] || '(none)'); m[k] = (m[k] || 0) + 1; }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };

  console.log('');
  console.log('  BY CITY');
  const cities = by(web.concat(noweb), 'city');
  const cmax = cities[0] ? cities[0][1] : 1;
  cities.slice(0, 10).forEach(([k, v]) =>
    console.log(`    ${k.slice(0, 16).padEnd(18)}${String(v).padStart(5)}  ${bar(v, cmax, 26)}`));

  console.log('');
  console.log('  BY SERVICE FIT');
  const fits = by(web.filter((l) => String(l.score).trim()).concat(noweb), 'service_fit');
  const fmax = fits[0] ? fits[0][1] : 1;
  fits.slice(0, 10).forEach(([k, v]) =>
    console.log(`    ${(k || '(unscored)').slice(0, 24).padEnd(26)}${String(v).padStart(5)}  ${bar(v, fmax, 18)}`));

  // Score distribution — the thing that decides whether the sheet is useful
  console.log('');
  console.log('  SCORE DISTRIBUTION');
  const buckets = [[70, 100, 'strong   70+'], [55, 69, 'good   55-69'], [40, 54, 'fair   40-54'], [0, 39, 'weak    0-39']];
  const all = scored.concat(noweb).map((l) => Number(l.score)).filter((n) => !isNaN(n));
  const bmax = Math.max(...buckets.map(([lo, hi]) => all.filter((s) => s >= lo && s <= hi).length), 1);
  buckets.forEach(([lo, hi, label]) => {
    const n = all.filter((s) => s >= lo && s <= hi).length;
    console.log(`    ${label}  ${String(n).padStart(5)}  ${bar(n, bmax, 26)}`);
  });

  console.log('');
  console.log(`  TOP ${TOP} — your call list`);
  console.log('  ' + '-'.repeat(64));
  scored.slice().sort((a, b) => Number(b.score) - Number(a.score)).slice(0, TOP).forEach((l, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${String(l.score).padStart(3)}  ${String(l.company_name).slice(0, 34).padEnd(36)}${String(l.service_fit || '').slice(0, 20)}`);
    console.log(`          ${String(l.email || '(no email)').slice(0, 34).padEnd(36)}${l.phone_e164 || ''}`);
  });

  // Recent activity, so it is obvious whether the thing is actually running
  console.log('');
  console.log('  RECENT RUNS');
  runlog.slice(-6).forEach((r) => {
    const when = String(r.finished_at || '').slice(5, 16).replace('T', ' ');
    console.log(`    ${when}  ${String(r.workflow).padEnd(9)} found ${String(r.candidates_found).padStart(4)}  new ${String(r.new_leads).padStart(4)}  ${String(r.notes || '').slice(0, 42)}`);
  });
  console.log('');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
