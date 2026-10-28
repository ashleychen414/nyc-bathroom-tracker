import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromV1, mergeBy, planSync } from './storage.js';

const item = (bathroomId, updatedAt, extra = {}) => ({ bathroomId, createdAt: updatedAt, updatedAt, ...extra });
const mine = (id, updatedAt, extra = {}) => ({ id, name: id, lat: 40.7, lng: -73.9, address: '', hours: null, access: 'unknown', visibility: 'private', createdAt: updatedAt, updatedAt, ...extra });

test('v1 places move over: city restrooms become items, hand-added ones Private bathrooms with the same id', () => {
  const data = fromV1([
    { id: 'u1', name: 'My café', lat: 40.7, lng: -73.9, address: '1 Main St', hours: { kind: 'always' }, log: { lighting: 4, notes: ' code 12 ' }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' },
    { id: 'u2', name: 'Park', publicId: 'nyc-abc', lat: 40.6, lng: -73.8, log: { cleanliness: 2 }, createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z' },
    { id: 'u3', name: 'Gone', lat: 40.6, lng: -73.8, log: {}, updatedAt: '2026-10-04T00:00:00Z', deletedAt: '2026-10-04T00:00:00Z' },
  ]);
  assert.deepEqual(data.mine, [
    { id: 'u1', name: 'My café', lat: 40.7, lng: -73.9, address: '1 Main St', hours: { kind: 'always' }, access: 'unknown', visibility: 'private', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' },
  ]);
  assert.deepEqual(data.items.map((i) => [i.bathroomId, i.notes]), [['u1', 'code 12'], ['nyc-abc', undefined]]);
  assert.deepEqual(data.items[1].snapshot, { name: 'Park', lat: 40.6, lng: -73.8 });
  // Moved-over bathrooms aren't "changed on this phone": the account already has them.
  assert.equal(data.mine[0].dirty, undefined);
});

test('merge keeps the newer edit per key and counts what changed', () => {
  const current = [item('a', '2026-10-01T00:00:00Z', { notes: 'old a' }), item('b', '2026-10-05T00:00:00Z', { notes: 'mine b' })];
  const incoming = [item('a', '2026-10-03T00:00:00Z', { notes: 'new a' }), item('b', '2026-10-02T00:00:00Z'), item('c', '2026-10-04T00:00:00Z')];
  const { list, counts } = mergeBy(current, incoming, 'bathroomId');
  assert.deepEqual(counts, { added: 1, updated: 1, unchanged: 1 });
  assert.deepEqual(Object.fromEntries(list.map((i) => [i.bathroomId, i.notes])), { a: 'new a', b: 'mine b', c: undefined });
});

test('list items sync: newer edit wins in both directions, and a newer delete beats an older edit', () => {
  const server = [item('a', '2026-10-05T00:00:00Z', { notes: 'server' }), item('b', '2026-10-01T00:00:00Z')];
  const local = [item('a', '2026-10-02T00:00:00Z', { notes: 'phone' }), item('b', '2026-10-06T00:00:00Z', { deletedAt: '2026-10-06T00:00:00Z' }), item('c', '2026-10-07T00:00:00Z')];
  const { merged, toPush } = planSync(server, local, 'bathroomId');
  const byId = Object.fromEntries(merged.map((i) => [i.bathroomId, i]));
  assert.equal(byId.a.notes, 'server');
  assert.equal(byId.b.deletedAt, '2026-10-06T00:00:00Z');
  assert.deepEqual(toPush.map((i) => i.bathroomId).sort(), ['b', 'c']);
  assert.equal(planSync(server, server, 'bathroomId').toPush.length, 0);
});
