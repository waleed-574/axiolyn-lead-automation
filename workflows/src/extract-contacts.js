/**
 * Extracts business contact details from a company's own web page.
 *
 * Ordered by precision, highest first — a `mailto:` link is a fact, a regex
 * match over page text is a guess:
 *
 *   1. mailto: / tel: links in the markup
 *   2. Cloudflare's obfuscated addresses (data-cfemail / #email-protection)
 *   3. JSON-LD structured data
 *   4. free-text regex, last resort
 *
 * Dependency-free: this is inlined into an n8n Code node, which has no module
 * system.
 */

// --- page discovery --------------------------------------------------------

/**
 * Paths worth trying before the homepage. Ordered by how likely they are to
 * carry a real address rather than a contact form.
 */
const CONTACT_PATHS = [
  '/contact', '/contact-us', '/contactus', '/contact.html', '/contact.php',
  '/about', '/about-us', '/about.html',
  '/get-in-touch', '/reach-us', '/support',
];

/** Absolute URLs to try for a domain, best candidates first. */
function candidateUrls(domain) {
  const base = 'https://' + domain;
  return [base, ...CONTACT_PATHS.map((p) => base + p)];
}

// --- email hygiene ---------------------------------------------------------

/**
 * Addresses that belong to tooling, not the business. Without this the most
 * common "email" scraped from a WordPress site is the theme author's.
 */
const JUNK_DOMAINS = [
  'example.com', 'example.org', 'domain.com', 'yourdomain.com', 'email.com',
  'sentry.io', 'wixpress.com', 'wix.com', 'godaddy.com', 'squarespace.com',
  'shopify.com', 'cloudflare.com', 'jquery.com', 'bootstrapcdn.com',
  'googleapis.com', 'gstatic.com', 'w3.org', 'schema.org', 'mozilla.org',
  'sentry-cdn.com', 'automattic.com', 'wordpress.org', 'wpengine.com',
];

const JUNK_LOCALPARTS = [
  'example', 'youremail', 'your-email', 'email', 'name', 'firstname',
  'test', 'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'postmaster',
  'abuse', 'webmaster@sentry', 'user', 'username', 'someone', 'sample',
];

/** Image and asset filenames regularly match an email regex. */
const ASSET_EXT = /\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|eot|mp4|pdf)$/i;

function isJunkEmail(email) {
  const e = String(email).toLowerCase().trim();
  if (!e || e.length > 100) return true;
  if (ASSET_EXT.test(e)) return true;
  if (/@\d+x\./.test(e)) return true;              // @2x.png sprites
  if (/\.(png|jpg|gif|svg)@/.test(e)) return true;

  const at = e.lastIndexOf('@');
  if (at < 1) return true;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);

  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return true;
  if (JUNK_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d))) return true;
  if (JUNK_LOCALPARTS.includes(local)) return true;
  if (/^[0-9a-f]{16,}$/.test(local)) return true;  // hashes, not humans
  return false;
}

/**
 * Role addresses beat personal ones for cold outreach: they survive staff
 * turnover and reaching them is not a privacy intrusion.
 */
const ROLE_RANK = [
  'info', 'contact', 'hello', 'sales', 'enquiry', 'enquiries', 'inquiry',
  'inquiries', 'office', 'admin', 'support', 'business', 'marketing', 'hr',
];

function scoreEmail(email, siteDomain) {
  const e = String(email).toLowerCase();
  const [local, domain] = e.split('@');
  let score = 0;

  // An address on the company's own domain is far more likely to be theirs.
  if (siteDomain && (domain === siteDomain || domain.endsWith('.' + siteDomain))) score += 50;
  else if (/gmail\.com|yahoo\.|hotmail\.|outlook\./.test(domain)) score += 10;

  const roleIdx = ROLE_RANK.indexOf(local);
  if (roleIdx >= 0) score += 30 - roleIdx;
  return score;
}

// --- Cloudflare de-obfuscation ---------------------------------------------

/**
 * Cloudflare rewrites addresses to a hex blob whose first byte is an XOR key.
 * A great many small business sites sit behind Cloudflare, so skipping this
 * loses real addresses that are plainly visible to a human reader.
 */
