import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBathrooms, PAGE } from './bathrooms-source.js';

const SOURCE = { source_updated_at: '2025-06-27T12:00:00+00:00', generated_at: '2026-10-08T00:00:00+00:00', special_days: null, updated_at: '2026-10-14T20:00:00+00:00' };
const row = (i) => ({ id: `nyc-${String(i).padStart(10, '0')}`, name: `R${i}`, lat: 40.7, lng: -73.9, hours: null, hoursReviewed: false, status: 'Operational' });
const FILE = { sourceUpdatedAt: '2025-06-27T12:00:00.000Z', bathrooms: [row('file')] };

// A fake fetch answering Supabase and the published file; records what was asked.
function fakeFetch({ rows = [row(1)], source = SOURCE, latest = '2026-10-14T21:00:00+00:00', supabaseDown = false, fileDown = false } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const ok = (body) => ({ ok: true, json: async () => body });
    if (url.endsWith('bathrooms.json')) return fileDown ? { ok: false, status: 404 } : ok(FILE);
    if (supabaseDown) throw new TypeError('Failed to fetch');
    if (url.includes('/data_sources?')) return ok(source ? [source] : []);
    if (url.includes('select=updated_at&')) return ok(rows.length ? [{ updated_at: latest }] : []);
    const offset = Number(new URL(url).searchParams.get('offset'));
    return ok(rows.slice(offset, offset + PAGE));
  };
  return { fetchImpl, calls };
}

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

async function load(opts) {
  const seen = [];
  await loadBathrooms((d) => seen.push(d), opts);
  return seen;
}

test('loads every restroom from Supabase, a page at a time, in the app shape', async () => {
  const rows = Array.from({ length: PAGE + 5 }, (_, i) => row(i));
  const { fetchImpl, calls } = fakeFetch({ rows });
  const [data] = await load({ fetchImpl, storage: memoryStorage() });
  assert.equal(data.bathrooms.length, PAGE + 5);
  assert.equal(data.count, PAGE + 5);
  assert.equal(data.sourceUpdatedAt, SOURCE.source_updated_at);
  assert.equal('specialDays' in data, false);
  assert.equal(calls.filter((u) => u.includes('offset=')).length, 2);
  assert.ok(calls.some((u) => u.includes('source_removed_at=is.null')), 'rows gone from the city data are left out');
});

test('passes holiday closures through as specialDays', async () => {
  const { fetchImpl } = fakeFetch({ source: { ...SOURCE, special_days: { BPL: ['2026-11-26'] } } });
  const [data] = await load({ fetchImpl, storage: memoryStorage() });
  assert.deepEqual(data.specialDays, { BPL: ['2026-11-26'] });
});

test('a second open with nothing changed uses the phone copy and downloads no restrooms', async () => {
  const storage = memoryStorage();
  await load({ fetchImpl: fakeFetch().fetchImpl, storage });
  const { fetchImpl, calls } = fakeFetch();
  const seen = await load({ fetchImpl, storage });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].bathrooms[0].id, row(1).id);
  assert.equal(calls.filter((u) => u.includes('offset=')).length, 0);
});

test('shows the phone copy first, then fresh data when something changed', async () => {
  const storage = memoryStorage();
  await load({ fetchImpl: fakeFetch().fetchImpl, storage });
  const { fetchImpl } = fakeFetch({ rows: [row(1), row(2)], latest: '2026-10-15T09:00:00+00:00' });
  const seen = await load({ fetchImpl, storage });
  assert.deepEqual(seen.map((d) => d.bathrooms.length), [1, 2]);
});

test('falls back to the published file when Supabase is down or not set up', async () => {
  for (const opts of [{ supabaseDown: true }, { source: null }, { rows: [] }]) {
    const [data] = await load({ fetchImpl: fakeFetch(opts).fetchImpl, storage: memoryStorage() });
    assert.equal(data.bathrooms[0].id, row('file').id, JSON.stringify(opts));
  }
});

test('offline with a phone copy keeps it; offline with nothing rejects', async () => {
  const storage = memoryStorage();
  await load({ fetchImpl: fakeFetch().fetchImpl, storage });
  const seen = await load({ fetchImpl: fakeFetch({ supabaseDown: true, fileDown: true }).fetchImpl, storage });
  assert.equal(seen.length, 1);
  await assert.rejects(load({ fetchImpl: fakeFetch({ supabaseDown: true, fileDown: true }).fetchImpl, storage: memoryStorage() }));
});

test('works when storage is unavailable', async () => {
  const [data] = await load({ fetchImpl: fakeFetch().fetchImpl, storage: null });
  assert.equal(data.bathrooms.length, 1);
});
