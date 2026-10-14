// Checks what an anonymous visitor (no sign-in) can do against the live Supabase project.
// Signed-in, cross-user checks live in supabase/tests/places_rls.sql (needs database access).
// Run: npm run test:rls

import assert from 'node:assert/strict';
import { SUPABASE_URL, SUPABASE_KEY } from '../src/lib/supabase-config.js';

const call = (path, { method = 'GET', body } = {}) =>
  fetch(SUPABASE_URL + path, {
    method,
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }));

const checks = [
  ['anonymous visitors see no saved places', async () => {
    const r = await call('/rest/v1/places?select=id');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, []);
  }],
  ['anonymous visitors cannot add a place', async () => {
    const r = await call('/rest/v1/places', { method: 'POST', body: { id: '00000000-0000-0000-0000-000000000000', data: {}, updated_at: new Date().toISOString() } });
    assert.ok(r.status === 401 || r.status === 403, `expected 401/403, got ${r.status}`);
  }],
  ['anonymous visitors cannot call delete_my_account', async () => {
    const r = await call('/rest/v1/rpc/delete_my_account', { method: 'POST', body: {} });
    assert.ok(r.status === 401 || r.status === 403, `expected 401/403, got ${r.status}`);
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
