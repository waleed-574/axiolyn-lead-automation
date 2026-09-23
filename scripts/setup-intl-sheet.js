/**
 * Creates the US/UK lead spreadsheet and hands ownership-level access to the
 * human who will actually use it.
 *
 *   node scripts/setup-intl-sheet.js <key.json> <owner-email>
 *
 * A service account creating a spreadsheet owns it in its own Drive, where
 * nobody can see it — so the file is explicitly shared with the real account
 * afterwards. Re-running is safe: pass an existing id as a third argument to
 * only refresh the tabs and headers.
 */
const fs = require('fs');
const crypto = require('crypto');

const KEY_PATH = process.argv[2];
const OWNER = process.argv[3];
const EXISTING = process.argv[4];

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o))
  .toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

// One list per country, both website-bearing and phone-only leads together —
// deliberately simpler than the Pakistan sheet's two-track split.
const LEAD_COLUMNS = [
  'lead_id', 'company_name', 'website', 'normalized_domain',
  'email', 'email_valid', 'phone_e164', 'phone_type',
  'city', 'country', 'category', 'service_fit',
  'score', 'score_reasons', 'tech_detected',
  'source', 'date_found', 'last_seen', 'contact_status', 'notes',
];

const TABS = {
  Leads_US: LEAD_COLUMNS,
  Leads_UK: LEAD_COLUMNS,
  _state: ['key', 'value', 'updated_at'],
  _runlog: ['run_id', 'workflow', 'started_at', 'finished_at',
            'candidates_found', 'new_leads', 'errors', 'notes'],
};

async function getToken(key, scopes) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email, scope: scopes,
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`;
  const s = crypto.createSign('RSA-SHA256');
  s.update(input);
  const sig = s.sign(key.private_key).toString('base64')
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
  if (!t.access_token) throw new Error('token: ' + JSON.stringify(t));
  return t.access_token;
}

async function call(token, url, method = 'GET', body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${JSON.stringify(json.error || json).slice(0, 300)}`);
  return json;
}

(async () => {
  const key = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  const token = await getToken(key,
    'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive');

  let id = EXISTING;
  if (!id) {
    const created = await call(token, 'https://sheets.googleapis.com/v4/spreadsheets', 'POST', {
      properties: { title: 'Axiolyn Leads — US & UK' },
      sheets: Object.keys(TABS).map((title) => ({
        properties: {
          title,
          gridProperties: { rowCount: 5000, columnCount: TABS[title].length, frozenRowCount: 1 },
        },
      })),
    });
    id = created.spreadsheetId;
    console.log('created spreadsheet:', id);
  } else {
    console.log('using existing spreadsheet:', id);
  }

  // Headers on every tab.
  await call(token,
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, 'POST', {
      valueInputOption: 'RAW',
      data: Object.entries(TABS).map(([title, cols]) => ({
        range: `${title}!A1`, values: [cols],
      })),
    });
  console.log('headers written to', Object.keys(TABS).length, 'tabs');

  // Freeze and bold the header rows.
  const meta = await call(token,
    `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties`);
  const ids = new Map(meta.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
  await call(token, `https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, 'POST', {
    requests: Object.keys(TABS).flatMap((title) => {
      const sheetId = ids.get(title);
      if (sheetId == null) return [];
      return [
        { updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount' } },
        { repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: {
              textFormat: { bold: true },
              backgroundColor: { red: 0.85, green: 0.89, blue: 0.86 } } },
            fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
      ];
    }),
  });
  console.log('header rows frozen and bolded');

  // Hand it to the human. Without this it sits invisibly in the service
  // account's own Drive.
  if (OWNER) {
    await call(token,
      `https://www.googleapis.com/drive/v3/files/${id}/permissions?sendNotificationEmail=false`,
      'POST', { role: 'writer', type: 'user', emailAddress: OWNER });
    // Ownership transfer needs the recipient to accept, so request it rather
    // than assume; writer access already makes the sheet fully usable.
    try {
      await call(token,
        `https://www.googleapis.com/drive/v3/files/${id}/permissions?transferOwnership=true&sendNotificationEmail=true`,
        'POST', { role: 'owner', type: 'user', emailAddress: OWNER });
      console.log('ownership transferred to', OWNER);
    } catch (e) {
      console.log('shared with', OWNER, 'as editor (ownership transfer not permitted:',
        String(e.message).slice(0, 80) + ')');
    }
  }

  console.log('');
  console.log('URL: https://docs.google.com/spreadsheets/d/' + id + '/edit');
  console.log('id :', id);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
