/**
 * Scores a US or UK lead 0-100, with a plain-language reason for every rule.
 *
 * Separate from the Pakistan model rather than parameterised, because the
 * markets differ in ways that change the weights, not just the constants:
 *
 *  - A US or UK business with no CRM is rarer, so its absence is a stronger
 *    signal than the same finding in Pakistan.
 *  - WhatsApp is a normal business channel in the UK and marginal in the US,
 *    and the North American numbering plan cannot identify a mobile at all.
 *  - `.gov` / `.edu` / `.ac.uk` / `.nhs.uk` mark institutions that do not buy
 *    this way, whatever their category says.
 */

/** Tools that mean the business already automates part of its funnel. */
const AUTOMATION_TOOLS = [
  'hubspot', 'salesforce', 'zoho', 'intercom', 'drift', 'tawk', 'crisp',
  'calendly', 'mailchimp',
];

const COMMERCE_TOOLS = ['woocommerce', 'shopify'];

const VERTICAL_PATTERNS = [
  ['E-commerce / retail', /shop:(supermarket|convenience|department_store|mall|general|variety_store|wholesale|trade|clothes|shoes|jewelry|furniture|electronics|computer|mobile_phone|sports|toys|books|bicycle)/],
  ['Healthcare', /(amenity|healthcare):(clinic|doctors|dentist|hospital|pharmacy|veterinary|nursing_home|physiotherapist|psychotherapist)/],
  ['Logistics', /office:(logistics|courier|freight|forwarding|moving_company)/],
  ['Real estate', /(office|shop):(estate_agent|property|property_management)/],
  ['Professional services', /office:(lawyer|accountant|tax_advisor|consulting|insurance|financial|architect|engineer|notary|surveyor|employment_agency)/],
  ['Agency / consultancy', /office:(advertising_agency|marketing|it|research|company|coworking|newspaper)/],
  ['Education / training', /amenity:(school|college|university|language_school|driving_school|music_school|training|prep_school)/],
  ['SaaS / tech', /office:(it|software|telecommunication)/],
  ['Hospitality', /(tourism:(hotel|guest_house|motel|hostel|resort)|amenity:(restaurant|cafe|bar|pub))/],
];

/**
 * Institutions, by domain. Far more reliable than matching names, which fails
 * on anything not written in plain English.
 */
const GOV_DOMAIN = /\.(gov|mil|gov\.uk|mod\.uk)$/i;
const EDU_DOMAIN = /\.(edu|ac\.uk|sch\.uk)$/i;
const NHS_DOMAIN = /\.nhs\.uk$/i;

const INSTITUTIONAL = /\b(city of|county of|department of|federal|municipal|government|council|nhs\b|hm revenue|dvla|police|fire department|public library|post office|dmv|social security|embassy|consulate|state of|borough of)\b/i;

const NONPROFIT = /\b(foundation|charitable|charity|\btrust\b|welfare|relief|ngo|non-?profit|humanitarian|philanthrop|\bcic\b)\b/i;

/** Franchise and multi-site brands: the decision is made at head office. */
const CHAIN = /\b(starbucks|mcdonald|subway|kfc|burger king|domino|pizza hut|costa|pret|greggs|nando|wagamama|tesco|sainsbury|asda|morrisons|aldi|lidl|waitrose|boots|superdrug|walgreens|cvs|walmart|target|home depot|best buy|dunkin|chipotle|wendy|taco bell|five guys|shell|bp\b|esso|chevron|exxon|hsbc|barclays|natwest|lloyds|santander|chase|wells fargo|citibank|regus|wework)\b/i;

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

function matchVertical(category) {
  const s = String(category || '').toLowerCase();
  for (const [name, re] of VERTICAL_PATTERNS) if (re.test(s)) return name;
  return null;
}

function techList(t) {
  return String(t || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
}

/** Words that appear in company names everywhere and prove nothing. */
const NAME_NOISE = new Set([
  'the', 'and', 'ltd', 'limited', 'llp', 'plc', 'inc', 'llc', 'corp', 'company',
  'group', 'partners', 'partnership', 'associates', 'solicitors', 'accountants',
  'chartered', 'consulting', 'consultants', 'services', 'law', 'legal', 'firm',
  'office', 'offices', 'international', 'global', 'uk', 'usa', 'london',
  'newyork', 'new', 'york', 'management', 'capital', 'advisors', 'advisory',
]);

/**
 * Whether the domain visibly relates to the company name.
 *
 * Returns true on a match, false on a clear mismatch, and null when there is
 * not enough to judge — an all-noise name like "The Law Partnership" says
 * nothing either way, and should not be penalised for it.
 */
function nameMatchesDomain(name, domain) {
  const stem = String(domain).split('.')[0].replace(/[^a-z0-9]/g, '');
  if (!stem) return null;

  const words = String(name).toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !NAME_NOISE.has(w));
  if (!words.length) return null;

  if (words.some((w) => stem.includes(w) || w.includes(stem))) return true;

  // Initialisms are extremely common in professional services, and each of
  // these shapes appeared in the first 26 London leads:
  //   "Abrahams Dresden"       → ad-solicitors.co.uk   (plain initials)
  //   "RadcliffesLeBrasseur"   → rlb-law.com           (CamelCase compound)
  //   "Five St. Andrew's Hill" → 5sah.co.uk            (number spelled out)
  const NUMERALS = { one: '1', two: '2', three: '3', four: '4', five: '5',
                     six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };

  const parts = String(name)
    // Split CamelCase before lowercasing, or the word boundaries are lost.
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  // A possessive leaves an orphan letter behind — "Andrew's" becomes
  // ["andrew", "s"] — which corrupts the initials of 5sah.co.uk.
  const meaty = parts.filter((w) => w.length > 1);

  const initialForms = new Set();
  for (const list of [parts, meaty]) {
    if (!list.length) continue;
    initialForms.add(list.map((w) => w[0]).join(''));
    initialForms.add(list.map((w) => NUMERALS[w] || w[0]).join(''));
    // Leading articles are usually dropped from a domain.
    const trimmed = list[0] === 'the' ? list.slice(1) : list;
    initialForms.add(trimmed.map((w) => NUMERALS[w] || w[0]).join(''));
  }

  for (const ini of initialForms) {
    if (ini.length >= 2 && stem.includes(ini)) return true;
  }

  return false;
}

