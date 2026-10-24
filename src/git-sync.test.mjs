import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { commitAndPush, gitStatus, pullRemote } from './git-sync.mjs';

// Echtes Git, aber ohne die Git-Konfiguration dieses Rechners.
const config = join(mkdtempSync(join(tmpdir(), 'gedankenraum-gitconfig-')), 'gitconfig');
writeFileSync(config, '');
Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
});
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// Ein Remote und ein Klon, in dem ideas.json neben einer anderen Datei eingecheckt ist.
function repository() {
  const base = mkdtempSync(join(tmpdir(), 'gedankenraum-git-'));
  const seed = join(base, 'seed');
  git(base, 'init', '-b', 'main', seed);
  writeFileSync(join(seed, 'ideas.json'), '{"version":1,"ideas":[]}\n');
  writeFileSync(join(seed, 'notes.txt'), 'Notiz\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-m', 'Start');
  const remote = join(base, 'remote.git');
  git(base, 'clone', '--bare', seed, remote);
  const clone = (name) => { git(base, 'clone', remote, join(base, name)); return join(base, name); };
  const work = clone('work');
  return { remote, work, file: join(work, 'ideas.json'), clone };
}

test('push is only offered for an ideas.json that git tracks', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'gedankenraum-nogit-'));
  writeFileSync(join(outside, 'ideas.json'), '{}\n');
  assert.equal((await gitStatus(join(outside, 'ideas.json'))).available, false);

  const { work, file } = repository();
  mkdirSync(join(work, 'andere'));
  writeFileSync(join(work, 'andere', 'ideas.json'), '{}\n');
  assert.equal((await gitStatus(join(work, 'andere', 'ideas.json'))).available, false);
  await assert.rejects(commitAndPush(join(work, 'andere', 'ideas.json')), /nicht in Git eingecheckt/);
  assert.deepEqual(await gitStatus(file), { available: true, branch: 'main', upstream: 'origin/main', changed: false, ahead: 0, behind: 0, foreign: 0 });
});

test('push commits only ideas.json and leaves other changes in the repository alone', async () => {
  const { remote, work, file } = repository();
  writeFileSync(file, '{"version":1,"ideas":[{"id":"a"}]}\n');
  writeFileSync(join(work, 'notes.txt'), 'Geänderte Notiz\n');
  writeFileSync(join(work, 'staged.txt'), 'vorgemerkt\n');
  git(work, 'add', 'staged.txt');
  assert.equal((await gitStatus(file)).changed, true);

  const result = await commitAndPush(file);
  assert.deepEqual(result, { available: true, branch: 'main', upstream: 'origin/main', changed: false, ahead: 0, behind: 0, foreign: 0, pushed: true });
  assert.equal(git(remote, 'log', '-1', '--format=%s', 'main').trim(), 'Gedankenraum: ideas.json aktualisiert');
  assert.equal(git(remote, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'main').trim(), 'ideas.json');
  assert.equal(git(remote, 'show', 'main:ideas.json'), '{"version":1,"ideas":[{"id":"a"}]}\n');
  assert.deepEqual(git(work, 'status', '--porcelain').trimEnd().split('\n').sort(), [' M notes.txt', 'A  staged.txt']);
  assert.equal((await commitAndPush(file)).pushed, false);
});

test('status counts outgoing commits that Gedankenraum did not make', async () => {
  const { work, file } = repository();
  writeFileSync(join(work, 'notes.txt'), 'Eigener Commit\n');
  git(work, 'commit', '-am', 'Notiz');
  writeFileSync(file, '{"version":1,"ideas":[{"id":"c"}]}\n');
  git(work, 'commit', '-am', 'Gedankenraum: ideas.json aktualisiert');
  assert.deepEqual(await gitStatus(file), { available: true, branch: 'main', upstream: 'origin/main', changed: false, ahead: 2, behind: 0, foreign: 1 });
  git(work, 'branch', '--unset-upstream');
  assert.equal((await gitStatus(file)).foreign, 0);
});

test('a rejected push keeps the local commit and can be pushed again after a pull', async () => {
  const { remote, work, file, clone } = repository();
  const other = clone('other');
  writeFileSync(join(other, 'notes.txt'), 'Von woanders\n');
  git(other, 'commit', '-am', 'Anderswo');
  git(other, 'push');

  writeFileSync(file, '{"version":1,"ideas":[{"id":"b"}]}\n');
  await assert.rejects(commitAndPush(file), /neuere Änderungen.*pullen.*Commit bleibt lokal erhalten/);
  assert.deepEqual(await gitStatus(file), { available: true, branch: 'main', upstream: 'origin/main', changed: false, ahead: 1, behind: 0, foreign: 0 });

  git(work, 'pull', '--no-rebase', '--no-edit');
  // Der Merge-Commit stammt nicht von Gedankenraum und wird mit gepusht.
  assert.deepEqual(await gitStatus(file), { available: true, branch: 'main', upstream: 'origin/main', changed: false, ahead: 2, behind: 0, foreign: 1 });
  assert.equal((await commitAndPush(file)).ahead, 0);
  assert.equal(git(remote, 'show', 'main:ideas.json'), '{"version":1,"ideas":[{"id":"b"}]}\n');
  assert.equal(git(remote, 'show', 'main:notes.txt'), 'Von woanders\n');
});

const ideas = (...items) => `${JSON.stringify({ version: 1, ideas: items }, null, 2)}\n`;
const ids = (file) => JSON.parse(readFileSync(file, 'utf8')).ideas.map((idea) => idea.id);

