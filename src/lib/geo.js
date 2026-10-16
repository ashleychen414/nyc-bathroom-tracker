// Location helpers: GPS, distance, address search, Google Maps directions.

import { searchRestaurants } from './restaurants.js';

// Address search uses Photon (photon.komoot.io): free, no API key, built on OpenStreetMap.
// Fine for a friends-scale tool; revisit (e.g. Geoapify) if usage grows. Restaurants that
// OpenStreetMap is missing come from the city's inspection data (restaurants.js).
const PHOTON = 'https://photon.komoot.io';
const NYC_BBOX = '-74.26,40.49,-73.70,40.92';
const BROOKLYN = { lat: 40.65, lng: -73.95 };

export function getPosition({ timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('unsupported'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable')),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 },
    );
  });
}

export function distanceMiles(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

export function formatDistance(miles) {
  return miles < 0.1 ? `${Math.round(miles * 5280)} ft` : `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}

// OpenStreetMap tag → short label shown in search results. Checked as "key=value", then "key".
const KIND_LABELS = {
  'amenity=cafe': 'Café',
  'shop=coffee': 'Café',
  'amenity=restaurant': 'Restaurant',
  'amenity=fast_food': 'Fast food',
  'amenity=food_court': 'Food court',
  'amenity=bar': 'Bar',
  'amenity=pub': 'Bar',
  'amenity=ice_cream': 'Ice cream',
  'amenity=library': 'Library',
  'amenity=community_centre': 'Community center',
  'amenity=toilets': 'Restroom',
  'amenity=fuel': 'Gas station',
  'amenity=pharmacy': 'Pharmacy',
  'amenity=bank': 'Bank',
  'amenity=cinema': 'Cinema',
  'amenity=theatre': 'Theater',
  'amenity=hospital': 'Hospital',
  'amenity=place_of_worship': 'Place of worship',
  'amenity=school': 'School',
  'amenity=university': 'University',
  'shop=supermarket': 'Supermarket',
  'shop=grocery': 'Grocery',
  'shop=convenience': 'Deli / convenience',
  'shop=bakery': 'Bakery',
  'shop=books': 'Bookstore',
  'shop=department_store': 'Department store',
  'shop=mall': 'Mall',
  'shop=chemist': 'Pharmacy',
  'tourism=museum': 'Museum',
  'tourism=hotel': 'Hotel',
  'tourism=zoo': 'Zoo',
  'tourism=attraction': 'Attraction',
  'leisure=park': 'Park',
  'leisure=playground': 'Playground',
  'leisure=stadium': 'Stadium',
  'leisure=sports_centre': 'Gym / sports',
  'leisure=fitness_centre': 'Gym',
  'railway=station': 'Station',
  'railway=subway_entrance': 'Subway entrance',
  'public_transport=station': 'Station',
  'place=neighbourhood': 'Neighborhood',
  'place=suburb': 'Neighborhood',
  'place=quarter': 'Neighborhood',
  'place=postcode': 'Zip code',
  highway: 'Street',
  shop: 'Shop',
  office: 'Office',
  building: 'Building',
  place: 'Area',
};

// How useful a kind of result is when adding a bathroom: venues you can walk into first,
// then addresses, then streets and areas, then things nobody means (bike racks, book boxes).
const VENUE_KEYS = new Set(['amenity', 'shop', 'tourism', 'leisure', 'craft', 'healthcare', 'office']);
const UNLIKELY = new Set([
  'bicycle_parking', 'bicycle_rental', 'public_bookcase', 'bench', 'waste_basket', 'vending_machine',
  'post_box', 'parking', 'parking_entrance', 'charging_station', 'atm', 'telephone', 'drinking_water',
  'footway', 'cycleway', 'path', 'service', 'steps', 'tower', 'grass',
]);

export function placeKind(osmKey, osmValue, type) {
  if (!osmKey) return type === 'house' ? 'Address' : '';
  if (type === 'house' && (osmKey === 'building' || osmKey === 'place') && osmValue !== 'postcode') return 'Address';
  const label = KIND_LABELS[`${osmKey}=${osmValue}`] ?? KIND_LABELS[osmKey];
  if (label) return label;
  if (!osmValue || osmValue === 'yes') return '';
  const words = osmValue.replace(/_/g, ' ');
  return words[0].toUpperCase() + words.slice(1);
}

function kindWeight({ osmKey, osmValue }) {
  if (UNLIKELY.has(osmValue)) return -3;
  if (osmKey === 'amenity' && osmValue === 'toilets') return 2;
  if (VENUE_KEYS.has(osmKey)) return 1.5;
  if (osmKey === 'railway' || osmKey === 'public_transport') return 0.5;
  if (osmKey === 'building' || !osmKey) return 0;
  if (osmKey === 'highway') return -1;
  if (osmKey === 'place') return -1.5;
  return -0.5;
}

// Lowercase, no accents, no punctuation: "Devoción" and "devocion" match, "Katz's" and "katzs" match.
export const normalize = (text) =>
  (text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function nameMatch(name, query) {
  const n = normalize(name);
  const q = normalize(query);
  if (!n || !q) return 0;
  if (n === q) return 3;
  if (n.startsWith(q)) return 2;
  const words = q.split(' ');
  if (words.every((w) => n.split(' ').some((nw) => nw.startsWith(w)))) return 1.75;
  if (n.includes(q)) return 1;
  return 0;
}

// "350 5th ave" or "40-33 23rd st", but not "7th ave".
const looksLikeAddress = (query) => /^\s*\d+(-\d+)?[a-z]?\s/i.test(query);

// Higher is better. Exported for tests. Mixes how well the name matches, what kind of place
// it is, and how far away it is: a café 0.3 mi away beats the same name 5 mi away, but an
// exact name match still beats a loose one nearby.
export function scoreResult(result, query, near) {
  const address = looksLikeAddress(query);
  const match = address ? nameMatch(result.street, query) : Math.max(nameMatch(result.name, query), 0.5 * nameMatch(result.street, query));
  const kind = address ? Math.min(0, kindWeight(result)) : kindWeight(result);
  const miles = near ? distanceMiles(near, result) : 0;
  return 2 * match + kind - 1.5 * Math.log2(1 + miles) - 0.03 * result.providerRank;
}

export function rankResults(results, query, near, limit = 6) {
  const seen = new Set();
  return results
    .map((r) => ({ r, score: scoreResult(r, query, near) }))
    .sort((a, b) => b.score - a.score)
    .map(({ r }) => r)
    .filter((r) => {
      const key = `${normalize(r.name)}|${normalize(r.address)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

// "Café · 0.3 mi", or just one of them, or ''.
export function resultMeta(result) {
  return [result.kind, result.distance !== undefined ? formatDistance(result.distance) : null].filter(Boolean).join(' · ');
}

export function toResult(feature, providerRank = 0) {
  const p = feature.properties;
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const area = p.district ?? p.city ?? p.county;
  const address = [street || (p.name !== area ? p.name : null), area].filter(Boolean).join(', ');
  const [lng, lat] = feature.geometry.coordinates;
  return {
    name: p.name ?? street ?? '',
    address: address || p.name || '',
    street,
    kind: placeKind(p.osm_key, p.osm_value, p.type),
    osmKey: p.osm_key,
    osmValue: p.osm_value,
    providerRank,
    lat,
    lng,
  };
}

// Generic words that don't tell two places apart: "Devoción" and "Devocion Coffee" are one place.
const GENERIC = new Set(['restaurant', 'cafe', 'coffee', 'bar', 'nyc', 'brooklyn', 'inc', 'llc', 'the', 'and']);
const coreName = (name) =>
  normalize(name)
    .split(' ')
    .filter((w) => !GENERIC.has(w))
    .join('');

// Drops city restaurant rows that OpenStreetMap already has (same name within ~250 m).
// The OpenStreetMap one is kept: its names have proper accents and capitals.
export function mergeRestaurants(osm, restaurants) {
  const extra = restaurants.filter((r) => {
    const name = coreName(r.name);
    return !osm.some((o) => name && coreName(o.name) === name && distanceMiles(o, r) < 0.15);
  });
  return [...osm, ...extra];
}

// near: the person's location if known (results then show distance). Without it, results
// are still biased to central Brooklyn but show no distance.
export async function searchAddress(query, near, signal) {
  const center = near ?? BROOKLYN;
  const [osm, food] = await Promise.allSettled([
    searchPhoton(query, center, signal),
    looksLikeAddress(query) ? [] : searchRestaurantsQuickly(query, center, signal),
  ]);
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  if (osm.status === 'rejected' && food.status === 'rejected') throw osm.reason;
  const results = mergeRestaurants(osm.value ?? [], food.value ?? []);
  return rankResults(results, query, center).map((r) => (near ? { ...r, distance: distanceMiles(near, r) } : r));
}

// City restaurant results are a bonus: give up after 4 s rather than hold up the list.
async function searchRestaurantsQuickly(query, center, signal) {
  const abort = new AbortController();
  const stop = () => abort.abort();
  signal?.addEventListener('abort', stop);
  const timer = setTimeout(stop, 4000);
  try {
    return await searchRestaurants(query, center, abort.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

async function searchPhoton(query, center, signal) {
  // location_bias_scale 0.1 + zoom 14: strong pull to within a mile or two, while famous or
  // exact matches further away still come back. We ask for more than we show and re-rank.
  const params = new URLSearchParams({
    q: query,
    limit: '15',
    lat: center.lat,
    lon: center.lng,
    location_bias_scale: '0.1',
    zoom: '14',
    bbox: NYC_BBOX,
  });
  const res = await fetch(`${PHOTON}/api/?${params}`, { signal });
  if (!res.ok) throw new Error(`search failed (${res.status})`);
  return (await res.json()).features.map((f, i) => toResult(f, i));
}

export async function reverseGeocode({ lat, lng }) {
  const res = await fetch(`${PHOTON}/reverse?lat=${lat}&lon=${lng}&limit=1`);
  if (!res.ok) return null;
  const [feature] = (await res.json()).features;
  return feature ? toResult(feature) : null;
}

// Center of an NYC zip code, used when location is off. Returns null if not found.
export async function lookupZip(zip, signal) {
  const params = new URLSearchParams({ q: zip, limit: '5', bbox: NYC_BBOX });
  const res = await fetch(`${PHOTON}/api/?${params}`, { signal });
  if (!res.ok) throw new Error(`zip lookup failed (${res.status})`);
  const feature = (await res.json()).features.find((f) => f.properties.osm_value === 'postcode' && f.properties.name === zip);
  if (!feature) return null;
  const [lng, lat] = feature.geometry.coordinates;
  return { lat, lng, area: feature.properties.district ?? feature.properties.city ?? '' };
}

// Opens the spot in Google Maps (useful to cross-check hours there).
export const googleMapsUrl = ({ lat, lng }) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

export const directionsUrl =({ lat, lng }) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
