import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { IdeaBoard } from './idea-board.mjs';

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const boardFor = (overrides = {}) => {
  let sequence = 0;
  return new IdeaBoard({
    path: join(mkdtempSync(join(tmpdir(), 'gedankenraum-collection-')), 'ideas.json'),
    makeId: () => `item-${++sequence}`,
    analyze: async ({ input }) => ({ title: input, summary: `Kurz: ${input}`, topic: 'Test', keyPoints: [], keywords: [] }),
    readLink: async (url) => ({ url, text: 'Quelle' }),
    research: async () => ({ summary: 'Antwort', findings: [{ text: 'Befund', sources: [{ title: 'Quelle', url: 'https://example.org/q' }] }], engine: 'Test-KI' }),
    ...overrides,
  });
};

test('merging tags is one undo step and moves keyword suggestions along', async () => {
  const board = boardFor({ analyze: async ({ input }) => ({ title: input, summary: input, topic: 'Test', keyPoints: [], keywords: ['Tokenverbrauch'] }) });
  const a = (await board.execute({ type: 'capture', input: 'A' })).idea;
  const b = (await board.execute({ type: 'capture', input: 'B' })).idea;
  await board.whenIdle();
  await board.execute({ type: 'retag', id: a.id, tags: ['Tokenkosten'] });
  await board.execute({ type: 'retag', id: b.id, tags: ['Tokenverbrauch', 'KI'] });
  const merged = await board.execute({ type: 'mergeTags', tags: ['Tokenverbrauch', 'Tokenkosten'], into: 'Tokenkosten' });
  assert.equal(merged.changed, 1);
  assert.deepEqual(board.snapshot().ideas.find((idea) => idea.id === b.id).tags, ['Tokenkosten', 'KI']);
  assert.ok(board.snapshot().ideas.every((idea) => idea.keywords.includes('Tokenkosten') && !idea.keywords.includes('Tokenverbrauch')));
  await board.execute({ type: 'undo' });
  assert.deepEqual(board.snapshot().ideas.find((idea) => idea.id === b.id).tags, ['Tokenverbrauch', 'KI']);
  await assert.rejects(() => board.execute({ type: 'mergeTags', tags: ['KI'], into: 'KI' }), /mindestens zwei/);
  await assert.rejects(() => board.execute({ type: 'mergeTags', tags: ['KI', 'Tokenkosten'], into: 'Neu' }), /mindestens zwei/);
});

test('re-analysis refreshes every thought, keeps the old analysis on failure or fallback and can be cancelled', async () => {
  let round = 1;
  const board = boardFor({ analyze: async ({ input }) => {
    if (round === 2 && input === 'Fehler') throw new Error('Link nicht erreichbar');
    if (round === 2 && input === 'Lokal') return { analysis: { title: 'Lokal', summary: 'schwach', keyPoints: [], keywords: [], topic: 'X' }, engine: 'Lokale Analyse', warning: 'Codex war nicht verfügbar' };
    return { title: `${input} ${round}`, summary: `Runde ${round}`, topic: 'Test', keyPoints: [], keywords: [] };
  } });
  for (const input of ['Gut', 'Fehler', 'Lokal']) await board.execute({ type: 'capture', input });
  await board.whenIdle();
  const undoSteps = board.history.length;
  round = 2;
  assert.equal((await board.execute({ type: 'reanalyzeAll' })).queued, 3);
  await board.whenIdle();
  const byInput = (input) => board.snapshot().ideas.find((idea) => idea.input === input);
  assert.equal(byInput('Gut').summary, 'Runde 2');
  assert.equal(byInput('Fehler').summary, 'Runde 1');
  assert.equal(byInput('Fehler').analysisState, 'ready');
  assert.match(byInput('Fehler').analysisWarning, /Neu-Analyse nicht möglich: Link nicht erreichbar/);
  assert.equal(byInput('Lokal').summary, 'Runde 1');
  assert.match(byInput('Lokal').analysisWarning, /Codex nicht verfügbar/);
  assert.ok(board.snapshot().ideas.every((idea) => !idea.reanalyze));
  assert.equal(board.history.length, undoSteps);

  const gate = deferred(); const entered = deferred();
  board.analyze = async ({ input }) => { entered.resolve(); await gate.promise; return { title: input, summary: 'Runde 3', topic: 'Test', keyPoints: [], keywords: [] }; };
  await board.execute({ type: 'reanalyzeAll' });
  await entered.promise;
  assert.equal((await board.execute({ type: 'cancelReanalysis' })).stopped, 3);
  gate.resolve(); await board.whenIdle();
  assert.ok(board.snapshot().ideas.every((idea) => idea.analysisState === 'ready' && idea.summary !== 'Runde 3'));
  await assert.rejects(() => board.execute({ type: 'cancelReanalysis' }), /Keine Neu-Analyse/);
});

