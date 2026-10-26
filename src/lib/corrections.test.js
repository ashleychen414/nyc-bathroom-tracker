import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changesFrom, canReopen, cityClosed, applyResult, describeChange, deviceId } from './corrections.js';

const city = (extra) => ({ id: 'nyc-1', source: 'seed', name: 'Park House', access: 'public', hours: { kind: 'always' }, status: 'Operational', season: 'Year Round', userFields: [], reportedClosedAt: null, ...extra });

test('changesFrom sends only what differs, trimmed', () => {
  const b = city();
  assert.deepEqual(changesFrom(b, { name: ' Park House ', access: 'public' }), {});
  assert.deepEqual(changesFrom(b, { name: ' Boathouse ' }), { name: 'Boathouse' });
  assert.deepEqual(changesFrom(b, { access: 'customers_only' }), { access: 'customers_only' });
  // Untouched hours (undefined) are never sent; "Don't know" (null) is a change from known hours.
  assert.deepEqual(changesFrom(b, { hours: undefined }), {});
  assert.deepEqual(changesFrom(b, { hours: { kind: 'always' } }), {});
  assert.deepEqual(changesFrom(b, { hours: null }), { hours: null });
  assert.deepEqual(changesFrom(city({ hours: null }), { hours: null }), {});
  // An empty name never clears the name.
  assert.deepEqual(changesFrom(b, { name: '  ' }), {});
});

test('"open again" only for a restroom shown closed', () => {
  assert.equal(canReopen(city()), false);
  assert.deepEqual(changesFrom(city(), { open: true }), {});
  assert.equal(canReopen(city({ reportedClosedAt: '2026-10-26T12:00:00Z' })), true);
  assert.equal(cityClosed(city({ status: 'Closed for Construction' })), true);
  assert.equal(canReopen(city({ status: 'Closed for Construction' })), true);
  assert.equal(canReopen(city({ status: 'Closed for Construction', userFields: ['open'] })), false);
  assert.equal(canReopen(city({ season: 'Future' })), true);
  assert.equal(canReopen({ source: 'user', recordStatus: 'unverified' }), false);
  assert.deepEqual(changesFrom(city({ reportedClosedAt: '2026-10-26T12:00:00Z' }), { open: true }), { open: true });
});

test('applyResult copies the database answer onto the app copy', () => {
  const b = city();
  applyResult(b, { editId: 'e', bathroom: { id: 'nyc-1', name: 'Boathouse', hours: null, access: 'customers_only', userFields: ['hours', 'name'], reportedClosedAt: null } });
  assert.deepEqual([b.name, b.hours, b.access, b.userFields, b.status], ['Boathouse', null, 'customers_only', ['hours', 'name'], 'Operational']);
  assert.equal(applyResult(null, {}), null);
});

test('describeChange says what changed, never who', () => {
  assert.equal(describeChange({ kind: 'report_closed' }), 'Reported closed');
  assert.equal(describeChange({ kind: 'confirm_open' }), 'Confirmed open');
  assert.equal(describeChange({ kind: 'edit', changes: { name: 'Boathouse', hours: { kind: 'always' } } }), 'Name changed to Boathouse · Hours changed');
  assert.equal(describeChange({ kind: 'edit', changes: { hours: null, access: 'customers_only' } }), 'Hours marked unknown · Access: Customer Only');
  assert.equal(describeChange({ kind: 'edit', changes: { open: true } }), 'Marked open again');
});

test('deviceId is made once per phone and kept', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const id = deviceId(storage);
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(deviceId(storage), id);
  // Blocked storage: still an id, the same for the rest of the page's life.
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(deviceId(blocked), deviceId(blocked));
});
