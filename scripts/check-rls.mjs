// Checks what an anonymous visitor (no sign-in) can do against the live Supabase project.
// Signed-in, cross-user checks live in supabase/tests/places_rls.sql (needs database access).
// Covers places, profiles, the shared bathrooms table and data_sources.
// Run: npm run test:rls

import assert from 'node:assert/strict';
import { SUPABASE_URL, SUPABASE_KEY } from '../src/lib/supabase-config.js';

const call = (path, { method = 'GET', body, headers = {} } = {}) =>
  fetch(SUPABASE_URL + path, {
    method,
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, headers: res.headers, body: await res.json().catch(() => null) }));

const blocked = (r) => assert.ok(r.status === 401 || r.status === 403, `expected 401/403, got ${r.status}`);

const checks = [
  ['anonymous visitors see no saved places', async () => {
    const r = await call('/rest/v1/places?select=id');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, []);
  }],
  ['anonymous visitors cannot add a place', async () => {
    blocked(await call('/rest/v1/places', { method: 'POST', body: { id: '00000000-0000-0000-0000-000000000000', data: {}, updated_at: new Date().toISOString() } }));
  }],
  ['anonymous visitors cannot call delete_my_account', async () => {
    blocked(await call('/rest/v1/rpc/delete_my_account', { method: 'POST', body: {} }));
  }],
  ['anonymous visitors see no profiles', async () => {
    const r = await call('/rest/v1/profiles?select=id');
    if (r.status === 200) assert.deepEqual(r.body, []);
    else blocked(r);
  }],
  ['anonymous visitors cannot add a profile', async () => {
    blocked(await call('/rest/v1/profiles', { method: 'POST', body: { id: '00000000-0000-0000-0000-000000000000' } }));
  }],
  ['anonymous visitors can read the city restrooms', async () => {
    const r = await call('/rest/v1/bathrooms?select=id,source&source=eq.seed&limit=1', { headers: { Prefer: 'count=exact' } });
    assert.ok(r.status === 200 || r.status === 206, `expected 200/206, got ${r.status}`); // 206 = partial page with a count
    const total = Number(r.headers.get('content-range')?.split('/')[1]);
    assert.ok(total >= 1000, `expected 1,000+ seed bathrooms, got ${total}`);
    assert.match(r.body[0].id, /^nyc-[0-9a-f]{10}$/);
  }],
  ['anonymous visitors see only seed and confirmed bathrooms', async () => {
    const r = await call('/rest/v1/bathrooms?select=id&source=neq.seed&status=neq.confirmed&limit=1');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, []);
  }],
  ['anonymous visitors cannot add a bathroom', async () => {
    blocked(await call('/rest/v1/bathrooms', { method: 'POST', body: { id: 'rls-check', name: 'x', source: 'user', lat: 40.7, lng: -73.9 } }));
  }],
  ['anonymous visitors cannot change a bathroom', async () => {
    blocked(await call('/rest/v1/bathrooms?id=eq.rls-check-none', { method: 'PATCH', body: { name: 'changed' } }));
  }],
  ['anonymous visitors cannot delete a bathroom', async () => {
    blocked(await call('/rest/v1/bathrooms?id=eq.rls-check-none', { method: 'DELETE' }));
  }],
  ['anonymous visitors cannot run the bathrooms sync', async () => {
    const r = await call('/rest/v1/rpc/sync_seed_bathrooms', { method: 'POST', body: { rows: [], mark_missing: false } });
    assert.ok([401, 403, 404].includes(r.status), `expected 401/403/404, got ${r.status}`);
  }],
  ['anonymous visitors can read the dataset info', async () => {
    const r = await call('/rest/v1/data_sources?select=id,source_updated_at');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
  }],
  ['anonymous visitors cannot add or change dataset info', async () => {
    blocked(await call('/rest/v1/data_sources', { method: 'POST', body: { id: 'rls-check' } }));
    blocked(await call('/rest/v1/data_sources?id=eq.rls-check-none', { method: 'PATCH', body: { generated_at: new Date().toISOString() } }));
  }],
  ['keep_alive works for the nightly job', async () => {
    const r = await call('/rest/v1/rpc/keep_alive', { method: 'POST', body: {} });
    assert.equal(r.status, 200);
    assert.equal(r.body, 1);
  }],
];

let failed = 0;
for (const [name, check] of checks) {
  try {
    await check();
    console.log(`ok - ${name}`);
  } catch (err) {
    failed++;
    console.log(`not ok - ${name}: ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
