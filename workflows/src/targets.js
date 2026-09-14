/**
 * The discovery sweep: every business category, across every target city.
 *
 * Two design constraints shaped this, both learned from live failures:
 *
 * 1. Broad multi-category queries get 504'd by every public Overpass instance.
 *    So the sweep is broken into one small query per run, advanced by a cursor
 *    in the _state tab. A failure costs one combination, not the whole run.
 *
 * 2. Roughly 90% of OSM business entries carry no phone and no website, and are
 *    useless to us. Overpass can filter on tag presence server-side, so we ask
 *    only for entries that already have a contact channel. Far smaller payloads
 *    and far less to discard.
 */

const CITIES = [
  { name: 'Lahore', bbox: '31.35,74.15,31.65,74.50' },
  { name: 'Karachi', bbox: '24.75,66.95,25.05,67.25' },
  { name: 'Islamabad', bbox: '33.60,72.95,33.78,73.20' },
  { name: 'Rawalpindi', bbox: '33.52,73.00,33.68,73.15' },
  { name: 'Faisalabad', bbox: '31.36,73.03,31.50,73.18' },
  { name: 'Multan', bbox: '30.10,71.40,30.26,71.55' },
  { name: 'Peshawar', bbox: '33.95,71.40,34.06,71.62' },
  { name: 'Gujranwala', bbox: '32.10,74.10,32.22,74.25' },
  { name: 'Sialkot', bbox: '32.44,74.48,32.56,74.60' },
];

/**
 * Category groups. Together these cover essentially every commercial OSM tag —
 * the eight priority verticals are a scoring input, not a filter, so nothing is
 * excluded for being outside them.
 *
 * `shop` and `office` are the densest tags, so they are split rather than
 * queried wholesale; a single `nwr["shop"]` over Karachi is exactly the kind of
 * query that times out.
 */
const CATEGORY_GROUPS = [
  { key: 'office', selector: '["office"]' },
  { key: 'craft', selector: '["craft"]' },
  { key: 'healthcare', selector: '["healthcare"]' },
  {
    key: 'shop_retail',
    selector: '["shop"~"^(supermarket|convenience|department_store|mall|general|variety_store|wholesale|trade)$"]',
  },
  {
    key: 'shop_goods',
    selector: '["shop"~"^(clothes|shoes|jewelry|furniture|electronics|computer|mobile_phone|hardware|doityourself|paint|florist|books|stationery|sports|toys|optician|cosmetics|chemist)$"]',
  },
  {
    key: 'shop_auto',
    selector: '["shop"~"^(car|car_repair|car_parts|motorcycle|tyres|bicycle|fuel)$"]',
  },
  {
    key: 'shop_services',
    selector: '["shop"~"^(hairdresser|beauty|laundry|dry_cleaning|travel_agency|copyshop|printing|tailor|photo|funeral_directors|estate_agent|insurance)$"]',
  },
  {
    key: 'amenity_food',
    selector: '["amenity"~"^(restaurant|cafe|fast_food|bar|pub|ice_cream|food_court|catering)$"]',
  },
  {
    key: 'amenity_education',
    selector: '["amenity"~"^(school|college|university|language_school|driving_school|music_school|training|childcare|kindergarten|prep_school)$"]',
  },
  {
    key: 'amenity_health',
    selector: '["amenity"~"^(clinic|doctors|dentist|hospital|pharmacy|veterinary|nursing_home)$"]',
  },
  {
    key: 'amenity_finance',
    selector: '["amenity"~"^(bank|bureau_de_change|money_transfer|atm|payment_centre)$"]',
  },
  {
    key: 'amenity_services',
    selector: '["amenity"~"^(car_rental|car_wash|coworking_space|internet_cafe|marketplace|studio|events_venue|conference_centre|cinema|nightclub|gym)$"]',
  },
  {
    key: 'tourism_stay',
    selector: '["tourism"~"^(hotel|guest_house|motel|hostel|apartment|resort)$"]',
  },
  {
    key: 'leisure_fitness',
    selector: '["leisure"~"^(fitness_centre|sports_centre|swimming_pool|golf_course)$"]',
  },
];

/**
 * Ask Overpass only for entries that already carry a contact channel. Four
 * sub-queries because OSM spells contact details several ways and Overpass has
 * no "any of these tags exist" operator.
 */
function buildQuery(bbox, selector, timeout) {
  const t = timeout || 90;
  const contactTags = ['phone', 'contact:phone', 'website', 'contact:website'];
  const parts = contactTags
    .map((tag) => `  nwr${selector}["name"]["${tag}"](${bbox});`)
    .join('\n');
  return `[out:json][timeout:${t}];\n(\n${parts}\n);\nout tags center 500;`;
}

/** Flat list of every city x category combination, in sweep order. */
function combinations() {
  const out = [];
  for (const city of CITIES) {
    for (const group of CATEGORY_GROUPS) {
      out.push({
        city: city.name,
        bbox: city.bbox,
        categoryKey: group.key,
        selector: group.selector,
      });
    }
  }
  return out;
}

/** Pick the combination at `cursor`, wrapping around at the end of the sweep. */
function atCursor(cursor) {
  const all = combinations();
  const n = all.length;
  const i = ((Number(cursor) || 0) % n + n) % n;
  const combo = all[i];
  return {
    index: i,
    total: n,
    nextCursor: (i + 1) % n,
    ...combo,
    query: buildQuery(combo.bbox, combo.selector),
    sourceQuery: `${combo.categoryKey} @ ${combo.city}`,
  };
}

module.exports = { CITIES, CATEGORY_GROUPS, buildQuery, combinations, atCursor };
