import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { IdeaBoard } from './idea-board.mjs';
import { layoutMindmap, mindmapMarkup } from './mindmap.mjs';

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const fixture = (overrides = {}) => {
  let id = 0;
  return new IdeaBoard({
    path: join(mkdtempSync(join(tmpdir(), 'gedankenraum-thinking-')), 'ideas.json'),
    makeId: () => `idea-${++id}`,
    analyze: async ({ input }) => ({ title: `Analyse: ${input}`, summary: `Kurz: ${input}`, topic: 'Gedanken', keyPoints: ['Kernpunkt'], keywords: ['Idee'] }),
    readLink: async (url) => ({ url, title: 'Quelle', text: 'Quelltext' }),
    ...overrides,
  });
};

test('capture is durable before analysis and a second capture and edits do not wait', { timeout: 3000 }, async () => {
  const gate = deferred();
  const entered = deferred();
  const board = fixture({ analyze: async ({ input }) => { entered.resolve(); await gate.promise; return { title: `KI ${input}`, summary: 'KI Text', topic: 'KI Thema' }; } });
  const first = await board.execute({ type: 'capture', input: 'erster\nGedanke' });
  await entered.promise;
  assert.equal(JSON.parse(readFileSync(board.path, 'utf8')).ideas[0].input, 'erster\nGedanke');
  assert.equal(first.idea.analysisState, 'pending');
  const second = await board.execute({ type: 'capture', input: 'zweiter' });
  await board.execute({ type: 'edit', id: first.idea.id, fields: { title: 'Mein Titel', summary: 'Meine Worte', notes: 'Eigene Ergänzung' } });
  await board.execute({ type: 'retopic', id: first.idea.id, topic: 'Mein Thema' });
  gate.resolve();
  await board.whenIdle();
  const result = board.snapshot().ideas.find((idea) => idea.id === first.idea.id);
  assert.equal(result.title, 'Mein Titel');
  assert.equal(result.summary, 'Meine Worte');
  assert.equal(result.topic, 'Mein Thema');
  assert.equal(result.notes, 'Eigene Ergänzung');
  assert.equal(board.snapshot().ideas.find((idea) => idea.id === second.idea.id).title, 'KI zweiter');
});

test('editing source text discards a stale analysis and analyzes the new input', async () => {
  const gate = deferred(); const entered = deferred(); const seen = [];
  const board = fixture({ analyze: async ({ input }) => { seen.push(input); if (input === 'alt') { entered.resolve(); await gate.promise; } return { title: input, summary: input }; } });
  const { idea } = await board.execute({ type: 'capture', input: 'alt' });
  await entered.promise;
  await board.execute({ type: 'edit', id: idea.id, fields: { input: 'neu' } });
  gate.resolve(); await board.whenIdle();
  assert.deepEqual(seen, ['alt', 'neu']);
  assert.equal(board.snapshot().ideas[0].summary, 'neu');
});

test('trash survives restart and analysis never resurrects a deleted thought', async () => {
  const gate = deferred(); const entered = deferred();
  const board = fixture({ analyze: async () => { entered.resolve(); await gate.promise; return { title: 'Fertig' }; } });
  const { idea } = await board.execute({ type: 'capture', input: 'Bleibt erhalten' });
  await entered.promise;
  await board.execute({ type: 'delete', id: idea.id });
  gate.resolve(); await board.whenIdle();
  assert.equal(board.snapshot().ideas.length, 0);
  assert.equal(board.snapshot().trash[0].input, 'Bleibt erhalten');
  const reopened = fixture({ path: board.path });
  assert.equal(reopened.snapshot().trash.length, 1);
  await reopened.execute({ type: 'restore', id: idea.id });
  await reopened.whenIdle();
  assert.equal(reopened.snapshot().ideas[0].analysisState, 'ready');
});

test('undo changes only user fields, keeps analysis, and does not drop other ideas', async () => {
  const gate = deferred(); const entered = deferred();
  const board = fixture({ analyze: async () => { entered.resolve(); await gate.promise; return { title: 'Analysiert', summary: 'Wichtig' }; } });
  const { idea } = await board.execute({ type: 'capture', input: 'Eins' });
  await entered.promise;
  await board.execute({ type: 'edit', id: idea.id, fields: { notes: 'Notiz' } });
  gate.resolve(); await board.whenIdle();
  await board.execute({ type: 'undo' });
  assert.equal(board.snapshot().ideas[0].title, 'Analysiert');
  assert.equal(board.snapshot().ideas[0].notes, '');
  const second = await board.execute({ type: 'capture', input: 'Zwei' });
  await board.whenIdle();
  await board.execute({ type: 'undo' });
  assert.equal(board.snapshot().ideas[0].id, idea.id);
  assert.equal(board.snapshot().trash[0].id, second.idea.id);
  await board.execute({ type: 'restore', id: second.idea.id });
  await board.execute({ type: 'undo' });
  assert.equal(board.snapshot().trash[0].id, second.idea.id);
});

