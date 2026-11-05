import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usageEvent, createUsageLog } from './usage-log.js';

const ctx = { session: '5e550000-0000-0000-0000-000000000001', platform: 'ios-safari', version: 'abc1234' };

test('a usage row holds only the event, place, restroom, session, platform and version', () => {
  assert.deepEqual(usageEvent('directions', { bathroomId: 'nyc-1', place: 'map' }, ctx), {
    event: 'directions', place: 'map', bathroom_id: 'nyc-1', session_id: ctx.session, platform: 'ios-safari', app_version: 'abc1234',
  });
  assert.deepEqual(usageEvent('feedback_send', undefined, ctx), {
    event: 'feedback_send', place: null, bathroom_id: null, session_id: ctx.session, platform: 'ios-safari', app_version: 'abc1234',
  });
});

test('values outside what the table accepts send nothing', () => {
  assert.equal(usageEvent('clicked_ad', {}, ctx), null);
  assert.equal(usageEvent('directions', { place: 'footer' }, ctx), null);
  assert.equal(usageEvent('directions', {}, { ...ctx, platform: 'Mozilla/5.0' }), null);
  assert.equal(usageEvent('directions', { bathroomId: 'x'.repeat(65) }, ctx), null);
});

test('one session id per app open; nothing sent offline; never throws', () => {
  const sent = [];
  const fetch = async (url, opts) => sent.push(JSON.parse(opts.body));
  let online = true;
  const log = createUsageLog({ fetch, online: () => online, platform: () => 'android', session: 's-1', version: 'v' });
  assert.equal(log('restroom_view', { bathroomId: 'nyc-1', place: 'page' }), true);
  assert.equal(log('directions', { bathroomId: 'nyc-1', place: 'page' }), true);
  online = false;
  assert.equal(log('went_here', { bathroomId: 'nyc-1' }), false);
  assert.deepEqual(sent.map((r) => [r.event, r.session_id]), [['restroom_view', 's-1'], ['directions', 's-1']]);
  const broken = createUsageLog({ fetch: () => { throw new Error('boom'); }, online: () => true, platform: () => 'android', session: 's' });
  assert.equal(broken('directions'), false);
});
