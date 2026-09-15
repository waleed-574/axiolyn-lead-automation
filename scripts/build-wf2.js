/**
 * Generates WF2 Enrichment and writes it to workflows/.
 *
 * This is the point where splitting from WF1 earns its keep: enrichment runs
 * over the backlog of leads still missing an email — not over whatever WF1
 * happened to discover this hour — and a crash partway through a multi-minute
 * crawl must not force a re-run of a 200-second Overpass fetch.
 *
 *   node scripts/build-wf2.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const SHEET_ID = cfg.sheet.spreadsheetId;
const sheetsCred = { googleApi: { id: cfg.n8n.credentialId, name: cfg.n8n.credentialName } };

const extractorSource = fs
  .readFileSync(path.join(ROOT, 'workflows', 'src', 'extract-contacts.js'), 'utf8')
  .replace(/module\.exports\s*=\s*\{[\s\S]*?\};\s*$/, '');

// Crawling is slow and must stay polite, so each run takes a bite of the
// backlog rather than the whole thing.
const BATCH_SIZE = 12;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function fetchNode(id, name, urlExpr, position) {
  return {
    id,
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position,
    parameters: {
      method: 'GET',
      url: urlExpr,
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'User-Agent', value: UA },
          { name: 'Accept', value: 'text/html,application/xhtml+xml' },
        ],
      },
      options: {
        timeout: 15000,
        redirect: { redirect: { followRedirects: true, maxRedirects: 3 } },
        response: { response: { neverError: true, responseFormat: 'text' } },
        // One request at a time with a gap, so a run never looks like a scrape.
        batching: { batch: { batchSize: 1, batchInterval: 1500 } },
      },
    },
    // A third of the sites sampled were dead or unreachable. One bad host must
    // never abort the batch.
    onError: 'continueRegularOutput',
    alwaysOutputData: true,
  };
}

const nodes = [
  {
    id: 'sched',
    name: 'Schedule Every 2h',
    type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2,
    position: [-680, 0],
    parameters: {
      rule: { interval: [{ field: 'cronExpression', expression: '30 */2 * * *' }] },
    },
  },
  {
    id: 'readLeads',
    name: 'Read Leads',
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.7,
    position: [-460, 0],
    parameters: {
      authentication: 'serviceAccount',
      resource: 'sheet',
      operation: 'read',
      documentId: { __rl: true, mode: 'id', value: SHEET_ID },
      sheetName: { __rl: true, mode: 'name', value: 'Leads' },
      options: {},
    },
    credentials: sheetsCred,
    executeOnce: true,
    alwaysOutputData: true,
  },
  {
    id: 'pick',
    name: 'Pick Backlog',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-240, 0],
    parameters: {
      jsCode: [
        '// Take the next slice of leads that have a website but no enrichment',
        '// verdict yet. email_valid doubles as the processed marker, so a site',
        '// is attempted once and never retried in a loop.',
        `const BATCH = ${BATCH_SIZE};`,
        '',
        'const rows = $input.all().map(i => i.json);',
        'const todo = rows.filter(r =>',
        '  r.lead_id &&',
        '  String(r.normalized_domain || "").trim() &&',
        '  !String(r.email_valid || "").trim()',
        ');',
        '',
        'if (!todo.length) {',
        '  return [{ json: { __nothing_to_do: true, backlog: 0 } }];',
        '}',
        '',
        'return todo.slice(0, BATCH).map(r => ({ json: {',
        '  lead_id: r.lead_id,',
        '  company_name: r.company_name,',
        '  domain: String(r.normalized_domain).trim(),',
        '  home_url: "https://" + String(r.normalized_domain).trim(),',
        '  contact_url: "https://" + String(r.normalized_domain).trim() + "/contact",',
        '  backlog_total: todo.length,',
        '} }));',
      ].join('\n'),
    },
  },
  {
    id: 'anyWork',
    name: 'Anything To Do?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [-20, 0],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{
          id: 'w1',
          leftValue: '={{ $json.__nothing_to_do }}',
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        }],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    id: 'noop',
    name: 'Backlog Empty',
    type: 'n8n-nodes-base.noOp',
    typeVersion: 1,
    position: [200, -200],
    parameters: {},
  },
  fetchNode('fetchHome', 'Fetch Homepage', '={{ $json.home_url }}', [200, 60]),
  // Reference Pick Backlog explicitly. This node's immediate input is the
  // homepage HTML, so $json.contact_url is undefined — which failed silently as
  // "URL parameter must be a string" on every item, and the contact pages were
  // never actually fetched.
  fetchNode('fetchContact', 'Fetch Contact Page',
    "={{ $('Pick Backlog').item.json.contact_url }}", [420, 60]),
  {
    id: 'extract',
    name: 'Extract Contacts',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [640, 60],
    parameters: {
      jsCode: [
        extractorSource,
        '',
        '// --- n8n wrapper ---',
        "const leads = $('Pick Backlog').all().map(i => i.json);",
        "const homes = $('Fetch Homepage').all();",
        "const contacts = $('Fetch Contact Page').all();",
        '',
        'const bodyOf = (item) => {',
        '  if (!item || !item.json) return "";',
        '  const j = item.json;',
        '  // neverError keeps failures in-band, so the body may be missing.',
        '  const raw = typeof j === "string" ? j : (j.data || j.body || "");',
        '  return typeof raw === "string" ? raw : "";',
        '};',
        '',
        'const out = [];',
        'for (let i = 0; i < leads.length; i++) {',
        '  const lead = leads[i];',
        '  const html = [bodyOf(homes[i]), bodyOf(contacts[i])].join("\\n");',
        '',
        '  if (!html.trim()) {',
        '    out.push({ json: {',
        '      lead_id: lead.lead_id,',
        '      email: "",',
        '      email_valid: "fetch_failed",',
        '      tech_detected: "",',
        '      notes_suffix: "site unreachable",',
        '    } });',
        '    continue;',
        '  }',
        '',
        '  const r = extractFromPage(html, lead.domain);',
        '  const best = r.emails[0];',
        '',
        '  out.push({ json: {',
        '    lead_id: lead.lead_id,',
        '    email: best ? best.email : "",',
        '    email_valid: best ? ("found:" + best.source) : "no_email_found",',
        '    tech_detected: r.tech.join(","),',
        '    has_automation: r.automationTech.length > 0,',
        '    automation_tech: r.automationTech.join(","),',
        '    copyright_year: r.stale.copyrightYear || "",',
        '    form_only: r.formOnly,',
        '    socials: Object.values(r.socials).join(" "),',
        '    rejected_foreign: (r.emails.rejectedForeign || []).join(","),',
        '  } });',
        '}',
        '',
        'return out;',
      ].join('\n'),
    },
  },
  {
    id: 'shape',
    name: 'Shape Update',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [860, 60],
    parameters: {
      jsCode: [
        '// Only the columns enrichment owns are written. contact_status and',
        '// notes belong to the team and must never be overwritten by a robot.',
        'return $input.all().map(({ json: j }) => ({ json: {',
        '  lead_id: j.lead_id,',
        '  email: j.email,',
        '  email_valid: j.email_valid,',
        '  tech_detected: j.tech_detected,',
        '  last_seen: new Date().toISOString(),',
        '} }));',
      ].join('\n'),
    },
  },
  {
    id: 'update',
    name: 'Update Leads',
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.7,
    position: [1080, 60],
    parameters: {
      authentication: 'serviceAccount',
      resource: 'sheet',
      operation: 'update',
      documentId: { __rl: true, mode: 'id', value: SHEET_ID },
      sheetName: { __rl: true, mode: 'name', value: 'Leads' },
      columns: {
        mappingMode: 'autoMapInputData',
        value: {},
        matchingColumns: ['lead_id'],
        schema: [],
      },
      options: { cellFormat: 'RAW' },
    },
    credentials: sheetsCred,
    alwaysOutputData: true,
  },
];

