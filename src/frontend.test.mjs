import assert from 'node:assert/strict';
import test from 'node:test';

import { TOPIC_COLORS, topicColor } from './mindmap.mjs';

test('topic colors depend only on the topic name and use the whole palette', () => {
  assert.equal(topicColor('Kunst'), topicColor('Kunst'));
  assert.ok(TOPIC_COLORS.includes(topicColor('Kunst')));
  assert.ok(TOPIC_COLORS.includes(topicColor('')));
  assert.ok(TOPIC_COLORS.includes(topicColor(undefined)));
  const topics = Array.from({ length: 60 }, (_, index) => `Thema ${index}`);
  assert.equal(new Set(topics.map(topicColor)).size, TOPIC_COLORS.length);
  assert.notEqual(new Set(['Kunst', 'Reisen', 'Kochen', 'Arbeit', 'Garten'].map(topicColor)).size, 1);
});
