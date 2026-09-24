/**
 * Snapshot of the US/UK lead sheet, per country.
 *
 *   node scripts/sheet-stats-intl.js [--top=8]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { Sheet } = require(path.join(ROOT, 'workflows/src/sheets'));
const { combinations } = require(path.join(ROOT, 'workflows/src/targets-intl'));

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=')[1] : d;
};
const TOP = parseInt(arg('top', '8'), 10);

function sheetId() {
  if (process.env.SHEET_ID_INTL) return process.env.SHEET_ID_INTL;
  const p = path.join(ROOT, 'config.json');
  if (fs.existsSync(p)) {
    const c = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (c.sheetIntl) return c.sheetIntl.spreadsheetId;
  }
  throw new Error('Set SHEET_ID_INTL or add sheetIntl to config.json');
}

const bar = (n, max, w) => '█'.repeat(Math.max(0, Math.round((n / (max || 1)) * (w || 22))));
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

(async () => {
  const sheet = await Sheet.open(sheetId(), process.env.GOOGLE_SERVICE_ACCOUNT_FILE);
  const state = (await sheet.readObjects('_state')).rows;
  const runlog = (await sheet.readObjects('_runlog')).rows;

  console.log('');
  console.log('  AXIOLYN LEADS — US & UK');
  console.log('  ' + '='.repeat(62));

  let grand = 0;
  for (const [label, tab] of [['UNITED STATES', 'Leads_US'], ['UNITED KINGDOM', 'Leads_UK']]) {
    const { rows } = await sheet.readObjects(tab);
    grand += rows.length;
    const web = rows.filter((l) => String(l.normalized_domain || '').trim());
    const crawled = rows.filter((l) => String(l.email_valid || '').trim());
    const mxOk = rows.filter((l) => String(l.email_valid || '').startsWith('ok:'));
    const scored = rows.filter((l) => String(l.score).trim());

    console.log('');
    console.log(`  ${label}  (${tab})`);
    console.log(`    leads            ${String(rows.length).padStart(5)}`);
    console.log(`    with a website   ${String(web.length).padStart(5)}`);
    console.log(`    crawled          ${String(crawled.length).padStart(5)}  ${pct(crawled.length, web.length)}% of web leads`);
    console.log(`    verified email   ${String(mxOk.length).padStart(5)}`);
    console.log(`    scored           ${String(scored.length).padStart(5)}`);

    if (scored.length) {
      console.log('');
      console.log(`    top ${Math.min(TOP, scored.length)}:`);
      scored.slice().sort((a, b) => Number(b.score) - Number(a.score)).slice(0, TOP).forEach((l) => {
        console.log(`      ${String(l.score).padStart(3)}  ${String(l.company_name).slice(0, 30).padEnd(32)}${String(l.email || '-').slice(0, 30)}`);
        console.log(`           ${String(l.phone_e164 || '').padEnd(18)}${String(l.service_fit || '').slice(0, 24)}`);
      });
    }
  }

  const cursor = parseInt((state.find((r) => r.key === 'intl_cursor') || {}).value || '0', 10);
  const total = combinations().length;
  console.log('');
  console.log('  ' + '-'.repeat(62));
  console.log(`  TOTAL LEADS      ${String(grand).padStart(5)}`);
  console.log(`  sweep position   ${String(cursor).padStart(5)} / ${total}   ${bar(cursor, total, 20)} ${pct(cursor, total)}%`);

  console.log('');
  console.log('  RECENT RUNS');
  runlog.slice(-5).forEach((r) => {
    const when = String(r.finished_at || '').slice(5, 16).replace('T', ' ');
    console.log(`    ${when}  ${String(r.workflow).padEnd(14)} found ${String(r.candidates_found).padStart(4)}  new ${String(r.new_leads).padStart(4)}  ${String(r.notes || '').slice(0, 40)}`);
  });
  console.log('');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
