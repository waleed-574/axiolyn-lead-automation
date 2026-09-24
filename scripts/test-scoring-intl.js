/**
 * Offline regression tests for the US/UK scoring model.
 *
 *   node scripts/test-scoring-intl.js
 */
const { scoreIntlLead } = require('../workflows/src/score-intl');

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`}`);
  if (!ok) failed++;
}

const lead = (o) => scoreIntlLead(Object.assign({
  company_name: 'Acme Consulting',
  normalized_domain: 'acme.com',
  email_valid: 'ok:mailto:own',
  tech_detected: 'wordpress',
  phone_e164: '+12125550147',
  phone_type: 'unknown',
  city: 'New York',
  country: 'US',
  category: 'office:consulting',
}, o));

console.log('uncrawled leads stay out of the ranking');
check('pending when a site has not been crawled', lead({ email_valid: '' }).pending, true);
check('no score while pending', lead({ email_valid: '' }).score, '');
// A phone-only lead has nothing to crawl, so it must be scorable immediately.
check('phone-only lead is scored right away',
  typeof lead({ normalized_domain: '', email_valid: '' }).score, 'number');

console.log('');
console.log('absence of automation is the central signal');
{
  const clean = lead({ tech_detected: 'wordpress,woocommerce' });
  const served = lead({ tech_detected: 'wordpress,woocommerce,hubspot' });
  check('no CRM outranks already-automated', clean.score > served.score, true);
  check('reason names the tool', /already uses hubspot/.test(served.reasons), true);
  check('no fingerprint earns no bonus',
    /no CRM or booking tool/.test(lead({ tech_detected: '' }).reasons), false);
}

console.log('');
console.log('institutions, charities and chains are demoted');
check('a .gov domain', lead({ normalized_domain: 'ny.gov', company_name: 'Some Office' }).score < 25, true);
check('a .gov.uk domain', lead({ normalized_domain: 'camden.gov.uk', company_name: 'Some Office', country: 'GB' }).score < 25, true);
check('an NHS domain', lead({ normalized_domain: 'gstt.nhs.uk', company_name: 'Guys Hospital', country: 'GB' }).score < 25, true);
// Universities do buy, just slowly, so mid-pack rather than excluded.
check('a .ac.uk domain', lead({ normalized_domain: 'ucl.ac.uk', company_name: 'UCL', country: 'GB' }).score < 60, true);
check('a named council', lead({ company_name: 'Camden Council' }).score < 25, true);
check('a charity', lead({ company_name: 'Shelter Foundation' }).score < 50, true);
check('a chain branch', lead({ company_name: 'Starbucks Coffee' }).score < 40, true);
check('an ordinary consultancy is untouched',
  /public body|academic|charity|chain/.test(lead({}).reasons), false);

console.log('');
console.log('phone handling differs by country');
{
  const ukMobile = lead({ country: 'GB', phone_type: 'mobile', phone_e164: '+447700900123' });
  const ukLandline = lead({ country: 'GB', phone_type: 'landline', phone_e164: '+442079460958' });
  check('UK mobile earns a WhatsApp bonus', ukMobile.score > ukLandline.score, true);
  check('reason mentions WhatsApp', /WhatsApp/.test(ukMobile.reasons), true);
  // The North American plan cannot identify a mobile, so no WhatsApp claim.
  check('US never claims WhatsApp',
    /WhatsApp/.test(lead({ country: 'US', phone_type: 'unknown' }).reasons), false);
  check('a published phone still counts',
    /phone number published/.test(lead({ country: 'US' }).reasons), true);
}

console.log('');
console.log('mismatched website warning (OpenStreetMap tagging errors)');
{
  const { nameMatchesDomain } = require('../workflows/src/score-intl');
  // A genuine error found in the first 26 London leads: an accountancy firm
  // tagged with a neighbouring restaurant's website.
  check('flags a genuine mismatch', nameMatchesDomain('Perrys Chartered Accountants','themercer.co.uk'), false);
  check('accepts plain initials', nameMatchesDomain('Abrahams Dresden','ad-solicitors.co.uk'), true);
  check('accepts CamelCase initials', nameMatchesDomain('RadcliffesLeBrasseur','rlb-law.com'), true);
  check('accepts a spelled-out number', nameMatchesDomain("Five St. Andrew's Hill",'5sah.co.uk'), true);
  check('accepts a direct name match', nameMatchesDomain('Physical Gold','physicalgold.com'), true);
  check('declines to judge an all-generic name', nameMatchesDomain('The Law Partnership','xyz.co.uk'), null);
  check('warning reaches the reasons',
    /may not belong/.test(lead({ company_name: 'Perrys Chartered Accountants', normalized_domain: 'themercer.co.uk' }).reasons), true);
}

console.log('');
console.log('reachability');
check('verified email beats none',
  lead({ email_valid: 'ok:mailto:own' }).score > lead({ email_valid: 'no_email_found' }).score, true);
check('own domain beats a free mailbox',
  lead({ email_valid: 'ok:mailto:own' }).score > lead({ email_valid: 'ok:mailto:free' }).score, true);
{
  const deadWithPhone = lead({ email_valid: 'fetch_failed', tech_detected: '', phone_e164: '+12125550147' });
  const deadNoPhone = lead({ email_valid: 'fetch_failed', tech_detected: '', phone_e164: '' });
  check('a dead site with a live phone scores higher', deadWithPhone.score > deadNoPhone.score, true);
}

console.log('');
console.log('a crawled web lead outranks a phone-only one');
check('web beats phone-only',
  lead({ tech_detected: 'wordpress,woocommerce' }).score >
  lead({ normalized_domain: '', email_valid: '' }).score, true);

console.log('');
console.log('scores stay inside 0-100');
{
  const best = lead({ tech_detected: 'wordpress,woocommerce', country: 'GB',
                      phone_type: 'mobile', phone_e164: '+447700900123' });
  const worst = lead({ company_name: 'Department of Motor Vehicles',
                       normalized_domain: 'dmv.gov', email_valid: 'fetch_failed',
                       tech_detected: '', phone_e164: '', category: 'other' });
  check('best case in range', best.score > 0 && best.score <= 100, true);
  check('worst case floors at 0', worst.score, 0);
}

console.log('');
console.log(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
