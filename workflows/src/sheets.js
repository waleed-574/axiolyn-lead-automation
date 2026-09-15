/**
 * Minimal Google Sheets client backed by a service account.
 *
 * No dependencies on purpose — this runs in GitHub Actions on a bare Node
 * image, and the whole project is meant to stay installable with nothing but
 * Node itself.
 */
const fs = require('fs');
const crypto = require('crypto');

const b64url = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o))
  .toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

/**
 * Loads the service account key from the environment (GitHub Actions secret)
 * or from a local file path (development).
 */
function loadKey(explicitPath) {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (inline && inline.trim().startsWith('{')) return JSON.parse(inline);
  const p = explicitPath || process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  if (!p) throw new Error('No service account key: set GOOGLE_SERVICE_ACCOUNT_JSON or pass a file path');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function getToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(input);
  const sig = signer.sign(key.private_key)
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
  if (!t.access_token) throw new Error('token exchange failed: ' + JSON.stringify(t));
  return t.access_token;
}

class Sheet {
  constructor(spreadsheetId, token) {
    this.id = spreadsheetId;
    this.token = token;
  }

  static async open(spreadsheetId, keyPath) {
    const key = loadKey(keyPath);
    return new Sheet(spreadsheetId, await getToken(key));
  }

  async api(path, method = 'GET', body) {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json.error || json).slice(0, 300)}`);
    }
    return json;
  }

  /** Whole tab as objects keyed by header. */
  async readObjects(tab) {
    const r = await this.api(`/${this.id}/values/${encodeURIComponent(tab)}`);
    const [hdr, ...rows] = r.values || [];
    if (!hdr) return { header: [], rows: [] };
    const objects = rows.map((row, i) => {
      const o = Object.fromEntries(hdr.map((h, j) => [h, row[j] == null ? '' : row[j]]));
      o.__row = i + 2; // 1-based, and row 1 is the header
      return o;
    });
    return { header: hdr, rows: objects };
  }

  /** Append rows, ordered to match the tab's existing header. */
  async appendObjects(tab, header, objects) {
    if (!objects.length) return 0;
    const values = objects.map((o) => header.map((h) => (o[h] == null ? '' : o[h])));
    await this.api(
      `/${this.id}/values/${encodeURIComponent(tab)}:append` +
      '?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
      'POST',
      { values }
    );
    return values.length;
  }

  /**
   * Update specific columns on rows matched by a key column.
   *
   * Written as one batch of per-cell ranges rather than a read-modify-write of
   * whole rows, so a concurrent edit to a column we do not touch — a human
   * typing in contact_status — is never clobbered.
   */
  async updateByKey(tab, keyColumn, updates) {
    if (!updates.length) return 0;
    const { header, rows } = await this.readObjects(tab);
    if (!header.length) return 0;

    const rowOf = new Map();
    for (const r of rows) {
      const k = String(r[keyColumn] || '').trim();
      if (k) rowOf.set(k, r.__row);
    }

    const colLetter = (i) => {
      let s = '';
      for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) {
        s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
      }
      return s;
    };

    const data = [];
    for (const u of updates) {
      const row = rowOf.get(String(u[keyColumn] || '').trim());
      if (!row) continue;
      for (const [field, value] of Object.entries(u)) {
        if (field === keyColumn) continue;
        const idx = header.indexOf(field);
        if (idx < 0) continue;
        const a1 = `${tab}!${colLetter(idx)}${row}`;
        data.push({ range: a1, values: [[value == null ? '' : value]] });
      }
    }
    if (!data.length) return 0;

    // Sheets caps a batch; send in chunks so a large re-score still succeeds.
    const CHUNK = 500;
    for (let i = 0; i < data.length; i += CHUNK) {
      await this.api(`/${this.id}/values:batchUpdate`, 'POST', {
        valueInputOption: 'RAW',
        data: data.slice(i, i + CHUNK),
      });
    }
    return data.length;
  }

  /** Read a single key/value pair from the _state tab. */
  async getState(key, fallback) {
    const { rows } = await this.readObjects('_state');
    const hit = rows.find((r) => String(r.key || '').trim() === key);
    return hit ? hit.value : fallback;
  }

  async setState(key, value) {
    const { header, rows } = await this.readObjects('_state');
    const hit = rows.find((r) => String(r.key || '').trim() === key);
    const now = new Date().toISOString();
    if (hit) {
      await this.updateByKey('_state', 'key', [{ key, value: String(value), updated_at: now }]);
    } else {
      await this.appendObjects('_state', header.length ? header : ['key', 'value', 'updated_at'],
        [{ key, value: String(value), updated_at: now }]);
    }
  }

  async appendRunLog(entry) {
    const { header } = await this.readObjects('_runlog');
    const cols = header.length
      ? header
      : ['run_id', 'workflow', 'started_at', 'finished_at', 'candidates_found', 'new_leads', 'errors', 'notes'];
    await this.appendObjects('_runlog', cols, [entry]);
  }
}

module.exports = { Sheet, loadKey, getToken };
