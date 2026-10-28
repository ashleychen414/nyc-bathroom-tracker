import { test } from 'node:test';
import assert from 'node:assert/strict';

const KEY = 'nbt.session';
const nowSec = () => Math.floor(Date.now() / 1000);
const USER = { id: 'u1', email: 'friend@example.com' };

// auth.js reads the saved session when it loads, so each test loads its own copy of the module
// after setting up a fake localStorage and fetch.
let copies = 0;
async function loadAuth({ session, respond }) {
  const store = new Map(session ? [[KEY, JSON.stringify(session)]] : []);
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const path = url.replace(/^https:\/\/[^/]+/, '');
    calls.push({ path, opts, auth: opts.headers.Authorization, body: opts.body && JSON.parse(opts.body) });
    const [status, body] = await respond(path, opts);
    return { ok: status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) };
  };
  const auth = await import(`./auth.js?copy=${++copies}`);
  return { auth, calls, store };
}

const REFRESH = '/auth/v1/token?grant_type=refresh_token';
const fresh = { access_token: 'a1', refresh_token: 'r1', expires_at: nowSec() + 3600, user: USER };
const expired = { ...fresh, expires_at: nowSec() - 10 };

test('a current token is used as is, with no refresh', async () => {
  const { auth, calls } = await loadAuth({ session: fresh, respond: () => [200, [{ id: 'row' }]] });
  assert.deepEqual(await auth.authedFetch('/rest/v1/visits'), [{ id: 'row' }]);
  assert.deepEqual(calls.map((c) => [c.path, c.auth]), [['/rest/v1/visits', 'Bearer a1']]);
});

test('an expired token is refreshed once for concurrent calls, saved, then used', async () => {
  const { auth, calls, store } = await loadAuth({
    session: expired,
    respond: (path) =>
      path === REFRESH ? [200, { access_token: 'a2', refresh_token: 'r2', expires_in: 3600, user: USER }] : [200, []],
  });
  await Promise.all([auth.authedFetch('/rest/v1/visits'), auth.authedFetch('/rest/v1/list_items')]);
  const refreshes = calls.filter((c) => c.path === REFRESH);
  assert.equal(refreshes.length, 1);
  assert.deepEqual(refreshes[0].body, { refresh_token: 'r1' });
  assert.deepEqual(calls.filter((c) => c.path !== REFRESH).map((c) => c.auth), ['Bearer a2', 'Bearer a2']);
  const saved = JSON.parse(store.get(KEY));
  assert.equal(saved.access_token, 'a2');
  assert.equal(saved.refresh_token, 'r2');
  assert.ok(saved.expires_at > nowSec());
  assert.deepEqual(auth.currentUser(), USER);
});

for (const status of [400, 401]) {
  test(`a refresh rejected with ${status} signs out`, async () => {
    const { auth, calls, store } = await loadAuth({
      session: expired,
      respond: () => [status, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }],
    });
    await assert.rejects(auth.authedFetch('/rest/v1/visits'), { status });
    assert.equal(auth.currentUser(), null);
    assert.equal(store.has(KEY), false);
    assert.deepEqual(calls.map((c) => c.path), [REFRESH]);
    await assert.rejects(auth.authedFetch('/rest/v1/visits'), { message: 'Not signed in', status: 401 });
  });
}

test('a refresh that fails for other reasons (offline, server error) keeps you signed in', async () => {
  for (const respond of [() => Promise.reject(new TypeError('Failed to fetch')), () => [500, {}]]) {
    const { auth, store } = await loadAuth({ session: expired, respond });
    await assert.rejects(auth.authedFetch('/rest/v1/visits'));
    assert.deepEqual(auth.currentUser(), USER);
    assert.ok(store.has(KEY));
  }
});

test('signed-in requests give up after 8 seconds with a plain message', async () => {
  const { auth, calls } = await loadAuth({
    session: fresh,
    respond: (path, { signal }) => {
      const timedOut = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      return signal ? Promise.reject(timedOut) : [200, []];
    },
  });
  await assert.rejects(auth.authedFetch('/rest/v1/visits'), { message: /Couldn't reach NYC Poops/ });
  assert.ok(calls[0].opts.signal instanceof AbortSignal);
});
