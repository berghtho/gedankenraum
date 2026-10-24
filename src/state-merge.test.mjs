import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeStates } from './state-merge.mjs';

const state = (ideas, extra = {}) => ({ version: 1, ideas, ...extra });

test('ideas added on either side are kept, remote additions in front of their remote successor', () => {
  const base = state([{ id: 'a' }]);
  const ours = state([{ id: 'lokal' }, { id: 'a' }]);
  const theirs = state([{ id: 'r2' }, { id: 'r1' }, { id: 'a' }]);
  assert.deepEqual(mergeStates(base, ours, theirs).ideas.map((idea) => idea.id), ['lokal', 'r2', 'r1', 'a']);
});

test('changes to different ideas and to different fields of one idea are combined', () => {
  const base = state([{ id: 'a', summary: '', notes: '' }, { id: 'b', title: 'B' }]);
  const ours = state([{ id: 'a', summary: 'Analyse', notes: '' }, { id: 'b', title: 'B' }]);
  const theirs = state([{ id: 'a', summary: '', notes: 'Notiz' }, { id: 'b', title: 'B2' }]);
  assert.deepEqual(mergeStates(base, ours, theirs).ideas, [{ id: 'a', summary: 'Analyse', notes: 'Notiz' }, { id: 'b', title: 'B2' }]);
});

test('the same field changed on both sides follows the newer updatedAt, otherwise the local side', () => {
  const base = state([{ id: 'a', title: 'Alt', updatedAt: '2026-10-01' }]);
  const newerRemote = state([{ id: 'a', title: 'Remote', updatedAt: '2026-10-03' }]);
  const local = state([{ id: 'a', title: 'Lokal', updatedAt: '2026-10-02' }]);
  assert.deepEqual(mergeStates(base, local, newerRemote).ideas, [{ id: 'a', title: 'Remote', updatedAt: '2026-10-03' }]);
  assert.deepEqual(mergeStates(base, { ...local, label: 'L' }, { ...local, ideas: [{ id: 'a', title: 'R', updatedAt: '2026-10-02' }], label: 'R' }),
    { version: 1, ideas: [{ id: 'a', title: 'Lokal', updatedAt: '2026-10-02' }], label: 'L' });
});

test('an entry removed on one side stays removed unless the other side changed it', () => {
  const base = state([{ id: 'a' }, { id: 'b', title: 'B' }]);
  const ours = state([{ id: 'b', title: 'B' }]);
  const theirs = state([{ id: 'a' }]);
  assert.deepEqual(mergeStates(base, ours, theirs).ideas, []);
  assert.deepEqual(mergeStates(base, ours, state([{ id: 'a', title: 'geändert' }])).ideas, [{ id: 'a', title: 'geändert' }]);
});

test('rooms, reflections and nested lists merge by id as well, without a common ancestor too', () => {
  const ours = state([], { rooms: [{ id: 'r1' }], reflections: [] });
  const theirs = state([], { rooms: [{ id: 'r2' }], reflections: [{ id: 'x' }] });
  assert.deepEqual(mergeStates(null, ours, theirs), { version: 1, ideas: [], rooms: [{ id: 'r1' }, { id: 'r2' }], reflections: [{ id: 'x' }] });
});
