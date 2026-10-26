import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cityAnswer, resolveFacts, factLabel } from './facts.js';
import { describeChange } from './corrections.js';

const city = (extra) => ({ id: 'nyc-1', source: 'seed', accessibility: 'Fully Accessible', restroomType: 'Multi-Stall W/M Restrooms', changingStations: 'Yes, in women\'s restroom only', ...extra });
const row = (fact, value, people, last_at = '2026-10-26T12:00:00Z', count = null) => ({ fact, value, people, last_at, count });

test("the city's values become answers, and unclear ones don't", () => {
  assert.equal(cityAnswer(city(), 'accessible'), 'full');
  assert.equal(cityAnswer(city({ accessibility: 'Limited Accessibility' }), 'accessible'), 'partial');
  assert.equal(cityAnswer(city({ accessibility: 'Not Accessible' }), 'accessible'), 'none');
  assert.equal(cityAnswer(city(), 'layout'), 'stalls');
  assert.equal(cityAnswer(city({ restroomType: 'Both Single-Stall All Gender and Multi-Stall W/M' }), 'layout'), 'mixed');
  // "Restroom(s)": one or several, the city doesn't say.
  assert.equal(cityAnswer(city({ restroomType: 'Single-Stall All Gender Restroom(s)' }), 'layout'), null);
  assert.equal(cityAnswer(city(), 'changing_table'), 'yes');
  assert.equal(cityAnswer(city({ changingStations: 'No' }), 'changing_table'), 'no');
  assert.equal(cityAnswer(city({ changingStations: 'N/A, restrooms closed' }), 'changing_table'), null);
  assert.equal(cityAnswer(city(), 'code'), null);
  assert.equal(cityAnswer({ source: 'user', accessibility: 'Fully Accessible' }, 'accessible'), null);
});

test('majority wins; the city counts as one answer', () => {
  const b = city();
  assert.deepEqual(resolveFacts(b).accessible, { value: 'full', count: null, people: 1, city: true, total: 1, withCity: true });
  // Two people say partial: 2 beats the city's 1.
  assert.equal(resolveFacts(b, [row('accessible', 'partial', 2)]).accessible.value, 'partial');
  // One person agrees with the city: 2 answers for full.
  assert.deepEqual(resolveFacts(b, [row('accessible', 'full', 1)]).accessible, { value: 'full', count: null, people: 2, city: true, total: 2, withCity: true });
  assert.equal(resolveFacts(b).code, null);
});

test('a tie goes to the newest answer, and the city is the oldest', () => {
  const b = city();
  assert.equal(resolveFacts(b, [row('accessible', 'none', 1)]).accessible.value, 'none');
  const r = [row('code', 'yes', 1, '2026-10-25T12:00:00Z'), row('code', 'no', 1, '2026-10-26T12:00:00Z')];
  assert.equal(resolveFacts(b, r).code.value, 'no');
});

test('layout keeps the latest count; labels read naturally', () => {
  const f = resolveFacts(city({ restroomType: null }), [row('layout', 'singles', 2, undefined, 3)]).layout;
  assert.deepEqual([f.value, f.count, f.city], ['singles', 3, false]);
  assert.equal(factLabel('layout', f), '3 single bathrooms');
  assert.equal(factLabel('layout', { value: 'stalls', count: 1 }), '1 stall');
  assert.equal(factLabel('layout', { value: 'stalls', count: null }), 'Stalls');
  assert.equal(factLabel('accessible', { value: 'partial' }), 'Partly accessible');
  assert.equal(factLabel('code', { value: 'yes' }), 'Code needed');
  assert.equal(factLabel('code', null), null);
});

test('fact answers in the history', () => {
  assert.equal(describeChange({ kind: 'fact', changes: { fact: 'layout', value: 'singles', count: 4 } }), 'Layout: 4 single bathrooms');
  assert.equal(describeChange({ kind: 'fact', changes: { fact: 'code', value: null } }), 'Code or key: not sure');
});
