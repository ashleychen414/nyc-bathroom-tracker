import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePlaces, planSync } from './storage.js';

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

test('sync: newer edit wins per place, in both directions', () => {
  const server = [place('a', '2026-10-05T00:00:00Z', { name: 'server a' }), place('b', '2026-10-01T00:00:00Z', { name: 'server b' })];
  const local = [place('a', '2026-10-02T00:00:00Z', { name: 'phone a' }), place('b', '2026-10-06T00:00:00Z', { name: 'phone b' }), place('c', '2026-10-07T00:00:00Z')];
  const { merged, toPush } = planSync(server, local);
  assert.deepEqual(Object.fromEntries(merged.map((p) => [p.id, p.name])), { a: 'server a', b: 'phone b', c: 'c' });
  assert.deepEqual(toPush.map((p) => p.id).sort(), ['b', 'c']);
});

test('sync: a delete on one phone beats an older edit elsewhere', () => {
  const server = [place('a', '2026-10-05T00:00:00Z')];
  const local = [place('a', '2026-10-06T00:00:00Z', { deletedAt: '2026-10-06T00:00:00Z' })];
  const { merged, toPush } = planSync(server, local);
  assert.equal(merged[0].deletedAt, '2026-10-06T00:00:00Z');
  assert.equal(toPush.length, 1);
  // ...and a newer edit elsewhere beats an older delete.
  const again = planSync([place('a', '2026-10-08T00:00:00Z', { name: 'kept' })], local);
  assert.equal(again.merged[0].deletedAt, undefined);
  assert.equal(again.toPush.length, 0);
});

test('sync: nothing to push when both sides match', () => {
  const both = [place('a', '2026-10-05T00:00:00Z')];
  assert.equal(planSync(both, both).toPush.length, 0);
});
