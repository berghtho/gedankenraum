import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createLocalAnalyzer } from './local-analysis.mjs';
import { configuredStatePath, createGedankenraumServer, defaultStatePath } from './server.mjs';

const statusWithHost = (port, host) => new Promise((resolve, reject) => {
  const req = request({ hostname: '127.0.0.1', port, path: '/api/ideas', headers: { host } }, (res) => {
    res.resume();
    res.on('end', () => resolve(res.statusCode));
  });
  req.on('error', reject);
  req.end();
});

test('Windows data lives below LOCALAPPDATA unless explicitly configured', () => {
  assert.equal(
    defaultStatePath({ LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local' }, 'win32'),
    'C:\\Users\\Test\\AppData\\Local\\Gedankenraum\\ideas.json',
  );
  assert.equal(
    defaultStatePath({ GEDANKENRAUM_HOME: 'D:\\Meine Gedanken' }, 'win32'),
    'D:\\Meine Gedanken\\ideas.json',
  );
});

test('the configured storage directory is used on the next start', () => {
  const localAppData = mkdtempSync(join(tmpdir(), 'gedankenraum-settings-'));
  const directory = mkdtempSync(join(tmpdir(), 'gedankenraum-onedrive-'));
  const settingsDirectory = join(localAppData, 'Gedankenraum');
  mkdirSync(settingsDirectory);
  writeFileSync(join(settingsDirectory, 'settings.json'), JSON.stringify({ version: 1, directory }));

  assert.equal(configuredStatePath({ LOCALAPPDATA: localAppData }, 'win32'), join(directory, 'ideas.json'));
});

test('the local HTTP interface serves, protects, persists and shuts down', async () => {
  const appDirectory = mkdtempSync(join(tmpdir(), 'gedankenraum-server-'));
  const statePath = join(appDirectory, 'ideas.json');
  const settingsPath = join(appDirectory, 'settings.json');
  const externalDirectory = mkdtempSync(join(tmpdir(), 'gedankenraum-external-'));
  const app = createGedankenraumServer({
    statePath,
    settingsPath,
    token: 'secret',
    analyzer: createLocalAnalyzer(),
    readLink: async () => { throw new Error('not used'); },
    selectDirectory: async () => externalDirectory,
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  app.setOrigin(origin);
  try {
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /GEDANKENRAUM/);

    assert.equal(await statusWithHost(app.server.address().port, 'attacker.example'), 421);

    const refused = await fetch(`${origin}/api/ideas/execute`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'capture', input: 'Ein Gedanke.' }),
    });
    assert.equal(refused.status, 403);

    const accepted = await fetch(`${origin}/api/ideas/execute`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'x-gedankenraum-token': 'secret' },
      body: JSON.stringify({ type: 'capture', input: 'Ein Gedanke mit ausreichend Inhalt für die lokale Analyse.' }),
    });
    assert.equal(accepted.status, 200);
    const snapshot = await fetch(`${origin}/api/ideas`).then((response) => response.json());
    assert.equal(snapshot.ideas.length, 1);
    writeFileSync(join(externalDirectory, 'ideas.json'), `${JSON.stringify({
      version: 1,
      ideas: [{ ...snapshot.ideas[0], id: 'external', title: 'Externer Gedanke' }],
    })}\n`);

    const storage = await fetch(`${origin}/api/storage`).then((response) => response.json());
    assert.equal(storage.filePath, statePath);

    const refusedStorage = await fetch(`${origin}/api/storage`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ directory: externalDirectory }),
    });
    assert.equal(refusedStorage.status, 403);

    const selected = await fetch(`${origin}/api/storage/browse`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'x-gedankenraum-token': 'secret' },
      body: JSON.stringify({ initialDirectory: appDirectory }),
    }).then((response) => response.json());
    assert.equal(selected.directory, externalDirectory);

    const changed = await fetch(`${origin}/api/storage`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'x-gedankenraum-token': 'secret' },
      body: JSON.stringify({ directory: externalDirectory }),
    });
    assert.equal(changed.status, 409);
    assert.equal((await changed.json()).requiresDecision, true);
    assert.equal(JSON.parse(readFileSync(join(externalDirectory, 'ideas.json'), 'utf8')).ideas.length, 1);

    const merged = await fetch(`${origin}/api/storage`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'x-gedankenraum-token': 'secret' },
      body: JSON.stringify({ directory: externalDirectory, mode: 'merge' }),
    });
    assert.equal(merged.status, 200);
    assert.equal((await merged.json()).action, 'merge');
    assert.equal(JSON.parse(readFileSync(join(externalDirectory, 'ideas.json'), 'utf8')).ideas.length, 2);
    assert.equal(JSON.parse(readFileSync(settingsPath, 'utf8')).directory, externalDirectory);

    const closed = new Promise((resolve) => app.server.once('close', resolve));
    const stopped = await fetch(`${origin}/api/shutdown`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'x-gedankenraum-token': 'secret' },
      body: '{}',
    });
    assert.equal(stopped.status, 200);
    await closed;
  } finally {
    if (app.server.listening) {
      app.server.closeAllConnections();
      await new Promise((resolve) => app.server.close(resolve));
    }
  }
});
