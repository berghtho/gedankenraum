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

test('authenticated HTTP room and reflection workflow persists sources and accepts one suggestion', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gedankenraum-reflection-http-'));
  const local = createLocalAnalyzer();
  const app = createGedankenraumServer({ statePath: join(directory, 'ideas.json'), settingsPath: join(directory, 'settings.json'), token: 'test-token', analyzer: {
    ...local, reflect: async ({ sources }) => ({ summary: 'Vergleich', findings: [{ text: 'Gemeinsame Frage', sourceIds: sources.map((source) => source.id) }] }),
  } });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`; app.setOrigin(origin);
  const execute = async (command) => {
    const response = await fetch(`${origin}/api/ideas/execute`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-gedankenraum-token': 'test-token' }, body: JSON.stringify(command) });
    assert.equal(response.status, 200); return response.json();
  };
  try {
    assert.equal((await fetch(`${origin}/workspace-ui.mjs`)).status, 200);
    assert.equal((await fetch(`${origin}/inline-thought.mjs`)).status, 200);
    const { room } = await execute({ type: 'roomCreate', question: 'Welche Steuerung?' });
    const a = (await execute({ type: 'capture', input: 'Direkte Steuerung', roomId: room.id })).idea;
    const b = (await execute({ type: 'capture', input: 'Automatische Steuerung', roomId: room.id })).idea;
    const { reflection } = await execute({ type: 'reflect', kind: 'commonalities', ideaIds: [a.id, b.id], roomId: room.id });
    let state;
    for (let i = 0; i < 100; i++) {
      state = await fetch(`${origin}/api/ideas`).then((response) => response.json());
      if (state.reflections[0].status !== 'pending') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(state.reflections[0].status, 'ready');
    const accepted = await execute({ type: 'acceptReflection', id: reflection.id, index: 0 });
    assert.ok(accepted.rooms[0].ideaIds.includes(accepted.idea.id));
    const again = await execute({ type: 'acceptReflection', id: reflection.id, index: 0 });
    assert.equal(again.ideas.length, 3);
    assert.equal(JSON.parse(readFileSync(join(directory, 'ideas.json'), 'utf8')).reflections[0].sources.length, 2);
  } finally { await new Promise((resolve) => app.server.close(resolve)); }
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
    assert.match(await page.text(), /<title>Gedankenraum<\/title>/);

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
    const imported = await fetch(`${origin}/api/ideas/import`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'x-gedankenraum-token': 'secret' },
      body: JSON.stringify({
        version: 1,
        ideas: [snapshot.ideas[0], { ...snapshot.ideas[0], id: 'imported', title: 'Importierter Gedanke' }],
      }),
    });
    assert.equal(imported.status, 200);
    const importResult = await imported.json();
    assert.equal(importResult.imported, 1);
    assert.equal(importResult.skipped, 1);
    assert.equal(importResult.ideas.length, 2);
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
    assert.equal(JSON.parse(readFileSync(join(externalDirectory, 'ideas.json'), 'utf8')).ideas.length, 3);
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

test('HTTP capture returns persisted pending data while analysis waits; edits and trash remain usable', { timeout: 4000 }, async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const statePath = join(mkdtempSync(join(tmpdir(), 'gedankenraum-http-pending-')), 'ideas.json');
  const app = createGedankenraumServer({
    statePath, token: 'test',
    analyzer: { status: async () => ({ available: true }), analyze: async () => { await gate; return { title: 'KI', summary: 'KI Text' }; } },
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  app.setOrigin(origin);
  const post = async (command) => {
    const response = await fetch(`${origin}/api/ideas/execute`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-gedankenraum-token': 'test' }, body: JSON.stringify(command),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    const captured = await post({ type: 'capture', input: 'Gedanke' });
    assert.equal(captured.idea.analysisState, 'pending');
    assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).ideas[0].input, 'Gedanke');
    const edited = await post({ type: 'edit', id: captured.idea.id, fields: { title: 'Mein Titel' } });
    assert.equal(edited.idea.title, 'Mein Titel');
    const deleted = await post({ type: 'delete', id: captured.idea.id });
    assert.equal(deleted.ideas.length, 0);
    assert.equal(deleted.trash.length, 1);
    const restored = await post({ type: 'undo' });
    assert.equal(restored.ideas[0].title, 'Mein Titel');
    for (const asset of ['mindmap.mjs', 'thinking-tools.mjs', 'search.mjs']) assert.equal((await fetch(`${origin}/${asset}`)).status, 200);
  } finally {
    release();
    app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
  }
});
