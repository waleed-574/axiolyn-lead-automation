/**
 * Normalises a raw Overpass response into raw_candidates-shaped rows.
 *
 * This is the single source of truth for the logic. `scripts/build-code-node.js`
 * wraps it for the n8n Code node, and `scripts/test-normalize.js` exercises it
 * against the captured fixture — so the tested code and the deployed code
 * cannot drift apart.
 *
 * Dependency-free apart from crypto, because n8n Code nodes cannot import
 * project files.
 */
const crypto = require('crypto');

// --- helpers ---------------------------------------------------------------

/** Overpass spreads contact details across several tag spellings. */
function pick(tags, ...keys) {
  for (const k of keys) {
    const v = tags[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return '';
}

/**
 * Link shorteners and social profiles are not a company's own site. Hashing one
 * as identity would collapse every business behind the same shortener into a
 * single deduplicated lead, silently discarding real prospects.
 */
const NOT_A_HOMEPAGE = new Set([
  'share.google', 'goo.gl', 'g.page', 'maps.app.goo.gl', 'google.com',
  'sites.google.com', 'business.site', 'bit.ly', 'tinyurl.com', 'linktr.ee',
  'facebook.com', 'm.facebook.com', 'fb.me', 'fb.com', 'instagram.com',
  'twitter.com', 'x.com', 'linkedin.com', 'youtube.com', 'youtu.be',
  'wa.me', 'api.whatsapp.com', 'chat.whatsapp.com', 'tiktok.com',
]);

/** Strip protocol, www, port, path and query; lowercase. */
function normalizeDomain(url) {
  if (!url) return '';
  let s = String(url).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.split('/')[0].split('?')[0].split('#')[0].split(':')[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return '';

  // Match subdomains too. Google's site builder hands every business a
  // <name>.business.site address; an exact-match check let those through as if
  // they were real company domains, and they are neither crawlable nor a sign
  // the business has a web presence worth scoring.
  for (const blocked of NOT_A_HOMEPAGE) {
    if (s === blocked || s.endsWith('.' + blocked)) return '';
  }
  return s;
}

/**
 * Pakistani phone numbers to E.164, or '' when the input cannot be trusted.
 * Landlines are 9 digits after the country code, mobiles 10.
 */
function toE164PK(raw) {
  if (!raw) return '';
  let s = String(raw).split(/[;,/]|\bor\b/i)[0]; // tags often hold several numbers
  s = s.replace(/\(0\)/g, '').replace(/[^\d+]/g, '');
  if (!s) return '';

  if (s.startsWith('+92')) s = s;
  else if (s.startsWith('0092')) s = '+92' + s.slice(4);
  else if (s.startsWith('92') && s.length >= 11) s = '+92' + s.slice(2);
  else if (s.startsWith('0')) s = '+92' + s.slice(1);
  else if (/^\d{9,10}$/.test(s)) s = '+92' + s;
  else return '';

  return /^\+92\d{9,10}$/.test(s) ? s : '';
}

/** PK mobiles are +923XXXXXXXXX — the numbers reachable on WhatsApp. */
function isMobilePK(e164) {
  return /^\+923\d{9}$/.test(e164);
}

/** Collapse punctuation and company suffixes so name variants match. */
function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\b(pvt|private|ltd|limited|co|company|inc|llc|and|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function categoryOf(tags) {
  if (tags.office) return 'office:' + tags.office;
  if (tags.shop) return 'shop:' + tags.shop;
  if (tags.healthcare) return 'healthcare:' + tags.healthcare;
  if (tags.amenity) return 'amenity:' + tags.amenity;
  if (tags.craft) return 'craft:' + tags.craft;
  return 'other';
}

function addressOf(tags) {
  return [
    pick(tags, 'addr:housenumber'),
    pick(tags, 'addr:street'),
    pick(tags, 'addr:suburb', 'addr:neighbourhood'),
    pick(tags, 'addr:city'),
  ].filter(Boolean).join(', ');
}

/**
 * Institutions and government facilities are not prospects for an automation
 * agency — they do not buy this way. Filtering them here keeps the sheet
 * honest rather than padding the count.
 */
const INSTITUTIONAL = /\b(combined military|cmh|army|navy|air force|government|govt|district headquarters|dhq|thq|tehsil|punjab government|social security|railway|police|jail|prison|university|college of|medical college|public school)\b/i;

// --- main ------------------------------------------------------------------

/**
 * @param {Array}  elements  Overpass `elements` array
 * @param {Object} opts      { city, sourceQuery, now }
 * @returns {{rows: Array, stats: Object}}
 */
function normalizeOverpass(elements, opts) {
  const city = (opts && opts.city) || '';
  const sourceQuery = (opts && opts.sourceQuery) || 'overpass';
  const now = (opts && opts.now) || new Date().toISOString();

  const stats = {
    received: elements.length,
    unnamed: 0,
    institutional: 0,
    noContact: 0,
    dupInRun: 0,
    web: 0,
    noWeb: 0,
  };

  const rows = [];
  const seen = new Set();

  for (const el of elements) {
    const tags = el.tags || {};
    const name = pick(tags, 'name:en', 'name');
    if (!name) { stats.unnamed++; continue; }

    if (INSTITUTIONAL.test(name)) { stats.institutional++; continue; }

    const rawPhone = pick(tags, 'phone', 'contact:phone', 'contact:mobile', 'mobile');
    const rawSite = pick(tags, 'website', 'contact:website', 'url');

    const phone = toE164PK(rawPhone);
    const domain = normalizeDomain(rawSite);

    // No reachable channel is not a lead.
    if (!phone && !domain) { stats.noContact++; continue; }

    // Domain is the stronger identity; otherwise name + city + phone.
    const lead_id = domain
      ? sha1(domain)
      : sha1([normalizeName(name), city.toLowerCase(), phone].join('|'));

    if (seen.has(lead_id)) { stats.dupInRun++; continue; }
    seen.add(lead_id);

    const hasWebsite = Boolean(domain);
    if (hasWebsite) stats.web++; else stats.noWeb++;

    rows.push({
      candidate_id: lead_id,
      lead_id,
      company_name: name,
      website: domain ? 'https://' + domain : '',
      normalized_domain: domain,
      phone_raw: rawPhone,
      phone_e164: phone,
      whatsapp_ready: phone ? isMobilePK(phone) : false,
      address: addressOf(tags),
      city,
      country: 'Pakistan',
      region: 'PK',
      category: categoryOf(tags),
      source: 'osm_overpass',
      source_query: sourceQuery,
      discovered_at: now,
      status: 'new',
      has_website: hasWebsite,
    });
  }

  return { rows, stats };
}

module.exports = {
  normalizeOverpass,
  normalizeDomain,
  toE164PK,
  isMobilePK,
  normalizeName,
  NOT_A_HOMEPAGE,
};
