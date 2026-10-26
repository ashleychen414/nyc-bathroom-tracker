import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEntries, nearby, matches, bathroomStatus } from './nearby.js';
import { parseHours } from './hours.js';

// Wed Oct 8 2025, 6:30pm in New York.
const NOW = new Date(Date.UTC(2025, 9, 8, 22, 30));
const HERE = { lat: 40.6728, lng: -73.9701 }; // Grand Army Plaza
const MILE_LAT = 1 / 69; // ~1 mile of latitude

const pub = (id, milesNorth, hoursText, extra = {}) => ({
  id,
  name: id,
  lat: HERE.lat + milesNorth * MILE_LAT,
  lng: HERE.lng,
  status: 'Operational',
  season: 'Year Round',
  hours: parseHours(hoursText).hours,
  accessibility: 'Fully Accessible',
  changingStations: 'Yes',
  ...extra,
});

const bathrooms = [
  pub('closed-near', 0.1, '10am - 8pm', { status: 'Closed for Construction' }),
  pub('unknown', 0.2, undefined),
  pub('open-far', 0.4, '6am - 11pm'),
  pub('open-near', 0.3, '6am - 11pm', { accessibility: 'Partially Accessible', changingStations: 'No' }),
  pub('outside-1', 0.7, '6am - 11pm'),
  pub('outside-2', 0.9, undefined),
  pub('way-out', 3, '6am - 11pm'),
  pub('lib', 2, '10am - 6pm', { type: 'Library' }),
];
const places = [
  { id: 'p-mine', own: true, visibility: 'private', name: 'Whole Foods', lat: HERE.lat + 0.35 * MILE_LAT, lng: HERE.lng, hours: parseHours('7am - 10pm').hours },
  { id: 'open-far', publicId: 'open-far', name: 'open-far', notes: 'code 12' },
];

test('saved public restrooms merge into their public entry', () => {
  const entries = buildEntries(bathrooms, places, NOW);
  assert.equal(entries.length, bathrooms.length + 1);
  assert.equal(entries.find((e) => e.id === 'open-far').place.notes, 'code 12');
  assert.equal(entries.find((e) => e.id === 'p-mine').status.state, 'open');
});

test('sorted open first, then unknown, then greyed out, by distance within each', () => {
  const { inside } = nearby(buildEntries(bathrooms, places, NOW), HERE, { radius: 0.5 });
  assert.deepEqual(
    inside.map((e) => e.id),
    ['open-near', 'p-mine', 'open-far', 'unknown', 'closed-near'],
  );
});

test('Hide closed leaves out closed restrooms', () => {
  const { inside } = nearby(buildEntries(bathrooms, places, NOW), HERE, { radius: 0.5, hideClosed: true });
  assert.deepEqual(inside.map((e) => e.id), ['open-near', 'p-mine', 'open-far', 'unknown']);
});

test('tops up to 5 with the nearest outside the radius', () => {
  const { inside, outside } = nearby(buildEntries(bathrooms, places, NOW), HERE, { radius: 0.25 });
  assert.deepEqual(inside.map((e) => e.id), ['unknown', 'closed-near']);
  assert.deepEqual(outside.map((e) => e.id), ['open-near', 'p-mine', 'open-far']);
});

test('no top-up when the radius already has 5', () => {
  const { outside } = nearby(buildEntries(bathrooms, places, NOW), HERE, { radius: 1 });
  assert.equal(outside.length, 0);
});

test('filters', () => {
  const entries = buildEntries(bathrooms, places, NOW);
  const ids = (f) => entries.filter((e) => matches(e, f)).map((e) => e.id);
  assert.deepEqual(ids({ kind: 'mine' }), ['open-far', 'p-mine']);
  assert.ok(!ids({ kind: 'public' }).includes('p-mine'));
  assert.ok(!ids({ openNow: true }).includes('unknown'));
  assert.ok(!ids({ accessible: true }).includes('open-near'));
  assert.ok(!ids({ changing: true }).includes('open-near'));
  assert.ok(!ids({ accessible: true }).includes('p-mine'));
  assert.deepEqual(ids({ type: 'Library' }), ['lib']);
});

test('your own bathroom shows once, from your copy, even when it is Public in the shared data', () => {
  const shared = { ...pub('p-mine', 0.35, '7am - 10pm'), name: 'old name', source: 'user', access: 'customers_only' };
  const entries = buildEntries([...bathrooms, shared], [{ ...places[0], name: 'Whole Foods (edited)', visibility: 'public' }], NOW);
  const mine = entries.filter((e) => e.id === 'p-mine');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].kind, 'mine');
  assert.equal(mine[0].name, 'Whole Foods (edited)');
});

test("duplicates both show: someone's Public café and your Private one", () => {
  const theirs = { ...pub('their-cafe', 0.35, undefined), name: 'Whole Foods', source: 'user', access: 'customers_only' };
  const entries = buildEntries([...bathrooms, theirs], places, NOW);
  assert.deepEqual(entries.filter((e) => e.name === 'Whole Foods').map((e) => e.kind).sort(), ['mine', 'public']);
});

test('a bathroom someone added is open only by its hours, and closed when we marked it closed', () => {
  const user = (extra) => ({ id: 'u', source: 'user', hours: parseHours('7am - 10pm').hours, ...extra });
  assert.equal(bathroomStatus(user({}), NOW).state, 'open');
  assert.equal(bathroomStatus(user({ hours: null }), NOW).state, 'unknown');
  assert.equal(bathroomStatus(user({ recordStatus: 'closed' }), NOW).state, 'closed');
});
