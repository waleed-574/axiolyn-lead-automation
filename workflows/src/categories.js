/**
 * The category sweep, shared by the Pakistan and US/UK target lists so the two
 * markets cannot drift apart.
 *
 * The goal is every business, not a shortlist. Earlier versions enumerated shop
 * and amenity values, which silently skipped anything not on the list — a pet
 * groomer, a printing works, a bowling alley. Each family is now split across
 * several groups — the dense, high-value values first, then the long tail — so
 * nothing is skipped and no single query is large enough to be refused.
 *
 * Every group is a POSITIVE list. An earlier version used Overpass's negative
 * regex to catch the long tail — ["office"]["office"!~"..."] — which forces
 * Overpass to scan every entry carrying the tag and then exclude. Measured over
 * Manhattan that one query spent fifty minutes across three mirrors and
 * returned nothing. Positive lists are matched against an index instead.
 *
 * The long-tail values are not invented: they come from OpenStreetMap's own
 * taginfo statistics, every value of each key with 300+ uses worldwide, minus
 * the ones that are street furniture or public infrastructure.
 */

// Enumerated first, because splitting the dense tags keeps each query small
// enough that Overpass answers it.
const SHOP_RETAIL = ['supermarket', 'convenience', 'department_store', 'mall', 'general',
  'variety_store', 'wholesale', 'trade', 'doityourself', 'hardware'];

const SHOP_GOODS = ['clothes', 'shoes', 'jewelry', 'furniture', 'electronics', 'computer',
  'mobile_phone', 'sports', 'toys', 'books', 'optician', 'cosmetics', 'florist', 'bicycle',
  'stationery', 'chemist', 'paint', 'gift', 'pet', 'watches', 'bag', 'fabric', 'carpet'];

const SHOP_AUTO = ['car', 'car_repair', 'car_parts', 'motorcycle', 'tyres', 'fuel',
  'truck', 'caravan', 'boat', 'motorcycle_repair'];

const SHOP_SERVICES = ['hairdresser', 'beauty', 'laundry', 'dry_cleaning', 'travel_agency',
  'copyshop', 'printing', 'tailor', 'photo', 'funeral_directors', 'estate_agent',
  'pawnbroker', 'insurance', 'massage', 'tattoo', 'locksmith', 'storage_rental'];

const AMENITY_FOOD = ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'ice_cream',
  'food_court', 'catering', 'biergarten'];

const AMENITY_EDUCATION = ['school', 'college', 'university', 'language_school',
  'driving_school', 'music_school', 'training', 'childcare', 'kindergarten', 'prep_school',
  'dancing_school', 'research_institute'];

const AMENITY_HEALTH = ['clinic', 'doctors', 'dentist', 'hospital', 'pharmacy',
  'veterinary', 'nursing_home', 'social_facility'];

const AMENITY_FINANCE = ['bank', 'bureau_de_change', 'money_transfer', 'atm',
  'payment_centre', 'money_lender'];

const AMENITY_SERVICES = ['car_rental', 'car_wash', 'coworking_space', 'internet_cafe',
  'marketplace', 'studio', 'events_venue', 'conference_centre', 'cinema', 'nightclub',
  'gym', 'theatre', 'vehicle_inspection', 'driving_range', 'animal_boarding',
  'animal_shelter', 'dive_centre', 'casino', 'gambling', 'stripclub', 'crematorium',
  'funeral_hall', 'photo_booth', 'post_office', 'courier'];

/**
 * Amenity values that are street furniture or public infrastructure rather
 * than a business anyone could sell to. Excluded from the catch-all so it does
 * not return ten thousand benches and bicycle racks.
 */
