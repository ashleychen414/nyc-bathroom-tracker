import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeKind, normalize, rankResults, resultMeta, toResult, scoreResult } from './geo.js';

const HERE = { lat: 40.6728, lng: -73.9701 }; // Grand Army Plaza
const MILE_LAT = 1 / 69; // ~1 mile of latitude

// A Photon feature, `milesNorth` of HERE.
const feature = (name, osmKey, osmValue, milesNorth, extra = {}) => ({
  geometry: { coordinates: [HERE.lng, HERE.lat + milesNorth * MILE_LAT] },
  properties: { name, osm_key: osmKey, osm_value: osmValue, type: 'house', district: 'Brooklyn', ...extra },
});

const results = (...features) => features.map((f, i) => toResult(f, i));
const names = (list) => list.map((r) => `${r.name} @${r.address}`);

test('placeKind gives short labels for common places', () => {
  assert.equal(placeKind('amenity', 'cafe'), 'Café');
  assert.equal(placeKind('shop', 'coffee'), 'Café');
  assert.equal(placeKind('amenity', 'fast_food'), 'Fast food');
  assert.equal(placeKind('amenity', 'library'), 'Library');
  assert.equal(placeKind('shop', 'supermarket'), 'Supermarket');
  assert.equal(placeKind('shop', 'hardware'), 'Shop');
  assert.equal(placeKind('highway', 'residential', 'street'), 'Street');
  assert.equal(placeKind('place', 'neighbourhood', 'locality'), 'Neighborhood');
  assert.equal(placeKind('place', 'house', 'house'), 'Address');
  assert.equal(placeKind('building', 'yes', 'house'), 'Address');
  assert.equal(placeKind('amenity', 'bicycle_rental'), 'Bicycle rental');
  assert.equal(placeKind(undefined, undefined, 'street'), '');
});

test('normalize ignores accents, case and punctuation', () => {
  assert.equal(normalize('Devoción'), 'devocion');
  assert.equal(normalize("Katz's Delicatessen"), 'katzs delicatessen');
  assert.equal(normalize('7th Ave.'), '7th ave');
});

test('resultMeta shows type and distance', () => {
  assert.equal(resultMeta({ kind: 'Café', distance: 0.12 }), 'Café · 0.1 mi');
  assert.equal(resultMeta({ kind: 'Café', distance: 0.05 }), 'Café · 264 ft');
  assert.equal(resultMeta({ kind: 'Café' }), 'Café');
  assert.equal(resultMeta({ kind: '', distance: 2 }), '2.0 mi');
  assert.equal(resultMeta({ kind: '' }), '');
});

test('toResult keeps name, address and kind', () => {
  const r = toResult(feature('Starbucks', 'amenity', 'cafe', 0.5, { housenumber: '341', street: 'Eastern Parkway' }), 3);
  assert.equal(r.name, 'Starbucks');
  assert.equal(r.address, '341 Eastern Parkway, Brooklyn');
  assert.equal(r.kind, 'Café');
  assert.equal(r.providerRank, 3);
});

test('a chain: the nearest branch comes first', () => {
  const list = results(
    feature('Starbucks', 'amenity', 'cafe', 5, { street: 'Lexington Avenue' }),
    feature('Starbucks', 'amenity', 'cafe', 3, { street: 'Broadway' }),
    feature('Starbucks', 'amenity', 'cafe', 0.7, { street: '9th Street' }),
  );
  assert.deepEqual(names(rankResults(list, 'starbucks', HERE)).map((n) => n.split('@')[1]), [
    '9th Street, Brooklyn',
    'Broadway, Brooklyn',
    'Lexington Avenue, Brooklyn',
  ]);
});

test('businesses beat streets and neighbourhoods with the same name', () => {
  const list = results(
    feature('Prospect Heights', 'place', 'neighbourhood', 0.3, { type: 'locality' }),
    feature('Prospect Avenue', 'highway', 'residential', 0.4, { type: 'street' }),
    feature('Prospect Café', 'amenity', 'cafe', 0.6),
  );
  assert.equal(rankResults(list, 'prospect', HERE)[0].name, 'Prospect Café');
});

test('bike racks and book boxes sink below real places', () => {
  const list = results(
    feature('Library Bike Parking', 'amenity', 'bicycle_parking', 0.05),
    feature('Little Free Library', 'amenity', 'public_bookcase', 0.1),
    feature('Brooklyn Public Library', 'amenity', 'library', 0.1),
  );
  assert.equal(rankResults(list, 'library', HERE)[0].name, 'Brooklyn Public Library');
});

test('a nearby match on a whole word beats a far one that starts with the query', () => {
  const list = results(
    feature('Library for Arts and Culture', 'amenity', 'library', 1),
    feature('Brooklyn Public Library', 'amenity', 'library', 0.1),
  );
  assert.equal(rankResults(list, 'library', HERE)[0].name, 'Brooklyn Public Library');
});

test('an exact name far away still beats an unrelated place nearby', () => {
  const list = results(
    feature('Katz Center', 'amenity', 'place_of_worship', 1),
    feature("Katz's Delicatessen", 'amenity', 'restaurant', 3.5),
  );
  assert.equal(rankResults(list, "katz's delicatessen", HERE)[0].name, "Katz's Delicatessen");
});

test('accents do not matter: "devocion" finds Devoción', () => {
  const r = toResult(feature('Devoción', 'amenity', 'cafe', 1.3));
  const other = toResult(feature('Devon Deli', 'shop', 'convenience', 0.2));
  assert.ok(scoreResult(r, 'devocion', HERE) > scoreResult(other, 'devocion', HERE));
});

test('an address search prefers the address over a business at the same number', () => {
  const list = results(
    feature('WCBS-FM', 'man_made', 'tower', 5.3, { housenumber: '350', street: '5th Avenue', district: 'Manhattan' }),
    feature(undefined, 'place', 'house', 0.8, { housenumber: '350', street: '5th Avenue' }),
  );
  const [first] = rankResults(list, '350 5th ave', HERE);
  assert.equal(first.address, '350 5th Avenue, Brooklyn');
  assert.equal(first.kind, 'Address');
});

test('"7th ave" is a name search, not an address search', () => {
  const list = results(
    feature('Citi Bike - 7 Ave & Park Pl', 'amenity', 'bicycle_rental', 0.2, { street: '7th Avenue' }),
    feature('7th Ave. News', 'shop', 'convenience', 0.5, { street: '7th Avenue' }),
  );
  assert.equal(rankResults(list, '7th ave', HERE)[0].name, '7th Ave. News');
});

test('duplicates are dropped and the list is capped', () => {
  const list = results(
    ...Array.from({ length: 10 }, (_, i) => feature(`Cafe ${i}`, 'amenity', 'cafe', i / 10)),
    feature('Cafe 0', 'amenity', 'cafe', 0),
  );
  const ranked = rankResults(list, 'cafe', HERE);
  assert.equal(ranked.length, 6);
  assert.equal(new Set(names(ranked)).size, 6);
});
