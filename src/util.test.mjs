import assert from 'node:assert/strict';
import test from 'node:test';

import { byUse, compact, html, REFLECTION_KINDS, tagCounts, tagsOf } from './util.mjs';
import { REFLECTION_KINDS as reexported } from './reflection-analysis.mjs';

test('html escapes markup characters and treats missing values as empty', () => {
  assert.equal(html(`<a href="x">Tom & 'Jerry'</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;');
  assert.equal(html(null), '');
  assert.equal(html(undefined), '');
  assert.equal(html(0), '0');
});

test('compact collapses whitespace and trims', () => {
  assert.equal(compact('  eins \n\t zwei  drei '), 'eins zwei drei');
  assert.equal(compact(null), '');
  assert.equal(compact(42), '42');
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
