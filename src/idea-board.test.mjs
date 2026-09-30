import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { IdeaBoard, IdeaBoardValidationError } from './idea-board.mjs';
import { preferExistingTags, similarTag, similarTagGroups } from './tag-match.mjs';

let sequence = 0;
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
  makeId: () => `gedanke-${++sequence}`,
  ...overrides,
});

async function captureAnalyzed(board, command) {
  const result = await board.execute(command);
  await board.whenIdle();
  return { ...result, idea: board.snapshot().ideas.find((idea) => idea.id === result.idea.id) };
}

test('capture, retopic and delete use the durable board interface', async () => {
  const board = makeBoard();
  const captured = await captureAnalyzed(board, { type: 'capture', input: 'Tiefe Module vereinfachen Aufrufer.' });
  assert.equal(captured.idea.topic, 'Architektur');
  assert.equal(captured.idea.engine, 'Testanalyse');
  assert.equal(board.snapshot().ideas.length, 1);

  const changed = await board.execute({ type: 'retopic', id: captured.idea.id, topic: 'Code Design' });
  assert.equal(changed.idea.topic, 'Code Design');
  const removed = await board.execute({ type: 'delete', id: captured.idea.id });
  assert.equal(removed.idea.id, captured.idea.id);
  assert.deepEqual(board.snapshot().ideas, []);
});

test('the revision changes with every write and with external replacement, but not on reads', async () => {
  const board = makeBoard();
  const empty = board.snapshot().revision;
  assert.equal(board.revision(), empty);
  const captured = await captureAnalyzed(board, { type: 'capture', input: 'Revision prüfen.' });
  const afterCapture = board.snapshot().revision;
  assert.notEqual(afterCapture, empty);
  assert.equal(board.revision(), afterCapture);
  await board.execute({ type: 'answer', id: captured.idea.id, answered: true });
  const afterAnswer = board.revision();
  assert.notEqual(afterAnswer, afterCapture);
  const state = JSON.parse(readFileSync(board.path, 'utf8'));
  state.ideas[0].notes = 'von außen';
  writeFileSync(board.path, JSON.stringify(state));
  assert.notEqual(board.revision(), afterAnswer);
});

test('manual tags and analysis keywords keep unrelated words that resemble plurals', async () => {
  const board = makeBoard({ analyze: async () => ({ title: 'Reisen', keywords: ['Reisen', 'Reis'] }) });
  const first = await captureAnalyzed(board, { type: 'capture', input: 'Reis kochen' });
  await board.execute({ type: 'retag', id: first.idea.id, tags: ['Reis'] });
  const second = await captureAnalyzed(board, { type: 'capture', input: 'Reisen planen' });
  const tagged = await board.execute({ type: 'retag', id: second.idea.id, tags: ['Reisen'] });
  assert.deepEqual(tagged.idea.tags, ['Reisen']);
  assert.deepEqual(second.idea.keywords, ['Reisen', 'Reis']);
});

test('exact tag spellings normalize automatically while plural variants remain cleanup suggestions', async () => {
  assert.ok(similarTag('KI-Agent', 'ki agenten'));
  assert.ok(similarTag('LLM', 'LLMs'));
  assert.ok(similarTag('Node.js', 'NodeJS'));
  assert.ok(!similarTag('C++', 'C#'));
  assert.ok(!similarTag('Spiel', 'Spieler'));
  assert.deepEqual(preferExistingTags(['Agenten', 'agent', 'Neu'], ['Agent']), ['Agenten', 'Agent', 'Neu']);
  assert.deepEqual(similarTagGroups(['KI-Agenten', 'Kontext', 'ki agent', 'Kontexte', 'Rust']), [['KI-Agenten', 'ki agent'], ['Kontext', 'Kontexte']]);
  let seen;
  const board = makeBoard({ analyze: async (request) => { seen = request; return { title: 'T', summary: 'S', keyPoints: [], keywords: ['coding agents', 'Kontexte', 'Neu'], topic: 'KI' }; } });
  const first = await captureAnalyzed(board, { type: 'capture', input: 'Eins' });
  const second = await captureAnalyzed(board, { type: 'capture', input: 'Zwei' });
  await board.execute({ type: 'retag', id: first.idea.id, tags: ['Coding-Agents', 'Kontext', 'Rust'] });
  const retagged = await board.execute({ type: 'retag', id: second.idea.id, tags: ['kontexte', 'coding agents'] });
  assert.deepEqual(retagged.idea.tags, ['kontexte', 'Coding-Agents']);
  const third = await captureAnalyzed(board, { type: 'capture', input: 'Drei' });
  assert.equal(seen.existingTags.length, 4);
  assert.equal(seen.existingTags.at(-1), 'Rust');
  assert.deepEqual(third.idea.keywords, ['Coding-Agents', 'kontexte', 'Neu']);
});

test('a kept text note stays verbatim, keeps line breaks and is not read as a link', async () => {
  let seen;
  let linkRead = false;
  const board = makeBoard({
    readLink: async () => { linkRead = true; return { url: 'x', text: 'x' }; },
    analyze: async (request) => { seen = request; return { title: 'T', summary: 'S', keyPoints: [], keywords: [], topic: 'Agenten' }; },
  });
  const text = '  Erklärung:\r\n\r\n1. Erster   Punkt\n2. Zweiter Punkt\nhttps://example.com/quelle  ';
  const captured = await captureAnalyzed(board, { type: 'capture', input: text, keep: true });
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

test('an unreadable link stays saved with a retryable failure', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'gedankenraum-')), 'ideas.json');
  let analyzed = false;
  const board = makeBoard({
    path,
    readLink: async () => { throw new Error('offline'); },
    analyze: async () => { analyzed = true; return {}; },
  });
  await board.execute({ type: 'capture', input: 'https://example.com/a' });
  await board.whenIdle();
  assert.equal(analyzed, false);
  assert.equal(existsSync(path), true);
  assert.equal(board.snapshot().ideas[0].analysisState, 'failed');
  assert.match(board.snapshot().ideas[0].analysisWarning, /offline/);
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
  await board.whenIdle();
  assert.deepEqual(board.snapshot().ideas.map((idea) => idea.title), ['second', 'first']);
});