test('pull fast-forwards without local changes and merges diverged history', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'gedankenraum-nogit-'));
  writeFileSync(join(outside, 'ideas.json'), '{}\n');
  assert.equal(await pullRemote(join(outside, 'ideas.json')), null);

  const { remote, work, file, clone } = repository();
  assert.deepEqual(await pullRemote(file), { upstream: 'origin/main', pulled: 0 });
  const other = clone('other');
  writeFileSync(join(other, 'ideas.json'), ideas({ id: 'remote' }));
  git(other, 'commit', '-am', 'Anderswo');
  git(other, 'push');
  assert.deepEqual(await pullRemote(file), { upstream: 'origin/main', pulled: 1 });
  assert.deepEqual(ids(file), ['remote']);

  writeFileSync(join(other, 'ideas.json'), ideas({ id: 'remote2' }, { id: 'remote' }));
  writeFileSync(join(other, 'notes.txt'), 'Von woanders\n');
  git(other, 'commit', '-am', 'Noch einmal anderswo');
  git(other, 'push');
  writeFileSync(join(work, 'other.txt'), 'Hier\n');
  git(work, 'add', 'other.txt');
  git(work, 'commit', '-m', 'Hier');
  assert.deepEqual(await pullRemote(file), { upstream: 'origin/main', pulled: 1, merged: true });
  assert.deepEqual(ids(file), ['remote2', 'remote']);
  assert.equal(readFileSync(join(work, 'notes.txt'), 'utf8'), 'Von woanders\n');
  assert.equal(git(work, 'log', '-1', '--format=%s').trim(), 'Gedankenraum: ideas.json zusammengeführt');
  // Der fremde Commit „Hier“ geht mit, der Merge-Commit stammt von Gedankenraum.
  assert.deepEqual(await gitStatus(file), { available: true, branch: 'main', upstream: 'origin/main', changed: false, ahead: 2, behind: 0, foreign: 1 });
  await commitAndPush(file);
  assert.deepEqual(JSON.parse(git(remote, 'show', 'main:ideas.json')).ideas.map((idea) => idea.id), ['remote2', 'remote']);
});

test('pull keeps an unpushed ideas.json by committing and merging it entry by entry', async () => {
  const { work, file, clone } = repository();
  const other = clone('other');
  writeFileSync(file, ideas({ id: 'a', summary: '', updatedAt: '1' }));
  await commitAndPush(file);
  git(other, 'pull');

  // Remote kommt ein neuer Digest dazu, lokal wird derselbe Bereich der Datei analysiert.
  writeFileSync(join(other, 'ideas.json'), ideas({ id: 'neu', summary: '', updatedAt: '2' }, { id: 'a', summary: '', updatedAt: '1' }));
  git(other, 'commit', '-am', 'Digest');
  git(other, 'push');
  writeFileSync(file, ideas({ id: 'a', summary: 'Analysiert', updatedAt: '3' }));

  assert.deepEqual(await pullRemote(file), { upstream: 'origin/main', pulled: 1, merged: true });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).ideas, [
    { id: 'neu', summary: '', updatedAt: '2' },
    { id: 'a', summary: 'Analysiert', updatedAt: '3' },
  ]);
  assert.deepEqual(git(work, 'log', '-2', '--format=%s').trim().split(/\r?\n/), ['Gedankenraum: ideas.json zusammengeführt', 'Gedankenraum: ideas.json aktualisiert']);
  assert.deepEqual(await gitStatus(file), { available: true, branch: 'main', upstream: 'origin/main', changed: false, ahead: 2, behind: 0, foreign: 0 });
});

test('pull aborts when another file conflicts and leaves an unreadable ideas.json alone', async () => {
  const { work, file, clone } = repository();
  const other = clone('other');
  writeFileSync(join(other, 'notes.txt'), 'Remote\n');
  writeFileSync(join(other, 'ideas.json'), ideas({ id: 'remote' }));
  git(other, 'commit', '-am', 'Anderswo');
  git(other, 'push');
  writeFileSync(join(work, 'notes.txt'), 'Lokal\n');
  git(work, 'commit', '-am', 'Hier');
  const head = git(work, 'rev-parse', 'HEAD');
  const conflict = await pullRemote(file);
  assert.equal(conflict.pulled, 0);
  assert.match(conflict.error, /Konflikt in notes\.txt/);
  assert.equal(git(work, 'rev-parse', 'HEAD'), head);
  assert.equal(git(work, 'status', '--porcelain').trim(), '');

  git(work, 'reset', '--hard', 'origin/main~1');
  const before = git(work, 'rev-parse', 'HEAD');
  writeFileSync(file, '{ kaputt');
  const broken = await pullRemote(file);
  assert.equal(broken.pulled, 0);
  assert.ok(broken.error);
  assert.equal(git(work, 'rev-parse', 'HEAD'), before);
  assert.equal(readFileSync(file, 'utf8'), '{ kaputt');
});

test('pull survives an unreachable remote', async () => {
  const { work, file } = repository();
  git(work, 'remote', 'set-url', 'origin', join(work, '..', 'fehlt.git'));
  const offline = await pullRemote(file);
  assert.equal(offline.pulled, 0);
  assert.ok(offline.error);
});

test('the launch fetch gives up after the given timeout', async () => {
  const { file } = repository();
  const slow = await pullRemote(file, 1);
  assert.equal(slow.pulled, 0);
  assert.match(slow.error, /nicht rechtzeitig/);
});
