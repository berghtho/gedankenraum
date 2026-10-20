import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { IdeaBoard } from './idea-board.mjs';
import { createInbox, dropDigest, inboxCommand } from './inbox.mjs';
import { createLocalAnalyzer } from './local-analysis.mjs';
import { createGedankenraumServer } from './server.mjs';

const temp = (name) => mkdtempSync(join(tmpdir(), `gedankenraum-inbox-${name}-`));
const boardFor = (directory) => new IdeaBoard({
  path: join(directory, 'ideas.json'),
  analyze: async ({ input }) => ({ title: 'Analysiert', summary: input.slice(0, 40), topic: 'KI', keyPoints: [], keywords: [] }),
  readLink: async (url) => ({ url, text: 'Quelle' }),
});
const digest = { title: 'YouTube AI digest – 2026-10-09', text: '## Theo\n\n- Neues Modell\n- Benchmarks', sourceUrls: ['https://www.youtube.com/watch?v=abc123'] };

test('inbox files become digests after a pull, are moved to done/ and are pushed once analysed', async () => {
  const data = temp('data');
  const inboxDir = join(data, 'inbox');
  const board = boardFor(data);
  const calls = [];
  const inbox = createInbox({
    board, directory: inboxDir,
    pull: async () => { calls.push(['pull', board.snapshot().ideas.length]); return { pulled: 0 }; },
    push: async () => { calls.push(['push', board.snapshot().ideas[0].analysisState]); return { pushed: true }; },
  });
  await dropDigest(inboxDir, '2026-10-09.json', digest);
  const report = await inbox.scan();

  assert.deepEqual(calls, [['pull', 0], ['push', 'ready']]);
  const [idea] = board.snapshot().ideas;
  assert.equal(idea.source, 'digest');
  assert.equal(idea.title, digest.title, 'the given title is kept over the analysis title');
  assert.equal(idea.input, digest.text);
  assert.deepEqual(idea.sourceUrls, digest.sourceUrls);
  assert.equal(report.entries[0].status, 'imported');
  assert.deepEqual(readdirSync(join(inboxDir, 'done')), ['2026-10-09.json']);
  assert.equal(JSON.parse(readFileSync(join(inboxDir, '.last-run.json'), 'utf8')).push.pushed, true);

  // Dieselbe Datei noch einmal: kein zweiter Digest, kein zweiter Push.
  await dropDigest(inboxDir, '2026-10-09.json', digest);
  const again = await inbox.scan();
  assert.equal(again.entries[0].status, 'duplicate');
  assert.equal(board.snapshot().ideas.length, 1);
  assert.equal(calls.filter(([name]) => name === 'push').length, 1);
  assert.deepEqual(readdirSync(join(inboxDir, 'done')).sort(), ['2026-10-09.1.json', '2026-10-09.json']);
});

test('an empty inbox neither pulls nor pushes', async () => {
  const data = temp('empty');
  let touched = false;
  const inbox = createInbox({ board: boardFor(data), directory: join(data, 'missing'), pull: async () => { touched = true; }, push: async () => { touched = true; } });
  assert.equal(await inbox.scan(), null);
  assert.equal(touched, false);
});

test('a failed push is retried on the next run even without new files', async () => {
  const data = temp('retry');
  const inboxDir = join(data, 'inbox');
  const results = [{ error: 'offline' }, { pushed: true }];
  const pushes = [];
  const inbox = createInbox({ board: boardFor(data), directory: inboxDir, push: async () => { pushes.push(results[pushes.length]); return pushes.at(-1); } });
  await dropDigest(inboxDir, 'digest.json', digest);
  assert.equal((await inbox.scan()).push.error, 'offline');
  assert.ok(existsSync(join(inboxDir, '.push-pending')), 'the failed push is remembered');
  assert.deepEqual(readdirSync(join(inboxDir, 'done')), ['digest.json']);

  const retry = await inbox.scan();
  assert.equal(retry.push.pushed, true);
  assert.deepEqual(retry.entries, []);
  assert.equal(existsSync(join(inboxDir, '.push-pending')), false);
  assert.equal(await inbox.scan(), null, 'after a successful push the empty inbox is quiet again');
  assert.equal(pushes.length, 2);
});

