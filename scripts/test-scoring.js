/**
 * Dry-runs the scoring model against the live sheet and prints the ranking it
 * would produce. Writes nothing — the point is to judge the ordering before
 * committing it.
 *
 *   node scripts/test-scoring.js <key.json> <spreadsheetId>
 */
const fs = require('fs');
const crypto = require('crypto');
const { scoreWebLead, scoreNoWebLead } = require('../workflows/src/score-leads');

const KEY_PATH = process.argv[2];
const SHEET_ID = process.argv[3];

const b64url = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o))
  .toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

async function getToken() {
  const j = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
    iss: j.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  })}`;
  const s = crypto.createSign('RSA-SHA256');
  s.update(input);
  const sig = s.sign(j.private_key).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${input}.${sig}`,
    }),
  });
  const t = await res.json();
  if (!t.access_token) throw new Error(JSON.stringify(t));
  return t.access_token;
}

/** Sheet rows arrive as arrays; turn them into objects keyed by header. */
function toObjects(values) {
  const [hdr, ...rows] = values || [];
  if (!hdr) return [];
  return rows.map((r) => Object.fromEntries(hdr.map((h, i) => [h, r[i] == null ? '' : r[i]])));
}

(async () => {
  const token = await getToken();
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet` +
    `?ranges=${encodeURIComponent('Leads!A:W')}&ranges=${encodeURIComponent('Leads_NoWeb!A:P')}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const body = await res.json();
  const web = toObjects(body.valueRanges[0].values);
  const noweb = toObjects(body.valueRanges[1].values);

  const scoredWebAll = web.map((l) => ({ ...l, ...scoreWebLead(l) }));
  const pending = scoredWebAll.filter((l) => l.pending).length;
  const scoredWeb = scoredWebAll.filter((l) => !l.pending);
  console.log('web leads awaiting enrichment (unscored):', pending);
  const scoredNoWeb = noweb.map((l) => ({ ...l, ...scoreNoWebLead(l) }));

  const show = (title, list, n) => {
    console.log(`\n=== ${title} — top ${n} of ${list.length} ===`);
    list.slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
      .forEach((l) => {
        console.log(`  ${String(l.score).padStart(3)}  ${String(l.company_name).slice(0, 34).padEnd(36)}${String(l.service_fit).slice(0, 22)}`);
        console.log(`       ${l.reasons}`);
      });
  };

  show('WEB LEADS', scoredWeb, 10);
  show('NO-WEBSITE LEADS', scoredNoWeb, 6);

  console.log('\n=== bottom of the web list (sanity check) ===');
  scoredWeb.slice().sort((a, b) => a.score - b.score).slice(0, 5).forEach((l) => {
    console.log(`  ${String(l.score).padStart(3)}  ${String(l.company_name).slice(0, 34).padEnd(36)}`);
    console.log(`       ${l.reasons}`);
  });

  const dist = (list) => {
    const b = { '0-29': 0, '30-49': 0, '50-69': 0, '70-100': 0 };
    for (const l of list) {
      if (l.score < 30) b['0-29']++;
      else if (l.score < 50) b['30-49']++;
      else if (l.score < 70) b['50-69']++;
      else b['70-100']++;
    }
    return b;
  };
  console.log('\n=== distribution ===');
  console.log('  web    :', JSON.stringify(dist(scoredWeb)));
  console.log('  no-web :', JSON.stringify(dist(scoredNoWeb)));

  const verticals = {};
  for (const l of [...scoredWeb, ...scoredNoWeb]) {
    verticals[l.service_fit] = (verticals[l.service_fit] || 0) + 1;
  }
  console.log('\n=== service fit ===');
  Object.entries(verticals).sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
