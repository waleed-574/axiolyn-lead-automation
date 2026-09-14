/**
 * Generates the WF1 Discovery workflow JSON and writes it to workflows/.
 *
 * The normaliser Code node body is assembled from
 * workflows/src/normalize-overpass.js, so the code that ships is the same code
 * scripts/test-normalize.js verifies. Re-run this after changing the source:
 *
 *   node scripts/build-wf1.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const SHEET_ID = cfg.sheet.spreadsheetId;
const CRED = { id: cfg.n8n.credentialId, name: cfg.n8n.credentialName };

// Strip the module.exports tail — n8n Code nodes have no module system.
const normalizerSource = fs
  .readFileSync(path.join(ROOT, 'workflows', 'src', 'normalize-overpass.js'), 'utf8')
  .replace(/module\.exports\s*=\s*\{[\s\S]*?\};\s*$/, '');

/**
 * Mirrors must serve the whole planet. overpass.osm.ch is deliberately absent:
 * it is a Switzerland-only instance that answers Pakistani queries with HTTP
 * 200 and zero elements in about a second. That is worse than an error — the
 * run would look successful, append nothing, and log nothing.
 *
 * The "Got Data?" guard downstream catches this class of failure generally,
 * for any mirror that returns an empty success.
 */
const MIRRORS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const sheetsCred = { googleApi: CRED };

/** A Google Sheets read node that still emits an item when the tab is empty. */
function readTab(id, name, tab, position) {
  return {
    id,
    name,
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.7,
    position,
    parameters: {
      authentication: 'serviceAccount',
      resource: 'sheet',
      operation: 'read',
      documentId: { __rl: true, mode: 'id', value: SHEET_ID },
      sheetName: { __rl: true, mode: 'name', value: tab },
      options: {},
    },
    credentials: sheetsCred,
    // Without executeOnce this node runs once PER INPUT ITEM. 39 candidates
    // became 39 reads of Leads (546 items), then 546 reads of Leads_NoWeb
    // (13,650 items) — hundreds of pointless Sheets API calls, and a
    // guaranteed rate-limit failure once the sheet is large.
    executeOnce: true,
    // An empty tab returns zero items, which would halt the branch. The dedup
    // node reads via $() references, so an empty passthrough is enough.
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
  };
}

function appendTab(id, name, tab, position) {
  return {
    id,
    name,
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.7,
    position,
    parameters: {
      authentication: 'serviceAccount',
      resource: 'sheet',
      operation: 'append',
      documentId: { __rl: true, mode: 'id', value: SHEET_ID },
      sheetName: { __rl: true, mode: 'name', value: tab },
      columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] },
      // USER_ENTERED (the default) makes Sheets reinterpret values as it would
      // typed input: "+923001234567" is parsed as arithmetic and stored as the
      // number 923001234567, silently destroying the phone number. RAW writes
      // exactly what we send.
      options: { cellFormat: 'RAW' },
    },
    credentials: sheetsCred,
    alwaysOutputData: true,
  };
}

/** One HTTP node per mirror; each falls through to the next on failure. */
function mirrorNode(i, url, position) {
  return {
    id: 'mirror' + i,
    name: `Overpass ${i + 1}`,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position,
    parameters: {
      method: 'POST',
      url,
      sendBody: true,
      contentType: 'form-urlencoded',
      bodyParameters: {
        parameters: [{ name: 'data', value: '={{ $json.overpass_query }}' }],
      },
      sendHeaders: true,
      headerParameters: {
        parameters: [{
          name: 'User-Agent',
          value: 'AxiolynLeadBot/1.0 (business research; contact via axiolyn.com)',
        }],
      },
      options: { timeout: 120000, response: { response: { neverError: false } } },
    },
    // Overpass 504s under load. Falling through to the next mirror is the
    // whole point, so a failure must not stop the run.
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 5000,
  };
}

