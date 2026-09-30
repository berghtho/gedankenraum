import assert from 'node:assert/strict';
import test from 'node:test';

import { byUse, compact, html, isLinkInput, lower, REFLECTION_KINDS, tagCounts, tagsOf, webUrl } from './util.mjs';
import { REFLECTION_KINDS as reexported } from './reflection-analysis.mjs';

test('html escapes markup characters and treats missing values as empty', () => {
  assert.equal(html(`<a href="x">Tom & 'Jerry'</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;');
  assert.equal(html(null), '');
  assert.equal(html(undefined), '');
  assert.equal(html(0), '0');
});

test('compact collapses whitespace and trims, lower folds case', () => {
  assert.equal(compact('  eins \n\t zwei  drei '), 'eins zwei drei');
  assert.equal(compact(null), '');
  assert.equal(compact(42), '42');
  assert.equal(lower('ÄRGER'), 'ärger');
});

test('tag counts keep first appearance, byUse puts most-used first and keeps ties stable', () => {
  const ideas = [{ tags: ['b', 'a'] }, { tags: ['a', 'c'] }, { tags: null }, {}, { tags: ['c', 'd'] }];
  assert.deepEqual(tagsOf({ tags: 'kein Array' }), []);
  const counts = tagCounts(ideas);
  assert.deepEqual([...counts], [['b', 1], ['a', 2], ['c', 2], ['d', 1]]);
  assert.deepEqual(byUse(counts), [['a', 2], ['c', 2], ['b', 1], ['d', 1]]);
});

test('reflection kinds have one source shared with the server', () => {
  assert.equal(reexported, REFLECTION_KINDS);
  assert.deepEqual(Object.keys(REFLECTION_KINDS), ['commonalities', 'contradictions', 'questions']);
});

test('browser and server share one rule for links', () => {
  for (const value of ['https://example.org/a', ' http://example.org ']) assert.ok(isLinkInput(value), value);
  for (const value of ['http://[', 'https://', 'javascript:alert(1)', 'https://example.org mit Text', 'Text https://example.org']) assert.ok(!isLinkInput(value), value);
  assert.equal(webUrl('HTTPS://Example.org'), 'https://example.org/');
  assert.equal(webUrl('javascript:alert(1)'), null);
});