test('hierarchy rejects cycles; typed links and parentage survive trash and import', async () => {
  const board = fixture();
  const a = (await board.execute({ type: 'capture', input: 'A', title: 'A' })).idea;
  const b = (await board.execute({ type: 'capture', input: 'B', parentId: a.id })).idea;
  const c = (await board.execute({ type: 'capture', input: 'C', parentId: b.id })).idea;
  await assert.rejects(() => board.execute({ type: 'move', id: a.id, parentId: c.id }), /nicht unter sich/);
  await board.execute({ type: 'connect', id: a.id, targetId: c.id, relation: 'contradicts' });
  await board.execute({ type: 'connect', id: a.id, targetId: c.id, relation: 'contradicts' });
  assert.equal(board.snapshot().ideas.find((idea) => idea.id === a.id).relations.length, 1);
  await assert.rejects(() => board.execute({ type: 'connect', id: a.id, targetId: a.id, relation: 'builds' }), /Ungültige/);
  await board.execute({ type: 'delete', id: b.id });
  assert.equal(board.snapshot().ideas.length, 2);
  await board.execute({ type: 'restore', id: b.id });
  await board.whenIdle();
  const imported = fixture();
  await imported.importState(JSON.parse(readFileSync(board.path, 'utf8')));
  assert.equal(imported.snapshot().ideas.find((idea) => idea.id === c.id).parentId, b.id);
  assert.equal(imported.snapshot().ideas.find((idea) => idea.id === a.id).relations[0].targetId, c.id);
});

test('switching storage during analysis cannot overwrite the new collection or carry undo across', async () => {
  const gate = deferred(); const entered = deferred();
  const board = fixture({ analyze: async () => { entered.resolve(); await gate.promise; return { title: 'Alt' }; } });
  await board.execute({ type: 'capture', input: 'Alt' });
  await entered.promise;
  const other = join(mkdtempSync(join(tmpdir(), 'gedankenraum-other-')), 'ideas.json');
  writeFileSync(other, JSON.stringify({ version: 1, ideas: [{ id: 'idea-1', title: 'Andere Sammlung', analysisState: 'ready' }] }));
  await board.switchStorage(other);
  gate.resolve(); await board.whenIdle();
  assert.equal(board.snapshot().ideas[0].title, 'Andere Sammlung');
  assert.equal(board.snapshot().canUndo, false);
});

test('restart resumes durable pending captures and retry fixes failed links', async () => {
  const board = fixture(); board.stop();
  const { idea } = await board.execute({ type: 'capture', input: 'https://example.com' });
  const restarted = fixture({ path: board.path, readLink: async () => { throw new Error('Offline'); } });
  await restarted.whenIdle();
  assert.equal(restarted.snapshot().ideas[0].analysisState, 'failed');
  restarted.readLink = async (url) => ({ url, text: 'Jetzt verfügbar' });
  await restarted.execute({ type: 'retry', id: idea.id }); await restarted.whenIdle();
  assert.equal(restarted.snapshot().ideas[0].analysisState, 'ready');
});

test('layout collapses descendants, promotes filtered or orphaned children, and tolerates imported cycles', () => {
  const ideas = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B', parentId: 'a' }, { id: 'c', title: 'C', parentId: 'b' }];
  assert.deepEqual(layoutMindmap(ideas, new Set(['a'])).nodes.map((node) => node.idea.id), ['a']);
  assert.equal(layoutMindmap(ideas.slice(1)).nodes[0].x, 32);
  const cycle = [{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }];
  assert.equal(layoutMindmap(cycle).nodes.length, 2);
  const markup = mindmapMarkup([{ id: '<x>', title: '<script>alert(1)</script>' }], '<x>', () => '#fff', { collapsed: new Set(), zoom: 1 });
  assert.doesNotMatch(markup, /<script>/);
});

test('active-only commands do not alter trash and malformed optional graph fields cannot be imported', async () => {
  const board = fixture();
  const { idea } = await board.execute({ type: 'capture', input: 'Aufbewahren' });
  await board.whenIdle();
  await board.execute({ type: 'delete', id: idea.id });
  const before = readFileSync(board.path, 'utf8');
  for (const change of [{ type: 'retopic', topic: 'Neu' }, { type: 'retag', tags: ['Neu'] }, { type: 'delete' }]) {
    await assert.rejects(() => board.execute({ ...change, id: idea.id }), /nicht gefunden/);
  }
  for (const invalid of [{ relations: {} }, { relations: [{ targetId: 'x', type: 'invalid' }] }, { parentId: 42 }, { manualFields: 'title' }]) {
    await assert.rejects(() => board.importState({ version: 1, ideas: [{ id: 'bad', ...invalid }] }), /ungültige/);
  }
  assert.equal(readFileSync(board.path, 'utf8'), before);
});
