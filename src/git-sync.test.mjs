import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { commitAndPush, gitStatus } from './git-sync.mjs';

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
  assert.deepEqual(await gitStatus(file), { available: true, branch: 'main', upstream: 'origin/main', changed: false, ahead: 0 });
});

test('push commits only ideas.json and leaves other changes in the repository alone', async () => {
  const { remote, work, file } = repository();
  writeFileSync(file, '{"version":1,"ideas":[{"id":"a"}]}\n');
  writeFileSync(join(work, 'notes.txt'), 'Geänderte Notiz\n');
  writeFileSync(join(work, 'staged.txt'), 'vorgemerkt\n');
  git(work, 'add', 'staged.txt');
  assert.equal((await gitStatus(file)).changed, true);

  const result = await commitAndPush(file);
  assert.deepEqual(result, { available: true, branch: 'main', upstream: 'origin/main', changed: false, ahead: 0, pushed: true });
  assert.equal(git(remote, 'log', '-1', '--format=%s', 'main').trim(), 'Gedankenraum: ideas.json aktualisiert');
  assert.equal(git(remote, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'main').trim(), 'ideas.json');
  assert.equal(git(remote, 'show', 'main:ideas.json'), '{"version":1,"ideas":[{"id":"a"}]}\n');
  assert.deepEqual(git(work, 'status', '--porcelain').trimEnd().split('\n').sort(), [' M notes.txt', 'A  staged.txt']);
  assert.equal((await commitAndPush(file)).pushed, false);
});

test('a rejected push keeps the local commit and can be pushed again after a pull', async () => {
  const { remote, work, file, clone } = repository();
  const other = clone('other');
  writeFileSync(join(other, 'notes.txt'), 'Von woanders\n');
  git(other, 'commit', '-am', 'Anderswo');
  git(other, 'push');

  writeFileSync(file, '{"version":1,"ideas":[{"id":"b"}]}\n');
  await assert.rejects(commitAndPush(file), /neuere Änderungen.*pullen.*Commit bleibt lokal erhalten/);
  assert.deepEqual(await gitStatus(file), { available: true, branch: 'main', upstream: 'origin/main', changed: false, ahead: 1 });

  git(work, 'pull', '--no-rebase', '--no-edit');
  assert.equal((await gitStatus(file)).ahead, 2);
  assert.equal((await commitAndPush(file)).ahead, 0);
  assert.equal(git(remote, 'show', 'main:ideas.json'), '{"version":1,"ideas":[{"id":"b"}]}\n');
  assert.equal(git(remote, 'show', 'main:notes.txt'), 'Von woanders\n');
});
