/**
 * Offline tests for the US/UK normaliser.
 *
 *   node scripts/test-normalize-intl.js
 */
const { normalizeIntl, normalizeDomain, NOT_A_PROSPECT, CHAINS } =
  require('../workflows/src/normalize-intl');

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`}`);
  if (!ok) failed++;
}

const el = (tags) => ({ type: 'node', id: Math.random(), tags });

console.log('domain hygiene');
check('keeps a real site', normalizeDomain('https://www.Example.co.uk/contact'), 'example.co.uk');
check('rejects yelp', normalizeDomain('https://www.yelp.com/biz/acme'), '');
check('rejects a delivery platform', normalizeDomain('https://deliveroo.co.uk/menu/x'), '');
check('rejects a site-builder subdomain', normalizeDomain('https://acme.wixsite.com/home'), '');
check('rejects business.site subdomain', normalizeDomain('https://acme.business.site'), '');

console.log('');
console.log('chains and public bodies are not prospects');
check('spots a chain', CHAINS.test('Starbucks'), true);
check('spots a UK chain', CHAINS.test('Greggs'), true);
check('spots a bank branch', CHAINS.test('Barclays'), true);
check('leaves an independent alone', CHAINS.test('Perrys Chartered Accountants'), false);
check('spots a council', NOT_A_PROSPECT.test('Camden Council'), true);
check('spots NHS', NOT_A_PROSPECT.test('NHS Walk-in Centre'), true);
check('leaves a private clinic alone', NOT_A_PROSPECT.test('Harley Street Clinic'), false);

console.log('');
console.log('US normalisation');
{
  const { rows, stats } = normalizeIntl([
    el({ name: 'Block Advisors', office: 'tax_advisor', phone: '+1-212-785-1216', website: 'https://www.blockadvisors.com' }),
    el({ name: 'Starbucks', amenity: 'cafe', phone: '+1-212-555-0100' }),
    el({ name: 'Department of Motor Vehicles', office: 'government', phone: '+1-212-555-0111' }),
    el({ name: 'No Contact Co', office: 'company' }),
  ], { country: 'US', city: 'New York', now: '2026-09-23T00:00:00.000Z' });

  check('keeps only the real prospect', rows.length, 1);
  check('chain filtered', stats.chain, 1);
  check('public body filtered', stats.institutional, 1);
  check('no-contact filtered', stats.noContact, 1);
  check('phone normalised', rows[0].phone_e164, '+12127851216');
  check('US phone type is unknown, never mobile', rows[0].phone_type, 'unknown');
  check('country recorded', rows[0].country, 'US');
}

console.log('');
console.log('UK normalisation');
{
  const { rows } = normalizeIntl([
    el({ name: 'Perrys Chartered Accountants', office: 'accountant', phone: '+44 20 7256 9339', website: 'https://perrysaccountants.co.uk' }),
    el({ name: 'Camden Cabs', office: 'company', phone: '07700 900123' }),
  ], { country: 'GB', city: 'London', now: '2026-09-23T00:00:00.000Z' });

  check('two prospects kept', rows.length, 2);
  check('landline normalised', rows[0].phone_e164, '+442072569339');
  check('landline typed', rows[0].phone_type, 'landline');
  check('mobile normalised', rows[1].phone_e164, '+447700900123');
  check('UK mobile is typed mobile', rows[1].phone_type, 'mobile');
  check('phone-only lead has no domain', rows[1].normalized_domain, '');
}

console.log('');
console.log('identity and determinism');
{
  const input = [el({ name: 'Acme Ltd', office: 'company', website: 'https://acme.co.uk', phone: '+44 20 7946 0958' })];
  const a = normalizeIntl(input, { country: 'GB', city: 'London' });
  const b = normalizeIntl(input, { country: 'GB', city: 'London' });
  check('lead_id is a sha1', /^[0-9a-f]{40}$/.test(a.rows[0].lead_id), true);
  check('lead_id is deterministic', a.rows[0].lead_id, b.rows[0].lead_id);

  const dup = normalizeIntl([input[0], input[0]], { country: 'GB', city: 'London' });
  check('duplicates collapse within a run', dup.rows.length, 1);
}

console.log('');
console.log(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
