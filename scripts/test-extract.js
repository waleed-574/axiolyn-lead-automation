/**
 * Exercises the contact extractor against real captured company pages plus
 * unit cases for the fiddly parts. Offline and repeatable.
 *
 *   node scripts/test-extract.js
 */
const fs = require('fs');
const path = require('path');
const {
  decodeCfEmail, isJunkEmail, extractEmails, extractPhones,
  detectTech, detectStaleness, extractFromPage, candidateUrls,
} = require('../workflows/src/extract-contacts');

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`}`);
  if (!ok) failed++;
}

console.log('Cloudflare de-obfuscation');
{
  // Build a known-good blob the way Cloudflare does: XOR every byte with a key
  // and prefix the key.
  const encode = (email, key) => {
    let hex = key.toString(16).padStart(2, '0');
    for (const ch of email) hex += (ch.charCodeAt(0) ^ key).toString(16).padStart(2, '0');
    return hex;
  };
  check('round-trips an address', decodeCfEmail(encode('info@axiolyn.com', 0x5a)), 'info@axiolyn.com');
  check('works with another key', decodeCfEmail(encode('sales@example.pk', 0x21)), 'sales@example.pk');
  check('survives garbage', decodeCfEmail('zzzz'), '');
  check('rejects odd-length blob', decodeCfEmail('5a6b7'), '');
}

console.log('');
console.log('junk filtering');
check('rejects theme author domain', isJunkEmail('hello@wixpress.com'), true);
check('rejects placeholder', isJunkEmail('your-email@example.com'), true);
check('rejects image sprite', isJunkEmail('logo@2x.png'), true);
check('rejects asset', isJunkEmail('icon@fonts.gstatic.com'), true);
check('rejects hash localpart', isJunkEmail('a1b2c3d4e5f60718@somewhere.com'), true);
check('rejects noreply', isJunkEmail('noreply@realcompany.pk'), true);
check('keeps a real business address', isJunkEmail('info@techlogix.com'), false);
check('keeps a gmail business address', isJunkEmail('axiolyn2026@gmail.com'), false);

console.log('');
console.log('foreign-domain rejection (spam injected on hacked sites)');
{
  const { isForeignDomain, stripInvisible } = require('../workflows/src/extract-contacts');
  check('rejects spam TLD', isForeignDomain('info@breitlingreplica.is', 'pakhockey.org'), true);
  check('keeps a related company domain', isForeignDomain('info@dhmc.com.pk', 'doctorshospital.com.pk'), false);
  const { scoreEmail } = require('../workflows/src/extract-contacts');
  check('role on related domain beats personal gmail',
    scoreEmail('info@dhmc.com.pk','doctorshospital.com.pk') > scoreEmail('sanamrana222@gmail.com','doctorshospital.com.pk'), true);
  check('keeps own domain', isForeignDomain('info@acme.pk', 'acme.pk'), false);
  check('keeps subdomain of site', isForeignDomain('a@mail.acme.pk', 'acme.pk'), false);
  check('keeps gmail', isForeignDomain('acme2026@gmail.com', 'acme.pk'), false);
  check('keeps same name, other TLD', isForeignDomain('info@acme.com', 'acme.pk'), false);
  check('strips zero-width chars', stripInvisible('+92304​1115551'), '+923041115551');
}

console.log('');
console.log('email ranking');
{
  const html = `
    <a href="mailto:ceo.personal@gmail.com">me</a>
    <a href="mailto:info@acme.com.pk">general</a>
    <a href="mailto:sales@acme.com.pk">sales</a>`;
  const ranked = extractEmails(html, 'acme.com.pk');
  check('own-domain role address ranks first', ranked[0].email, 'info@acme.com.pk');
  check('all three survive the junk filter', ranked.length, 3);
  check('source recorded as mailto', ranked[0].source, 'mailto');
}

console.log('');
console.log('candidate URLs');
check('homepage tried first', candidateUrls('acme.pk')[0], 'https://acme.pk');
check('contact page is a candidate', candidateUrls('acme.pk').includes('https://acme.pk/contact'), true);

