/**
 * Country-aware phone normalisation tests.
 *
 *   node scripts/test-phone.js
 */
const { toE164, isMobile, countryOf } = require('../workflows/src/phone');

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`}`);
  if (!ok) failed++;
}

console.log('Pakistan — unchanged behaviour');
check('local mobile', toE164('0300-1234567', 'PK'), '+923001234567');
check('landline', toE164('042-35761234', 'PK'), '+924235761234');
check('already E.164', toE164('+923001234567', 'PK'), '+923001234567');
check('00 prefix', toE164('00923001234567', 'PK'), '+923001234567');
check('strips (0)', toE164('+92 (0)300 1234567', 'PK'), '+923001234567');
check('mobile detected', isMobile('+923001234567', 'PK'), true);
check('landline not mobile', isMobile('+924235761234', 'PK'), false);

console.log('');
console.log('United Kingdom');
check('London landline', toE164('020 7946 0958', 'GB'), '+442079460958');
check('mobile', toE164('07700 900123', 'GB'), '+447700900123');
check('already E.164', toE164('+447700900123', 'GB'), '+447700900123');
check('00 prefix', toE164('00447700900123', 'GB'), '+447700900123');
check('spaced and dashed', toE164('0161-496-0123', 'GB'), '+441614960123');
check('mobile detected', isMobile('+447700900123', 'GB'), true);
check('landline not mobile', isMobile('+442079460958', 'GB'), false);

console.log('');
console.log('United States');
check('bracketed', toE164('(212) 555-0147', 'US'), '+12125550147');
check('dotted', toE164('415.555.0182', 'US'), '+14155550182');
check('with leading 1', toE164('1-800-555-0199', 'US'), '+18005550199');
check('already E.164', toE164('+12125550147', 'US'), '+12125550147');
check('strips extension', toE164('212-555-0147 ext 22', 'US'), '+12125550147');
// The NANP gives mobiles no distinct prefix, so claiming WhatsApp would be a guess.
check('never claims mobile', isMobile('+12125550147', 'US'), false);

console.log('');
console.log('cross-country safety');
// An explicitly international number of another country must be dropped, not
// reinterpreted. This is the case that actually occurs: a +44 number sitting
// on a page crawled during a Pakistani sweep.
check('a +44 number is dropped under PK rules', toE164('+44 20 7946 0958', 'PK'), '');
check('a +1 number is dropped under PK rules', toE164('+1 212 555 0147', 'PK'), '');
check('a +92 number is dropped under GB rules', toE164('+923001234567', 'GB'), '');
check('a +1 number is dropped under GB rules', toE164('+12125550147', 'GB'), '');
check('a +92 number is dropped under US rules', toE164('+923001234567', 'US'), '');
// A bare national number carries no country evidence, so the caller must pass
// the right one. Documented in phone.js rather than pretended away.
check('bare national numbers follow the country given',
  toE164('020 7946 0958', 'PK'), '+922079460958');

console.log('');
console.log('rejects rubbish');
check('too short', toE164('12345', 'US'), '');
check('empty', toE164('', 'GB'), '');
check('letters', toE164('call us', 'GB'), '');
check('unknown country', toE164('0300-1234567', 'ZZ'), '');

console.log('');
console.log('country detection from a number');
check('PK', countryOf('+923001234567'), 'PK');
check('GB', countryOf('+447700900123'), 'GB');
check('US', countryOf('+12125550147'), 'US');
check('unknown', countryOf('+33123456789'), '');

console.log('');
console.log(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
