/**
 * The US and UK sweep.
 *
 * Kept entirely separate from the Pakistan sweep (`targets.js`) so the two
 * markets never share a cursor, a sheet or a schedule.
 *
 * Cities are covered by **tiles** rather than one bounding box each.
 * OpenStreetMap coverage in these markets is far denser than Pakistan's, and a
 * box spanning central London returns HTTP 504 from every mirror. Measured on
 * `office_prof` over the City of London:
 *
 *   ~4.5 km box → 504 on all mirrors
 *   ~2.2 km box → 200, 26 businesses
 *   ~1.1 km box → 200, 6 businesses
 *
 * So tiles are kept around 2 km, and dense cities get several covering their
 * actual business districts rather than one box covering mostly housing.
 */

const CITIES = [
  // --- United States -------------------------------------------------------
  {
    country: 'US',
    name: 'New York',
    tiles: [
      '40.700,-74.020,40.717,-73.995', // Financial District
      '40.735,-74.010,40.755,-73.980', // Chelsea / Flatiron
      '40.750,-73.995,40.765,-73.965', // Midtown
    ],
  },
  {
    country: 'US',
    name: 'Los Angeles',
    tiles: [
      '34.040,-118.270,34.060,-118.240', // Downtown
      '34.055,-118.360,34.075,-118.330', // Mid-Wilshire
    ],
  },
  {
    country: 'US',
    name: 'Chicago',
    tiles: [
      '41.875,-87.640,41.895,-87.615', // The Loop
      '41.890,-87.645,41.905,-87.620', // River North
    ],
  },
  { country: 'US', name: 'Houston', tiles: ['29.740,-95.375,29.765,-95.350'] },
  { country: 'US', name: 'Phoenix', tiles: ['33.440,-112.080,33.465,-112.055'] },
  { country: 'US', name: 'Dallas', tiles: ['32.770,-96.810,32.795,-96.785'] },
  { country: 'US', name: 'Austin', tiles: ['30.260,-97.750,30.285,-97.725'] },
  { country: 'US', name: 'Miami', tiles: ['25.765,-80.200,25.790,-80.180'] },
  { country: 'US', name: 'Atlanta', tiles: ['33.750,-84.395,33.775,-84.370'] },
  { country: 'US', name: 'Seattle', tiles: ['47.600,-122.340,47.620,-122.320'] },
  { country: 'US', name: 'Denver', tiles: ['39.740,-104.995,39.760,-104.975'] },
  { country: 'US', name: 'Boston', tiles: ['42.350,-71.070,42.368,-71.050'] },

  // --- United Kingdom ------------------------------------------------------
  {
    country: 'GB',
    name: 'London',
    tiles: [
      '51.510,-0.110,51.525,-0.080', // City of London
      '51.505,-0.150,51.520,-0.120', // West End / Soho
      '51.498,-0.030,51.512,-0.005', // Canary Wharf
      '51.520,-0.100,51.535,-0.075', // Shoreditch / Old Street
      '51.490,-0.150,51.505,-0.125', // Westminster / Victoria
      '51.512,-0.190,51.527,-0.165', // Paddington / Marylebone
    ],
  },
  {
    country: 'GB',
    name: 'Manchester',
    tiles: [
      '53.475,-2.250,53.490,-2.225', // City centre
      '53.465,-2.275,53.480,-2.250', // Deansgate / Spinningfields
    ],
  },
  {
    country: 'GB',
    name: 'Birmingham',
    tiles: [
      '52.475,-1.910,52.490,-1.885', // City centre
      '52.465,-1.920,52.480,-1.900', // Mailbox / Brindleyplace
    ],
  },
  { country: 'GB', name: 'Leeds', tiles: ['53.793,-1.555,53.805,-1.535'] },
  { country: 'GB', name: 'Glasgow', tiles: ['55.855,-4.265,55.870,-4.240'] },
  { country: 'GB', name: 'Liverpool', tiles: ['53.403,-2.995,53.415,-2.975'] },
  { country: 'GB', name: 'Bristol', tiles: ['51.450,-2.600,51.462,-2.580'] },
  { country: 'GB', name: 'Edinburgh', tiles: ['55.945,-3.205,55.958,-3.180'] },
  { country: 'GB', name: 'Sheffield', tiles: ['53.378,-1.475,53.390,-1.458'] },
  { country: 'GB', name: 'Nottingham', tiles: ['52.950,-1.160,52.960,-1.142'] },
  { country: 'GB', name: 'Cardiff', tiles: ['51.478,-3.185,51.490,-3.165'] },
];

/**
 * Category groups, split more finely than the Pakistan sweep: a single
 * `["office"]` query over a dense centre is exactly what triggers a 504.
 */
const { categoryGroups } = require('./categories');

/**
 * Every commercial category, shared with the Pakistan sweep. Dense: US and UK
 * city centres carry far more data, so the office tag is split rather than
 * queried whole.
 */
const CATEGORY_GROUPS = categoryGroups({ dense: true });

/**
 * Ask only for entries that already carry a contact channel. In Pakistan this
 * stripped roughly 90% of the payload; in these markets it is what keeps the
 * query answerable at all.
 */
function buildQuery(bbox, selector, timeout) {
  const t = timeout || 90;
  const contactTags = ['phone', 'contact:phone', 'website', 'contact:website'];
  const parts = contactTags
    .map((tag) => `  nwr${selector}["name"]["${tag}"](${bbox});`)
    .join('\n');
  return `[out:json][timeout:${t}];\n(\n${parts}\n);\nout tags center 400;`;
}

/**
 * Every city tile × category group, **interleaved by country**.
 *
 * Listing all US combinations then all UK ones would leave the UK tab empty for
 * weeks: there are 256 US combinations, and at three sweep steps an hour the
 * sweep would not reach Britain for over three days. Alternating fills both
 * tabs from the first run.
 */
function combinations() {
  const perCountry = {};
  for (const city of CITIES) {
    city.tiles.forEach((bbox, tileIndex) => {
      for (const group of CATEGORY_GROUPS) {
        (perCountry[city.country] = perCountry[city.country] || []).push({
          country: city.country,
          city: city.name,
          tile: tileIndex + 1,
          tileCount: city.tiles.length,
          bbox,
          categoryKey: group.key,
          selector: group.selector,
          catchAll: Boolean(group.catchAll),
        });
      }
    });
  }

  const lists = Object.values(perCountry);
  const longest = Math.max(0, ...lists.map((l) => l.length));
  const out = [];
  for (let i = 0; i < longest; i++) {
    for (const list of lists) if (list[i]) out.push(list[i]);
  }
  return out;
}

/** Pick the combination at `cursor`, wrapping at the end of the sweep. */
function atCursor(cursor) {
  const all = combinations();
  const n = all.length;
  const i = ((Number(cursor) || 0) % n + n) % n;
  const c = all[i];
  const where = c.tileCount > 1 ? `${c.city} #${c.tile}` : c.city;
  return {
    index: i,
    total: n,
    nextCursor: (i + 1) % n,
    ...c,
    query: buildQuery(c.bbox, c.selector, c.catchAll ? 40 : 90),
    sourceQuery: `${c.categoryKey} @ ${where}, ${c.country}`,
  };
}

module.exports = { CITIES, CATEGORY_GROUPS, buildQuery, combinations, atCursor };