test('invalid files go to failed/, half-written files wait, temporary files are ignored', async () => {
  const data = temp('invalid');
  const inboxDir = join(data, 'inbox');
  const board = boardFor(data);
  let pushes = 0;
  const inbox = createInbox({ board, directory: inboxDir, push: async () => { pushes += 1; } });
  await dropDigest(inboxDir, 'no-title.json', { ...digest, title: '' });
  writeFileSync(join(inboxDir, 'wrong.json'), JSON.stringify({ type: 'digest', title: 'x', text: 'y' }));
  writeFileSync(join(inboxDir, 'partial.json'), '{"format":"gedankenraum-in');
  const old = join(inboxDir, 'broken.json');
  writeFileSync(old, '{nope');
  utimesSync(old, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  writeFileSync(join(inboxDir, '.writing.json.tmp'), '{');

  const report = await inbox.scan();
  assert.deepEqual(report.entries.map(({ file, status }) => [file, status]).sort(), [['broken.json', 'failed'], ['no-title.json', 'failed'], ['wrong.json', 'failed']]);
  assert.match(report.entries.find(({ file }) => file === 'wrong.json').error, /format/);
  assert.deepEqual(readdirSync(join(inboxDir, 'failed')).sort(), ['broken.json', 'no-title.json', 'wrong.json']);
  assert.ok(existsSync(join(inboxDir, 'partial.json')), 'a fresh unreadable file is left for the next run');
  assert.equal(board.snapshot().ideas.length, 0);
  assert.equal(pushes, 0);
  await inbox.stop();
});

test('the inbox format is checked before anything is captured', () => {
  assert.throws(() => inboxCommand([]), /JSON-Objekt/);
  assert.throws(() => inboxCommand({ format: 'gedankenraum-inbox', version: 2, type: 'digest' }), /version 1/);
  assert.throws(() => inboxCommand({ format: 'gedankenraum-inbox', version: 1, type: 'note', title: 'a', text: 'b' }), /digest/);
  assert.deepEqual(inboxCommand({ format: 'gedankenraum-inbox', version: 1, type: 'digest', title: 'T', text: 'X' }),
    { type: 'capture', source: 'digest', title: 'T', input: 'X', sourceUrls: [] });
});

// Echtes Git, aber ohne die Git-Konfiguration dieses Rechners.
const gitConfig = join(temp('gitconfig'), 'gitconfig');
writeFileSync(gitConfig, '');
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('the running server pulls a newer remote ideas.json first, adds the dropped digest and pushes both', async () => {
  Object.assign(process.env, gitEnv);
  const base = temp('git');
  const seed = join(base, 'seed');
  git(base, 'init', '-b', 'main', seed);
  writeFileSync(join(seed, 'ideas.json'), '{"version":1,"ideas":[]}\n');
  git(seed, 'add', '.'); git(seed, 'commit', '-m', 'Start');
  git(base, 'clone', '--bare', seed, join(base, 'remote.git'));
  git(base, 'clone', join(base, 'remote.git'), join(base, 'work'));
  git(base, 'clone', join(base, 'remote.git'), join(base, 'laptop'));
  // Auf einem anderen Rechner kam inzwischen ein Gedanke dazu.
  const laptop = boardFor(join(base, 'laptop'));
  await laptop.execute({ type: 'capture', input: 'Vom Laptop' }); await laptop.whenIdle();
  git(join(base, 'laptop'), 'commit', '-am', 'Gedankenraum: ideas.json aktualisiert'); git(join(base, 'laptop'), 'push');

  const inboxDir = join(base, 'inbox');
  const app = createGedankenraumServer({ statePath: join(base, 'work', 'ideas.json'), settingsPath: join(base, 'settings.json'), token: 't', analyzer: createLocalAnalyzer(), inboxDirectory: inboxDir });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  try {
    // Erst ablegen, dann starten: Sonst kann der Startlauf den noch leeren Eingang sehen.
    await dropDigest(inboxDir, 'digest.json', digest);
    app.setOrigin(origin);
    const report = await app.inbox.scan();
    assert.equal(report.entries[0]?.status, 'imported', JSON.stringify(report));
    assert.equal(report.pull.pulled, 1);
    assert.equal(report.push.pushed, true, JSON.stringify(report.push));
    git(join(base, 'laptop'), 'pull', '--ff-only');
    const remote = JSON.parse(readFileSync(join(base, 'laptop', 'ideas.json'), 'utf8'));
    assert.deepEqual(remote.ideas.map((idea) => idea.source).sort(), ['digest', 'text']);
    const state = await fetch(`${origin}/api/ideas`).then((response) => response.json());
    assert.equal(state.ideas.find((idea) => idea.source === 'digest').title, digest.title);
  } finally {
    await app.inbox.stop();
    await new Promise((resolve) => app.server.close(resolve));
  }
});
