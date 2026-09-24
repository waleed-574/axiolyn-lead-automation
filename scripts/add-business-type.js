/**
 * Adds a `business_type` column to every lead tab and backfills it from the
 * OSM category already stored on each row.
 *
 *   node scripts/add-business-type.js            # both sheets
 *   node scripts/add-business-type.js --dry-run
 *
 * Safe to re-run: the column is only inserted when missing, and the backfill
 * simply recomputes every cell from its category, so a later change to the
 * label map can be rolled out by running this again.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { Sheet } = require(path.join(ROOT, 'workflows/src/sheets'));
const { businessType } = require(path.join(ROOT, 'workflows/src/business-type'));

const DRY = process.argv.includes('--dry-run');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

// Each tab, and which column holds its OSM category. The Pakistan Leads tab
// calls it `industry`; everything else calls it `category`.
const TARGETS = [
  { sheetId: cfg.sheet.spreadsheetId, tab: 'Leads', categoryCol: 'industry', after: 'industry' },
  { sheetId: cfg.sheet.spreadsheetId, tab: 'Leads_NoWeb', categoryCol: 'category', after: 'category' },
  { sheetId: cfg.sheetIntl.spreadsheetId, tab: 'Leads_US', categoryCol: 'category', after: 'category' },
  { sheetId: cfg.sheetIntl.spreadsheetId, tab: 'Leads_UK', categoryCol: 'category', after: 'category' },
];

const colLetter = (i) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
};

(async () => {
  const opened = new Map();
  const openSheet = async (id) => {
    if (!opened.has(id)) opened.set(id, await Sheet.open(id, process.env.GOOGLE_SERVICE_ACCOUNT_FILE));
    return opened.get(id);
  };

  for (const t of TARGETS) {
    const sheet = await openSheet(t.sheetId);
    const { header, rows } = await sheet.readObjects(t.tab);
    if (!header.length) { console.log(`${t.tab}: empty, skipped`); continue; }

    if (!header.includes('business_type')) {
      // Insert next to the category it is derived from, so the two read
      // together rather than the label being stranded at the far right.
      const anchor = header.indexOf(t.after);
      const insertAt = anchor >= 0 ? anchor + 1 : header.length;

      const meta = await sheet.api(`/${t.sheetId}?fields=sheets.properties`);
      const props = meta.sheets.find((s) => s.properties.title === t.tab);
      if (!props) { console.log(`${t.tab}: not found`); continue; }

      if (DRY) {
        console.log(`${t.tab}: would insert business_type at column ${colLetter(insertAt)}`);
      } else {
        await sheet.api(`/${t.sheetId}:batchUpdate`, 'POST', {
          requests: [{
            insertDimension: {
              range: {
                sheetId: props.properties.sheetId,
                dimension: 'COLUMNS',
                startIndex: insertAt,
                endIndex: insertAt + 1,
              },
              inheritFromBefore: false,
            },
          }],
        });
        await sheet.api(
          `/${t.sheetId}/values/${encodeURIComponent(`${t.tab}!${colLetter(insertAt)}1`)}?valueInputOption=RAW`,
          'PUT',
          { values: [['business_type']] }
        );
        // Match the bold, frozen header styling of the other columns.
        await sheet.api(`/${t.sheetId}:batchUpdate`, 'POST', {
          requests: [{
            repeatCell: {
              range: {
                sheetId: props.properties.sheetId,
                startRowIndex: 0, endRowIndex: 1,
                startColumnIndex: insertAt, endColumnIndex: insertAt + 1,
              },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true },
                  backgroundColor: { red: 0.85, green: 0.89, blue: 0.86 },
                },
              },
              fields: 'userEnteredFormat(textFormat,backgroundColor)',
            },
          }],
        });
        console.log(`${t.tab}: inserted business_type at column ${colLetter(insertAt)}`);
      }
    } else {
      console.log(`${t.tab}: business_type column already present`);
    }

    // Backfill. Written as one contiguous range rather than per-row updates,
    // which would be thousands of API calls.
    const after = await sheet.readObjects(t.tab);
    const idx = after.header.indexOf('business_type');
    if (idx < 0) { console.log(`${t.tab}: column missing after insert, skipped backfill`); continue; }

    const values = after.rows.map((r) => [businessType(r[t.categoryCol])]);
    if (!values.length) { console.log(`${t.tab}: no rows to backfill`); continue; }

    if (DRY) {
      const sample = {};
      values.forEach(([v]) => { sample[v] = (sample[v] || 0) + 1; });
      console.log(`${t.tab}: would label ${values.length} rows — ` +
        Object.entries(sample).sort((a, b) => b[1] - a[1]).slice(0, 4)
          .map(([k, v]) => `${v} ${k}`).join(', '));
      continue;
    }

    const range = `${t.tab}!${colLetter(idx)}2:${colLetter(idx)}${after.rows.length + 1}`;
    await sheet.api(
      `/${t.sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      'PUT',
      { range, majorDimension: 'ROWS', values }
    );
    const distinct = new Set(values.map((v) => v[0])).size;
    console.log(`${t.tab}: labelled ${values.length} rows, ${distinct} distinct types`);
  }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
