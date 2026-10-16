// Restaurant search from the city's restaurant inspection data (NYC Open Data 43nn-pn8j):
// every place with a food permit, updated daily, no API key. It finds restaurants and cafés
// that OpenStreetMap doesn't have. Queried live (about 5 KB, 0.3-0.7 s) rather than shipped
// as a file (about 700 KB gzipped), since the data changes every day.
import { normalize } from './geo.js';

const INSPECTIONS = 'https://data.cityofnewyork.us/resource/43nn-pn8j.json';
const FIELDS = 'camis,dba,boro,building,street,cuisine_description,latitude,longitude';

// Query words → SoQL `like` patterns on the upper-cased name. Returns [] when there is
// nothing worth asking for. "katzs" also looks for "KATZ", since the data spells it KATZ'S.
export function nameWords(query) {
  const words = normalize(query).split(' ').filter(Boolean);
  const useful = words.length > 1 ? words.filter((w) => w.length > 1) : words.filter((w) => w.length > 2);
  return useful.map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w).toUpperCase());
}

// One row per place (camis), nearest first. normalize() leaves only a-z, 0-9 and spaces,
// so the words are safe to put in the query.
export function restaurantQuery(query, near, limit = 25) {
  const words = nameWords(query);
  if (!words.length) return null;
  const point = `POINT(${near.lng.toFixed(5)} ${near.lat.toFixed(5)})`;
  return new URLSearchParams({
    $select: `${FIELDS},min(distance_in_meters(location,'${point}')) as meters`,
    $where: words.map((w) => `upper(dba) like '%${w}%'`).join(' and '),
    $group: FIELDS,
    $order: 'meters',
    $limit: String(limit),
  });
}

// The data is ALL CAPS: "KATZ'S DELICATESSEN" → "Katz's Delicatessen".
const KEEP_UPPER = new Set(['NYC', 'NY', 'BBQ', 'USA', 'II', 'III', 'IV', 'LLC', 'KFC', 'DJ', 'JFK', 'LES', 'UWS', 'UES']);
const SMALL = new Set(['of', 'and', 'the', 'at', 'on', 'in', 'a', 'an', 'for', 'to', 'by', 'de', 'la', 'el', 'y', 'n']);

export function tidyName(text) {
  if (!text) return '';
  if (/[a-z]/.test(text)) return text.trim(); // already mixed case
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word, i) => {
      if (KEEP_UPPER.has(word.replace(/[^A-Z]/g, ''))) return word;
      const lower = word.toLowerCase();
      if (i > 0 && SMALL.has(lower)) return lower;
      if (/^\d/.test(lower)) return lower; // 23rd, 2nd
      return lower
        .replace(/(^|[\s\-/&(.])([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase()) // Win-Son, P.J.
        .replace(/^Mc([a-z])/, (m, ch) => `Mc${ch.toUpperCase()}`); // McDonald's
    })
    .join(' ');
}

// City cuisine names → short labels. Anything not here is shown as the city writes it
// ("Coffee/Tea", "Pizza", "Chinese").
const CUISINE_LABELS = {
  'Bakery Products/Desserts': 'Bakery',
  'Frozen Desserts': 'Ice cream',
  'Juice, Smoothies, Fruit Salads': 'Juice bar',
  'Sandwiches/Salads/Mixed Buffet': 'Sandwiches',
  'Bottled Beverages': 'Drinks',
  'Hotdogs/Pretzels': 'Hot dogs',
  'Soups/Salads/Sandwiches': 'Sandwiches',
  'Not Listed/Not Applicable': 'Restaurant',
  Other: 'Restaurant',
};

export const cuisineLabel = (cuisine) => (cuisine ? (CUISINE_LABELS[cuisine] ?? cuisine) : 'Restaurant');

// Same shape as geo.js toResult, so the same ranking applies.
export function toRestaurantResult(row, providerRank = 0) {
  const lat = Number(row.latitude);
  const lng = Number(row.longitude);
  if (!lat || !lng) return null; // ~3% of places have no map location
  const street = tidyName([row.building, row.street].filter(Boolean).join(' '));
  const area = row.boro && row.boro !== '0' ? row.boro : '';
  return {
    name: tidyName(row.dba),
    address: [street, area].filter(Boolean).join(', '),
    street,
    kind: cuisineLabel(row.cuisine_description),
    osmKey: 'amenity',
    osmValue: 'restaurant',
    source: 'nyc-restaurants',
    providerRank,
    lat,
    lng,
  };
}

export async function searchRestaurants(query, near, signal) {
  const params = restaurantQuery(query, near);
  if (!params) return [];
  const res = await fetch(`${INSPECTIONS}?${params}`, { signal });
  if (!res.ok) throw new Error(`restaurant search failed (${res.status})`);
  return (await res.json()).map((row, i) => toRestaurantResult(row, i)).filter(Boolean);
}