const nodes = [
  {
    id: 'sched',
    name: 'Schedule 5am PKT',
    type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2,
    position: [-640, 0],
    parameters: {
      rule: { interval: [{ field: 'cronExpression', expression: '0 5 * * *' }] },
    },
  },
  {
    id: 'cfg',
    name: 'Config',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-420, 0],
    parameters: {
      jsCode: [
        '// One small query per run. Big multi-category queries get 504d by the',
        '// public Overpass instances, and a failure would cost the whole run.',
        "const CITY = { name: 'Lahore', bbox: '31.35,74.15,31.65,74.50' };",
        "const AMENITIES = 'clinic|doctors|dentist|hospital|pharmacy';",
        '',
        'const query = `[out:json][timeout:90];',
        '(',
        '  node["amenity"~"^(${AMENITIES})$"](${CITY.bbox});',
        '  way["amenity"~"^(${AMENITIES})$"](${CITY.bbox});',
        ');',
        'out tags center 400;`;',
        '',
        'return [{ json: {',
        '  city: CITY.name,',
        '  bbox: CITY.bbox,',
        '  overpass_query: query,',
        '  source_query: `amenity=${AMENITIES} @ ${CITY.name}`,',
        '  run_id: String(Date.now()),',
        '  started_at: new Date().toISOString(),',
        '} }];',
      ].join('\n'),
    },
  },
  mirrorNode(0, MIRRORS[0], [-200, 0]),
  mirrorNode(1, MIRRORS[1], [-200, 200]),
  mirrorNode(2, MIRRORS[2], [-200, 400]),
  {
    id: 'norm',
    name: 'Normalize',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [40, 0],
    parameters: {
      jsCode: [
        normalizerSource,
        '',
        '// --- n8n wrapper ---',
        'const payload = $input.first().json;',
        'const elements = payload.elements || [];',
        "const cfg = $('Config').first().json;",
        '',
        'const { rows, stats } = normalizeOverpass(elements, {',
        '  city: cfg.city,',
        '  sourceQuery: cfg.source_query,',
        '});',
        '',
        'if (!rows.length) {',
        "  return [{ json: { __empty: true, stats } }];",
        '}',
        'return rows.map(r => ({ json: Object.assign({}, r, { __stats: stats }) }));',
      ].join('\n'),
    },
  },
  {
    id: 'gotData',
    name: 'Got Data?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [150, 0],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{
          id: 'g1',
          leftValue: '={{ $json.__empty }}',
          rightValue: '',
          operator: { type: 'boolean', operation: 'notTrue', singleValue: true },
        }],
        combinator: 'and',
      },
      options: {},
    },
  },
  readTab('readLeads', 'Read Leads', 'Leads', [260, -120]),
  readTab('readNoWeb', 'Read Leads_NoWeb', 'Leads_NoWeb', [260, 120]),
  {
    id: 'dedup',
    name: 'Drop Already Known',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [480, 0],
    parameters: {
      jsCode: [
        '// Read both tabs once into a Set. Per-lead lookups would blow through',
        "// the Sheets read quota (~60 req/min) the moment volume grows.",
        'const known = new Set();',
        "for (const nodeName of ['Read Leads', 'Read Leads_NoWeb']) {",
        '  let items = [];',
        '  try { items = $(nodeName).all(); } catch (e) { items = []; }',
        '  for (const it of items) {',
        '    const id = it.json && it.json.lead_id;',
        '    if (id) known.add(String(id).trim());',
        '  }',
        '}',
        '',
        "const candidates = $('Normalize').all()",
        '  .map(i => i.json)',
        '  .filter(j => !j.__empty);',
        '',
        'const fresh = candidates.filter(c => !known.has(c.lead_id));',
        '',
        'return fresh.map(c => ({ json: c }));',
      ].join('\n'),
    },
    // Deliberately NOT alwaysOutputData. When every lead is already known this
    // must emit zero items so the branch stops cleanly. With it set, n8n emits
    // a placeholder {} that flows into the shapers and appends a blank row.
  },
  {
    id: 'split',
    name: 'Has Website?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [700, 0],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{
          id: 'c1',
          leftValue: '={{ $json.has_website }}',
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        }],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    id: 'shapeWeb',
    name: 'Shape Leads Row',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [920, -120],
    parameters: {
      jsCode: [
        '// Emit exactly the Leads header order. Columns not yet known at',
        '// discovery time are written empty rather than omitted, so the row',
        '// shape always matches the sheet.',
        'return $input.all().map(({ json: j }) => ({ json: {',
        '  lead_id: j.lead_id,',
        '  company_name: j.company_name,',
        '  website: j.website,',
        '  normalized_domain: j.normalized_domain,',
        "  email: '',",
        "  email_valid: '',",
        '  phone_e164: j.phone_e164,',
        '  whatsapp_ready: j.whatsapp_ready,',
        '  city: j.city,',
        '  country: j.country,',
        '  region: j.region,',
        '  industry: j.category,',
        "  service_fit: '',",
        "  score: '',",
        "  score_reasons: '',",
        "  tech_detected: '',",
        "  hiring_signal: '',",
        '  source: j.source,',
        '  date_found: j.discovered_at,',
        '  last_seen: j.discovered_at,',
        "  contact_status: '',",
        "  ai_summary: '',",
        '  notes: j.address,',
        '} }));',
      ].join('\n'),
    },
  },
  {
    id: 'shapeNoWeb',
    name: 'Shape Leads_NoWeb Row',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [920, 120],
    parameters: {
      jsCode: [
        'return $input.all().map(({ json: j }) => ({ json: {',
        '  lead_id: j.lead_id,',
        '  company_name: j.company_name,',
        '  phone_e164: j.phone_e164,',
        '  whatsapp_ready: j.whatsapp_ready,',
        '  address: j.address,',
        '  city: j.city,',
        '  country: j.country,',
        '  region: j.region,',
        '  category: j.category,',
        "  score: '',",
        "  score_reasons: '',",
        '  source: j.source,',
        '  date_found: j.discovered_at,',
        '  last_seen: j.discovered_at,',
        "  contact_status: '',",
        "  notes: '',",
        '} }));',
      ].join('\n'),
    },
  },
  appendTab('appendWeb', 'Append Leads', 'Leads', [1140, -120]),
  appendTab('appendNoWeb', 'Append Leads_NoWeb', 'Leads_NoWeb', [1140, 120]),
  {
    id: 'mirrorFail',
    name: 'All Mirrors Failed',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [40, 400],
    parameters: {
      jsCode: [
        '// Every mirror refused. Without this the run would end silently and',
        '// look identical to "there were no new leads" — the failure mode that',
        '// lets a dead pipeline go unnoticed for a week.',
        "const cfg = $('Config').first().json;",
        'const err = $input.first().json;',
        '',
        'return [{ json: {',
        '  run_id: cfg.run_id,',
        "  workflow: 'wf1-discovery-overpass',",
        '  started_at: cfg.started_at,',
        '  finished_at: new Date().toISOString(),',
        "  candidates_found: '0',",
        "  new_leads: '0',",
        "  errors: '3',",
        '  notes: `ALL OVERPASS MIRRORS FAILED for ${cfg.source_query}. Last error: ` +',
        "    String(err && (err.error || err.message) || 'unknown').slice(0, 300),",
        '} }];',
      ].join('\n'),
    },
  },
  {
    id: 'emptyResp',
    name: 'Empty Response',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [150, 560],
    parameters: {
      jsCode: [
        '// A mirror answered 200 but the payload held no usable businesses.',
        '// Region-limited mirrors do exactly this, and an unguarded run would',
        '// report success having found nothing.',
        "const cfg = $('Config').first().json;",
        "const stats = ($input.first().json || {}).stats || {};",
        '',
        'return [{ json: {',
        '  run_id: cfg.run_id,',
        "  workflow: 'wf1-discovery-overpass',",
        '  started_at: cfg.started_at,',
        '  finished_at: new Date().toISOString(),',
        '  candidates_found: String(stats.received || 0),',
        "  new_leads: '0',",
        "  errors: '1',",
        '  notes: `EMPTY RESPONSE for ${cfg.source_query}. Received ` +',
        '    `${stats.received || 0} elements, none usable. ` +',
        '    `unnamed=${stats.unnamed || 0} noContact=${stats.noContact || 0} ` +',
        '    `institutional=${stats.institutional || 0}. Check whether a mirror ` +',
        '    `is region-limited.`,',
        '} }];',
      ].join('\n'),
    },
  },
  appendTab('appendFailLog', 'Log Failure', '_runlog', [260, 400]),
];