function decodeCfEmail(hex) {
  try {
    const s = String(hex || '');
    if (!/^[0-9a-fA-F]{4,}$/.test(s) || s.length % 2 !== 0) return '';
    const key = parseInt(s.slice(0, 2), 16);
    if (!Number.isFinite(key)) return '';
    let out = '';
    for (let i = 2; i < s.length; i += 2) {
      const byte = parseInt(s.slice(i, i + 2), 16);
      if (!Number.isFinite(byte)) return '';
      out += String.fromCharCode(byte ^ key);
    }
    return out;
  } catch (e) {
    return '';
  }
}

/** Strip zero-width and bidi characters that web pages hide inside contact details. */
function stripInvisible(s) {
  return String(s == null ? '' : s)
    .replace(/[​-‏‪-‮⁠﻿­]/g, '');
}

/**
 * Free mail providers that a small business legitimately uses as its public
 * address — common in Pakistan, so these are trusted despite not matching the
 * site's own domain.
 */
const FREE_MAIL = /^(gmail|yahoo|ymail|hotmail|outlook|live|msn|aol|proton|protonmail|icloud|zoho)\.(com|co\.uk|pk|net)$/;

/**
 * Rejects an address whose domain has nothing to do with the site it was found
 * on. Hacked sites carry injected spam addresses — pakhockey.org served a
 * Cloudflare-encoded `info@breitlingreplica.is` — and those decode perfectly,
 * rank well, and are indistinguishable from a real find without this check.
 */
function isForeignDomain(email, siteDomain) {
  if (!siteDomain) return false;
  const domain = String(email).toLowerCase().split('@')[1] || '';
  if (!domain) return true;
  if (domain === siteDomain || domain.endsWith('.' + siteDomain)) return false;
  // The site may sit on a subdomain of the mail domain, or vice versa.
  if (siteDomain.endsWith('.' + domain)) return false;
  if (FREE_MAIL.test(domain)) return false;
  // Same registrable name under a different TLD, e.g. acme.pk vs acme.com
  const stem = (d) => d.split('.')[0];
  if (stem(domain) && stem(domain) === stem(siteDomain)) return false;
  return true;
}

// --- extraction ------------------------------------------------------------

function extractEmails(html, siteDomain) {
  const found = new Map(); // email -> source, keeping the most precise source

  const rejected = [];
  const add = (raw, source) => {
    const e = stripInvisible(raw).trim().toLowerCase().replace(/^mailto:/, '').split('?')[0];
    if (!e || isJunkEmail(e)) return;
    if (isForeignDomain(e, siteDomain)) {
      // Kept for visibility rather than silently dropped — a genuine address on
      // a parent-company domain would show up here too.
      if (!rejected.includes(e)) rejected.push(e);
      return;
    }
    if (!found.has(e)) found.set(e, source);
  };

  // 1. mailto: links — an explicit declaration, not an inference
  const mailtoRe = /href\s*=\s*["']\s*mailto:([^"'?>\s]+)/gi;
  let m;
  while ((m = mailtoRe.exec(html))) add(m[1], 'mailto');

  // 2. Cloudflare-protected addresses
  const cfRe = /data-cfemail\s*=\s*["']([0-9a-fA-F]+)["']/g;
  while ((m = cfRe.exec(html))) {
    const decoded = decodeCfEmail(m[1]);
    if (decoded.includes('@')) add(decoded, 'cloudflare');
  }

  // 3. JSON-LD structured data
  const jsonLdRe = /"email"\s*:\s*"([^"]+)"/gi;
  while ((m = jsonLdRe.exec(html))) add(m[1], 'jsonld');

  // 4. free text, last resort
  const textRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  while ((m = textRe.exec(html))) add(m[0], 'text');

  const ranked = [...found.entries()]
    .map(([email, source]) => ({ email, source, score: scoreEmail(email, siteDomain) }))
    .sort((a, b) => b.score - a.score);

  ranked.rejectedForeign = rejected;
  return ranked;
}

