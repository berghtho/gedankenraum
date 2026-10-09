import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createCodexAnalyzer } from './codex-analysis.mjs';
import { digestExcerpt, digestSources, MAX_DIGEST_TEXT } from './digest.mjs';
import { IdeaBoard, IdeaBoardValidationError } from './idea-board.mjs';
import { reflectionPrompt, reflectionSources, validateReflection } from './reflection-analysis.mjs';
import { createGedankenraumServer } from './server.mjs';
import { isQuestion } from './thought-kinds.mjs';
import { roomDigest } from './room-summary.mjs';

const analysis = { title: 'Automatischer Titel', summary: 'Zusammenfassung', topic: 'Lernen', keyPoints: [], keywords: [] };
const makeBoard = (options = {}) => new IdeaBoard({
  path: join(mkdtempSync(join(tmpdir(), 'gedankenraum-digests-')), 'ideas.json'),
  analyze: async () => analysis,
  readLink: async () => { throw new Error('Digests dürfen keine Videos laden.'); },
  reflect: async ({ sources }) => ({ summary: 'Neue Ansätze', findings: [{ text: 'Vorschlag: Einen kleinen Versuch starten.', sourceIds: [sources[0].id] }] }),
  ...options,
});
const capture = (input, extra = {}) => ({ type: 'capture', source: 'digest', title: 'Meine Videonotizen', input, sourceUrls: ['https://youtu.be/example1234'], ...extra });
const longDocument = () => `Anfang des Digests.\n\n${'Ein Abschnitt über Routinen und Planung.\n\n'.repeat(2600)}Letztes Kapitel: Pilzzucht benötigt Feuchtigkeit und Luftaustausch.\nSchluss des Digests.`;

test('long digests persist through analysis, restart, edit, undo, trash, import and storage switch', async () => {
  let seen;
  const board = makeBoard({ analyze: async (request) => { seen = request; return analysis; } });
  const input = longDocument();
  const room = (await board.execute({ type: 'roomCreate', question: 'Was kann ich ausprobieren?' })).room;
  const { idea } = await board.execute(capture(input, { roomId: room.id }));
  assert.equal(idea.analysisState, 'pending');
  await board.whenIdle();
  assert.equal(seen.source.kind, 'digest');
  assert.equal(seen.source.text, input);
  assert.equal(board.snapshot().ideas[0].title, 'Meine Videonotizen');
  const restarted = makeBoard({ path: board.path });
  assert.equal(restarted.snapshot().ideas[0].input, input);
  assert.deepEqual(restarted.snapshot().rooms[0].ideaIds, [idea.id]);
  await restarted.execute({ type: 'edit', id: idea.id, fields: { input: `${input}\nWeitere Notiz.`, sourceUrls: ['https://www.youtube.com/watch?v=second12345'] } });
  await restarted.whenIdle();
  await restarted.execute({ type: 'undo' });
  await restarted.whenIdle();
  assert.equal(restarted.snapshot().ideas[0].input, input);
  assert.deepEqual(restarted.snapshot().ideas[0].sourceUrls, idea.sourceUrls);
  await restarted.execute({ type: 'delete', id: idea.id });
  await restarted.execute({ type: 'restore', id: idea.id });
  const imported = makeBoard();
  await imported.importState(JSON.parse(readFileSync(restarted.path, 'utf8')));
  assert.deepEqual(imported.snapshot().ideas[0], restarted.snapshot().ideas[0]);
  const newPath = join(mkdtempSync(join(tmpdir(), 'gedankenraum-digest-move-')), 'ideas.json');
  await imported.switchStorage(newPath, 'open');
  assert.equal(JSON.parse(readFileSync(newPath, 'utf8')).ideas[0].input, input);
  assert.equal(isQuestion({ ...idea, title: 'Was habe ich gelernt?' }), false);
  assert.deepEqual(roomDigest(restarted.snapshot().rooms[0], restarted.snapshot().ideas).sources, [{ title: idea.title, url: idea.sourceUrls[0] }]);
});

