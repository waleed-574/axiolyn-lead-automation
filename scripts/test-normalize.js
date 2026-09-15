/**
 * Exercises the Overpass normaliser against the captured fixture plus unit
 * cases for the fiddly bits. Runs offline — no network, repeatable.
 *
 *   node scripts/test-normalize.js
 */
const fs = require('fs');
const path = require('path');
const {
  normalizeOverpass, normalizeDomain, toE164PK, isMobilePK, normalizeName,
} = require('../workflows/src/normalize-overpass');

let failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`);
    failed++;
  }
}

console.log('domain normalisation');
check('strips protocol and www', normalizeDomain('https://www.Example.com.pk/contact?x=1'), 'example.com.pk');
check('keeps subdomain', normalizeDomain('http://clinic.example.pk'), 'clinic.example.pk');
check('strips port', normalizeDomain('https://example.pk:8080/'), 'example.pk');
check('rejects shortener', normalizeDomain('https://share.google/yYEdGcFIygiQxEg9y'), '');
check('rejects facebook', normalizeDomain('https://www.facebook.com/somebusiness'), '');
check('rejects wa.me', normalizeDomain('https://wa.me/923001234567'), '');
check('rejects garbage', normalizeDomain('not a url'), '');
check('rejects business.site subdomain', normalizeDomain('https://shazia-zahid-medical-centre.business.site'), '');
check('rejects facebook subdomain', normalizeDomain('https://m.facebook.com/x'), '');
check('keeps a normal subdomain', normalizeDomain('https://clinic.acme.pk'), 'clinic.acme.pk');
check('rejects empty', normalizeDomain(''), '');

console.log('');
console.log('PK phone to E.164');
check('local mobile 0300', toE164PK('0300-1234567'), '+923001234567');
check('spaced mobile', toE164PK('0321 987 6543'), '+923219876543');
check('already E.164', toE164PK('+923001234567'), '+923001234567');
check('0092 prefix', toE164PK('00923001234567'), '+923001234567');
check('92 prefix', toE164PK('923001234567'), '+923001234567');
check('landline 042', toE164PK('042-35761234'), '+924235761234');
check('takes first of several', toE164PK('0300-1234567; 0321-7654321'), '+923001234567');
check('strips (0)', toE164PK('+92 (0)300 1234567'), '+923001234567');
check('rejects too short', toE164PK('12345'), '');
check('rejects empty', toE164PK(''), '');

console.log('');
console.log('WhatsApp detection');
check('mobile is whatsapp-ready', isMobilePK('+923001234567'), true);
check('landline is not', isMobilePK('+924235761234'), false);

console.log('');
console.log('name normalisation');
check('collapses suffixes', normalizeName('ABC Pvt. Ltd.'), 'abc');
check('matches punctuation variant', normalizeName('abc pvt ltd'), normalizeName('ABC Pvt. Ltd.'));

console.log('');
console.log('fixture: real Overpass response');
const fixturePath = path.join(__dirname, '..', 'fixtures', 'overpass-lahore-healthcare.json');
if (!fs.existsSync(fixturePath)) {
  console.log('  FAIL fixture missing at ' + fixturePath);
  process.exit(1);
}
const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const { rows, stats } = normalizeOverpass(raw.elements, {
  city: 'Lahore',
  sourceQuery: 'amenity=clinic|doctors|dentist|hospital|pharmacy @ Lahore',
  now: '2026-09-14T00:00:00.000Z',
});

console.log('  stats:', JSON.stringify(stats));
console.log(`  usable rows: ${rows.length}  (web ${stats.web} / no-web ${stats.noWeb})`);

check('produced at least 20 usable rows', rows.length >= 20, true);
check('every row has a contact channel', rows.every(r => r.phone_e164 || r.normalized_domain), true);
check('every row has a lead_id', rows.every(r => r.lead_id && r.lead_id.length === 40), true);
check('lead_ids are unique', new Set(rows.map(r => r.lead_id)).size, rows.length);
check('no shortener leaked into a domain', rows.every(r => !/share\.google|wa\.me|facebook/.test(r.normalized_domain)), true);
check('every phone is E.164 or empty', rows.every(r => !r.phone_e164 || /^\+92\d{9,10}$/.test(r.phone_e164)), true);
check('web rows have a domain', rows.filter(r => r.has_website).every(r => r.normalized_domain), true);
check('no-web rows have a phone', rows.filter(r => !r.has_website).every(r => r.phone_e164), true);

// Determinism: the same input must yield the same ids, or dedup is worthless.
const again = normalizeOverpass(raw.elements, {
  city: 'Lahore',
  sourceQuery: 'amenity=clinic|doctors|dentist|hospital|pharmacy @ Lahore',
  now: '2026-09-14T00:00:00.000Z',
});
check('lead_ids are deterministic across runs',
  again.rows.map(r => r.lead_id).join(), rows.map(r => r.lead_id).join());

console.log('');
console.log('  --- 10 sample rows ---');
rows.slice(0, 10).forEach(r => console.log(
  '  ' + (r.has_website ? 'WEB  ' : 'PHONE') + ' ' +
  r.company_name.slice(0, 38).padEnd(40) +
  (r.phone_e164 || '-').padEnd(15) +
  (r.normalized_domain || '-')));

console.log('');
console.log(failed === 0 ? `ALL CHECKS PASSED` : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
