/**
 * Turns a raw OpenStreetMap category into a plain business type a person can
 * read at a glance — `office:lawyer` becomes "Law firm".
 *
 * The sheet already carries two other classifications and neither answers the
 * question "what is this business?":
 *   category     `office:lawyer`          — precise, but jargon
 *   service_fit  `Professional services`  — which Axiolyn service suits them
 *   business_type `Law firm`              — what they actually do
 *
 * The leads span 180 distinct OSM categories, so the common ones are named
 * explicitly and the long tail is derived from the tag itself rather than
 * left blank.
 */

const LABELS = {
  // --- food and hospitality ---
  'amenity:restaurant': 'Restaurant',
  'amenity:fast_food': 'Fast food',
  'amenity:cafe': 'Cafe',
  'amenity:bar': 'Bar',
  'amenity:pub': 'Pub',
  'amenity:ice_cream': 'Ice cream shop',
  'amenity:food_court': 'Food court',
  'amenity:catering': 'Catering',
  'craft:caterer': 'Caterer',
  'craft:bakery': 'Bakery',
  'shop:bakery': 'Bakery',
  'shop:butcher': 'Butcher',
  'shop:greengrocer': 'Greengrocer',
  'shop:confectionery': 'Confectioner',
  'shop:coffee': 'Coffee shop',
  'shop:tea': 'Tea shop',
  'shop:alcohol': 'Off licence',
  'shop:deli': 'Delicatessen',
  'shop:seafood': 'Fishmonger',

  // --- medical ---
  'amenity:clinic': 'Medical clinic',
  'amenity:doctors': 'Doctor’s surgery',
  'amenity:dentist': 'Dental clinic',
  'amenity:hospital': 'Hospital',
  'amenity:pharmacy': 'Pharmacy',
  'amenity:veterinary': 'Veterinary clinic',
  'amenity:nursing_home': 'Care home',
  'healthcare:clinic': 'Medical clinic',
  'healthcare:doctor': 'Doctor’s surgery',
  'healthcare:dentist': 'Dental clinic',
  'healthcare:hospital': 'Hospital',
  'healthcare:pharmacy': 'Pharmacy',
  'healthcare:physiotherapist': 'Physiotherapy clinic',
  'healthcare:psychotherapist': 'Therapy practice',
  'healthcare:optometrist': 'Optician',
  'healthcare:laboratory': 'Medical laboratory',
  'healthcare:alternative': 'Alternative medicine',
  'healthcare:centre': 'Health centre',
  'healthcare:yes': 'Healthcare provider',
  'shop:optician': 'Optician',
  'shop:chemist': 'Chemist',
  'shop:medical_supply': 'Medical supplies',
  'shop:hearing_aids': 'Hearing aid specialist',

  // --- professional services ---
  'office:lawyer': 'Law firm',
  'office:notary': 'Notary',
  'office:accountant': 'Accountancy firm',
  'office:tax_advisor': 'Tax advisor',
  'office:financial': 'Financial services',
  'office:financial_advisor': 'Financial advisor',
  'office:insurance': 'Insurance broker',
  'office:consulting': 'Consultancy',
  'office:architect': 'Architecture practice',
  'office:engineer': 'Engineering firm',
  'office:surveyor': 'Surveyor',
  'office:employment_agency': 'Recruitment agency',
  'office:accountants': 'Accountancy firm',

  // --- agencies, tech, media ---
  'office:it': 'IT company',
  'office:software': 'Software company',
  'office:telecommunication': 'Telecoms company',
  'office:advertising_agency': 'Advertising agency',
  'office:marketing': 'Marketing agency',
  'office:graphic_design': 'Design agency',
  'office:newspaper': 'Publisher',
  'office:research': 'Research firm',
  'office:coworking': 'Coworking space',
  'amenity:coworking_space': 'Coworking space',
  'office:company': 'Company office',
  'office:yes': 'Office (unspecified)',

  // --- property, logistics, trade ---
  'office:estate_agent': 'Estate agency',
  'shop:estate_agent': 'Estate agency',
  'office:property_management': 'Property management',
  'office:construction_company': 'Construction company',
  'office:logistics': 'Logistics company',
  'office:courier': 'Courier',
  'office:moving_company': 'Removals company',
  'office:travel_agent': 'Travel agency',
  'shop:travel_agency': 'Travel agency',
  'shop:wholesale': 'Wholesaler',
  'shop:trade': 'Trade supplier',

  // --- education ---
  'amenity:school': 'School',
  'amenity:college': 'College',
  'amenity:university': 'University',
  'amenity:kindergarten': 'Nursery',
  'amenity:childcare': 'Childcare',
  'amenity:language_school': 'Language school',
  'amenity:driving_school': 'Driving school',
  'amenity:music_school': 'Music school',
  'amenity:training': 'Training provider',
  'amenity:prep_school': 'Tuition centre',
  'office:educational_institution': 'Education provider',

  // --- retail ---
  'shop:supermarket': 'Supermarket',
  'shop:convenience': 'Convenience store',
  'shop:general': 'General store',
  'shop:department_store': 'Department store',
  'shop:mall': 'Shopping mall',
  'shop:variety_store': 'Variety store',
  'shop:clothes': 'Clothing shop',
  'shop:shoes': 'Shoe shop',
  'shop:jewelry': 'Jeweller',
  'shop:furniture': 'Furniture shop',
  'shop:electronics': 'Electronics shop',
  'shop:computer': 'Computer shop',
  'shop:mobile_phone': 'Mobile phone shop',
  'shop:hardware': 'Hardware shop',
  'shop:doityourself': 'DIY store',
  'shop:paint': 'Paint shop',
  'shop:florist': 'Florist',
  'shop:books': 'Bookshop',
  'shop:stationery': 'Stationery shop',
  'shop:sports': 'Sports shop',
  'shop:toys': 'Toy shop',
  'shop:cosmetics': 'Cosmetics shop',
  'shop:gift': 'Gift shop',
  'shop:pet': 'Pet shop',
  'shop:bicycle': 'Bicycle shop',
  'shop:fabric': 'Fabric shop',
  'shop:carpet': 'Carpet shop',
  'shop:kitchen': 'Kitchen showroom',
  'shop:garden_centre': 'Garden centre',

  // --- motor trade ---
  'shop:car': 'Car dealership',
  'shop:car_repair': 'Car repair garage',
  'shop:car_parts': 'Car parts shop',
  'shop:motorcycle': 'Motorcycle dealer',
  'shop:tyres': 'Tyre shop',
  'shop:fuel': 'Petrol station',
  'amenity:fuel': 'Petrol station',
  'amenity:car_rental': 'Car rental',
  'amenity:car_wash': 'Car wash',

  // --- personal services ---
  'shop:hairdresser': 'Hair salon',
  'shop:beauty': 'Beauty salon',
  'shop:massage': 'Massage therapy',
  'shop:laundry': 'Laundry',
  'shop:dry_cleaning': 'Dry cleaner',
  'shop:tailor': 'Tailor',
  'shop:photo': 'Photography studio',
  'shop:copyshop': 'Print shop',
  'shop:printing': 'Printing company',
  'shop:funeral_directors': 'Funeral directors',
  'shop:pawnbroker': 'Pawnbroker',
  'shop:tattoo': 'Tattoo studio',

  // --- finance and admin ---
  'amenity:bank': 'Bank',
  'amenity:bureau_de_change': 'Currency exchange',
  'amenity:money_transfer': 'Money transfer',
  'amenity:atm': 'ATM',
  'amenity:post_office': 'Post office',

  // --- leisure and venues ---
  'leisure:fitness_centre': 'Gym',
  'amenity:gym': 'Gym',
  'leisure:sports_centre': 'Sports centre',
  'leisure:swimming_pool': 'Swimming pool',
  'leisure:golf_course': 'Golf club',
  'amenity:cinema': 'Cinema',
  'amenity:nightclub': 'Nightclub',
  'amenity:events_venue': 'Events venue',
  'amenity:conference_centre': 'Conference centre',
  'amenity:studio': 'Studio',
  'amenity:marketplace': 'Marketplace',
  'amenity:internet_cafe': 'Internet cafe',

  // --- accommodation ---
  'tourism:hotel': 'Hotel',
  'tourism:guest_house': 'Guest house',
  'tourism:motel': 'Motel',
  'tourism:hostel': 'Hostel',
  'tourism:apartment': 'Serviced apartments',
  'tourism:resort': 'Resort',

  // --- crafts and trades ---
  'craft:electrician': 'Electrician',
  'craft:plumber': 'Plumber',
  'craft:carpenter': 'Carpenter',
  'craft:painter': 'Painter and decorator',
  'craft:builder': 'Builder',
  'craft:roofer': 'Roofer',
  'craft:shoemaker': 'Shoemaker',
  'craft:tailor': 'Tailor',
  'craft:photographer': 'Photographer',
  'craft:signmaker': 'Sign maker',
  'craft:metal_construction': 'Metal fabricator',
  'craft:hvac': 'Heating and cooling',
  'craft:joiner': 'Joiner',
  'craft:upholsterer': 'Upholsterer',
  'craft:jeweller': 'Jeweller',
  'craft:key_cutter': 'Locksmith',
  'craft:locksmith': 'Locksmith',

  // --- public sector, flagged so it is obvious why they score low ---
  'office:government': 'Government office',
  'office:diplomatic': 'Diplomatic mission',
  'office:administrative': 'Government office',
  'office:association': 'Trade association',
  'office:ngo': 'Charity or NGO',
  'office:charity': 'Charity or NGO',
  'office:political_party': 'Political party',
  'office:religion': 'Religious organisation',
  'office:energy_supplier': 'Energy supplier',
  'office:water_utility': 'Water utility',
};

