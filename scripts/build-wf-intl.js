/**
 * Generates the three US/UK n8n workflows and writes them to workflows/.
 *
 *   node scripts/build-wf-intl.js
 *
 * These mirror WF1-WF3 (Pakistan) for the second market, built from the same
 * modules under workflows/src that `scripts/run-intl-pipeline.js` uses — so
 * what you see on the n8n canvas is the code that actually runs.
 *
 * Note on what these are for: GitHub Actions is the real scheduler, because an
 * n8n Schedule Trigger only fires while the machine is awake. These exist so
 * the pipeline can be inspected and edited visually, and run by hand.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
if (!cfg.sheetIntl || !cfg.sheetIntl.spreadsheetId) {
  console.error('config.json has no sheetIntl.spreadsheetId — run setup-intl-sheet.js first');
  process.exit(1);
}
const SHEET_ID = cfg.sheetIntl.spreadsheetId;
const sheetsCred = { googleApi: { id: cfg.n8n.credentialId, name: cfg.n8n.credentialName } };

const src = (f) => fs
  .readFileSync(path.join(ROOT, 'workflows', 'src', f), 'utf8')
  .replace(/module\.exports\s*=\s*\{[\s\S]*?\};\s*$/, '')
  // The modules require each other, which an n8n Code node cannot do; the
  // dependency is inlined instead.
  .replace(/^const \{[^}]*\} = require\(['"]\.\/[^'"]+['"]\);\s*$/gm, '');

const targetsSrc = src('targets-intl.js');
// normalize-intl requires this, and a Code node cannot require project files.
const businessTypeSrc = src('business-type.js');
const normalizeSrc = src('normalize-intl.js');
const phoneSrc = src('phone.js');
const extractSrc = src('extract-contacts.js');
const scoreSrc = src('score-intl.js');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BOT_UA = 'AxiolynLeadBot/1.0 (business research; contact via axiolyn.com)';

const MIRRORS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

function readTab(id, name, tab, position) {
  return {
    id, name, type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position,
    parameters: {
      authentication: 'serviceAccount', resource: 'sheet', operation: 'read',
      documentId: { __rl: true, mode: 'id', value: SHEET_ID },
      sheetName: { __rl: true, mode: 'name', value: tab },
      options: {},
    },
    credentials: sheetsCred,
    // Without this the node runs once per input item, turning a handful of
    // candidates into hundreds of API calls.
    executeOnce: true,
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
  };
}

function writeTab(id, name, tab, operation, position, matching) {
  const columns = operation === 'append'
    ? { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }
    : { mappingMode: 'autoMapInputData', value: {}, matchingColumns: matching || ['lead_id'], schema: [] };
  return {
    id, name, type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position,
    parameters: {
      authentication: 'serviceAccount', resource: 'sheet', operation,
      documentId: { __rl: true, mode: 'id', value: SHEET_ID },
      sheetName: { __rl: true, mode: 'name', value: tab },
      columns,
      // USER_ENTERED makes Sheets parse "+442079460958" as arithmetic and
      // store a number, destroying the leading plus.
      options: { cellFormat: 'RAW' },
    },
    credentials: sheetsCred,
    alwaysOutputData: true,
  };
}

function mirrorNode(i, url, position, queryExpr) {
  return {
    id: 'mirror' + i,
    name: `Overpass ${i + 1}`,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position,
    parameters: {
      method: 'POST', url, sendBody: true, contentType: 'form-urlencoded',
      bodyParameters: { parameters: [{ name: 'data', value: queryExpr }] },
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'User-Agent', value: BOT_UA }] },
      options: { timeout: 180000 },
    },
    // Overpass 504s under load; falling through to the next mirror is the point.
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 5000,
  };
}

const settings = {
  executionOrder: 'v1',
  timezone: 'Asia/Karachi',
  saveDataSuccessExecution: 'all',
  saveDataErrorExecution: 'all',
  availableInMCP: true,
};

// ------------------------------------------------------- WF4: discovery

const wf4 = {
  name: 'WF4 US/UK Discovery — Overpass',
  nodes: [
    {
      id: 'sched', name: 'Schedule Hourly', type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2, position: [-900, 0],
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '47 * * * *' }] } },
    },
    readTab('readState', 'Read _state', '_state', [-680, 0]),
    {
      id: 'cfg', name: 'Config', type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [-460, 0],
      parameters: {
        jsCode: [
          targetsSrc,
          '',
          '// --- n8n wrapper ---',
          '// The sweep alternates US and UK, so both tabs fill from the first run.',
          'let cursor = 0;',
          'try {',
          "  for (const item of $('Read _state').all()) {",
          '    const r = item.json || {};',
          "    if (String(r.key || '').trim() === 'intl_cursor') {",
          '      const n = parseInt(String(r.value).trim(), 10);',
          '      if (Number.isFinite(n)) cursor = n;',
          '    }',
          '  }',
          '} catch (e) { cursor = 0; }',
          '',
          'const t = atCursor(cursor);',
          'return [{ json: {',
          '  country: t.country, city: t.city, bbox: t.bbox,',
          '  category_key: t.categoryKey, cursor: t.index,',
          '  next_cursor: t.nextCursor, total_combinations: t.total,',
          '  overpass_query: t.query, source_query: t.sourceQuery,',
          '  run_id: String(Date.now()), started_at: new Date().toISOString(),',
          '} }];',
        ].join('\n'),
      },
    },
    {
      id: 'saveCursor', name: 'Advance Cursor', type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.7, position: [-240, 0],
      parameters: {
        authentication: 'serviceAccount', resource: 'sheet', operation: 'appendOrUpdate',
        documentId: { __rl: true, mode: 'id', value: SHEET_ID },
        sheetName: { __rl: true, mode: 'name', value: '_state' },
        columns: {
          mappingMode: 'defineBelow',
          value: { key: 'intl_cursor', value: '={{ $json.next_cursor }}', updated_at: '={{ $now.toISO() }}' },
          matchingColumns: ['key'], schema: [],
        },
        options: { cellFormat: 'RAW' },
      },
      credentials: sheetsCred,
      // Advance before querying: a combination that always fails must not block
      // the sweep forever.
      alwaysOutputData: true,
      onError: 'continueRegularOutput',
    },
    mirrorNode(0, MIRRORS[0], [-20, 0], "={{ $('Config').first().json.overpass_query }}"),
    mirrorNode(1, MIRRORS[1], [-20, 200], "={{ $('Config').first().json.overpass_query }}"),
    mirrorNode(2, MIRRORS[2], [-20, 400], "={{ $('Config').first().json.overpass_query }}"),
    {
      id: 'norm', name: 'Normalize', type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [220, 0],
      parameters: {
        jsCode: [
          phoneSrc, '', businessTypeSrc, '', normalizeSrc, '',
          '// --- n8n wrapper ---',
          "const cfg = $('Config').first().json;",
          'const payload = $input.first().json;',
          'const { rows, stats } = normalizeIntl(payload.elements || [], {',
          '  country: cfg.country, city: cfg.city, sourceQuery: cfg.source_query,',
          '});',
          'if (!rows.length) return [{ json: { __empty: true, stats } }];',
          "return rows.map(r => ({ json: Object.assign({}, r, { __empty: false }) }));",
        ].join('\n'),
      },
    },
    {
      id: 'gotData', name: 'Response Empty?', type: 'n8n-nodes-base.if',
      typeVersion: 2.2, position: [440, 0],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
          conditions: [{
            id: 'g1', leftValue: '={{ $json.__empty }}', rightValue: '',
            operator: { type: 'boolean', operation: 'true', singleValue: true },
          }],
          combinator: 'and',
        },
        options: {},
      },
    },
    { id: 'noop', name: 'Nothing Found', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [660, -200], parameters: {} },
    readTab('readUS', 'Read Leads_US', 'Leads_US', [660, 60]),
    readTab('readUK', 'Read Leads_UK', 'Leads_UK', [880, 60]),
    {
      id: 'dedup', name: 'Drop Already Known', type: 'n8n-nodes-base.code',
      typeVersion: 2, position: [1100, 60],
      parameters: {
        jsCode: [
          '// Both tabs are read once into one Set, so a business cannot be added',
          '// twice, and cannot appear in both countries.',
          'const known = new Set();',
          "for (const nodeName of ['Read Leads_US', 'Read Leads_UK']) {",
          '  let items = [];',
          '  try { items = $(nodeName).all(); } catch (e) { items = []; }',
          '  for (const it of items) {',
          '    const id = it.json && it.json.lead_id;',
          '    if (id) known.add(String(id).trim());',
          '  }',
          '}',
          "const fresh = $('Normalize').all().map(i => i.json)",
          '  .filter(j => !j.__empty && !known.has(j.lead_id));',
          'return fresh.map(j => ({ json: j }));',
        ].join('\n'),
      },
    },
    {
      id: 'routeCountry', name: 'Which Country?', type: 'n8n-nodes-base.if',
      typeVersion: 2.2, position: [1320, 60],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
          conditions: [{
            id: 'c1', leftValue: '={{ $json.country }}', rightValue: 'US',
            operator: { type: 'string', operation: 'equals' },
          }],
          combinator: 'and',
        },
        options: {},
      },
    },
    {
      id: 'shapeUS', name: 'Shape US Row', type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1540, -60],
      parameters: { jsCode: shapeRow() },
    },
    {
      id: 'shapeUK', name: 'Shape UK Row', type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1540, 180],
      parameters: { jsCode: shapeRow() },
    },
    writeTab('appendUS', 'Append Leads_US', 'Leads_US', 'append', [1760, -60]),
    writeTab('appendUK', 'Append Leads_UK', 'Leads_UK', 'append', [1760, 180]),
  ],
  connections: {
    'Schedule Hourly': { main: [[{ node: 'Read _state', type: 'main', index: 0 }]] },
    'Read _state': { main: [[{ node: 'Config', type: 'main', index: 0 }]] },
    Config: { main: [[{ node: 'Advance Cursor', type: 'main', index: 0 }]] },
    'Advance Cursor': { main: [[{ node: 'Overpass 1', type: 'main', index: 0 }]] },
    'Overpass 1': { main: [[{ node: 'Normalize', type: 'main', index: 0 }], [{ node: 'Overpass 2', type: 'main', index: 0 }]] },
    'Overpass 2': { main: [[{ node: 'Normalize', type: 'main', index: 0 }], [{ node: 'Overpass 3', type: 'main', index: 0 }]] },
    'Overpass 3': { main: [[{ node: 'Normalize', type: 'main', index: 0 }], [{ node: 'Nothing Found', type: 'main', index: 0 }]] },
    Normalize: { main: [[{ node: 'Response Empty?', type: 'main', index: 0 }]] },
    'Response Empty?': {
      main: [
        [{ node: 'Nothing Found', type: 'main', index: 0 }],
        [{ node: 'Read Leads_US', type: 'main', index: 0 }],
      ],
    },
    'Read Leads_US': { main: [[{ node: 'Read Leads_UK', type: 'main', index: 0 }]] },
    'Read Leads_UK': { main: [[{ node: 'Drop Already Known', type: 'main', index: 0 }]] },
    'Drop Already Known': { main: [[{ node: 'Which Country?', type: 'main', index: 0 }]] },
    'Which Country?': {
      main: [
        [{ node: 'Shape US Row', type: 'main', index: 0 }],
        [{ node: 'Shape UK Row', type: 'main', index: 0 }],
      ],
    },
    'Shape US Row': { main: [[{ node: 'Append Leads_US', type: 'main', index: 0 }]] },
    'Shape UK Row': { main: [[{ node: 'Append Leads_UK', type: 'main', index: 0 }]] },
  },
  settings,
};

function shapeRow() {
  return [
    '// Emit exactly the tab header order; the internal __ fields are dropped.',
    'return $input.all().map(({ json: j }) => ({ json: {',
    '  lead_id: j.lead_id, company_name: j.company_name,',
    '  website: j.website, normalized_domain: j.normalized_domain,',
    "  email: '', email_valid: '',",
    '  phone_e164: j.phone_e164, phone_type: j.phone_type,',
    '  city: j.city, country: j.country, category: j.category,',
    '  business_type: j.business_type,',
    "  service_fit: '', score: '', score_reasons: '', tech_detected: '',",
    '  source: j.source, date_found: j.date_found, last_seen: j.last_seen,',
    "  contact_status: '', notes: j.notes,",
    '} }));',
  ].join('\n');
}

// ------------------------------------------------------ WF5: enrichment

function enrichBranch(country, tab, yOffset) {
  const suffix = country === 'US' ? 'US' : 'UK';
  return {
    nodes: [
      readTab('read' + suffix, `Read ${tab}`, tab, [-460, yOffset]),
      {
        id: 'pick' + suffix, name: `Pick ${suffix} Backlog`,
        type: 'n8n-nodes-base.code', typeVersion: 2, position: [-240, yOffset],
        parameters: {
          jsCode: [
            '// email_valid doubles as the processed marker, so a site is',
            '// attempted once and never retried in a loop.',
            'const BATCH = 12;',
            'const todo = $input.all().map(i => i.json).filter(r =>',
            '  r.lead_id && String(r.normalized_domain || "").trim() &&',
            '  !String(r.email_valid || "").trim());',
            'if (!todo.length) return [];',
            'return todo.slice(0, BATCH).map(r => ({ json: {',
            '  lead_id: r.lead_id, domain: String(r.normalized_domain).trim(),',
            '  home_url: "https://" + String(r.normalized_domain).trim(),',
            '  contact_url: "https://" + String(r.normalized_domain).trim() + "/contact",',
            '} }));',
          ].join('\n'),
        },
      },
      fetchNode('home' + suffix, `Fetch ${suffix} Homepage`, '={{ $json.home_url }}', [-20, yOffset]),
      fetchNode('contact' + suffix, `Fetch ${suffix} Contact`,
        `={{ $('Pick ${suffix} Backlog').item.json.contact_url }}`, [200, yOffset]),
      {
        id: 'extract' + suffix, name: `Extract ${suffix}`,
        type: 'n8n-nodes-base.code', typeVersion: 2, position: [420, yOffset],
        parameters: {
          jsCode: [
            extractSrc, '',
            '// --- n8n wrapper ---',
            `const leads = $('Pick ${suffix} Backlog').all().map(i => i.json);`,
            `const homes = $('Fetch ${suffix} Homepage').all();`,
            `const contacts = $('Fetch ${suffix} Contact').all();`,
            'const bodyOf = (item) => {',
            '  if (!item || !item.json) return "";',
            '  const raw = typeof item.json === "string" ? item.json : (item.json.data || item.json.body || "");',
            '  return typeof raw === "string" ? raw : "";',
            '};',
            '',
            "const dnsmod = require('dns');",
            '// n8n resolves against 127.0.0.1 here, where nothing is listening,',
            '// so every lookup fails with ECONNREFUSED without this.',
            "try { dnsmod.setServers(['8.8.8.8','1.1.1.1']); } catch (e) {}",
            'const dns = dnsmod.promises;',
            'const mxCache = new Map();',
            'async function hasMx(d) {',
            '  if (mxCache.has(d)) return mxCache.get(d);',
            '  let ok = false;',
            '  try { const mx = await dns.resolveMx(d); ok = Array.isArray(mx) && mx.length > 0; }',
            '  catch (e) { try { const a = await dns.resolve4(d); ok = Array.isArray(a) && a.length > 0; } catch (e2) { ok = false; } }',
            '  mxCache.set(d, ok); return ok;',
            '}',
            '',
            'const out = [];',
            'for (let i = 0; i < leads.length; i++) {',
            '  const lead = leads[i];',
            '  const html = [bodyOf(homes[i]), bodyOf(contacts[i])].join("\\n");',
            '  if (!html.trim()) {',
            '    out.push({ json: { lead_id: lead.lead_id, email: "", email_valid: "fetch_failed",',
            '      tech_detected: "", last_seen: new Date().toISOString() } });',
            '    continue;',
            '  }',
            '  const r = extractFromPage(html, lead.domain);',
            '  const best = r.emails[0];',
            '  let verdict = "no_email_found";',
            '  if (best) {',
            '    const ok = await hasMx(String(best.email).split("@")[1] || "");',
            '    verdict = (ok ? "ok" : "nomx") + ":" + best.source + ":" + best.confidence;',
            '  }',
            '  out.push({ json: {',
            '    lead_id: lead.lead_id, email: best ? best.email : "",',
            '    email_valid: verdict, tech_detected: r.tech.join(","),',
            '    last_seen: new Date().toISOString(),',
            '  } });',
            '}',
            'return out;',
          ].join('\n'),
        },
        onError: 'continueRegularOutput',
      },
      writeTab('upd' + suffix, `Update ${tab}`, tab, 'update', [640, yOffset]),
    ],
    connections: {
      [`Read ${tab}`]: { main: [[{ node: `Pick ${suffix} Backlog`, type: 'main', index: 0 }]] },
      [`Pick ${suffix} Backlog`]: { main: [[{ node: `Fetch ${suffix} Homepage`, type: 'main', index: 0 }]] },
      [`Fetch ${suffix} Homepage`]: { main: [[{ node: `Fetch ${suffix} Contact`, type: 'main', index: 0 }]] },
      [`Fetch ${suffix} Contact`]: { main: [[{ node: `Extract ${suffix}`, type: 'main', index: 0 }]] },
      [`Extract ${suffix}`]: { main: [[{ node: `Update ${tab}`, type: 'main', index: 0 }]] },
    },
  };
}

function fetchNode(id, name, urlExpr, position) {
  return {
    id, name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position,
    parameters: {
      method: 'GET', url: urlExpr, sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'User-Agent', value: UA },
        { name: 'Accept', value: 'text/html,application/xhtml+xml' },
      ] },
      options: {
        timeout: 15000,
        redirect: { redirect: { followRedirects: true, maxRedirects: 3 } },
        response: { response: { neverError: true, responseFormat: 'text' } },
        // One request at a time with a gap, so a run never looks like a scrape.
        batching: { batch: { batchSize: 1, batchInterval: 1500 } },
      },
    },
    // A third of sites are dead; one bad host must not abort the batch.
    onError: 'continueRegularOutput',
    alwaysOutputData: true,
  };
}

const usBranch = enrichBranch('US', 'Leads_US', -180);
const ukBranch = enrichBranch('GB', 'Leads_UK', 220);

const wf5 = {
  name: 'WF5 US/UK Enrichment — contact details',
  nodes: [
    {
      id: 'sched', name: 'Schedule Every 2h', type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2, position: [-680, 20],
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '17 */2 * * *' }] } },
    },
    ...usBranch.nodes,
    ...ukBranch.nodes,
  ],
  connections: {
    'Schedule Every 2h': {
      main: [[
        { node: 'Read Leads_US', type: 'main', index: 0 },
        { node: 'Read Leads_UK', type: 'main', index: 0 },
      ]],
    },
    ...usBranch.connections,
    ...ukBranch.connections,
  },
  settings,
};

