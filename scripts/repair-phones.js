/**
 * Repairs phone_e164 values that Google Sheets stored as numbers.
 *
 * The workflow originally appended with valueInputOption USER_ENTERED, so
 * "+923001234567" was parsed as arithmetic and stored as 923001234567 — the
 * leading + silently destroyed. The workflow now writes RAW; this fixes rows
 * written before that change.
 *
 *   node scripts/repair-phones.js <key.json> <spreadsheetId>
 */
const fs = require('fs');
const crypto = require('crypto');

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

/** Put back the country prefix a numeric coercion stripped. */
function restore(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (s.startsWith('+')) return s;                 // already fine
  if (/^92\d{9,10}$/.test(s)) return '+' + s;      // lost its plus
  return s;                                        // leave anything unexpected alone
}

(async () => {
  const token = await getToken();
  // phone_e164 is column G in Leads and column C in Leads_NoWeb.
  const targets = [
    { tab: 'Leads', col: 'G' },
    { tab: 'Leads_NoWeb', col: 'C' },
  ];

  for (const { tab, col } of targets) {
    const range = `${tab}!${col}2:${col}1000`;
    const cur = await api(token, `/${SHEET_ID}/values/${encodeURIComponent(range)}`);
    const rows = cur.values || [];
    if (!rows.length) { console.log(`${tab}: no phone values`); continue; }

    const fixedRows = rows.map(r => [restore(r[0])]);
    const changed = fixedRows.filter((r, i) => r[0] !== String(rows[i][0] == null ? '' : rows[i][0])).length;

    await api(
      token,
      `/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      'PUT',
      { range, majorDimension: 'ROWS', values: fixedRows }
    );
    console.log(`${tab.padEnd(14)} ${rows.length} phone cells, ${changed} repaired`);
  }

  // Confirm
  const check = await api(token, `/${SHEET_ID}/values:batchGet?ranges=Leads!G2:G&ranges=Leads_NoWeb!C2:C`);
  console.log('');
  for (const vr of check.valueRanges) {
    const tab = vr.range.split('!')[0].replace(/'/g, '');
    const vals = (vr.values || []).map(v => v[0]).filter(Boolean);
    const ok = vals.filter(v => /^\+92\d{9,10}$/.test(String(v))).length;
    console.log(`${tab.padEnd(14)} ${ok}/${vals.length} phones now valid E.164`);
    console.log('   sample: ' + vals.slice(0, 3).join(', '));
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