console.log('');
console.log('tech fingerprinting');
check('spots wordpress', detectTech('<link href="/wp-content/themes/x.css">').includes('wordpress'), true);
check('spots hubspot', detectTech('<script src="//js.hs-scripts.com/123.js">').includes('hubspot'), true);
check('spots analytics', detectTech('<script src="https://www.googletagmanager.com/gtag/js">').includes('google_analytics'), true);
check('clean html yields nothing', detectTech('<html><body>hi</body></html>'), []);

console.log('');
console.log('staleness');
check('reads copyright year', detectStaleness('<p>&copy; 2019 Acme</p>').copyrightYear, 2019);
check('takes the newest year', detectStaleness('© 2018 Acme. Copyright 2024 Acme').copyrightYear, 2024);
check('absent when no notice', detectStaleness('<p>nothing</p>').copyrightYear, null);

console.log('');
console.log('synthetic page — every hazard found on real sites');
{
  // Committed rather than the real captured pages: this exercises the same
  // traps without republishing another company's HTML, so CI covers them too.
  const synth = fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'synthetic-contact-page.html'), 'utf8');
  const r = extractFromPage(synth, 'alnoormedical.com.pk');
  const emails = r.emails.map((e) => e.email);

  check('recovers the Cloudflare-obfuscated address',
    emails.includes('info@alnoormedical.com.pk'), true);
  check('own-domain role address ranks first',
    r.emails[0].email, 'info@alnoormedical.com.pk');
  check('personal gmail does not outrank it',
    r.emails.findIndex((e) => e.email === 'dr.ahmed1987@gmail.com') > 0, true);
  check('rejects spam on a suspicious TLD',
    emails.some((e) => /replicawatches/.test(e)), false);
  check('rejects the theme author address',
    emails.some((e) => /wixpress/.test(e)), false);
  check('rejects asset filenames',
    emails.some((e) => /2x\.png|gstatic/.test(e)), false);
  check('strips the zero-width space from the phone',
    r.phones[0], '+923041115551');
  check('detects wordpress and woocommerce',
    ['wordpress', 'woocommerce'].every((t) => r.tech.includes(t)), true);
  check('finds no automation tooling', r.automationTech, []);
  check('reads the stale copyright year', r.stale.copyrightYear, 2019);
}

console.log('');
console.log('real captured pages');
const dir = path.join(__dirname, '..', 'fixtures', 'sites');
const manifestPath = path.join(dir, 'manifest.json');
// The captured pages are deliberately not committed, so this section is a
// local-only extra. CI relies on the synthetic fixture above.
const manifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      .filter((e) => fs.existsSync(path.join(dir, e.file)))
  : [];
if (!manifest.length) {
  console.log('  skipped — no captured pages present (they are not committed)');
}

let withEmail = 0;
let withPhone = 0;
const rows = [];
for (const entry of manifest) {
  const html = fs.readFileSync(path.join(dir, entry.file), 'utf8');
  const r = extractFromPage(html, entry.domain);
  if (r.emails.length) withEmail++;
  if (r.phones.length) withPhone++;
  rows.push({
    domain: entry.domain,
    email: r.emails[0] ? r.emails[0].email : '',
    src: r.emails[0] ? r.emails[0].source : '',
    nEmails: r.emails.length,
    phone: r.phones[0] || '',
    tech: r.tech.slice(0, 3).join(','),
    autom: r.automationTech.join(',') || '-',
    year: r.stale.copyrightYear || '-',
  });
}

rows.forEach((r) => console.log(
  `  ${r.domain.slice(0, 24).padEnd(26)}${(r.email || '(none)').slice(0, 30).padEnd(32)}` +
  `${r.src.padEnd(11)}${String(r.phone || '-').slice(0, 16).padEnd(18)}${r.autom.padEnd(12)}${r.year}`));

console.log('');
console.log(`  pages with an email: ${withEmail}/${manifest.length}`);
console.log(`  pages with a phone : ${withPhone}/${manifest.length}`);

if (manifest.length) {
  check('extracts an email from most real pages', withEmail >= Math.ceil(manifest.length / 2), true);
}
check('no junk leaked into the top pick',
  rows.every((r) => !r.email || !isJunkEmail(r.email)), true);

console.log('');
console.log(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
