/**
 * Proves the dedup logic is idempotent, using the captured fixture as a fixed
 * input and the live sheet as the known-set.
 *
 * Running the workflow twice cannot prove this on its own: the two runs hit
 * different Overpass mirrors and got marginally different data (39 vs 40
 * businesses), so a differing row count says nothing about the dedup. Holding
 * the input constant isolates the logic under test.
 *
 *   node scripts/test-idempotency.js <key.json> <spreadsheetId>
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeOverpass } = require('../workflows/src/normalize-overpass');

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

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`}`);
  if (!ok) failed++;
}

(async () => {
  const token = await getToken();
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet` +
    `?ranges=${encodeURIComponent('Leads!A:A')}&ranges=${encodeURIComponent('Leads_NoWeb!A:A')}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const body = await res.json();

  // Mirrors the "Drop Already Known" node: read both tabs once into one Set.
  const known = new Set();
  for (const vr of body.valueRanges) {
    for (const row of (vr.values || []).slice(1)) {
      if (row[0]) known.add(String(row[0]).trim());
    }
  }
  console.log(`known lead_ids in sheet: ${known.size}`);
  console.log('');

  const fixture = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'overpass-lahore-healthcare.json'), 'utf8'));

  const opts = { city: 'Lahore', sourceQuery: 'fixture', now: '2026-09-14T00:00:00.000Z' };

  console.log('pass 1 — fixture against live sheet state');
  const a = normalizeOverpass(fixture.elements, opts);
  const newA = a.rows.filter(r => !known.has(r.lead_id));
  console.log(`  normalised ${a.rows.length}, of which new: ${newA.length}`);
  if (newA.length) newA.slice(0, 5).forEach(r => console.log(`    would append: ${r.company_name}`));
  check('every fixture lead is already known — nothing to append', newA.length, 0);

  console.log('');
  console.log('pass 2 — same input again');
  const b = normalizeOverpass(fixture.elements, opts);
  const newB = b.rows.filter(r => !known.has(r.lead_id));
  check('second pass also appends nothing', newB.length, 0);
  check('both passes produce identical lead_ids',
    b.rows.map(r => r.lead_id).join(), a.rows.map(r => r.lead_id).join());

  console.log('');
  console.log('sheet integrity');
  const allIds = [];
  for (const vr of body.valueRanges) {
    for (const row of (vr.values || []).slice(1)) if (row[0]) allIds.push(String(row[0]).trim());
  }
  check('no duplicate lead_id anywhere in the sheet', allIds.length, new Set(allIds).size);
  check('every stored lead_id is 40-char hex', allIds.every(i => /^[0-9a-f]{40}$/.test(i)), true);

  console.log('');
  console.log(failed === 0 ? 'IDEMPOTENCY PROVEN' : `${failed} CHECK(S) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
