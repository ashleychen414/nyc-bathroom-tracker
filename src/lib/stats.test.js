import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statFromRow } from './stats.js';

test('a bathroom_stats row becomes counts, averages (null when nobody rated) and fact labels', () => {
  const row = { bathroom_id: 'nyc-1', people: 3, visits: 5, last_visit: '2026-10-26', clean: 3.0, clean_people: 3, get_in: '3.3', get_in_people: 3, vibes: null, vibes_people: 0, chips: { code: 2 }, facts: ['code'] };
  assert.deepEqual(statFromRow(row), {
    people: 3,
    visits: 5,
    lastVisit: '2026-10-26',
    ratings: { clean: 3, getIn: 3.3, vibes: null },
    chips: { code: 2 },
    facts: ['Code needed'],
  });
});
