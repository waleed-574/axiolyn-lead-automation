/**
 * Tests for spreadsheet id parsing.
 *
 *   node scripts/test-sheet-id.js
 */
const { parseSheetId } = require('../workflows/src/sheet-id');

let failed = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  (expected "${expected}", got "${actual}")`}`);
  if (!ok) failed++;
}

const ID = '1g_jR1kaj08U0y2d-K4w74CfWZDBkn9SBLVOZ7RPMzQk';

console.log('a bare id passes through');
check('plain id', parseSheetId(ID), ID);
check('surrounding whitespace', parseSheetId('  ' + ID + '  '), ID);
check('stray quotes', parseSheetId('"' + ID + '"'), ID);

console.log('');
console.log('a pasted URL is accepted — this is the mistake that broke CI');
// The secret held a URL, and the Sheets API reported it as 404 "entity not
// found", which reads like a deleted sheet rather than a malformed id.
check('edit URL with gid', parseSheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=0#gid=0`), ID);
check('bare edit URL', parseSheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit`), ID);
check('no scheme', parseSheetId(`docs.google.com/spreadsheets/d/${ID}`), ID);
check('with trailing slash', parseSheetId(`https://docs.google.com/spreadsheets/d/${ID}/`), ID);

console.log('');
console.log('nonsense is rejected rather than passed on to the API');
check('empty', parseSheetId(''), '');
check('null', parseSheetId(null), '');
check('a sentence', parseSheetId('my google sheet'), '');
check('too short to be an id', parseSheetId('abc123'), '');
check('an unrelated URL', parseSheetId('https://example.com/page'), '');

console.log('');
console.log(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
