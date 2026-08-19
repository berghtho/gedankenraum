import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('Windows launcher accepts the installed supported Node version', { skip: process.platform !== 'win32' }, () => {
  const repository = dirname(dirname(fileURLToPath(import.meta.url)));
  const result = spawnSync('cmd.exe', ['/d', '/c', join(repository, 'Gedankenraum.cmd'), '--check'], {
    cwd: repository,
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /SyntaxError|Expression expected/);
});
