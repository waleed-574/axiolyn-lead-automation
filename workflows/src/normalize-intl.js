/**
 * Normalises an Overpass response into US/UK lead rows.
 *
 * Separate from `normalize-overpass.js` (Pakistan) rather than parameterised,
 * because the two markets differ in more than a country code: the output
 * schema is a single list per country instead of a web/no-web split, phone
 * rules differ, and WhatsApp means something in the UK and almost nothing in
 * the US.
 */
const crypto = require('crypto');
const { toE164, isMobile } = require('./phone');
// Plain-language label so a row says 'Law firm' rather than 'office:lawyer'.
const { businessType } = require('./business-type');

function pick(tags, ...keys) {
  for (const k of keys) {
    const v = tags[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return '';
}

/**
 * Hosts that are not a company's own site. Matched on suffix, so Google's
 * per-business `<name>.business.site` addresses are excluded too.
 */
const NOT_A_HOMEPAGE = new Set([
  'share.google', 'goo.gl', 'g.page', 'maps.app.goo.gl', 'google.com',
  'sites.google.com', 'business.site', 'bit.ly', 'tinyurl.com', 'linktr.ee',
  'facebook.com', 'm.facebook.com', 'fb.me', 'fb.com', 'instagram.com',
  'twitter.com', 'x.com', 'linkedin.com', 'youtube.com', 'youtu.be',
  'wa.me', 'api.whatsapp.com', 'chat.whatsapp.com', 'tiktok.com',
  'yelp.com', 'yell.com', 'tripadvisor.com', 'opentable.com',
  'doordash.com', 'ubereats.com', 'justeat.co.uk', 'deliveroo.co.uk',
  'square.site', 'wixsite.com', 'weebly.com', 'godaddysites.com',
]);

function normalizeDomain(url) {
  if (!url) return '';
  let s = String(url).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.split('/')[0].split('?')[0].split('#')[0].split(':')[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return '';
  for (const blocked of NOT_A_HOMEPAGE) {
    if (s === blocked || s.endsWith('.' + blocked)) return '';
  }
  return s;
}

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\b(ltd|limited|llp|plc|inc|llc|corp|corporation|co|company|group|the|and)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

function categoryOf(tags) {
  if (tags.office) return 'office:' + tags.office;
  if (tags.shop) return 'shop:' + tags.shop;
  if (tags.healthcare) return 'healthcare:' + tags.healthcare;
  if (tags.amenity) return 'amenity:' + tags.amenity;
  if (tags.craft) return 'craft:' + tags.craft;
  if (tags.tourism) return 'tourism:' + tags.tourism;
  if (tags.leisure) return 'leisure:' + tags.leisure;
  return 'other';
}

function addressOf(tags) {
  return [
    pick(tags, 'addr:housenumber'),
    pick(tags, 'addr:street'),
    pick(tags, 'addr:suburb', 'addr:neighbourhood', 'addr:district'),
    pick(tags, 'addr:city'),
    pick(tags, 'addr:postcode'),
  ].filter(Boolean).join(', ');
}

/**
 * Public bodies and chains. Chains matter more here than in Pakistan: a
 * Starbucks branch is an OSM entry like any other, but it is not a prospect —
 * the decision is made at head office, not the shop.
 */
const NOT_A_PROSPECT = /\b(city of|county of|department of|federal|municipal|government|council|nhs\b|hm revenue|dvla|police|fire department|public library|post office|dmv|social security|embassy|consulate)\b/i;

const CHAINS = /^(starbucks|mcdonald'?s|subway|kfc|burger king|domino'?s|pizza hut|costa|pret|greggs|nando'?s|wagamama|tesco|sainsbury'?s|asda|morrisons|aldi|lidl|co-?op|waitrose|marks & spencer|boots|superdrug|walgreens|cvs|rite aid|7-eleven|walmart|target|home depot|lowe'?s|best buy|dunkin|chipotle|wendy'?s|taco bell|papa john'?s|five guys|shell|bp|esso|texaco|chevron|exxon|mobil|hsbc|barclays|natwest|lloyds|santander|chase|wells fargo|bank of america|citibank)\b/i;

/**
 * @param {Array}  elements  Overpass `elements`
 * @param {Object} opts      { country, city, sourceQuery, now }
 * @returns {{rows: Array, stats: Object}}
 */
function normalizeIntl(elements, opts) {
  const country = (opts && opts.country) || '';
  const city = (opts && opts.city) || '';
  const sourceQuery = (opts && opts.sourceQuery) || 'overpass';
  const now = (opts && opts.now) || new Date().toISOString();

  const stats = {
    received: elements.length,
    unnamed: 0, institutional: 0, chain: 0, noContact: 0, dupInRun: 0,
    web: 0, phoneOnly: 0,
  };

  const rows = [];
  const seen = new Set();

  for (const el of elements) {
    const tags = el.tags || {};
    const name = pick(tags, 'name:en', 'name');
    if (!name) { stats.unnamed++; continue; }
    if (NOT_A_PROSPECT.test(name)) { stats.institutional++; continue; }
    if (CHAINS.test(name.trim())) { stats.chain++; continue; }

    const rawPhone = pick(tags, 'phone', 'contact:phone', 'contact:mobile', 'mobile');
    const rawSite = pick(tags, 'website', 'contact:website', 'url');

    const phone = toE164(rawPhone, country);
    const domain = normalizeDomain(rawSite);
    if (!phone && !domain) { stats.noContact++; continue; }

    const lead_id = domain
      ? sha1(domain)
      : sha1([normalizeName(name), city.toLowerCase(), phone].join('|'));

    if (seen.has(lead_id)) { stats.dupInRun++; continue; }
    seen.add(lead_id);

    if (domain) stats.web++; else stats.phoneOnly++;

    rows.push({
      lead_id,
      company_name: name,
      website: domain ? 'https://' + domain : '',
      normalized_domain: domain,
      email: '',
      email_valid: '',
      phone_e164: phone,
      // The North American plan does not mark mobiles, so this reads "unknown"
      // in the US rather than claiming something untrue.
      phone_type: phone ? (isMobile(phone, country) ? 'mobile' : (country === 'US' ? 'unknown' : 'landline')) : '',
      city,
      country,
      category: categoryOf(tags),
      business_type: businessType(categoryOf(tags)),
      service_fit: '',
      score: '',
      score_reasons: '',
      tech_detected: '',
      source: 'osm_overpass',
      date_found: now,
      last_seen: now,
      contact_status: '',
      notes: addressOf(tags),
      __sourceQuery: sourceQuery,
      __hasWebsite: Boolean(domain),
    });
  }

  return { rows, stats };
}

module.exports = { normalizeIntl, normalizeDomain, normalizeName, NOT_A_PROSPECT, CHAINS };
