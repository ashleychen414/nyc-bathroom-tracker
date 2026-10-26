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

test('visits: newer edit wins, phone-only fields stay, stuck ones are not resent', async () => {
  const { planVisits, afterVisitPush, visitToRow } = await import('./sync.js');
  const v = (id, updatedAt, extra = {}) => ({ id, bathroomId: 'b', visitedAt: '2026-10-26T10:00:00.000Z', chips: [], source: 'app', updatedAt, ...extra });
  const server = [v('a', '2026-10-26T10:00:00.000Z', { clean: 2 }), v('b', '2026-10-26T11:00:00.000Z', { clean: 5 })];
  const local = [
    v('a', '2026-10-26T12:00:00.000Z', { clean: 4, name: 'Café', dismissedAt: 'x' }), // rated later on this phone
    v('b', '2026-10-26T10:30:00.000Z', { name: 'Park' }), // older than the account's copy
    v('c', '2026-10-26T12:00:00.000Z'), // logged signed out
    v('d', '2026-10-26T12:00:00.000Z', { stuck: true }), // refused before
  ];
  const plan = planVisits(server, local);
  assert.deepEqual(plan.toPush.map((x) => x.id), ['a', 'c']);
  const byId = Object.fromEntries(plan.merged.map((x) => [x.id, x]));
  assert.equal(byId.a.clean, 4);
  assert.equal(byId.b.clean, 5);
  assert.equal(byId.b.name, 'Park'); // the account's copy wins, the phone keeps the name
  assert.equal(byId.d.stuck, true);

  // After the push: c was refused; a was rated again mid-sync; b's card was closed mid-sync.
  const latest = [...local.slice(0, 1).map((x) => ({ ...x, clean: 1, updatedAt: '2026-10-26T13:00:00.000Z' })), { ...local[1], dismissedAt: 'y' }, local[2], local[3]];
  const after = Object.fromEntries(afterVisitPush(plan, new Set(['c']), latest).map((x) => [x.id, x]));
  assert.equal(after.a.clean, 1);
  assert.equal(after.b.dismissedAt, 'y');
  assert.equal(after.c.stuck, true);

  assert.deepEqual(Object.keys(visitToRow(v('e', 't'))), ['id', 'bathroom_id', 'visited_at', 'clean', 'get_in', 'vibes', 'chips', 'smell', 'trash', 'lighting', 'stall_count', 'updated_at']);
  assert.deepEqual(visitToRow({ id: 'e', bathroomId: 'b', visitedAt: 't', updatedAt: 't' }).chips, []);
});
