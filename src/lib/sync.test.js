import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planAll, afterPush, bathroomToRow, itemFromRow } from './sync.js';

const mine = (id, updatedAt, extra = {}) => ({ id, name: id, lat: 40.7, lng: -73.9, address: '', hours: null, access: 'unknown', visibility: 'private', createdAt: updatedAt, updatedAt, ...extra });

test('your bathrooms: changed on this phone or new is sent; otherwise the account copy wins, whatever the clocks say', () => {
  const server = { items: [], mine: [mine('a', '2026-10-24T18:00:00Z', { name: 'server a' }), mine('b', '2026-10-24T18:00:00Z', { name: 'server b' })] };
  const local = {
    items: [],
    mine: [
      mine('a', '2026-10-25T00:00:00Z', { name: 'phone a, newer clock but not changed' }),
      mine('b', '2026-10-01T00:00:00Z', { name: 'phone b, edited', dirty: true }), // phone clock behind: still sent
      mine('c', '2026-10-01T00:00:00Z', { name: 'only on this phone' }),
    ],
  };
  const { bathrooms } = planAll(server, local);
  assert.deepEqual(bathrooms.toPush.map((b) => b.id).sort(), ['b', 'c']);
  assert.deepEqual(Object.fromEntries(bathrooms.merged.map((b) => [b.id, b.name])), { a: 'server a', b: 'phone b, edited', c: 'only on this phone' });
});

test('Public on the account stays Public, even if this phone still says Private or deleted', () => {
  const server = { items: [], mine: [mine('a', '2026-10-24T18:00:00Z', { visibility: 'public' })] };
  const local = { items: [], mine: [mine('a', '2026-10-24T19:00:00Z', { visibility: 'private', deletedAt: '2026-10-24T19:00:00Z', dirty: true })] };
  const [sent] = planAll(server, local).bathrooms.toPush;
  assert.equal(sent.visibility, 'public');
  assert.equal(sent.deletedAt, undefined);
  assert.equal(bathroomToRow(sent).deleted_at, null);
});

test('after a push, sent bathrooms are marked saved unless edited again mid-sync', () => {
  const plan = planAll({ items: [], mine: [] }, { items: [], mine: [mine('a', 't1', { dirty: true }), mine('b', 't1', { dirty: true })] });
  const latest = { items: [], mine: [mine('a', 't1', { dirty: true }), mine('b', 't2', { name: 'edited mid-sync', dirty: true }), mine('c', 't3', { dirty: true })] };
  const kept = Object.fromEntries(afterPush(plan, latest).mine.map((b) => [b.id, b]));
  assert.equal(kept.a.dirty, undefined);
  assert.equal(kept.b.dirty, true);
  assert.equal(kept.b.name, 'edited mid-sync');
  assert.equal(kept.c.dirty, true); // added mid-sync: sent next time
});

test('list item rows carry the bathroom name and location for showing offline', () => {
  const i = itemFromRow({ bathroom_id: 'nyc-1', notes: null, created_at: '2026-10-24T18:00:00+00:00', updated_at: '2026-10-24T18:00:00+00:00', deleted_at: null, bathroom: { name: 'Park', lat: 1, lng: 2 } });
  assert.deepEqual(i, { bathroomId: 'nyc-1', createdAt: '2026-10-24T18:00:00.000Z', updatedAt: '2026-10-24T18:00:00.000Z', snapshot: { name: 'Park', lat: 1, lng: 2 } });
});
