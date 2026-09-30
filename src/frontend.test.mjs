import assert from 'node:assert/strict';
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