test('switching storage copies current data or opens an existing collection', async () => {
  const board = makeBoard();
  await captureAnalyzed(board, { type: 'capture', input: 'Aktuelle Sammlung' });
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
  const captured = await captureAnalyzed(board, { type: 'capture', input: 'Aktuelle Sammlung' });
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
  const captured = await captureAnalyzed(board, { type: 'capture', input: 'Aktuelle Sammlung' });
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
  await captureAnalyzed(board, { type: 'capture', input: 'Bleibt erhalten' });
  const before = readFileSync(board.path, 'utf8');

  await assert.rejects(() => board.importState({ version: 2, ideas: [] }), IdeaBoardValidationError);
  await assert.rejects(() => board.importState({ version: 1, ideas: [{}] }), IdeaBoardValidationError);
  assert.equal(readFileSync(board.path, 'utf8'), before);
});

test('thought links must be web addresses in imports and data files', async () => {
  const board = makeBoard();
  await captureAnalyzed(board, { type: 'capture', input: 'Bleibt erhalten' });
  const before = readFileSync(board.path, 'utf8');
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'kein Link', 42, ['https://example.com']]) {
    await assert.rejects(() => board.importState({ version: 1, ideas: [{ id: 'bad', source: 'link', url }] }), /ungültigen Link/);
  }
  assert.equal(readFileSync(board.path, 'utf8'), before);
  const imported = await board.importState({ version: 1, ideas: [{ id: 'link', source: 'link', url: 'https://example.com/a' }, { id: 'text', url: null }] });
  assert.equal(imported.imported, 2);

  const state = JSON.parse(readFileSync(board.path, 'utf8'));
  state.ideas[0].url = 'javascript:alert(1)';
  writeFileSync(board.path, JSON.stringify(state));
  assert.throws(() => board.snapshot(), /ungültigen Link/);
  await assert.rejects(() => makeBoard().switchStorage(board.path), /ungültigen Link/);
});

test('imported unfinished analysis waits for an explicit retry, also when merging storage', async () => {
  let calls = 0;
  const board = makeBoard({ analyze: async () => { calls += 1; return { title: 'Analysiert' }; } });
  const pending = { id: 'offen', title: 'Offen', input: 'Offen', source: 'text', analysisState: 'pending', analysisRevision: 3, reanalyze: 'ready' };
  await board.importState({ version: 1, ideas: [pending] }); await board.whenIdle();
  assert.equal(calls, 0);
  const imported = board.snapshot().ideas[0];
  assert.equal(imported.analysisState, 'failed');
  assert.match(imported.analysisWarning, /Unfertige Analyse importiert/);
  assert.equal(imported.reanalyze, undefined);
  await board.execute({ type: 'retry', id: 'offen' }); await board.whenIdle();
  assert.equal(calls, 1);
  assert.equal(board.snapshot().ideas[0].title, 'Analysiert');

  const target = join(mkdtempSync(join(tmpdir(), 'gedankenraum-pending-analysis-')), 'ideas.json');
  writeFileSync(target, JSON.stringify({ version: 1, ideas: [{ ...pending, id: 'extern' }] }));
  await board.switchStorage(target, 'merge'); await board.whenIdle();
  assert.equal(calls, 1);
  assert.equal(board.snapshot().ideas.find((idea) => idea.id === 'extern').analysisState, 'failed');
});

test('switching to the same file in other letter case keeps the collection on Windows', { skip: process.platform !== 'win32' }, async () => {
  const board = makeBoard();
  await captureAnalyzed(board, { type: 'capture', input: 'Bleibt' });
  const path = board.path;
  const switched = await board.switchStorage(path.toUpperCase());
  assert.equal(switched.action, 'unchanged');
  assert.equal(switched.canUndo, true);
  assert.equal(board.path, path);
});

test('small input slips: unparseable links stay text, renaming ignores trashed spellings, moves store the parent id', async () => {
  const board = makeBoard();
  const broken = await board.execute({ type: 'capture', input: 'http://[' });
  assert.notEqual(broken.idea.source, 'link');
  assert.equal(broken.idea.url, null);

  const kept = (await board.execute({ type: 'capture', input: 'Behalten' })).idea;
  const trashed = (await board.execute({ type: 'capture', input: 'Weg' })).idea;
  await board.whenIdle();
  await board.execute({ type: 'retag', id: kept.id, tags: ['Alt'] });
  await board.execute({ type: 'retag', id: trashed.id, tags: ['Neu'] });
  await board.execute({ type: 'delete', id: trashed.id });
  const renamed = await board.execute({ type: 'renametag', from: 'Alt', to: 'neu' });
  assert.equal(renamed.tag, 'neu');
  assert.equal(renamed.merged, false);
  assert.deepEqual(board.snapshot().ideas.find((idea) => idea.id === kept.id).tags, ['neu']);

  const moved = await board.execute({ type: 'move', id: kept.id, parentId: `  ${broken.idea.id} ` });
  assert.equal(moved.idea.parentId, broken.idea.id);
});
