/**
 * Scores a lead 0-100 for how likely it is to want automation work.
 *
 * Every rule writes a plain-language reason, so a score can be argued with
 * rather than taken on faith. When the team disagrees with the ranking, the
 * reasons say which weight to change.
 *
 * Scores only from columns stored in the sheet, so re-scoring never requires
 * re-crawling a website.
 */

/** Tools that mean the business already automates part of its funnel. */
const AUTOMATION_TOOLS = [
  'hubspot', 'salesforce', 'zoho', 'intercom', 'drift', 'tawk', 'crisp',
  'calendly', 'mailchimp',
];

/** Platforms that imply transactions worth automating. */
const COMMERCE_TOOLS = ['woocommerce', 'shopify'];

/**
 * OSM category fragments mapped to Axiolyn's priority verticals. A match raises
 * the score; anything unmatched is still scored, never discarded.
 */
const VERTICAL_PATTERNS = [
  ['E-commerce / retail', /shop:(supermarket|convenience|department_store|mall|general|variety_store|wholesale|trade|clothes|shoes|jewelry|furniture|electronics|computer|mobile_phone)/],
  ['Healthcare', /(amenity|healthcare):(clinic|doctors|dentist|hospital|pharmacy|veterinary|nursing_home)/],
  ['Logistics', /office:(logistics|courier|freight|forwarding)|shop:trade/],
  ['Real estate', /(office|shop):(estate_agent|property)/],
  ['Professional services', /office:(lawyer|accountant|consulting|tax|insurance|financial|architect|engineer|notary|employment_agency)/],
  ['Agency / consultancy', /office:(advertising_agency|marketing|it|research|company|coworking)/],
  ['Education / training', /amenity:(school|college|university|language_school|driving_school|music_school|training|prep_school)/],
  ['SaaS / tech', /office:(it|software|telecommunication)/],
];

/** Where the money and the density of businesses are. */
const TIER_1_CITIES = ['lahore', 'karachi', 'islamabad', 'rawalpindi'];

/** Public bodies do not buy this way, whatever their category says. */
const INSTITUTIONAL = /\b(government|govt|ministry|municipal|corporation of|district|tehsil|cantonment|army|navy|air force|military|cmh|police|railway|wapda|lesco|gepco|fesco|iesco|sui gas|nadra|fbr|utility|board of|authority|commission|embassy|consulate|united nations|unicef|who\b)/i;

/**
 * Charities and NGOs have no budget line for this and buy on grants, not need.
 * Name matching catches them where the category cannot.
 */
const NONPROFIT = /\b(foundation|charitable|charity|welfare|relief|ngo|non-profit|nonprofit|trust\b|aid\b|humanitarian|philanthrop)/i;

/**
 * Domain-based institutional detection, which works where name matching fails.
 * `سروسز ہسپتال` scored 80 because the English-only name regex could not read
 * it — but its domain, sims.edu.pk, gives it away immediately. Likewise
 * gcu.edu.pk is Government College University.
 *
 * In Pakistan `.edu.pk` is restricted to recognised institutions, which are
 * large and slow-moving; private academies, which are genuine prospects, sit on
 * ordinary domains.
 */
const GOV_DOMAIN = /\.(gov|mil|gob)(\.[a-z]{2})?$/i;
const EDU_DOMAIN = /\.(edu|ac)(\.[a-z]{2})?$/i;

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

function matchVertical(industry) {
  const s = String(industry || '').toLowerCase();
  for (const [name, re] of VERTICAL_PATTERNS) if (re.test(s)) return name;
  return null;
}

