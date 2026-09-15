/**
 * Offline regression tests for the scoring rules.
 *
 * Each case here comes from a lead that the model got wrong against real data,
 * so a future weight change cannot silently reintroduce the same mistake.
 *
 *   node scripts/test-scoring-rules.js
 */
const { scoreWebLead, scoreNoWebLead } = require('../workflows/src/score-leads');

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`}`);
  if (!ok) failed++;
}

const web = (o) => scoreWebLead(Object.assign({
  company_name: 'Acme Clinic',
  normalized_domain: 'acme.com.pk',
  email_valid: 'ok:mailto:own',
  tech_detected: 'wordpress',
  whatsapp_ready: 'FALSE',
  city: 'Lahore',
  industry: 'amenity:clinic',
  phone_e164: '',
}, o));

const noweb = (o) => scoreNoWebLead(Object.assign({
  company_name: 'Acme Clinic',
  phone_e164: '+923001234567',
  whatsapp_ready: 'TRUE',
  address: '12 Main Blvd, Gulberg, Lahore',
  city: 'Lahore',
  category: 'amenity:clinic',
}, o));

console.log('not-yet-enriched leads stay out of the ranking');
check('unenriched returns pending', web({ email_valid: '' }).pending, true);
check('unenriched has no score', web({ email_valid: '' }).score, '');

console.log('');
console.log('the central signal: absence of automation');
{
  const clean = web({ tech_detected: 'wordpress,woocommerce' });
  const served = web({ tech_detected: 'wordpress,woocommerce,hubspot' });
  check('no CRM scores higher than already-automated', clean.score > served.score, true);
  check('reason names the tool they already use', /already uses hubspot/.test(served.reasons), true);
  // A site we could not fingerprint at all must not earn the no-CRM bonus.
  check('no tech detected earns no bonus',
    /no CRM or booking tool/.test(web({ tech_detected: '' }).reasons), false);
}

console.log('');
console.log('institutions and nonprofits are demoted');
{
  // سروسز ہسپتال scored 80 because the English-only name check could not read
  // it; its .edu.pk domain is what gives it away.
  const gov = web({ company_name: 'سروسز ہسپتال', normalized_domain: 'sims.edu.pk' });
  check('academic domain demoted despite unreadable name', gov.score < 60, true);
  check('reason explains why', /academic institution/.test(gov.reasons), true);

  check('gov domain heavily demoted',
    web({ company_name: 'Some Office', normalized_domain: 'punjab.gov.pk' }).score < 25, true);
  check('named public body demoted',
    web({ company_name: 'Defense Housing Authority Office' }).score < 25, true);
  check('charity demoted',
    web({ company_name: 'Alkhidmat Foundation Pakistan' }).score < 50, true);
  check('a normal clinic is not demoted',
    /public body|academic|charity/.test(web({}).reasons), false);
  // "Trust" as a whole word only — a business legitimately called
  // "Trustworthy Motors" must not be mistaken for a charitable trust.
  check('does not demote a business merely containing "trust"',
    /charity or NGO/.test(web({ company_name: 'Trustworthy Motors' }).reasons), false);
}

console.log('');
console.log('a dead website with a live phone is still a lead');
{
  const withPhone = web({ email_valid: 'fetch_failed', phone_e164: '+923001234567', tech_detected: '' });
  const without = web({ email_valid: 'fetch_failed', phone_e164: '', tech_detected: '' });
  check('phone softens the penalty', withPhone.score > without.score, true);
  check('reason says the phone works', /phone works/.test(withPhone.reasons), true);
  check('no phone is the harsher case', /no phone/.test(without.reasons), true);
}

console.log('');
console.log('reachability ranks above nothing');
{
  check('verified email beats none',
    web({ email_valid: 'ok:mailto:own' }).score > web({ email_valid: 'no_email_found' }).score, true);
  check('own-domain address beats a free one',
    web({ email_valid: 'ok:mailto:own' }).score > web({ email_valid: 'ok:mailto:free' }).score, true);
  check('a domain that cannot receive mail is penalised',
    web({ email_valid: 'nomx:text:own' }).score < web({ email_valid: 'ok:text:own' }).score, true);
}

console.log('');
console.log('phone-only leads are ordered, not tied');
{
  const clinic = noweb({ category: 'amenity:clinic' });
  const lawyer = noweb({ category: 'office:lawyer' });
  const shoemaker = noweb({ category: 'craft:shoemaker' });
  const kiosk = noweb({ category: 'shop:kiosk' });
  check('high-value category beats an unclassified craft', clinic.score > shoemaker.score, true);
  check('professional services rank well', lawyer.score > shoemaker.score, true);
  check('small operators rank lowest', kiosk.score < shoemaker.score, true);
  check('landline scores below mobile',
    noweb({ whatsapp_ready: 'FALSE' }).score < noweb({ whatsapp_ready: 'TRUE' }).score, true);
}

console.log('');
console.log('a qualified web lead outranks a phone-only one');
check('best web beats best no-web',
  web({ tech_detected: 'wordpress,woocommerce', whatsapp_ready: 'TRUE' }).score > noweb({}).score, true);

console.log('');
console.log('scores stay inside 0-100');
{
  const everything = web({
    tech_detected: 'wordpress,woocommerce', whatsapp_ready: 'TRUE',
    email_valid: 'ok:mailto:own', city: 'Lahore', industry: 'amenity:clinic',
  });
  const nothing = web({
    company_name: 'Government Board of Authority', normalized_domain: 'x.gov.pk',
    email_valid: 'fetch_failed', tech_detected: '', phone_e164: '', city: 'Nowhere',
    industry: 'other',
  });
  check('best case is within range', everything.score <= 100 && everything.score > 0, true);
  check('worst case floors at 0', nothing.score, 0);
}

console.log('');
console.log(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
