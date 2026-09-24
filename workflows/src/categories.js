/**
 * The category sweep, shared by the Pakistan and US/UK target lists so the two
 * markets cannot drift apart.
 *
 * The goal is every business, not a shortlist. Earlier versions enumerated shop
 * and amenity values, which silently skipped anything not on the list — a pet
 * groomer, a printing works, a bowling alley. Enumerated groups are kept for
 * the dense, high-value tags, and each family now ends with a catch-all that
 * picks up whatever the lists missed.
 *
 * Catch-alls use Overpass's negative regex (`!~`) to exclude what the earlier
 * groups already covered, so the same business is not fetched twice.
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

const re = (values) => `^(${values.join('|')})$`;

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
        {
          key: 'office_other',
          // Everything else tagged as an office, minus what the three groups
          // above already fetched.
          selector: '["office"]["office"!~"^(lawyer|accountant|tax_advisor|financial|insurance|notary|architect|engineer|surveyor|financial_advisor|advertising_agency|marketing|it|research|consulting|employment_agency|newspaper|telecommunication|graphic_design|software|estate_agent|property_management|construction_company|logistics|moving_company|travel_agent|courier)$"]',
        },
      ]
    : [{ key: 'office', selector: '["office"]' }];

  const enumeratedShops = [...SHOP_RETAIL, ...SHOP_GOODS, ...SHOP_AUTO, ...SHOP_SERVICES];
  const enumeratedAmenities = [
    ...AMENITY_FOOD, ...AMENITY_EDUCATION, ...AMENITY_HEALTH,
    ...AMENITY_FINANCE, ...AMENITY_SERVICES,
  ];

  return [
    ...officeGroups,
    { key: 'craft', selector: '["craft"]' },
    { key: 'healthcare', selector: '["healthcare"]' },

    { key: 'shop_retail', selector: `["shop"~"${re(SHOP_RETAIL)}"]` },
    { key: 'shop_goods', selector: `["shop"~"${re(SHOP_GOODS)}"]` },
    { key: 'shop_auto', selector: `["shop"~"${re(SHOP_AUTO)}"]` },
    { key: 'shop_services', selector: `["shop"~"${re(SHOP_SERVICES)}"]` },
    // The long tail: art dealers, bed shops, garden centres, wool shops, and
    // every other retail type nobody thought to list.
    { key: 'shop_other', selector: `["shop"]["shop"!~"${re(enumeratedShops)}"]` },

    { key: 'amenity_food', selector: `["amenity"~"${re(AMENITY_FOOD)}"]` },
    { key: 'amenity_education', selector: `["amenity"~"${re(AMENITY_EDUCATION)}"]` },
    { key: 'amenity_health', selector: `["amenity"~"${re(AMENITY_HEALTH)}"]` },
    { key: 'amenity_finance', selector: `["amenity"~"${re(AMENITY_FINANCE)}"]` },
    { key: 'amenity_services', selector: `["amenity"~"${re(AMENITY_SERVICES)}"]` },
    {
      key: 'amenity_other',
      selector: `["amenity"]["amenity"!~"${re([...enumeratedAmenities, ...AMENITY_NOT_A_BUSINESS])}"]`,
    },

    { key: 'tourism_stay', selector: `["tourism"~"${re(TOURISM_STAY)}"]` },
    { key: 'tourism_attraction', selector: `["tourism"~"${re(TOURISM_ATTRACTION)}"]` },
    { key: 'leisure_fitness', selector: `["leisure"~"${re(LEISURE_FITNESS)}"]` },

    // Whole families the sweep never touched before.
    { key: 'industrial', selector: '["industrial"]' },
    { key: 'works', selector: '["man_made"~"^(works|wastewater_plant|water_works)$"]' },
    { key: 'club', selector: '["club"]' },
  ];
}

module.exports = { categoryGroups, AMENITY_NOT_A_BUSINESS };
