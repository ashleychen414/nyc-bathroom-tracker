import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePlaces } from './storage.js';

const place = (id, updatedAt, extra = {}) => ({ id, name: id, lat: 40.7, lng: -73.9, updatedAt, log: {}, ...extra });

test('import adds new places and keeps the newer edit', () => {
  const current = [place('a', '2026-10-01T00:00:00Z', { name: 'old a' }), place('b', '2026-10-05T00:00:00Z', { name: 'mine b' })];
  const incoming = [
    place('a', '2026-10-03T00:00:00Z', { name: 'new a' }),
    place('b', '2026-10-02T00:00:00Z', { name: 'older b' }),
    place('c', '2026-10-04T00:00:00Z'),
  ];
  const { places, counts } = mergePlaces(current, incoming);
  assert.deepEqual(counts, { added: 1, updated: 1, unchanged: 1, skipped: 0 });
  const byId = Object.fromEntries(places.map((p) => [p.id, p.name]));
  assert.deepEqual(byId, { a: 'new a', b: 'mine b', c: 'c' });
});

test('import skips malformed entries', () => {
  const { places, counts } = mergePlaces([], [{ id: 'x' }, null, place('ok', '2026-10-01T00:00:00Z'), { ...place('bad', 'x'), lat: 'nope' }]);
  assert.equal(counts.skipped, 3);
  assert.deepEqual(places.map((p) => p.id), ['ok']);
});
