import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visitsFromV1, cleanRatings, pendingRating } from './visits.js';

test('old phone ratings carry over like the database did: same id, Clean, chip ratings, 1–2 marks the chip', () => {
  const visits = visitsFromV1([
    { id: 'p1', name: 'My café', lat: 40.7, lng: -73.9, log: { cleanliness: 5, smell: 4, trashCleanliness: 2, lighting: 1, hasStalls: true, stallCount: 2, notes: 'code 1' }, updatedAt: '2026-10-08T21:27:58.110Z' },
    { id: 'p2', name: 'Park', publicId: 'nyc-abc', lat: 40.6, lng: -73.8, log: { cleanliness: 3, hasStalls: false }, updatedAt: '2026-10-13T13:44:29.284Z' },
    { id: 'p3', name: 'Notes only', lat: 40.6, lng: -73.8, log: { notes: 'hi' }, updatedAt: '2026-10-14T00:00:00Z' },
    { id: 'p4', name: 'Deleted', lat: 40.6, lng: -73.8, log: { cleanliness: 1 }, updatedAt: '2026-10-14T00:00:00Z', deletedAt: '2026-10-15T00:00:00Z' },
  ]);
  assert.deepEqual(visits, [
    { id: 'p1', bathroomId: 'p1', name: 'My café', visitedAt: '2026-10-08T21:27:58.110Z', clean: 5, smell: 4, trash: 2, lighting: 1, stallCount: 2, source: 'carried_over', updatedAt: '2026-10-08T21:27:58.110Z', chips: ['trash', 'lighting'] },
    { id: 'p2', bathroomId: 'nyc-abc', name: 'Park', visitedAt: '2026-10-13T13:44:29.284Z', clean: 3, source: 'carried_over', updatedAt: '2026-10-13T13:44:29.284Z', chips: [] },
  ]);
});

test('ratings keep valid values only, and a chip field only while its chip is tapped', () => {
  assert.deepEqual(cleanRatings({ clean: 3, getIn: 7, vibes: 0, chips: ['smell', 'code', 'code', 'nope'], smell: 2, trash: 4, lighting: 3, stallCount: 3 }), {
    clean: 3,
    chips: ['smell', 'code'],
    smell: 2,
  });
  assert.deepEqual(cleanRatings({ getIn: 2, chips: ['stalls'], stallCount: 4 }), { getIn: 2, chips: ['stalls'], stallCount: 4 });
  assert.deepEqual(cleanRatings({ getIn: 2, chips: ['stalls'], stallCount: 99 }), { getIn: 2, chips: ['stalls'] });
});

test('"Rate your last visit": newest unrated app visit from the last 7 days, unless closed', () => {
  const now = new Date('2026-10-26T12:00:00Z');
  const v = (id, daysAgo, extra = {}) => ({ id, bathroomId: 'b', visitedAt: new Date(now - daysAgo * 864e5).toISOString(), chips: [], source: 'app', updatedAt: '', ...extra });
  assert.equal(pendingRating([v('old', 8), v('rated', 0, { clean: 4 }), v('a', 2), v('b', 1)], now).id, 'b');
  assert.equal(pendingRating([v('a', 2), v('b', 1, { dismissedAt: now.toISOString() })], now).id, 'a');
  assert.equal(pendingRating([v('c', 1, { source: 'carried_over' })], now), null);
  assert.equal(pendingRating([v('chips only', 1, { chips: ['code'] })], now).id, 'chips only'); // no stars: still unrated
});
