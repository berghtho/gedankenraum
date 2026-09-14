import assert from 'node:assert/strict';
import test from 'node:test';

import { fold, foldMap, hitsIn, hostOf, markText, matches, pathOf, scoreOf, startsWithTitle, stripTitle, termsOf, windowAround } from './search.mjs';

const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

test('folding lets umlaut spellings, ß and case find each other', () => {
  const hay = fold('Die Hütte an der Straße');
  for (const query of ['hütte', 'hutte', 'huette', 'HÜTTE', 'strasse', 'straße']) assert.ok(matches(hay, termsOf(query)), query);
  assert.ok(!matches(hay, termsOf('hutten')));
});

test('every term must occur, in any order; empty query matches everything', () => {
  const hay = fold('Busverbindung von Belluno zurück nach Cortina');
  assert.ok(matches(hay, termsOf('cortina belluno')));
  assert.ok(matches(hay, termsOf('belluno cortina')));
  assert.ok(!matches(hay, termsOf('belluno venedig')));
  assert.ok(matches(hay, termsOf('   ')));
});

test('hits map back to original positions, including ß and surrogate pairs', () => {
  const text = '🙂 Straße Hütte straße';
  const { folded, idx } = foldMap(text);
  assert.equal(folded, '🙂 strasse hutte strasse');
  assert.equal(idx[idx.length - 1], text.length);
  const hits = hitsIn(text, termsOf('strasse'));
  assert.deepEqual(hits.map(({ start, end }) => text.slice(start, end)), ['Straße', 'straße']);
  assert.deepEqual(hitsIn(text, termsOf('hütte')).map(({ start, end }) => text.slice(start, end)), ['Hütte']);
  assert.deepEqual(hitsIn(text, termsOf('stras')).map(({ start, end }) => text.slice(start, end)), ['Straß', 'straß']);
});

test('overlapping hits merge and marking escapes HTML around them', () => {
  const text = 'Tag <b>Wandern</b> & wandern';
  assert.equal(markText(text, termsOf('wandern wand'), escape), 'Tag &lt;b&gt;<mark class="ib-hit">Wandern</mark>&lt;/b&gt; &amp; <mark class="ib-hit">wandern</mark>');
  assert.equal(markText(text, [], escape), escape(text));
  assert.equal(hitsIn('a a a a a', termsOf('a'), 3).length, 3);
  const many = `${'tag '.repeat(50)}ziel`;
  assert.ok(hitsIn(many, termsOf('tag ziel'), 3).some(({ start, end }) => many.slice(start, end) === 'ziel'), 'later terms still get hits when the first term is frequent');
});

test('snippet window always contains the hit, even after a very long word', () => {
  const text = `${'a '.repeat(40)}${'w'.repeat(250)} ziel`;
  const [hit] = hitsIn(text, termsOf('ziel'));
  const snippet = windowAround(text, hit, { before: 40, length: 120 });
  assert.ok(snippet.text.includes('ziel'));
});

test('snippet window starts before the hit on a word boundary and marks cut ends', () => {
  const text = `${'Alta Via eins, sieben Tage. '.repeat(8)}Busverbindung von Belluno zurück nach Cortina fährt nur zweimal täglich.`;
  const [hit] = hitsIn(text, termsOf('belluno'));
  const snippet = windowAround(text, hit, { before: 40, length: 120 });
  assert.ok(snippet.text.startsWith('… '));
  assert.ok(snippet.text.includes('Belluno'));
  assert.ok(!snippet.text.endsWith(' …') || snippet.text.length <= 130);
  assert.equal(windowAround('kurz', null).text, 'kurz');
  assert.ok(windowAround('wort '.repeat(80), null).text.endsWith(' …'));
});

test('title hits rank above tag hits above summary hits', () => {
  const terms = termsOf('sauerteig');
  assert.equal(scoreOf({ title: fold('Sauerteig füttern'), tags: '', summary: '' }, terms), 3);
  assert.equal(scoreOf({ title: '', tags: fold('brot sauerteig'), summary: '' }, terms), 2);
  assert.equal(scoreOf({ title: '', tags: '', summary: fold('Über Sauerteig') }, terms), 1);
  assert.equal(scoreOf({ title: 'x', tags: 'y', summary: 'z' }, terms), 0);
  assert.equal(scoreOf({ title: fold('Sauerteig'), tags: fold('brot'), summary: '' }, termsOf('sauerteig brot')), 5);
});

test('title prefix is stripped only on word boundaries and detected regardless of punctuation', () => {
  assert.equal(stripTitle('Pasta-Wasser ist Gold.\n\nEin Schöpfer bindet.', 'Pasta-Wasser ist Gold'), 'Ein Schöpfer bindet.');
  assert.equal(stripTitle('Der Trick vom Bäcker: Salz erst nach der Autolyse einkneten', 'Der Trick vom Bäcker: Salz erst nach der Auto'), 'Autolyse einkneten');
  assert.equal(stripTitle('Ganz anderer Text', 'Titel'), 'Ganz anderer Text');
  assert.equal(stripTitle('Nur Titel.', 'Nur Titel'), '');
  assert.ok(startsWithTitle('Physio-Übung: Wandengel.\n\nRücken an die Wand.', 'Physio-Übung: Wandengel'));
  assert.ok(!startsWithTitle('Rücken an die Wand.', 'Physio-Übung'));
});

test('host and path of links are readable', () => {
  assert.equal(hostOf('https://www.heise.de/news/abc?x=1'), 'heise.de');
  assert.equal(pathOf('https://www.heise.de/news/abc?x=1'), '/news/abc?x=1');
  assert.equal(pathOf('https://grugbrain.dev/'), '');
  assert.equal(hostOf('kein link'), 'kein link');
});
