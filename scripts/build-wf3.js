/**
 * Generates WF3 Scoring and writes it to workflows/.
 *
 * Kept separate from enrichment so weights can be retuned and every lead
 * re-scored without re-crawling a single website — which is the whole reason
 * scoring reads only from columns already in the sheet.
 *
 *   node scripts/build-wf3.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const SHEET_ID = cfg.sheet.spreadsheetId;
const sheetsCred = { googleApi: { id: cfg.n8n.credentialId, name: cfg.n8n.credentialName } };

const scorerSource = fs
  .readFileSync(path.join(ROOT, 'workflows', 'src', 'score-leads.js'), 'utf8')
  .replace(/module\.exports\s*=\s*\{[\s\S]*?\};\s*$/, '');

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
    executeOnce: true,
    alwaysOutputData: true,
  };
}

function updateTab(id, name, tab, position) {
  return {
    id,
    name,
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.7,
    position,
    parameters: {
      authentication: 'serviceAccount',
      resource: 'sheet',
      operation: 'update',
      documentId: { __rl: true, mode: 'id', value: SHEET_ID },
      sheetName: { __rl: true, mode: 'name', value: tab },
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
  };
}

const nodes = [
  {
    id: 'sched',
    name: 'Schedule Hourly',
    type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2,
    position: [-680, 0],
    // Offset from discovery and enrichment so it scores what they have just
    // written rather than racing them.
    parameters: {
      rule: { interval: [{ field: 'cronExpression', expression: '50 * * * *' }] },
    },
  },
  readTab('readWeb', 'Read Leads', 'Leads', [-460, 0]),
  {
    id: 'scoreWeb',
    name: 'Score Web Leads',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-240, 0],
    parameters: {
      jsCode: [
        scorerSource,
        '',
        '// --- n8n wrapper ---',
        'const out = [];',
        'for (const item of $input.all()) {',
        '  const lead = item.json;',
        '  if (!lead.lead_id) continue;',
        '  const r = scoreWebLead(lead);',
        '  // Leads the crawler has not reached yet stay unscored, so the top of',
        '  // the sheet reflects the best known leads rather than whichever ones',
        '  // happened to be processed first.',
        '  if (r.pending) continue;',
        '  out.push({ json: {',
        '    lead_id: lead.lead_id,',
        '    score: r.score,',
        '    score_reasons: r.reasons,',
        '    service_fit: r.service_fit,',
        '  } });',
        '}',
        'return out;',
      ].join('\n'),
    },
    alwaysOutputData: true,
  },
  updateTab('updWeb', 'Update Leads', 'Leads', [-20, 0]),
  readTab('readNoWeb', 'Read Leads_NoWeb', 'Leads_NoWeb', [200, 0]),
  {
    id: 'scoreNoWeb',
    name: 'Score No-Web Leads',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [420, 0],
    parameters: {
      jsCode: [
        scorerSource,
        '',
        '// --- n8n wrapper ---',
        '// Everything here is scorable at discovery time — there is no crawl to',
        '// wait for — so no pending state.',
        'const out = [];',
        'for (const item of $input.all()) {',
        '  const lead = item.json;',
        '  if (!lead.lead_id) continue;',
        '  const r = scoreNoWebLead(lead);',
        '  out.push({ json: {',
        '    lead_id: lead.lead_id,',
        '    score: r.score,',
        '    score_reasons: r.reasons,',
        '  } });',
        '}',
        'return out;',
      ].join('\n'),
    },
    alwaysOutputData: true,
  },
  updateTab('updNoWeb', 'Update Leads_NoWeb', 'Leads_NoWeb', [640, 0]),
];

// Linear on purpose: two short passes are easier to follow in the n8n canvas
// than parallel branches, and scoring is fast enough that nothing is gained by
// running them at once.
const connections = {
  'Schedule Hourly': { main: [[{ node: 'Read Leads', type: 'main', index: 0 }]] },
  'Read Leads': { main: [[{ node: 'Score Web Leads', type: 'main', index: 0 }]] },
  'Score Web Leads': { main: [[{ node: 'Update Leads', type: 'main', index: 0 }]] },
  'Update Leads': { main: [[{ node: 'Read Leads_NoWeb', type: 'main', index: 0 }]] },
  'Read Leads_NoWeb': { main: [[{ node: 'Score No-Web Leads', type: 'main', index: 0 }]] },
  'Score No-Web Leads': { main: [[{ node: 'Update Leads_NoWeb', type: 'main', index: 0 }]] },
};

const workflow = {
  name: 'WF3 Scoring — rank the call list',
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

const out = path.join(ROOT, 'workflows', 'wf3-scoring.json');
fs.writeFileSync(out, JSON.stringify(workflow, null, 2));
console.log(`wrote ${path.relative(ROOT, out)}`);
console.log(`  nodes: ${nodes.length}`);