const AMENITY_NOT_A_BUSINESS = ['parking', 'parking_space', 'parking_entrance',
  'bicycle_parking', 'motorcycle_parking', 'bench', 'waste_basket', 'waste_disposal',
  'recycling', 'toilets', 'drinking_water', 'water_point', 'fountain', 'shelter',
  'bus_station', 'taxi', 'ferry_terminal', 'charging_station', 'telephone', 'clock',
  'place_of_worship', 'grave_yard', 'townhall', 'courthouse', 'police', 'fire_station',
  'prison', 'public_building', 'library', 'community_centre', 'social_centre',
  'public_bath', 'shower', 'bbq', 'hunting_stand', 'lounger', 'device_charging_station',
  'give_box', 'letter_box', 'post_box', 'parcel_locker', 'vending_machine', 'fuel_station',
  'ranger_station', 'watering_place', 'trolley_bay', 'smoking_area', 'compressed_air'];

const TOURISM_STAY = ['hotel', 'guest_house', 'motel', 'hostel', 'apartment', 'resort',
  'chalet', 'camp_site', 'caravan_site'];

/** Visitor businesses — they sell tickets and run bookings, so they qualify. */
const TOURISM_ATTRACTION = ['attraction', 'museum', 'gallery', 'theme_park', 'zoo',
  'aquarium', 'information'];

const LEISURE_FITNESS = ['fitness_centre', 'sports_centre', 'swimming_pool', 'golf_course',
  'horse_riding', 'bowling_alley', 'amusement_arcade', 'adult_gaming_centre', 'escape_game',
  'dance', 'trampoline_park', 'climbing', 'marina', 'sauna', 'hackerspace'];


/**
 * Long-tail values, taken from OpenStreetMap's own taginfo statistics — every
 * value of each key with 300+ uses worldwide, minus street furniture and public
 * infrastructure. Enumerated in chunks so each Overpass query stays small.
 */
const OFFICE_TAIL_1 = ['company', 'educational_institution', 'security', 'coworking',
  'therapist', 'union', 'guide', 'physician', 'university', 'cooperative', 'transport',
  'camping', 'parish', 'publisher', 'medical', 'translator', 'healthcare',
  'harbour_master', 'engineering', 'geodesist', 'construction', 'bail_bond_agent'];
const OFFICE_TAIL_2 = ['interior_design', 'chamber', 'tutoring', 'private_investigator'];

const CRAFT_1 = ['grinding_mill', 'carpenter', 'electronics_repair', 'winery',
  'metal_construction', 'photographer', 'electrician', 'hvac', 'plumber', 'brewery',
  'tailor', 'caterer', 'sawmill', 'shoemaker', 'window_construction', 'handicraft',
  'gardener', 'joiner', 'stonemason', 'dressmaker', 'confectionery', 'painter'];
const CRAFT_2 = ['glaziery', 'beekeeper', 'roofer', 'builder', 'key_cutter', 'cleaning',
  'upholsterer', 'pottery', 'blacksmith', 'signmaker', 'distillery', 'agricultural_engines',
  'jeweller', 'locksmith', 'tiler', 'watchmaker', 'photographic_laboratory', 'bakery',
  'printer', 'clockmaker', 'floorer', 'tinsmith'];
const CRAFT_3 = ['welder', 'boatbuilder', 'sculptor', 'scaffolder', 'atelier', 'plasterer',
  'oil_mill', 'bookbinder', 'optician', 'insulation', 'cabinet_maker', 'dental_technician',
  'saddler', 'chimney_sweeper', 'carpet_layer', 'construction', 'print_shop',
  'parquet_layer', 'sun_protection', 'car_painter'];

const HEALTHCARE_1 = ['pharmacy', 'doctor', 'clinic', 'hospital', 'dentist',
  'physiotherapist', 'alternative', 'laboratory', 'psychotherapist', 'optometrist',
  'rehabilitation', 'podiatrist', 'counselling', 'nurse', 'speech_therapist',
  'blood_donation', 'hospice', 'occupational_therapist', 'dialysis', 'sample_collection',
  'midwife', 'audiologist'];
const HEALTHCARE_2 = ['birthing_centre', 'community_health_worker', 'health_aide',
  'vaccination_centre', 'blood_bank'];