/** Words that should stay capitalised or shortened when deriving a label. */
const ACRONYMS = { it: 'IT', hvac: 'HVAC', diy: 'DIY', ngo: 'NGO', gp: 'GP' };

/**
 * Human-readable business type for an OSM category.
 *
 * Falls back to prettifying the tag rather than returning nothing: with 180
 * distinct categories in the data, an unmapped long tail is inevitable, and
 * "Pet grooming" derived from `shop:pet_grooming` is still far more use than a
 * blank cell.
 *
 * @param {string} category  e.g. "office:lawyer"
 * @returns {string}         e.g. "Law firm"
 */
function businessType(category) {
  const raw = String(category || '').trim().toLowerCase();
  if (!raw || raw === 'other' || raw === 'yes') return 'Unclassified';

  if (LABELS[raw]) return LABELS[raw];

  // Derive from the tag value: "shop:pet_grooming" -> "Pet grooming".
  const value = raw.includes(':') ? raw.split(':').slice(1).join(':') : raw;
  if (!value || value === 'yes') {
    const group = raw.split(':')[0];
    return group ? titleCase(group) + ' (unspecified)' : 'Unclassified';
  }
  return titleCase(value);
}

function titleCase(s) {
  return String(s)
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w, i) => {
      if (ACRONYMS[w]) return ACRONYMS[w];
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    })
    .join(' ');
}

module.exports = { businessType, LABELS };
