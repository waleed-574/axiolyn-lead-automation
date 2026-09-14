/**
 * Creates the seven tabs of the Axiolyn lead database with the exact headers
 * from the design spec, freezes each header row, and removes the default
 * "Sheet1".
 *
 *   node scripts/setup-sheet.js <path-to-service-account.json> <spreadsheetId>
 *
 * Idempotent: tabs that already exist are left alone, and their headers are
 * rewritten to match the spec. Existing data rows are never touched.
 */
const fs = require('fs');
const crypto = require('crypto');

const KEY_PATH = process.argv[2];
const SHEET_ID = process.argv[3];

if (!KEY_PATH || !SHEET_ID) {
  console.error('usage: node scripts/setup-sheet.js <key.json> <spreadsheetId>');
  process.exit(1);
}

// Headers are the contract between workflows. WF1 writes raw_candidates, WF2
// reads it and writes enriched, WF3 reads that and writes Leads/Leads_NoWeb.
const TABS = {
  Leads: [
    'lead_id', 'company_name', 'website', 'normalized_domain',
    'email', 'email_valid', 'phone_e164', 'whatsapp_ready',
    'city', 'country', 'region', 'industry', 'service_fit',
    'score', 'score_reasons', 'tech_detected', 'hiring_signal',
    'source', 'date_found', 'last_seen', 'contact_status',
    'ai_summary', 'notes',
  ],
  Leads_NoWeb: [
    'lead_id', 'company_name', 'phone_e164', 'whatsapp_ready',
    'address', 'city', 'country', 'region', 'category',
    'score', 'score_reasons', 'source', 'date_found', 'last_seen',
    'contact_status', 'notes',
  ],
  raw_candidates: [
    'candidate_id', 'company_name', 'website', 'phone_raw', 'address',
    'city', 'country', 'region', 'category', 'source', 'source_query',
    'discovered_at', 'status',
  ],
  enriched: [
    'candidate_id', 'company_name', 'website', 'normalized_domain',
    'email', 'email_valid', 'phone_e164', 'whatsapp_ready',
    'city', 'country', 'region', 'category', 'tech_detected',
    'contact_page_url', 'enriched_at', 'status', 'error',
  ],
  _state: ['key', 'value', 'updated_at'],
  _suppression: ['match_value', 'match_type', 'reason', 'added_at'],
  _runlog: [
    'run_id', 'workflow', 'started_at', 'finished_at',
    'candidates_found', 'new_leads', 'errors', 'notes',
  ],
};

function b64url(o) {
  return Buffer.from(typeof o === 'string' ? o : JSON.stringify(o))
    .toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getToken() {
  const j = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
    iss: j.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(input);
  const sig = signer.sign(j.private_key)
    .toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${input}.${sig}`,
    }),
  });
  const t = await res.json();
  if (!t.access_token) throw new Error(`token exchange failed: ${JSON.stringify(t)}`);
  return t.access_token;
}

async function api(token, path, method = 'GET', body) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json.error || json)}`);
  }
  return json;
}

(async () => {
  const token = await getToken();

  const meta = await api(token, `/${SHEET_ID}?fields=sheets.properties`);
  const existing = new Map(meta.sheets.map((s) => [s.properties.title, s.properties.sheetId]));

  // 1. Create any missing tabs.
  const toCreate = Object.keys(TABS).filter((t) => !existing.has(t));
  if (toCreate.length) {
    await api(token, `/${SHEET_ID}:batchUpdate`, 'POST', {
      requests: toCreate.map((title) => ({
        addSheet: {
          properties: {
            title,
            gridProperties: {
              rowCount: 1000,
              columnCount: TABS[title].length,
              frozenRowCount: 1,
            },
          },
        },
      })),
    });
    console.log(`created  : ${toCreate.join(', ')}`);
  } else {
    console.log('created  : (none needed)');
  }

  // 2. Write headers. Done for every tab, not just new ones, so the sheet can
  //    be brought back in line with the spec after a schema change.
  await api(token, `/${SHEET_ID}/values:batchUpdate`, 'POST', {
    valueInputOption: 'RAW',
    data: Object.entries(TABS).map(([title, headers]) => ({
      range: `${title}!A1`,
      values: [headers],
    })),
  });
  console.log('headers  : written to all 7 tabs');

  // 3. Style header rows, and freeze them on tabs that already existed.
  const after = await api(token, `/${SHEET_ID}?fields=sheets.properties`);
  const ids = new Map(after.sheets.map((s) => [s.properties.title, s.properties.sheetId]));

  await api(token, `/${SHEET_ID}:batchUpdate`, 'POST', {
    requests: Object.keys(TABS).flatMap((title) => {
      const sheetId = ids.get(title);
      return [
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          },
        },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
                backgroundColor: { red: 0.85, green: 0.89, blue: 0.86 },
              },
            },
            fields: 'userEnteredFormat(textFormat,backgroundColor)',
          },
        },
      ];
    }),
  });
  console.log('format   : header rows frozen and bolded');

  // 4. Drop the default Sheet1, but only if it is genuinely empty.
  if (ids.has('Sheet1')) {
    const vals = await api(token, `/${SHEET_ID}/values/Sheet1!A1:Z10`);
    if (!vals.values || vals.values.length === 0) {
      await api(token, `/${SHEET_ID}:batchUpdate`, 'POST', {
        requests: [{ deleteSheet: { sheetId: ids.get('Sheet1') } }],
      });
      console.log('cleanup  : removed default Sheet1');
    } else {
      console.log('cleanup  : Sheet1 left in place (it has data)');
    }
  }

  // 5. Report what is actually there now.
  const final = await api(token, `/${SHEET_ID}?fields=sheets.properties.title`);
  console.log('');
  console.log('final tabs:');
  for (const s of final.sheets) console.log('  -', s.properties.title);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