function extractPhones(html) {
  const out = new Set();
  const telRe = /href\s*=\s*["']\s*tel:([^"'>\s]+)/gi;
  let m;
  while ((m = telRe.exec(html))) {
    const v = stripInvisible(decodeURIComponent(m[1])).trim();
    if (v) out.add(v);
  }
  return [...out];
}

/** Social profiles are a usable fallback channel when no email is published. */
function extractSocials(html) {
  const socials = {};
  const patterns = {
    facebook: /https?:\/\/(?:www\.)?facebook\.com\/([A-Za-z0-9._-]{3,})/i,
    instagram: /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._-]{3,})/i,
    linkedin: /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|in)\/([A-Za-z0-9._-]{2,})/i,
    whatsapp: /https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send)\S*?(\d{10,15})/i,
  };
  for (const [k, re] of Object.entries(patterns)) {
    const m = html.match(re);
    if (m) socials[k] = m[0].split('"')[0].split("'")[0];
  }
  return socials;
}

/**
 * Tech fingerprinting. The absence of a CRM, booking tool or marketing
 * automation is the strongest buy signal for an automation agency, so this
 * feeds scoring directly rather than being trivia.
 */
const TECH_SIGNATURES = [
  ['wordpress', /wp-content|wp-includes|wordpress/i],
  ['shopify', /cdn\.shopify\.com|shopify\.theme/i],
  ['woocommerce', /woocommerce/i],
  ['wix', /wix\.com|wixstatic/i],
  ['squarespace', /squarespace/i],
  ['webflow', /webflow/i],
  ['hubspot', /hs-scripts\.com|hubspot/i],
  ['salesforce', /salesforce|pardot/i],
  ['zoho', /zoho\.com|zohopublic/i],
  ['intercom', /intercom\.io|widget\.intercom/i],
  ['drift', /drift\.com/i],
  ['tawk', /tawk\.to/i],
  ['crisp', /crisp\.chat/i],
  ['calendly', /calendly\.com/i],
  ['google_analytics', /google-analytics\.com|gtag\/js|googletagmanager/i],
  ['facebook_pixel', /connect\.facebook\.net.*fbevents/i],
  ['mailchimp', /mailchimp|list-manage\.com/i],
  ['react', /__NEXT_DATA__|react-dom|_next\/static/i],
  ['jquery', /jquery/i],
];

/** Tools that indicate the business already automates part of its funnel. */
const AUTOMATION_TECH = new Set([
  'hubspot', 'salesforce', 'zoho', 'intercom', 'drift', 'tawk', 'crisp',
  'calendly', 'mailchimp',
]);

function detectTech(html) {
  const found = [];
  for (const [name, re] of TECH_SIGNATURES) if (re.test(html)) found.push(name);
  return found;
}

/** Signals a site is stale — an outdated presence suggests unmet need. */
function detectStaleness(html) {
  const years = [...html.matchAll(/(?:©|&copy;|copyright)[^0-9]{0,20}(20\d{2})/gi)]
    .map((m) => parseInt(m[1], 10))
    .filter((y) => y >= 2000 && y <= 2100);
  const newest = years.length ? Math.max(...years) : null;
  return { copyrightYear: newest };
}

/** True when the page offers only a form, with no address to write to. */
function hasContactFormOnly(html, emails) {
  const hasForm = /<form[^>]*>/i.test(html);
  return hasForm && emails.length === 0;
}

/**
 * Pull everything of interest out of one page.
 * @param {string} html
 * @param {string} siteDomain  registrable domain, used to prefer own-domain addresses
 */
function extractFromPage(html, siteDomain) {
  const emails = extractEmails(html, siteDomain);
  const tech = detectTech(html);
  return {
    emails,
    phones: extractPhones(html),
    socials: extractSocials(html),
    tech,
    automationTech: tech.filter((t) => AUTOMATION_TECH.has(t)),
    stale: detectStaleness(html),
    formOnly: hasContactFormOnly(html, emails),
  };
}

module.exports = {
  CONTACT_PATHS,
  stripInvisible,
  isForeignDomain,
  candidateUrls,
  decodeCfEmail,
  isJunkEmail,
  scoreEmail,
  extractEmails,
  extractPhones,
  extractSocials,
  detectTech,
  detectStaleness,
  extractFromPage,
  AUTOMATION_TECH,
};