function techList(techDetected) {
  return String(techDetected || '')
    .toLowerCase()
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Score a lead that has a website.
 * @param {Object} lead  a row from the Leads tab
 */
function scoreWebLead(lead) {
  const reasons = [];
  const verdictRaw = String(lead.email_valid || '').trim();

  // An unenriched lead has no tech stack and no contact verdict, so scoring it
  // would rank it purely on city and category. Left unscored it stays out of
  // the ranking until the crawler has actually looked at it — otherwise the top
  // of the sheet shows whatever happened to be processed first rather than
  // whatever is best.
  if (!verdictRaw) {
    return { score: '', reasons: 'not yet enriched', service_fit: '', pending: true };
  }

  let score = 15; // deliberately low: the bonuses below carry the signal

  const tech = techList(lead.tech_detected);
  const automation = tech.filter((t) => AUTOMATION_TOOLS.includes(t));
  const commerce = tech.filter((t) => COMMERCE_TOOLS.includes(t));
  const verdict = String(lead.email_valid || '');

  // The central signal. A business with a real web presence and no CRM,
  // chatbot or booking tool is doing that work by hand.
  if (tech.length && !automation.length) {
    score += 25;
    reasons.push('no CRM or booking tool on site');
  } else if (automation.length) {
    score -= 15;
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

  // Reachability. A lead nobody can contact is worth little regardless of fit.
  if (verdict.startsWith('ok:')) {
    score += 12;
    reasons.push('email verified');
    if (/:(own|related)$/.test(verdict)) {
      score += 5;
      reasons.push('official company address');
    }
  } else if (verdict.startsWith('nomx:')) {
    score -= 6;
    reasons.push('email domain does not accept mail');
  } else if (verdict === 'fetch_failed') {
    // A dead website is a real negative — we learn nothing about them — but it
    // is not a dead lead if the phone still works. Six of the first eight
    // unreachable sites had a number, four of them WhatsApp-ready, and they
    // were being scored as though nobody could be contacted at all.
    const reachableByPhone = String(lead.phone_e164 || '').trim();
    if (reachableByPhone) {
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

  if (String(lead.whatsapp_ready).toLowerCase() === 'true') {
    score += 6;
    reasons.push('mobile number, reachable on WhatsApp');
  }

  const vertical = matchVertical(lead.industry);
  if (vertical) {
    score += 7;
    reasons.push('priority vertical: ' + vertical);
  }

  if (TIER_1_CITIES.includes(String(lead.city || '').toLowerCase())) {
    score += 3;
    reasons.push('major city');
  }

  const name = String(lead.company_name || '');
  const domain = String(lead.normalized_domain || '').toLowerCase();

  if (INSTITUTIONAL.test(name) || GOV_DOMAIN.test(domain)) {
    score -= 55;
    reasons.push('public body, unlikely to buy');
  } else if (EDU_DOMAIN.test(domain)) {
    score -= 25;
    reasons.push('recognised academic institution, long procurement');
  } else if (NONPROFIT.test(name)) {
    score -= 25;
    reasons.push('charity or NGO, grant-funded');
  }

  return {
    score: clamp(score),
    reasons: reasons.join('; '),
    service_fit: vertical || 'General business',
  };
}

/**
 * Category value for phone-only leads. Without this, 28 of 55 no-web leads
 * scored exactly 61 — every one of them had a mobile, an address, a healthcare
 * category and a Lahore postcode, so the model could not tell them apart and
 * gave no useful call order.
 */
const HIGH_VALUE_CATEGORY = /(clinic|dentist|doctors|hospital|estate_agent|lawyer|accountant|consulting|logistics|courier|it$|software|school|college|university|training|car$|travel_agency|wholesale|insurance|financial)/;
const LOW_VALUE_CATEGORY = /(kiosk|newsagent|tobacco|vending|ice_cream|fast_food|hairdresser|laundry|tailor|florist|photo|copyshop)/;

/**
 * Score a lead with no website. Different model deliberately: the signals that
 * matter are reachability and the size of the gap, not the tech stack.
 */
function scoreNoWebLead(lead) {
  const reasons = [];
  let score = 25;

  // No web presence at all is the opportunity, not a disqualification.
  score += 8;
  reasons.push('no website — web presence opportunity');

  if (String(lead.whatsapp_ready).toLowerCase() === 'true') {
    score += 12;
    reasons.push('mobile number, reachable on WhatsApp');
  } else if (String(lead.phone_e164 || '').trim()) {
    score += 5;
    reasons.push('landline only');
  }

  if (String(lead.address || '').trim()) {
    score += 6;
    reasons.push('full address listed');
  }

  const vertical = matchVertical(lead.category);
  if (vertical) {
    score += 7;
    reasons.push('priority vertical: ' + vertical);
  }

  // Category value, the one signal that actually separates otherwise identical
  // phone-only listings.
  const cat = String(lead.category || '').toLowerCase();
  if (HIGH_VALUE_CATEGORY.test(cat)) {
    score += 9;
    reasons.push('higher-value category');
  } else if (LOW_VALUE_CATEGORY.test(cat)) {
    score -= 8;
    reasons.push('small operator, limited budget');
  }

  if (TIER_1_CITIES.includes(String(lead.city || '').toLowerCase())) {
    score += 3;
    reasons.push('major city');
  }

  const nwName = String(lead.company_name || '');
  if (INSTITUTIONAL.test(nwName)) {
    score -= 55;
    reasons.push('public body, unlikely to buy');
  } else if (NONPROFIT.test(nwName)) {
    score -= 25;
    reasons.push('charity or NGO, grant-funded');
  }

  return {
    score: clamp(score),
    reasons: reasons.join('; '),
    service_fit: vertical || 'General business',
  };
}

module.exports = {
  scoreWebLead,
  NONPROFIT,
  GOV_DOMAIN,
  EDU_DOMAIN,
  scoreNoWebLead,
  matchVertical,
  AUTOMATION_TOOLS,
  COMMERCE_TOOLS,
  INSTITUTIONAL,
};
