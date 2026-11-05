import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ratingsSection } from './ratings.js';

const mine = [{ visitedAt: '2026-10-28T18:37:38.696Z' }];

test('ratingsSection: signed out, own visits point to sign-in (they never upload without it)', () => {
  assert.match(ratingsSection(null, mine, false), /Sign in to add them to the public counts/);
  assert.match(ratingsSection(null, mine, true), /haven't reached the public counts yet/);
  assert.match(ratingsSection(null, [], false), /No visits logged yet/);
});
