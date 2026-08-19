import assert from 'node:assert/strict';
import test from 'node:test';

import { createLocalAnalyzer } from './local-analysis.mjs';

test('local analysis needs no setup and produces bounded metadata', async () => {
  const analyzer = createLocalAnalyzer();
  assert.deepEqual(await analyzer.status(), { available: true, engine: 'Lokale Analyse' });

  const result = await analyzer.analyze({
    input: 'Tiefe Module konzentrieren Komplexität. Kleine Interfaces vereinfachen die Verwendung. Locality erleichtert Änderungen.',
    source: {
      kind: 'note',
      text: 'Tiefe Module konzentrieren Komplexität. Kleine Interfaces vereinfachen die Verwendung. Locality erleichtert Änderungen.',
    },
    existingTopics: ['Software Module', 'Reisen'],
  });

  assert.equal(result.engine, 'Lokale Analyse');
  assert.match(result.analysis.title, /Tiefe Module/);
  assert.equal(result.analysis.topic, 'Software Module');
  assert.ok(result.analysis.keyPoints.length <= 4);
  assert.ok(result.analysis.keywords.length <= 6);
});

test('a page title becomes the thought title', async () => {
  const result = await createLocalAnalyzer().analyze({
    input: 'https://example.com',
    source: { kind: 'link', pageTitle: 'Ein guter Artikel', text: 'Der Artikel enthält einen längeren nützlichen Text.' },
    existingTopics: [],
  });
  assert.equal(result.analysis.title, 'Ein guter Artikel');
  assert.equal(result.analysis.topic, 'Unsortiert');
});

test('short existing topics can be reused', async () => {
  const result = await createLocalAnalyzer().analyze({
    input: 'KI hilft beim Sortieren längerer Notizen.',
    source: { kind: 'note', text: 'KI hilft beim Sortieren längerer Notizen.' },
    existingTopics: ['KI', 'UX'],
  });
  assert.equal(result.analysis.topic, 'KI');
});