const SHOP_TAIL_1 = ['bakery', 'butcher', 'kiosk', 'alcohol', 'greengrocer', 'confectionery',
  'tobacco', 'pastry', 'farm', 'garden_centre', 'beverages', 'newsagent', 'ticket',
  'interior_decoration', 'deli', 'houseware', 'seafood', 'wine', 'second_hand',
  'medical_supply', 'bed', 'kitchen'];
const SHOP_TAIL_2 = ['bookmaker', 'art', 'lottery', 'agrarian', 'outdoor', 'antiques',
  'coffee', 'perfumery', 'gas', 'hearing_aids', 'appliance', 'craft', 'electrical',
  'telecommunication', 'money_lender', 'pet_grooming', 'tea', 'dairy', 'baby_goods',
  'musical_instrument', 'rental', 'fashion_accessories'];
const SHOP_TAIL_3 = ['cannabis', 'boutique', 'health_food', 'chocolate', 'music', 'cheese',
  'grocery', 'fishing', 'repair', 'nutrition_supplements', 'bathroom_furnishing', 'sewing',
  'video_games', 'curtain', 'lighting', 'herbalist', 'tiles', 'flooring', 'frozen_food',
  'doors', 'hifi', 'shoe_repair'];
const SHOP_TAIL_4 = ['erotic', 'party', 'water', 'frame', 'swimming_pool',
  'hairdresser_supply', 'video', 'games', 'leather', 'food', 'weapons', 'country_store',
  'pottery', 'fireplace', 'window_blind', 'collector', 'radiotechnics', 'tool_hire',
  'household_linen', 'glaziery', 'ice_cream', 'spices'];
const SHOP_TAIL_5 = ['scuba_diving', 'building_materials', 'pyrotechnics', 'printer_ink',
  'nuts', 'mobile_phone_accessories', 'security', 'power_tools', 'model', 'gold_buyer',
  'candles', 'hunting', 'groundskeeping', 'pasta', 'vacuum_cleaner', 'honey', 'camera',
  'rice', 'water_sports', 'photo_studio', 'tortilla', 'hobby', 'wool', 'haberdashery'];

/** Curated by hand: the automated list was full of hydrants and bus stops. */
const AMENITY_TAIL = ['fuel', 'arts_centre', 'mobile_money_agent', 'dojo', 'boat_rental',
  'animal_training', 'exhibition_centre', 'music_venue', 'social_club', 'ski_rental',
  'veterinary_pharmacy', 'retirement_home', 'warehouse', 'sanatorium', 'outfitter',
  'health_post', 'bicycle_rental'];

const LEISURE_TAIL = ['resort', 'fishing', 'recreation_ground', 'bathing_place', 'hot_tub',
  'indoor_play', 'summer_camp', 'tanning_salon', 'sport', 'shooting_ground', 'social_club',
  'spa'];

const re = (values) => `^(${values.join('|')})$`;

/**
 * Groups that query a whole tag without a value filter. These are cheap enough
 * on an indexed tag, but still the heaviest in the set, so the runner gives
 * them a shorter Overpass deadline.
 */
/**
 * The two groups that still select on a bare key, with no value list. Both keys
 * are rare enough that a full scan stays cheap, but they get a shorter timeout
 * so a bad day costs seconds rather than minutes.
 */
const CATCH_ALL_KEYS = new Set(['industrial', 'club']);

/**
 * @param {Object} opts
 * @param {boolean} opts.dense  split the densest tags further. US and UK city
 *   centres carry an order of magnitude more data than Pakistani ones, and a
 *   single `["office"]` query over the City of London returns 504.
 * @returns {Array<{key: string, selector: string}>}
 */