const connections = {
  'Schedule Every 2h': { main: [[{ node: 'Read Leads', type: 'main', index: 0 }]] },
  'Read Leads': { main: [[{ node: 'Pick Backlog', type: 'main', index: 0 }]] },
  'Pick Backlog': { main: [[{ node: 'Anything To Do?', type: 'main', index: 0 }]] },
  // true = nothing left to enrich, stop quietly
  'Anything To Do?': {
    main: [
      [{ node: 'Backlog Empty', type: 'main', index: 0 }],
      [{ node: 'Fetch Homepage', type: 'main', index: 0 }],
    ],
  },
  'Fetch Homepage': { main: [[{ node: 'Fetch Contact Page', type: 'main', index: 0 }]] },
  'Fetch Contact Page': { main: [[{ node: 'Extract Contacts', type: 'main', index: 0 }]] },
  'Extract Contacts': { main: [[{ node: 'Shape Update', type: 'main', index: 0 }]] },
  'Shape Update': { main: [[{ node: 'Update Leads', type: 'main', index: 0 }]] },
};

const workflow = {
  name: 'WF2 Enrichment — contact details',
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

const out = path.join(ROOT, 'workflows', 'wf2-enrichment.json');
fs.writeFileSync(out, JSON.stringify(workflow, null, 2));
console.log(`wrote ${path.relative(ROOT, out)}`);
console.log(`  nodes: ${nodes.length}`);
console.log(`  batch size: ${BATCH_SIZE} leads/run`);
