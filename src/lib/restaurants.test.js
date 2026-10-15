import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameWords, restaurantQuery, tidyName, cuisineLabel, toRestaurantResult } from './restaurants.js';
import { mergeRestaurants, rankResults, resultMeta, toResult, distanceMiles } from './geo.js';

const HERE = { lat: 40.6728, lng: -73.9701 }; // Grand Army Plaza
const MILE_LAT = 1 / 69;

// A row as the city API returns it (one per place), `milesNorth` of HERE.
const row = (dba, milesNorth, extra = {}) => ({
  camis: '1',
  dba,
  boro: 'Brooklyn',
  building: '159',
  street: 'GRAHAM AVENUE',
  cuisine_description: 'Coffee/Tea',
  latitude: String(HERE.lat + milesNorth * MILE_LAT),
  longitude: String(HERE.lng),
  ...extra,
});

const photon = (name, osmKey, osmValue, milesNorth) =>
  toResult({
    geometry: { coordinates: [HERE.lng, HERE.lat + milesNorth * MILE_LAT] },
    properties: { name, osm_key: osmKey, osm_value: osmValue, type: 'house', district: 'Brooklyn' },
  });

test('nameWords: query words to match against the all-caps names', () => {
  assert.deepEqual(nameWords('Sixty Three Clinton'), ['SIXTY', 'THREE', 'CLINTON']);
  assert.deepEqual(nameWords("katzs"), ['KATZ']); // the data says KATZ'S
  assert.deepEqual(nameWords("Katz's"), ['KATZ']);
  assert.deepEqual(nameWords('Devoción'), ['DEVOCION']);
  assert.deepEqual(nameWords('gp-81'), ['GP', '81']);
  assert.deepEqual(nameWords('a b'), []); // nothing useful to ask for
  assert.deepEqual(nameWords("'; drop --"), ['DROP']); // only letters, digits and spaces get through
});

test('restaurantQuery asks for one row per place, nearest first', () => {
  const p = restaurantQuery('win son', HERE);
  assert.equal(p.get('$where'), "upper(dba) like '%WIN%' and upper(dba) like '%SON%'");
  assert.match(p.get('$select'), /distance_in_meters\(location,'POINT\(-73\.97010 40\.67280\)'\)/);
  assert.match(p.get('$group'), /^camis,/);
  assert.equal(p.get('$order'), 'meters');
  assert.equal(restaurantQuery('xy', HERE), null);
});

test('tidyName turns ALL CAPS into readable names', () => {
  assert.equal(tidyName('SIXTY THREE CLINTON'), 'Sixty Three Clinton');
  assert.equal(tidyName("KATZ'S DELICATESSEN"), "Katz's Delicatessen");
  assert.equal(tidyName("MCDONALD'S"), "McDonald's");
  assert.equal(tidyName('BAR OF THE NYC BBQ'), 'Bar of the NYC BBQ');
  assert.equal(tidyName('THE MEAT HOOK'), 'The Meat Hook');
  assert.equal(tidyName('40-33 23RD STREET'), '40-33 23rd Street');
  assert.equal(tidyName('WIN-SON BAKERY'), 'Win-Son Bakery');
  assert.equal(tidyName('P.J. CLARKE\'S'), "P.J. Clarke's");
  assert.equal(tidyName('Devoción'), 'Devoción'); // already mixed case: leave alone
  assert.equal(tidyName(undefined), '');
});

test('cuisineLabel keeps city labels short', () => {
  assert.equal(cuisineLabel('Coffee/Tea'), 'Coffee/Tea');
  assert.equal(cuisineLabel('Bakery Products/Desserts'), 'Bakery');
  assert.equal(cuisineLabel('Not Listed/Not Applicable'), 'Restaurant');
  assert.equal(cuisineLabel(undefined), 'Restaurant');
});

test('toRestaurantResult: tidy name, address, cuisine label', () => {
  const r = toRestaurantResult(row('WIN SON', 0.3));
  assert.equal(r.name, 'Win Son');
  assert.equal(r.address, '159 Graham Avenue, Brooklyn');
  assert.equal(r.kind, 'Coffee/Tea');
  assert.equal(resultMeta({ ...r, distance: distanceMiles(HERE, r) }), 'Coffee/Tea · 0.3 mi');
  assert.equal(toRestaurantResult(row('NO MAP', 0, { latitude: '0', longitude: '0' })), null);
  assert.equal(toRestaurantResult(row('NO BORO', 0, { boro: '0' })).address, '159 Graham Avenue');
});

test('mergeRestaurants drops places OpenStreetMap already has nearby', () => {
  const osm = [photon('Devoción', 'amenity', 'cafe', 0.2)];
  const city = [
    toRestaurantResult(row('DEVOCION', 0.21)), // same place: dropped
    toRestaurantResult(row('DEVOCION', 3)), // another branch far away: kept
    toRestaurantResult(row('DEVOCION COFFEE', 0.2)), // "coffee" is generic: same place
  ];
  const merged = mergeRestaurants(osm, city);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].name, 'Devoción');
  assert.equal(merged[1].lat, city[1].lat);
});

test('mergeRestaurants keeps a different place with a similar name', () => {
  const osm = [photon('Win Son', 'amenity', 'restaurant', 0.2)];
  const merged = mergeRestaurants(osm, [toRestaurantResult(row('WIN SON BAKERY', 0.2))]);
  assert.deepEqual(merged.map((r) => r.name), ['Win Son', 'Win Son Bakery']);
});

test('a city restaurant OpenStreetMap only knows as a bare building ranks first', () => {
  // Sixty Three Clinton: OpenStreetMap has just the building at 63 Clinton St.
  const osm = [photon('Clinton Street', 'highway', 'residential', 0.1), photon('63 Clinton Street', 'building', 'yes', 4)];
  const city = [toRestaurantResult(row('SIXTY THREE CLINTON', 4, { cuisine_description: 'New American' }))];
  const [first] = rankResults(mergeRestaurants(osm, city), 'sixty three clinton', HERE);
  assert.equal(first.name, 'Sixty Three Clinton');
  assert.equal(first.kind, 'New American');
});

test('nearest branch of a chain wins across both sources', () => {
  const osm = [photon('Starbucks', 'amenity', 'cafe', 2)];
  const city = [toRestaurantResult(row('STARBUCKS', 0.3, { building: '1' })), toRestaurantResult(row('STARBUCKS', 5, { building: '2' }))];
  const ranked = rankResults(mergeRestaurants(osm, city), 'starbucks', HERE);
  assert.deepEqual(ranked.map((r) => Math.round(distanceMiles(HERE, r))), [0, 2, 5]);
});
