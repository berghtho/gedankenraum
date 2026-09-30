import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createGedankenraumServer } from './server.mjs';
import { stop } from './stop.mjs';

test('stop closes the authenticated running instance on its actual port', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gedankenraum-stop-'));
  const app = createGedankenraumServer({
    statePath: join(directory, 'ideas.json'),
    settingsPath: join(directory, 'settings.json'),
    analyzer: { analyze: async () => ({}), status: async () => ({}), stop: async () => {} },
  });
  try {
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    const url = `http://127.0.0.1:${app.server.address().port}`;
    app.setOrigin(url);
    const lockPath = join(directory, '.instance.json');
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, url }));
    // Wie beim echten Start gibt der Server die Sperre erst nach dem Schließen frei.
    app.server.once('close', () => setTimeout(() => rm(lockPath), 300));
    const closed = once(app.server, 'close');
    assert.deepEqual(await stop({ appDirectory: directory }), { stopped: true });
    assert.equal(existsSync(lockPath), false);
    await closed;
  } finally {
    app.server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('stop is harmless when no instance exists and refuses nonlocal addresses', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gedankenraum-stop-'));
  try {
    assert.deepEqual(await stop({ appDirectory: directory }), { stopped: false });
    await writeFile(join(directory, '.instance.json'), JSON.stringify({
      pid: process.pid, url: 'https://example.com:7788',
    }));
    await assert.rejects(stop({ appDirectory: directory }), /Adresse ist ungültig/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('stop does not wait forever for a lock that is not released', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gedankenraum-stop-'));
  const app = createGedankenraumServer({
    statePath: join(directory, 'ideas.json'),
    settingsPath: join(directory, 'settings.json'),
    analyzer: { analyze: async () => ({}), status: async () => ({}), stop: async () => {} },
  });
  try {
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    const url = `http://127.0.0.1:${app.server.address().port}`;
    app.setOrigin(url);
    await writeFile(join(directory, '.instance.json'), JSON.stringify({ pid: process.pid, url }));
    const started = Date.now();
    assert.deepEqual(await stop({ appDirectory: directory, wait: 300 }), { stopped: true });
    assert.ok(Date.now() - started >= 250);
  } finally {
    app.server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