/**
 * @param {Object} lead  a row from Leads_US or Leads_UK
 */
function scoreIntlLead(lead) {
  const hasWebsite = Boolean(String(lead.normalized_domain || '').trim());
  const verdict = String(lead.email_valid || '').trim();

  // A lead with a website nobody has crawled yet would be scored on city and
  // category alone, which would put whatever ran first at the top of the sheet.
  if (hasWebsite && !verdict) {
    return { score: '', reasons: 'not yet crawled', service_fit: '', pending: true };
  }

  const reasons = [];
  const country = String(lead.country || '').toUpperCase();
  let score = 15;

  const tech = techList(lead.tech_detected);
  const automation = tech.filter((t) => AUTOMATION_TOOLS.includes(t));
  const commerce = tech.filter((t) => COMMERCE_TOOLS.includes(t));

  if (hasWebsite) {
    // Worth more here than in Pakistan: a US or UK business with a real site
    // and no CRM at all is genuinely unusual, so it is a sharper signal.
    if (tech.length && !automation.length) {
      score += 28;
      reasons.push('no CRM or booking tool on site');
    } else if (automation.length) {
      score -= 18;
      reasons.push('already uses ' + automation.join(', '));
    }

    if (commerce.length) {
      score += 10;
      reasons.push('runs an online store (' + commerce.join(', ') + ')');
    }
    if (tech.includes('wordpress')) {
      score += 3;
      reasons.push('WordPress site, straightforward to integrate');
    }

    if (verdict.startsWith('ok:')) {
      score += 14;
      reasons.push('email verified');
      if (/:(own|related)$/.test(verdict)) {
        score += 6;
        reasons.push('official company address');
      }
    } else if (verdict.startsWith('nomx:')) {
      score -= 6;
      reasons.push('email domain does not accept mail');
    } else if (verdict === 'fetch_failed') {
      // A dead site is a real negative, but not a dead lead if the phone works.
      if (String(lead.phone_e164 || '').trim()) {
        score -= 5;
        reasons.push('website unreachable, but phone works');
      } else {
        score -= 15;
        reasons.push('website unreachable and no phone');
      }
    } else if (verdict === 'no_email_found') {
      score -= 4;
      reasons.push('no email published');
    }
  } else {
    // Phone-only. In these markets that usually means a very small operator,
    // which is a weaker prospect than it is in Pakistan.
    score += 4;
    reasons.push('no website found');
  }

  const phoneType = String(lead.phone_type || '').toLowerCase();
  if (phoneType === 'mobile' && country === 'GB') {
    // WhatsApp is a normal business channel in the UK.
    score += 7;
    reasons.push('UK mobile, reachable on WhatsApp');
  } else if (String(lead.phone_e164 || '').trim()) {
    score += 4;
    reasons.push('phone number published');
  }

  const vertical = matchVertical(lead.category);
  if (vertical) {
    score += 8;
    reasons.push('priority vertical: ' + vertical);
  }

  const name = String(lead.company_name || '');
  const domain = String(lead.normalized_domain || '').toLowerCase();

  // OpenStreetMap is crowd-sourced and carries tagging errors. A real example:
  // "Perrys Chartered Accountants" is tagged with themercer.co.uk, a
  // neighbouring restaurant's site — so the crawler dutifully returned the
  // restaurant's address for an accountancy firm.
  //
  // This is flagged rather than filtered, because plenty of legitimate firms
  // use a domain that shares nothing with their name: "Abrahams Dresden"
  // trades at ad-solicitors.co.uk on its initials. A small penalty plus a
  // visible warning lets a human check before dialling.
  if (domain && nameMatchesDomain(name, domain) === false) {
    score -= 6;
    reasons.push('website may not belong to this business — verify before contact');
  }

  if (INSTITUTIONAL.test(name) || GOV_DOMAIN.test(domain) || NHS_DOMAIN.test(domain)) {
    score -= 55;
    reasons.push('public body, unlikely to buy');
  } else if (EDU_DOMAIN.test(domain)) {
    score -= 25;
    reasons.push('academic institution, long procurement');
  } else if (NONPROFIT.test(name)) {
    // Harsher than the academic penalty: a university has research budgets and
    // buys slowly, a charity mostly cannot buy at all.
    score -= 35;
    reasons.push('charity or nonprofit, grant-funded');
  } else if (CHAIN.test(name)) {
    // Should already be filtered at discovery; caught here too in case a
    // branch is named in a way the discovery filter missed.
    score -= 40;
    reasons.push('chain branch, decisions made at head office');
  }

  return {
    score: clamp(score),
    reasons: reasons.join('; '),
    service_fit: vertical || 'General business',
  };
}

module.exports = {
  scoreIntlLead, matchVertical, nameMatchesDomain,
  AUTOMATION_TOOLS, COMMERCE_TOOLS, INSTITUTIONAL, NONPROFIT, CHAIN,
  GOV_DOMAIN, EDU_DOMAIN, NHS_DOMAIN,
};
