import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

test('a kept text note stays verbatim, keeps line breaks and is not read as a link', async () => {
  let seen;
  let linkRead = false;
  const board = makeBoard({
    readLink: async () => { linkRead = true; return { url: 'x', text: 'x' }; },
    analyze: async (request) => { seen = request; return { title: 'T', summary: 'S', keyPoints: [], keywords: [], topic: 'Agenten' }; },
  });
  const text = '  Erklärung:\r\n\r\n1. Erster   Punkt\n2. Zweiter Punkt\nhttps://example.com/quelle  ';
  const captured = await board.execute({ type: 'capture', input: text, keep: true });
  assert.equal(captured.idea.source, 'text');
  assert.equal(captured.idea.input, 'Erklärung:\n\n1. Erster   Punkt\n2. Zweiter Punkt\nhttps://example.com/quelle');
  assert.equal(seen.source.kind, 'text');
  assert.equal(seen.source.text, captured.idea.input);

  const link = await board.execute({ type: 'capture', input: 'https://example.com/a', keep: true });
  assert.equal(link.idea.source, 'text');
  assert.equal(linkRead, false);
  assert.equal(JSON.parse(readFileSync(board.path, 'utf8')).ideas[1].input, captured.idea.input);
});

test('text notes allow longer input than plain notes', async () => {
  const board = makeBoard();
  await assert.rejects(() => board.execute({ type: 'capture', input: 'x'.repeat(12_001) }), /als Textnotiz/);
  const kept = await board.execute({ type: 'capture', input: 'x'.repeat(12_001), keep: true });
  assert.equal(kept.idea.input.length, 12_001);
  await assert.rejects(() => board.execute({ type: 'capture', input: 'x'.repeat(60_001), keep: true }), /60000/);
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

test('switching storage copies current data or opens an existing collection', async () => {
  const board = makeBoard();
  await board.execute({ type: 'capture', input: 'Aktuelle Sammlung' });
  const copiedPath = join(mkdtempSync(join(tmpdir(), 'gedankenraum-copy-')), 'ideas.json');

  const copied = await board.switchStorage(copiedPath);
  assert.equal(copied.created, true);
  assert.equal(JSON.parse(readFileSync(copiedPath, 'utf8')).ideas[0].title, 'Tiefe Module');

  const existingPath = join(mkdtempSync(join(tmpdir(), 'gedankenraum-existing-')), 'ideas.json');
  writeFileSync(existingPath, `${JSON.stringify({ version: 1, ideas: [{ id: 'vorhanden' }] })}\n`);
  const opened = await board.switchStorage(existingPath);
  assert.equal(opened.created, false);
  assert.deepEqual(opened.ideas, [{ id: 'vorhanden' }]);
});

test('merging keeps both collections without duplicate ids and replacing overwrites the target', async () => {
  const board = makeBoard();
  const captured = await board.execute({ type: 'capture', input: 'Aktuelle Sammlung' });
  const mergePath = join(mkdtempSync(join(tmpdir(), 'gedankenraum-merge-')), 'ideas.json');
  writeFileSync(mergePath, `${JSON.stringify({
    version: 1,
    ideas: [{ ...captured.idea, title: 'Veraltete Kopie' }, { ...captured.idea, id: 'extern', title: 'Externer Gedanke' }],
  })}\n`);

  const merged = await board.switchStorage(mergePath, 'merge');
  assert.equal(merged.action, 'merge');
  assert.deepEqual(merged.ideas.map((idea) => idea.title), ['Tiefe Module', 'Externer Gedanke']);

  const replacePath = join(mkdtempSync(join(tmpdir(), 'gedankenraum-replace-')), 'ideas.json');
  writeFileSync(replacePath, `${JSON.stringify({ version: 1, ideas: [{ id: 'wird-ersetzt' }] })}\n`);
  const replaced = await board.switchStorage(replacePath, 'replace');
  assert.equal(replaced.action, 'replace');
  assert.deepEqual(JSON.parse(readFileSync(replacePath, 'utf8')).ideas, merged.ideas);
});

test('importing merges into the current collection and skips duplicate ids', async () => {
  const board = makeBoard();
  const captured = await board.execute({ type: 'capture', input: 'Aktuelle Sammlung' });
  const imported = await board.importState({
    version: 1,
    ideas: [
      { ...captured.idea, title: 'Veraltete Kopie' },
      { ...captured.idea, id: 'extern', title: 'Externer Gedanke' },
      { ...captured.idea, id: 'extern', title: 'Doppelter Import' },
    ],
  });

  assert.equal(imported.imported, 1);
  assert.equal(imported.skipped, 2);
  assert.deepEqual(imported.ideas.map((idea) => idea.title), ['Tiefe Module', 'Externer Gedanke']);
  assert.deepEqual(JSON.parse(readFileSync(board.path, 'utf8')).ideas, imported.ideas);
});

test('importing rejects unknown formats without changing the collection', async () => {
  const board = makeBoard();
  await board.execute({ type: 'capture', input: 'Bleibt erhalten' });
  const before = readFileSync(board.path, 'utf8');

  await assert.rejects(() => board.importState({ version: 2, ideas: [] }), IdeaBoardValidationError);
  await assert.rejects(() => board.importState({ version: 1, ideas: [{}] }), IdeaBoardValidationError);
  assert.equal(readFileSync(board.path, 'utf8'), before);
});