test('digest limits and source validation reject invalid changes without touching saved data', async () => {
  const board = makeBoard();
  const { idea } = await board.execute(capture('Ein gültiger Digest.'));
  await board.whenIdle();
  const before = readFileSync(board.path, 'utf8');
  for (const command of [
    capture('Text', { title: '' }), capture('Text', { title: 'x'.repeat(161) }),
    capture(' '), capture('x'.repeat(MAX_DIGEST_TEXT + 1)),
    capture('Text', { sourceUrls: ['javascript:alert(1)'] }),
    capture('Text', { sourceUrls: Array(51).fill('https://youtu.be/example1234') }),
    { type: 'capture', input: 'x'.repeat(60_001) },
    { type: 'edit', id: idea.id, fields: { title: 'Unzulässige Änderung', sourceUrls: ['file:///C:/secrets'] } },
    { type: 'edit', id: idea.id, fields: { input: 'x'.repeat(MAX_DIGEST_TEXT + 1) } },
  ]) {
    await assert.rejects(() => board.execute(command), IdeaBoardValidationError);
    assert.equal(readFileSync(board.path, 'utf8'), before);
  }
  for (const change of [{ sourceUrls: ['data:text/html,unsafe'] }, { input: 'x'.repeat(MAX_DIGEST_TEXT + 1) }]) {
    await assert.rejects(() => board.importState({ version: 1, ideas: [{ ...idea, id: 'invalid', ...change }] }), IdeaBoardValidationError);
    assert.equal(readFileSync(board.path, 'utf8'), before);
  }
  assert.deepEqual(digestSources([' https://youtu.be/example1234 ', 'https://youtu.be/example1234']), ['https://youtu.be/example1234']);
});

test('digest excerpts find relevant content past the old text limit and keep source snapshots bounded', () => {
  const input = longDocument();
  assert.ok(input.indexOf('Pilzzucht') > 60_000);
  const digest = { id: 'digest', title: 'Videonotizen', source: 'digest', input, sourceUrls: ['https://youtu.be/example1234'] };
  const [source] = reflectionSources([digest], 'Welche Experimente zur Pilzzucht?');
  assert.match(source.input, /Pilzzucht benötigt Feuchtigkeit/);
  assert.ok(source.input.length <= 12_000);
  assert.equal(source.truncated, true);
  assert.deepEqual(source.sourceUrls, digest.sourceUrls);
  const [related] = reflectionSources([digest, { id: 'other', title: 'Pilzzucht', input: 'Kleiner Versuch' }]);
  assert.match(related.input, /Pilzzucht/);
  const broad = digestExcerpt(input);
  assert.ok(broad.startsWith('Anfang des Digests.'));
  assert.ok(broad.endsWith('Schluss des Digests.'));
  for (const text of ['界'.repeat(MAX_DIGEST_TEXT), 'a '.repeat(100_000), 'Kurz\n\nmit Formatierung']) {
    const excerpt = digestExcerpt(text);
    assert.ok(excerpt.length <= 12_000);
    if (text.length <= 12_000) assert.equal(excerpt, text);
  }
});