function categoryGroups(opts) {
  const dense = Boolean(opts && opts.dense);

  const officeGroups = dense
    ? [
        { key: 'office_prof', selector: '["office"~"^(lawyer|accountant|tax_advisor|financial|insurance|notary|architect|engineer|surveyor|financial_advisor)$"]' },
        { key: 'office_agency', selector: '["office"~"^(advertising_agency|marketing|it|research|consulting|employment_agency|newspaper|telecommunication|graphic_design|software)$"]' },
        { key: 'office_property', selector: '["office"~"^(estate_agent|property_management|construction_company|logistics|moving_company|travel_agent|courier)$"]' },
      ]
    : [{ key: 'office', selector: '["office"]' }];

  // The long tail of office values, split in two. Only the dense markets need
  // them: where the whole key is fetched in one query, these would re-fetch
  // what 'office' already returned.
  const officeTail = dense
    ? [
        { key: 'office_tail1', selector: `["office"~"${re(OFFICE_TAIL_1)}"]` },
        { key: 'office_tail2', selector: `["office"~"${re(OFFICE_TAIL_2)}"]` },
      ]
    : [];

  const groups = [
    ...officeGroups,
    ...officeTail,
    // Offices beyond the three high-value groups, from taginfo.

    { key: 'craft1', selector: `["craft"~"${re(CRAFT_1)}"]` },
    { key: 'craft2', selector: `["craft"~"${re(CRAFT_2)}"]` },
    { key: 'craft3', selector: `["craft"~"${re(CRAFT_3)}"]` },

    { key: 'healthcare1', selector: `["healthcare"~"${re(HEALTHCARE_1)}"]` },
    { key: 'healthcare2', selector: `["healthcare"~"${re(HEALTHCARE_2)}"]` },

    { key: 'shop_retail', selector: `["shop"~"${re(SHOP_RETAIL)}"]` },
    { key: 'shop_goods', selector: `["shop"~"${re(SHOP_GOODS)}"]` },
    { key: 'shop_auto', selector: `["shop"~"${re(SHOP_AUTO)}"]` },
    { key: 'shop_services', selector: `["shop"~"${re(SHOP_SERVICES)}"]` },
    // The long tail, enumerated rather than excluded: bakers, butchers,
    // greengrocers, garden centres, kiosks — real businesses that no hand-written
    // list included and that the negative-regex catch-all could never fetch.
    { key: 'shop_tail1', selector: `["shop"~"${re(SHOP_TAIL_1)}"]` },
    { key: 'shop_tail2', selector: `["shop"~"${re(SHOP_TAIL_2)}"]` },
    { key: 'shop_tail3', selector: `["shop"~"${re(SHOP_TAIL_3)}"]` },
    { key: 'shop_tail4', selector: `["shop"~"${re(SHOP_TAIL_4)}"]` },
    { key: 'shop_tail5', selector: `["shop"~"${re(SHOP_TAIL_5)}"]` },

    { key: 'amenity_food', selector: `["amenity"~"${re(AMENITY_FOOD)}"]` },
    { key: 'amenity_education', selector: `["amenity"~"${re(AMENITY_EDUCATION)}"]` },
    { key: 'amenity_health', selector: `["amenity"~"${re(AMENITY_HEALTH)}"]` },
    { key: 'amenity_finance', selector: `["amenity"~"${re(AMENITY_FINANCE)}"]` },
    { key: 'amenity_services', selector: `["amenity"~"${re(AMENITY_SERVICES)}"]` },
    { key: 'amenity_tail', selector: `["amenity"~"${re(AMENITY_TAIL)}"]` },

    { key: 'tourism_stay', selector: `["tourism"~"${re(TOURISM_STAY)}"]` },
    { key: 'tourism_attraction', selector: `["tourism"~"${re(TOURISM_ATTRACTION)}"]` },
    { key: 'leisure_fitness', selector: `["leisure"~"${re(LEISURE_FITNESS)}"]` },
    { key: 'leisure_tail', selector: `["leisure"~"${re(LEISURE_TAIL)}"]` },

    // Low-volume tags, cheap to query whole.
    { key: 'industrial', selector: '["industrial"]' },
    { key: 'works', selector: '["man_made"~"^(works|wastewater_plant|water_works)$"]' },
    { key: 'club', selector: '["club"]' },
  ];

  // Flagged so the runner can cap how long it waits on the expensive ones.
  return groups.map((g) => ({ ...g, catchAll: CATCH_ALL_KEYS.has(g.key) }));
}

module.exports = { categoryGroups, AMENITY_NOT_A_BUSINESS, CATCH_ALL_KEYS };
