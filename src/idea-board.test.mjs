import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { IdeaBoard, IdeaBoardValidationError } from './idea-board.mjs';

const makeBoard = (overrides = {}) => new IdeaBoard({
  path: join(mkdtempSync(join(tmpdir(), 'gedankenraum-')), 'ideas.json'),
  analyze: async ({ existingTopics }) => ({
    analysis: {
      title: 'Tiefe Module',
      summary: 'Mehr Verhalten hinter kleineren Interfaces.',
      keyPoints: ['Locality steigt.'],
      keywords: ['Module'],
      topic: existingTopics[0] ?? 'Architektur',
    },
    engine: 'Testanalyse',
  }),
  readLink: async (url) => ({ url, title: 'Beispiel', text: 'Nützlicher Seitentext.' }),
  now: () => new Date('2026-08-19T12:00:00.000Z'),
  makeId: () => 'gedanke-1',
  ...overrides,
});

test('capture, retopic and delete use the durable board interface', async () => {
  const board = makeBoard();
  const captured = await board.execute({ type: 'capture', input: 'Tiefe Module vereinfachen Aufrufer.' });
  assert.equal(captured.idea.topic, 'Architektur');
  assert.equal(captured.idea.engine, 'Testanalyse');
  assert.equal(board.snapshot().ideas.length, 1);

  const changed = await board.execute({ type: 'retopic', id: 'gedanke-1', topic: 'Code Design' });
  assert.equal(changed.idea.topic, 'Code Design');
  const removed = await board.execute({ type: 'delete', id: 'gedanke-1' });
  assert.equal(removed.idea.id, 'gedanke-1');
  assert.deepEqual(board.snapshot().ideas, []);
});

test('an unreadable link is neither analyzed nor persisted', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'gedankenraum-')), 'ideas.json');
  let analyzed = false;
  const board = makeBoard({
    path,
    readLink: async () => { throw new Error('offline'); },
    analyze: async () => { analyzed = true; return {}; },
  });
  await assert.rejects(
    () => board.execute({ type: 'capture', input: 'https://example.com/a' }),
    /Link konnte nicht gelesen werden: offline/,
  );
  assert.equal(analyzed, false);
  assert.equal(existsSync(path), false);
});

test('invalid and oversized commands are rejected', async () => {
  const board = makeBoard();
  await assert.rejects(() => board.execute({ type: 'capture', input: 'x'.repeat(12_001) }), IdeaBoardValidationError);
  await assert.rejects(() => board.execute({ type: 'launch' }), /unsupported command/);
});

test('concurrent captures serialize instead of losing a thought', async () => {
  let releaseFirst;
  let ids = 0;
  const board = makeBoard({
    makeId: () => `gedanke-${++ids}`,
    analyze: async ({ input }) => {
      if (input === 'first') await new Promise((resolve) => { releaseFirst = resolve; });
      return { title: input, summary: input, keyPoints: [], keywords: [], topic: 'Queue', engine: 'Test' };
    },
  });
  const first = board.execute({ type: 'capture', input: 'first' });
  await new Promise((resolve) => setImmediate(resolve));
  const second = board.execute({ type: 'capture', input: 'second' });
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(board.snapshot().ideas.map((idea) => idea.title), ['second', 'first']);
});
