/**
 * Clears the enrichment marker on leads that did not yield an email, so WF2
 * will attempt them again. Leads with a found email are left alone.
 *
 *   node scripts/reset-enrichment.js <key.json> <spreadsheetId> [--all]
 *
 * --all clears every marker, including successful ones.
 */
const fs = require('fs');
const crypto = require('crypto');

const KEY_PATH = process.argv[2];
const SHEET_ID = process.argv[3];
const ALL = process.argv.includes('--all');

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

async function api(token, path, method = 'GET', body) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json.error || json)}`);
  return json;
}

(async () => {
  const token = await getToken();
  // E = email, F = email_valid. Both are cleared together: clearing only the
  // verdict leaves a row showing an address with no verdict behind it, which
  // reads as a pipeline bug when it is only a half-finished reset.
  const range = 'Leads!E2:F1000';
  const cur = await api(token, `/${SHEET_ID}/values/${encodeURIComponent(range)}`);
  const rows = cur.values || [];
  if (!rows.length) { console.log('nothing to reset'); return; }

  let cleared = 0;
  const next = rows.map((r) => {
    const email = String(r[0] == null ? '' : r[0]);
    const verdict = String(r[1] == null ? '' : r[1]).trim();
    if (!verdict && !email) return ['', ''];
    const isFailure = verdict === 'no_email_found' || verdict === 'fetch_failed';
    if (ALL || isFailure || (email && !verdict)) { cleared++; return ['', '']; }
    return [email, verdict];
  });

  await api(
    token,
    `/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    'PUT',
    { range, majorDimension: 'ROWS', values: next }
  );

  const remaining = next.filter((r) => r[1]).length;
  console.log(`cleared ${cleared} lead(s)${ALL ? ' (all)' : ' (failures and half-written rows)'}`);
  console.log(`${remaining} lead(s) still marked as enriched`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