// --------------------------------------------------------- WF6: scoring

function scoreBranch(tab, suffix, y) {
  return {
    nodes: [
      readTab('rs' + suffix, `Read ${tab}`, tab, [-460, y]),
      {
        id: 'sc' + suffix, name: `Score ${suffix}`, type: 'n8n-nodes-base.code',
        typeVersion: 2, position: [-240, y],
        parameters: {
          jsCode: [
            scoreSrc, '',
            '// --- n8n wrapper ---',
            'const out = [];',
            'for (const item of $input.all()) {',
            '  const lead = item.json;',
            '  if (!lead.lead_id) continue;',
            '  const r = scoreIntlLead(lead);',
            '  // Leads whose site has not been crawled stay unscored, so the top',
            '  // of the sheet is the best known leads rather than the first ones.',
            '  if (r.pending) continue;',
            '  out.push({ json: { lead_id: lead.lead_id, score: r.score,',
            '    score_reasons: r.reasons, service_fit: r.service_fit } });',
            '}',
            'return out;',
          ].join('\n'),
        },
        alwaysOutputData: true,
      },
      writeTab('wr' + suffix, `Update ${tab}`, tab, 'update', [-20, y]),
    ],
    connections: {
      [`Read ${tab}`]: { main: [[{ node: `Score ${suffix}`, type: 'main', index: 0 }]] },
      [`Score ${suffix}`]: { main: [[{ node: `Update ${tab}`, type: 'main', index: 0 }]] },
    },
  };
}

const scUS = scoreBranch('Leads_US', 'US', -120);
const scUK = scoreBranch('Leads_UK', 'UK', 120);

const wf6 = {
  name: 'WF6 US/UK Scoring — rank the call list',
  nodes: [
    {
      id: 'sched', name: 'Schedule Hourly', type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2, position: [-680, 0],
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '55 * * * *' }] } },
    },
    ...scUS.nodes,
    ...scUK.nodes,
  ],
  connections: {
    'Schedule Hourly': {
      main: [[
        { node: 'Read Leads_US', type: 'main', index: 0 },
        { node: 'Read Leads_UK', type: 'main', index: 0 },
      ]],
    },
    ...scUS.connections,
    ...scUK.connections,
  },
  settings,
};

for (const [file, wf] of [
  ['wf4-intl-discovery.json', wf4],
  ['wf5-intl-enrichment.json', wf5],
  ['wf6-intl-scoring.json', wf6],
]) {
  const out = path.join(ROOT, 'workflows', file);
  fs.writeFileSync(out, JSON.stringify(wf, null, 2));
  console.log(`wrote workflows/${file}  (${wf.nodes.length} nodes)`);
}
