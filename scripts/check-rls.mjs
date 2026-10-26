// Checks what an anonymous visitor (no sign-in) can do against the live Supabase project.
// Signed-in, cross-user checks live in supabase/tests/places_rls.sql (needs database access).
// Covers places, profiles, the shared bathrooms table, lists, list_items, visits, bathroom_stats(), bathroom_edits (and its functions), data_sources and location_events.
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
  ['anonymous visitors see no Private bathrooms', async () => {
    const r = await call('/rest/v1/bathrooms?select=id&visibility=eq.private&limit=1');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, []);
  }],
  ['anonymous visitors see no removed or merged user bathrooms', async () => {
    const r = await call('/rest/v1/bathrooms?select=id&source=eq.user&status=in.(removed,merged)&limit=1');
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
  ['anonymous visitors see no lists or list items, and cannot add any', async () => {
    for (const table of ['lists', 'list_items']) {
      const r = await call(`/rest/v1/${table}?select=*&limit=1`);
      if (r.status === 200) assert.deepEqual(r.body, []);
      else blocked(r);
    }
    blocked(await call('/rest/v1/lists', { method: 'POST', body: { name: 'x' } }));
    blocked(await call('/rest/v1/list_items', { method: 'POST', body: { list_id: '00000000-0000-0000-0000-000000000000', bathroom_id: 'rls-check' } }));
  }],
  ['anonymous visitors cannot read or add visits', async () => {
    blocked(await call('/rest/v1/visits?select=bathroom_id&limit=1'));
    blocked(await call('/rest/v1/visits', { method: 'POST', body: { bathroom_id: 'rls-check', visited_at: new Date().toISOString() } }));
    blocked(await call('/rest/v1/visits?bathroom_id=eq.rls-check-none', { method: 'PATCH', body: { clean: 1 } }));
  }],
  ['bathroom stats are counts only, above the minimum number of people', async () => {
    const min = await call('/rest/v1/rpc/stats_min_people', { method: 'POST', body: {} });
    assert.equal(min.status, 200);
    assert.ok(Number.isInteger(min.body) && min.body >= 1, `stats_min_people() returned ${min.body}`);
    const r = await call('/rest/v1/rpc/bathroom_stats', { method: 'POST', body: {} });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    const columns = ['bathroom_id', 'people', 'visits', 'last_visit', 'clean', 'clean_people', 'get_in', 'get_in_people', 'vibes', 'vibes_people', 'chips', 'facts'];
    for (const row of r.body) {
      assert.deepEqual(Object.keys(row).sort(), [...columns].sort());
      assert.ok(row.people >= min.body, `${row.bathroom_id} shows ${row.people} people`);
      assert.match(row.last_visit, /^\d{4}-\d{2}-\d{2}$/); // a date, never a time
      for (const dim of ['clean', 'get_in', 'vibes']) assert.ok(row[dim] === null || row[`${dim}_people`] >= min.body, `${row.bathroom_id} ${dim} average from too few people`);
    }
  }],
  // Edits only through the functions (their rules are tested in places_rls.sql). These checks
  // change nothing: a bathroom history is read, and the writes are refused.
  ['anonymous visitors cannot read or write bathroom edits directly', async () => {
    blocked(await call('/rest/v1/bathroom_edits?select=id&limit=1'));
    blocked(await call('/rest/v1/bathroom_edits_per_person?select=person&limit=1'));
    blocked(await call('/rest/v1/bathroom_edits', { method: 'POST', body: { bathroom_id: 'rls-check-none', kind: 'confirm_open', device_id: '00000000-0000-0000-0000-000000000000' } }));
    for (const fn of ['bathrooms_recompute_closed', 'is_admin', 'bathroom_edits_rate_check']) {
      const r = await call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: {} });
      assert.ok([401, 403, 404].includes(r.status), `${fn}: expected 401/403/404, got ${r.status}`);
    }
  }],
  ['a bathroom history never says who', async () => {
    const r = await call('/rest/v1/rpc/bathroom_history', { method: 'POST', body: { p_bathroom_id: 'rls-check-none' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, []);
    const [b] = (await call('/rest/v1/bathrooms?select=id&source=eq.seed&limit=1')).body;
    const h = await call('/rest/v1/rpc/bathroom_history', { method: 'POST', body: { p_bathroom_id: b.id } });
    assert.equal(h.status, 200);
    for (const row of h.body) assert.deepEqual(Object.keys(row).sort(), ['can_undo', 'changes', 'created_at', 'id', 'kind', 'mine', 'previous', 'undone']);
  }],
  ['anonymous visitors cannot edit a missing bathroom or undo others', async () => {
    const device = '00000000-0000-0000-0000-000000000000';
    const edit = await call('/rest/v1/rpc/edit_bathroom', { method: 'POST', body: { p_bathroom_id: 'rls-check-none', p_device_id: device, p_changes: { name: 'x' } } });
    assert.ok(edit.status >= 400, `edit of a missing bathroom: got ${edit.status}`);
    const undo = await call('/rest/v1/rpc/undo_bathroom_edit', { method: 'POST', body: { p_edit_id: device, p_device_id: device } });
    assert.ok(undo.status >= 400, `undo of a missing edit: got ${undo.status}`);
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
  // Leaves one real row per run, tagged app_version 'rls-check'; the reading views skip those.
  ['anonymous visitors can add a location event', async () => {
    const r = await call('/rest/v1/location_events', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: { trigger: 'startup', permission_before: 'unknown', result: 'unsupported', platform: 'other', app_version: 'rls-check' },
    });
    assert.equal(r.status, 201);
  }],
  ['location events refuse values outside the lists and extra fields', async () => {
    const event = { trigger: 'startup', permission_before: 'unknown', result: 'unsupported', platform: 'other', app_version: 'rls-check' };
    const bad = await call('/rest/v1/location_events', { method: 'POST', body: { ...event, platform: 'Mozilla/5.0' } });
    assert.equal(bad.status, 400);
    const extra = await call('/rest/v1/location_events', { method: 'POST', body: { ...event, lat: 40.7, lng: -73.9 } });
    assert.equal(extra.status, 400);
    blocked(await call('/rest/v1/location_events', { method: 'POST', body: { ...event, created_at: '2020-01-01T00:00:00Z' } }));
  }],
  ['anonymous visitors cannot read, change or delete location events', async () => {
    blocked(await call('/rest/v1/location_events?select=id&limit=1'));
    blocked(await call('/rest/v1/location_events_daily?select=day&limit=1'));
    blocked(await call('/rest/v1/location_events_weekly?select=platform&limit=1'));
    blocked(await call('/rest/v1/location_events?app_version=eq.rls-check', { method: 'PATCH', body: { result: 'granted' } }));
    blocked(await call('/rest/v1/location_events?app_version=eq.rls-check', { method: 'DELETE' }));
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
