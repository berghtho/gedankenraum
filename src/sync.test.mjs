import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { dropDigest } from './inbox.mjs';
import { createLocalAnalyzer } from './local-analysis.mjs';
import { claimInstance } from './server.mjs';
import { syncOnce, syncProblems } from './sync.mjs';

const temp = (name) => mkdtempSync(join(tmpdir(), `gedankenraum-sync-${name}-`));
const digest = { title: 'YouTube AI digest – 2026-10-20', text: '## Theo\n\n- Neues Modell', sourceUrls: ['https://www.youtube.com/watch?v=abc123'] };

// Echtes Git, aber ohne die Git-Konfiguration dieses Rechners.
const gitConfig = join(temp('gitconfig'), 'gitconfig');
writeFileSync(gitConfig, '');
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('a headless sync imports the inbox, analyses, pushes ideas.json and releases its lock', async () => {
  Object.assign(process.env, gitEnv);
  const base = temp('git');
  const seed = join(base, 'seed');
  git(base, 'init', '-b', 'main', seed);
  writeFileSync(join(seed, 'ideas.json'), '{"version":1,"ideas":[]}\n');
  git(seed, 'add', '.'); git(seed, 'commit', '-m', 'Start');
  git(base, 'clone', '--bare', seed, join(base, 'remote.git'));
  git(base, 'clone', join(base, 'remote.git'), join(base, 'runner'));
  const inboxDirectory = join(base, 'runner', 'inbox');
  const lockPath = join(base, 'app', '.instance.json');
  await dropDigest(inboxDirectory, 'digest.json', digest);

  const { report, warnings } = await syncOnce({ statePath: join(base, 'runner', 'ideas.json'), inboxDirectory, analyzer: createLocalAnalyzer(), lockPath, log: () => {} });
  assert.deepEqual(syncProblems(report), []);
  assert.equal(report.push.pushed, true);
  assert.deepEqual(warnings, []);
  git(base, 'clone', join(base, 'remote.git'), join(base, 'check'));
  const [idea] = JSON.parse(readFileSync(join(base, 'check', 'ideas.json'), 'utf8')).ideas;
  assert.equal(idea.title, digest.title);
  assert.equal(idea.analysisState, 'ready');

  // Die Sperre ist wieder frei; ein zweiter Lauf findet einen leeren Eingang.
  assert.deepEqual(await syncOnce({ statePath: join(base, 'runner', 'ideas.json'), inboxDirectory, analyzer: createLocalAnalyzer(), lockPath, log: () => {} }), { report: null, warnings: [] });
});

test('a headless sync leaves the inbox to a running Gedankenraum', async () => {
  const lockPath = join(temp('lock'), '.instance.json');
  const running = await claimInstance(lockPath);
  try {
    assert.deepEqual(await syncOnce({ statePath: join(temp('state'), 'ideas.json'), inboxDirectory: temp('inbox'), analyzer: createLocalAnalyzer(), lockPath }), { running: true });
  } finally { running.release(); }
});

test('sync problems name failed files, pull and push errors and skipped pushes', () => {
  assert.deepEqual(syncProblems(null), []);
  assert.deepEqual(syncProblems({
    entries: [{ file: 'a.json', status: 'failed', error: 'kaputt' }, { file: 'b.json', status: 'imported' }],
    pull: { error: 'offline' }, push: { skipped: 'nicht in Git' },
  }), ['a.json: kaputt', 'Holen: offline', 'Push übersprungen: nicht in Git']);
});
