import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factTags, codeSection, codeMapLine } from './facts.js';

// A city restroom with no answers yet; stat = its visit stats (a "Code needed" chip from visits).
const b = (extra) => ({ id: 'nyc-1', source: 'seed', name: 'Park House', ...extra });
const needsCode = { facts: ['Code needed'] };

test('cards show the code in place of "Code needed"', () => {
  assert.match(factTags(b(), needsCode), />Code needed</);
  const tags = factTags(b({ code: '4321', codeConfirmedAt: '2026-10-27T15:00:00Z' }), needsCode);
  assert.match(tags, />Code: 4321 · confirmed Oct 27</);
  assert.doesNotMatch(tags, /Code needed/);
  // A code shows even before anyone said one is needed.
  assert.match(factTags(b({ code: '12#' })), />Code: 12#</);
  assert.equal(factTags(b()), '');
});

test('the code is escaped', () => {
  assert.match(factTags(b({ code: '<b>1</b>' })), /&lt;b&gt;1&lt;\/b&gt;/);
  assert.doesNotMatch(codeSection(b({ code: '<b>1</b>' })), /<b>1/);
});

test('the page asks "Know the code?" only when one is needed and missing', () => {
  assert.equal(codeSection(b()), '');
  const ask = codeSection(b(), needsCode);
  assert.match(ask, /Know the code\?/);
  assert.match(ask, /data-action="edit-code" data-value="nyc-1"/);
  const known = codeSection(b({ code: '4321', codeConfirmedAt: '2026-10-27T15:00:00Z' }), needsCode);
  assert.match(known, /Code: 4321 · confirmed Oct 27/);
  assert.match(known, /data-action="confirm-code"/);
  assert.match(known, /Edit code/);
  assert.doesNotMatch(known, /Know the code/);
});

test('the map card shows the code, or asks for it', () => {
  assert.equal(codeMapLine(b()), '');
  assert.match(codeMapLine(b(), needsCode), /Know the code\?/);
  assert.match(codeMapLine(b({ code: '4321' })), /Code: 4321/);
});
