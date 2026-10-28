import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc } from './html.js';

test('esc escapes the five HTML-special characters', () => {
  assert.equal(esc(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(esc(`<img src=x onerror="alert('hi')">`), '&lt;img src=x onerror=&quot;alert(&#39;hi&#39;)&quot;&gt;');
  assert.equal(esc('&amp;'), '&amp;amp;'); // already-escaped text is escaped again, not trusted
});

test('esc leaves other text alone', () => {
  assert.equal(esc('Prospect Park · Lakeside, café 9am–5pm / ok?'), 'Prospect Park · Lakeside, café 9am–5pm / ok?');
});

test('esc turns null and undefined into empty text, and numbers into text', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
  assert.equal(esc(3.5), '3.5');
  assert.equal(esc(false), 'false');
});