test('questions can be marked answered and reopened; the status is undoable and imported safely', async () => {
  const board = boardFor();
  const { idea } = await board.execute({ type: 'capture', input: 'Hilft Schlaf beim Lernen?' });
  assert.ok((await board.execute({ type: 'answer', id: idea.id, answered: true })).idea.answeredAt);
  await board.execute({ type: 'undo' });
  assert.equal(board.snapshot().ideas[0].answeredAt, undefined);
  await board.execute({ type: 'answer', id: idea.id, answered: true });
  assert.equal((await board.execute({ type: 'answer', id: idea.id, answered: false })).idea.answeredAt, null);
  await assert.rejects(() => board.execute({ type: 'answer', id: idea.id, answered: 'ja' }), /Fragenstatus/);
  await assert.rejects(() => board.importState({ version: 1, ideas: [{ id: 'x', title: 'X?', answeredAt: 5 }] }), /Fragenstatus/);
});

test('a research finding becomes one derived thought that builds on the question and joins its rooms', async () => {
  const board = boardFor();
  const room = (await board.execute({ type: 'roomCreate', question: 'Wie lernen wir?' })).room;
  const { idea } = await board.execute({ type: 'capture', input: 'Hilft Schlaf beim Lernen?', roomId: room.id });
  await board.execute({ type: 'research', id: idea.id }); await board.whenIdle();
  const accepted = await board.execute({ type: 'acceptResearch', id: idea.id, index: 0 });
  assert.equal(accepted.idea.input, 'Befund');
  assert.deepEqual(accepted.idea.relations, [{ targetId: idea.id, type: 'builds' }]);
  assert.deepEqual(accepted.idea.researchOrigin.sources, [{ title: 'Quelle', url: 'https://example.org/q' }]);
  assert.ok(board.snapshot().rooms[0].ideaIds.includes(accepted.idea.id));
  assert.equal((await board.execute({ type: 'acceptResearch', id: idea.id, index: 0 })).idea.id, accepted.idea.id);
  await board.execute({ type: 'undo' });
  assert.ok(board.snapshot().trash.some((item) => item.id === accepted.idea.id));
  assert.ok(!board.snapshot().rooms[0].ideaIds.includes(accepted.idea.id));
  assert.equal((await board.execute({ type: 'acceptResearch', id: idea.id, index: 0 })).idea.id, accepted.idea.id);
  assert.ok(board.snapshot().rooms[0].ideaIds.includes(accepted.idea.id));
  await assert.rejects(() => board.execute({ type: 'acceptResearch', id: idea.id, index: 5 }), /Befund/);
  const forged = { ...accepted.idea, id: 'forged', researchOrigin: { ideaId: idea.id, completedAt: null, index: 0, sources: [{ title: 'x', url: 'javascript:alert(1)' }] } };
  await assert.rejects(() => board.importState({ version: 1, ideas: [forged] }), /Recherche-Befund/);
});