const connections = {
  'Schedule 5am PKT': { main: [[{ node: 'Config', type: 'main', index: 0 }]] },
  Config: { main: [[{ node: 'Overpass 1', type: 'main', index: 0 }]] },
  // Success -> Normalize. Error -> next mirror.
  'Overpass 1': {
    main: [
      [{ node: 'Normalize', type: 'main', index: 0 }],
      [{ node: 'Overpass 2', type: 'main', index: 0 }],
    ],
  },
  'Overpass 2': {
    main: [
      [{ node: 'Normalize', type: 'main', index: 0 }],
      [{ node: 'Overpass 3', type: 'main', index: 0 }],
    ],
  },
  'Overpass 3': {
    main: [
      [{ node: 'Normalize', type: 'main', index: 0 }],
      [{ node: 'All Mirrors Failed', type: 'main', index: 0 }],
    ],
  },
  'All Mirrors Failed': { main: [[{ node: 'Log Failure', type: 'main', index: 0 }]] },
  // A mirror that answers 200 with no elements would otherwise sail through as
  // a successful run that found nothing. Route the empty case to the log.
  Normalize: { main: [[{ node: 'Got Data?', type: 'main', index: 0 }]] },
  'Got Data?': {
    main: [
      [{ node: 'Read Leads', type: 'main', index: 0 }],
      [{ node: 'Empty Response', type: 'main', index: 0 }],
    ],
  },
  'Empty Response': { main: [[{ node: 'Log Failure', type: 'main', index: 0 }]] },
  'Read Leads': { main: [[{ node: 'Read Leads_NoWeb', type: 'main', index: 0 }]] },
  'Read Leads_NoWeb': { main: [[{ node: 'Drop Already Known', type: 'main', index: 0 }]] },
  'Drop Already Known': { main: [[{ node: 'Has Website?', type: 'main', index: 0 }]] },
  'Has Website?': {
    main: [
      [{ node: 'Shape Leads Row', type: 'main', index: 0 }],
      [{ node: 'Shape Leads_NoWeb Row', type: 'main', index: 0 }],
    ],
  },
  'Shape Leads Row': { main: [[{ node: 'Append Leads', type: 'main', index: 0 }]] },
  'Shape Leads_NoWeb Row': { main: [[{ node: 'Append Leads_NoWeb', type: 'main', index: 0 }]] },
};

const workflow = {
  name: 'WF1 Discovery — Overpass (Pakistan)',
  nodes,
  connections,
  settings: {
    executionOrder: 'v1',
    timezone: 'Asia/Karachi',
    saveDataSuccessExecution: 'all',
    saveDataErrorExecution: 'all',
    availableInMCP: true,
  },
};

const out = path.join(ROOT, 'workflows', 'wf1-discovery-overpass.json');
fs.writeFileSync(out, JSON.stringify(workflow, null, 2));
console.log(`wrote ${path.relative(ROOT, out)}`);
console.log(`  nodes: ${nodes.length}`);
console.log(`  normalizer body: ${normalizerSource.length} chars`);