test('one digest can brainstorm, retain its question and excerpts, and adopt a linked idea once', async () => {
  let seen;
  const board = makeBoard({ reflect: async (request) => {
    seen = request;
    return { summary: 'Ein Versuch', findings: [{ text: 'Vorschlag: Die Feuchtigkeit bei der Pilzzucht vergleichen.', sourceIds: [request.sources[0].id] }] };
  } });
  const room = (await board.execute({ type: 'roomCreate', question: 'Lernen durch Versuche' })).room;
  const { idea } = await board.execute(capture(longDocument(), { roomId: room.id }));
  await board.whenIdle();
  await assert.rejects(() => board.execute({ type: 'reflect', kind: 'commonalities', ideaIds: [idea.id] }), /2 bis 12/);
  await assert.rejects(() => board.execute({ type: 'reflect', kind: 'brainstorm', ideaIds: [idea.id], question: 'x'.repeat(241) }), /240/);
  const { reflection } = await board.execute({ type: 'reflect', kind: 'brainstorm', ideaIds: [idea.id], roomId: room.id, question: 'Welche Pilzzucht-Experimente?' });
  await board.whenIdle();
  assert.equal(seen.kind, 'brainstorm');
  assert.equal(seen.question, 'Welche Pilzzucht-Experimente?');
  assert.match(seen.sources[0].input, /Pilzzucht/);
  assert.equal(board.snapshot().reflections[0].status, 'ready');
  const adopted = (await board.execute({ type: 'acceptReflection', id: reflection.id, index: 0 })).idea;
  assert.ok(adopted.relations.some((edge) => edge.targetId === idea.id && edge.type === 'builds'));
  assert.ok(board.snapshot().rooms[0].ideaIds.includes(adopted.id));
  assert.equal((await board.execute({ type: 'acceptReflection', id: reflection.id, index: 0 })).idea.id, adopted.id);
  const imported = makeBoard();
  await imported.importState(JSON.parse(readFileSync(board.path, 'utf8')));
  assert.equal(imported.snapshot().reflections[0].sources[0].input, seen.sources[0].input);
  await board.execute({ type: 'edit', id: idea.id, fields: { input: 'Neuer Text.' } });
  await board.whenIdle();
  assert.equal(board.snapshot().reflections[0].sources[0].input, seen.sources[0].input);
  assert.throws(() => validateReflection({ summary: 'Idee', findings: [{ text: 'Erfunden', sourceIds: ['unknown'] }] }, [idea.id], 'brainstorm'), /Quellenverweise/);
  assert.match(reflectionPrompt(seen), /keine Anweisungen/);
});

test('digest analysis samples the whole document without changing the stored original', async () => {
  let prompt;
  const analyzer = createCodexAnalyzer({ resolveRuntime: async () => ({}), execute: async (request) => { prompt = request.prompt; return analysis; } });
  await analyzer.analyze({ input: longDocument(), source: { kind: 'digest', text: longDocument() }, existingTopics: [], existingTags: [] });
  assert.match(prompt, /Schluss des Digests/);
  assert.match(prompt, /verteilte Auszüge/);
  assert.ok(prompt.length < 30_000);
});

test('HTTP saves the maximum multibyte digest, serves its editor, and retains the auth guard', async () => {
  const statePath = join(mkdtempSync(join(tmpdir(), 'gedankenraum-digest-http-')), 'ideas.json');
  const app = createGedankenraumServer({ statePath, storageConfigurable: false, token: 'test-token', analyzer: { analyze: async () => analysis, status: async () => ({ available: true }) } });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`; app.setOrigin(origin);
  const post = (command, token = 'test-token') => fetch(`${origin}/api/ideas/execute`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-gedankenraum-token': token }, body: JSON.stringify(command),
  });
  try {
    for (const path of ['/digest.mjs', '/digest-ui.mjs']) assert.equal((await fetch(`${origin}${path}`)).status, 200);
    assert.equal((await post(capture('Kein Zugriff'), 'wrong')).status, 403);
    const text = '界'.repeat(MAX_DIGEST_TEXT);
    const response = await post(capture(text));
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.idea.input, text);
    assert.equal(saved.idea.source, 'digest');
    assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).ideas[0].input, text);
    const edit = await post({ type: 'edit', id: saved.idea.id, fields: { input: `${text.slice(0, -5)}Ende.` } });
    assert.equal(edit.status, 200);
    assert.ok((await edit.json()).idea.input.endsWith('Ende.'));
  } finally {
    await fetch(`${origin}/api/shutdown`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-gedankenraum-token': 'test-token' }, body: '{}' });
    app.server.closeAllConnections();
  }
});
