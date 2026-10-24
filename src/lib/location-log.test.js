import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locationEvent, createLocationLog } from './location-log.js';

const OUTCOME = { trigger: 'button', permissionBefore: 'prompt', result: 'granted', platform: 'ios-safari' };

function fakeFetch() {
  const calls = [];
  const fetch = (url, opts) => {
    calls.push({ url, opts, body: JSON.parse(opts.body) });
    return Promise.resolve({ ok: true });
  };
  return { fetch, calls };
}

test('locationEvent sends only the five allowed fields', () => {
  assert.deepEqual(locationEvent({ ...OUTCOME, lat: 40.7, lng: -73.9, accuracy: 10, zip: '11215' }, 'abc1234'), {
    trigger: 'button',
    permission_before: 'prompt',
    result: 'granted',
    platform: 'ios-safari',
    app_version: 'abc1234',
  });
});

test('locationEvent refuses values the table would reject', () => {
  assert.equal(locationEvent({ ...OUTCOME, trigger: 'loop' }), null);
  assert.equal(locationEvent({ ...OUTCOME, result: 'error' }), null);
  assert.equal(locationEvent({ ...OUTCOME, permissionBefore: undefined }), null);
  assert.equal(locationEvent({ ...OUTCOME, platform: 'Mozilla/5.0 (iPhone)' }), null);
});

test('one row per trigger per page load, with the public key only', () => {
  const { fetch, calls } = fakeFetch();
  const log = createLocationLog({ fetch, online: () => true, version: 'abc1234' });
  assert.equal(log(OUTCOME), true);
  assert.equal(log({ ...OUTCOME, result: 'timeout' }), false); // same trigger again: dropped
  assert.equal(log({ ...OUTCOME, trigger: 'startup' }), true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/rest\/v1\/location_events$/);
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers.Authorization, undefined);
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['app_version', 'permission_before', 'platform', 'result', 'trigger']);
});

test('does nothing offline, and an offline attempt does not use up the trigger', () => {
  const { fetch, calls } = fakeFetch();
  let online = false;
  const log = createLocationLog({ fetch, online: () => online });
  assert.equal(log(OUTCOME), false);
  online = true;
  assert.equal(log(OUTCOME), true);
  assert.equal(calls.length, 1);
});

test('never throws, whether fetch rejects or throws', async () => {
  const rejecting = createLocationLog({ fetch: () => Promise.reject(new TypeError('offline')), online: () => true });
  assert.equal(rejecting(OUTCOME), true);
  const throwing = createLocationLog({ fetch: () => { throw new TypeError('blocked'); }, online: () => true });
  assert.doesNotThrow(() => throwing(OUTCOME));
  await new Promise((r) => setTimeout(r, 0)); // an unhandled rejection would fail the test run
});
