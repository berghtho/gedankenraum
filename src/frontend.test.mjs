import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { connectionCount, TOPIC_COLORS, topicColor } from './mindmap.mjs';

test('topic colors depend only on the topic name and use the whole palette', () => {
  assert.equal(topicColor('Kunst'), topicColor('Kunst'));
  assert.ok(TOPIC_COLORS.includes(topicColor('Kunst')));
  assert.ok(TOPIC_COLORS.includes(topicColor('')));
  assert.ok(TOPIC_COLORS.includes(topicColor(undefined)));
  const topics = Array.from({ length: 60 }, (_, index) => `Thema ${index}`);
  assert.equal(new Set(topics.map(topicColor)).size, TOPIC_COLORS.length);
  assert.notEqual(new Set(['Kunst', 'Reisen', 'Kochen', 'Arbeit', 'Garten'].map(topicColor)).size, 1);
});

test('connections count the present parent and named relations in both directions', () => {
  const ideas = [
    { id: 'a', relations: [{ type: 'builds', targetId: 'b' }, { type: 'unknown', targetId: 'b' }, { type: 'example', targetId: 'gone' }] },
    { id: 'b', parentId: 'a', relations: [{ type: 'contradicts', targetId: 'a' }] },
    { id: 'c', parentId: 'gone', relations: [{ type: 'example', targetId: 'b' }] },
  ];
  assert.equal(connectionCount(ideas[0], ideas), 2);
  assert.equal(connectionCount(ideas[1], ideas), 4);
  assert.equal(connectionCount(ideas[2], ideas), 1);
});

// app.mjs greift beim Laden auf das DOM zu; seine Module lassen sich ohne Browser prüfen.
test('every name app.mjs imports is exported by its module', async () => {
  const source = await readFile(new URL('./app.mjs', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/import \{([^}]+)\} from '\.\/([\w-]+\.mjs)'/g)];
  assert.ok(imports.length > 5);
  for (const [, names, file] of imports) {
    const module = await import(`./${file}`);
    for (const name of names.split(',').map((part) => part.trim()).filter(Boolean)) assert.equal(typeof module[name], 'function', `${file}: ${name}`);
  }
});
