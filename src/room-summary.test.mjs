import assert from 'node:assert/strict';
import test from 'node:test';

import { digestFileName, digestMarkdown, digestMarkup, digestOutline, roomDigest } from './room-summary.mjs';
import { isDerived, isQuestion } from './thought-kinds.mjs';

const room = { id: 'r', question: 'Wie lernen wir besser?', ideaIds: ['q1', 'q2', 'f', 'l', 't', 'bad', 'missing'] };
const ideas = [
  { id: 'q1', title: 'Hilft Schlaf?', input: 'Hilft Schlaf beim Lernen?', source: 'text', research: { status: 'ready', summary: 'Ja, deutlich.', findings: [{ text: 'Studie', sources: [{ title: 'Studie A', url: 'https://example.org/a' }] }] } },
  { id: 'q2', title: 'Wie oft wiederholen?', input: 'Wie oft wiederholen?', source: 'note', answeredAt: '2026-09-01T00:00:00.000Z', notes: 'Alle paar Tage.' },
  { id: 'f', title: 'Befund <b>', input: 'Befund <b>', source: 'text', researchOrigin: { ideaId: 'q1', completedAt: null, index: 0, sources: [{ title: 'Kopie', url: 'http://www.example.org/a/' }] } },
  { id: 'l', title: 'Artikel über [Lernen]', summary: 'Zusammenfassung', source: 'link', url: 'https://blog.example.com/lernen' },
  { id: 't', title: 'Pausen helfen', summary: 'Pausen helfen', input: 'Pausen helfen', source: 'note' },
  { id: 'bad', title: 'Böse', source: 'link', url: 'javascript:alert(1)' },
  { id: 'outside', title: 'Nicht im Raum?', input: 'Nicht im Raum?', source: 'note' },
];
const reflections = [
  { id: 'e', roomId: 'r', kind: 'commonalities', status: 'ready', summary: 'Beide betonen Wiederholung.' },
  { id: 'o', roomId: 'other', kind: 'questions', status: 'ready', summary: 'Fremd' },
];
const date = new Date('2026-09-27T12:00:00Z');

test('questions are own thoughts ending with "?" and derived thoughts come from evaluations or research', () => {
  assert.equal(isQuestion({ source: 'link', title: 'Is this the future?', input: 'https://example.com' }), false);
  assert.equal(isQuestion({ source: 'text', title: 'Gekürzter Titel', input: 'Eine lange Frage?' }), true);
  assert.equal(isDerived({ researchOrigin: { ideaId: 'q' } }), true);
  assert.equal(isDerived({ reflectionOrigin: { id: 'r', index: 0 } }), true);
  assert.equal(isDerived({}), false);
});

test('room digest groups questions, findings, thoughts and deduplicated web sources of the room only', () => {
  const digest = roomDigest(room, ideas, reflections);
  assert.equal(digest.count, 6);
  assert.deepEqual(digest.open.map((idea) => idea.id), ['q1']);
  assert.deepEqual(digest.answered.map((idea) => idea.id), ['q2']);
  assert.deepEqual(digest.findings.map((idea) => idea.id), ['f']);
  assert.deepEqual(digest.thoughts.map((idea) => idea.id), ['l', 't', 'bad']);
  assert.deepEqual(digest.evaluations.map((item) => item.id), ['e']);
  assert.deepEqual(digest.sources.map((source) => source.url), ['https://example.org/a', 'https://blog.example.com/lernen']);
});

test('markdown and slide outline carry answers, findings and sources; long lists span several slides', () => {
  const digest = roomDigest(room, ideas, reflections);
  const markdown = digestMarkdown(digest, date);
  assert.match(markdown, /^# Wie lernen wir besser\?/);
  assert.match(markdown, /Stand 27\.09\.2026/);
  assert.match(markdown, /## Offene Fragen\n\n- Hilft Schlaf beim Lernen\?\n {2}- Recherche: Ja, deutlich\./);
  assert.match(markdown, /## Beantwortete Fragen\n\n- \*\*Wie oft wiederholen\?\*\*\n {2}Alle paar Tage\./);
  assert.match(markdown, /- Gemeinsamkeiten: Beide betonen Wiederholung\./);
  assert.match(markdown, /- \[Artikel über Lernen\]\(https:\/\/blog\.example\.com\/lernen\)/);
  assert.doesNotMatch(markdown, /Nicht im Raum|Fremd|javascript:/);
  const slides = digestOutline(digest, date).split('\n\n---\n\n');
  assert.equal(slides[0].split('\n')[0], '# Wie lernen wir besser?');
  assert.ok(slides.some((slide) => slide.startsWith('## Antworten') && slide.includes('Wie oft wiederholen? → Alle paar Tage.')));
  const many = Array.from({ length: 14 }, (_, index) => ({ id: `n${index}`, title: `Gedanke ${index}`, input: `Gedanke ${index}`, source: 'note' }));
  const long = roomDigest({ ...room, ideaIds: many.map((idea) => idea.id) }, many);
  assert.deepEqual(digestOutline(long, date).split('\n\n---\n\n').slice(1).map((slide) => slide.split('\n')[0]), ['## Gedanken (1/2)', '## Gedanken (2/2)']);
});

test('overview markup escapes text, opens thoughts and only links web sources', () => {
  const digest = roomDigest(room, ideas, reflections);
  const markup = digestMarkup(digest);
  assert.match(markup, /data-source-live="q1"/);
  assert.match(markup, /Befund &lt;b&gt;/);
  assert.doesNotMatch(markup, /Befund <b>|href="javascript/);
  const forged = { ...digest, sources: [{ title: 'Böse', url: 'javascript:alert(1)' }, { title: 'Gut', url: 'https://example.org/' }] };
  assert.doesNotMatch(digestMarkup(forged), /javascript:/);
  assert.match(digestMarkup(forged), /<span>Böse<\/span>.*href="https:\/\/example\.org\/"/s);
  assert.doesNotMatch(digestMarkdown(forged, date), /javascript:/);
  assert.equal(digestFileName(digest, '-folien'), 'wie-lernen-wir-besser-folien.md');
  assert.equal(digestFileName({ question: '???' }), 'arbeitsraum.md');
});
