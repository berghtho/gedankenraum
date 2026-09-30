import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createLocalAnalyzer } from './local-analysis.mjs';
import { claimInstance, configuredStatePath, createGedankenraumServer, defaultStatePath } from './server.mjs';

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

test('tag suggestions send only tag names with their counts and need a session', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gedankenraum-tags-http-'));
  let seen;
  const app = createGedankenraumServer({ statePath: join(directory, 'ideas.json'), settingsPath: join(directory, 'settings.json'), token: 'test-token', analyzer: {
    ...createLocalAnalyzer(), suggestTagMerges: async (request) => { seen = request; return { groups: [{ into: 'KI', tags: ['KI', 'AI'], reason: 'Übersetzung' }], engine: 'Test' }; },
  } });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`; app.setOrigin(origin);
  const post = (path, body) => fetch(`${origin}${path}`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-gedankenraum-token': 'test-token' }, body: JSON.stringify(body) });
  try {
    const a = (await (await post('/api/ideas/execute', { type: 'capture', input: 'Geheimer Gedanke' })).json()).idea;
    const b = (await (await post('/api/ideas/execute', { type: 'capture', input: 'Noch ein Gedanke' })).json()).idea;
    await post('/api/ideas/execute', { type: 'retag', id: a.id, tags: ['KI', 'AI'] });
    await post('/api/ideas/execute', { type: 'retag', id: b.id, tags: ['KI'] });
    const response = await post('/api/tags/suggest', {});
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).groups[0].tags, ['KI', 'AI']);
    assert.deepEqual(seen.tags, [{ name: 'KI', count: 2 }, { name: 'AI', count: 1 }]);
    assert.ok(!JSON.stringify(seen).includes('Geheimer'));
    const refused = await fetch(`${origin}/api/tags/suggest`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(refused.status, 403);
  } finally {
    app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
  }
});

test('git push needs a session and is not offered outside a git repository; the launch update is reported', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gedankenraum-git-http-'));
  const update = { upstream: 'origin/main', pulled: 2 };
  const app = createGedankenraumServer({ statePath: join(directory, 'ideas.json'), settingsPath: join(directory, 'settings.json'), token: 'test-token', analyzer: createLocalAnalyzer(), update });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`; app.setOrigin(origin);
  try {
    const git = await fetch(`${origin}/api/git`).then((response) => response.json());
    assert.equal(git.available, false);
    assert.deepEqual(git.update, update);
    const refused = await fetch(`${origin}/api/git/push`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(refused.status, 403);
    const failed = await fetch(`${origin}/api/git/push`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-gedankenraum-token': 'test-token' }, body: '{}' });
    assert.equal(failed.status, 500);
    assert.ok((await failed.json()).error);
  } finally {
    app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
  }
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
    // Jedes Modul, das der Browser ab app.mjs importiert, muss ausgeliefert werden.
    const pending = ['app.mjs'];
    const served = new Set();
    while (pending.length) {
      const asset = pending.pop();
      if (served.has(asset)) continue;
      const response = await fetch(`${origin}/${asset}`);
      assert.equal(response.status, 200, asset);
      served.add(asset);
      for (const [, name] of (await response.text()).matchAll(/from '\.\/([\w-]+\.mjs)'/g)) pending.push(name);
    }
    assert.ok(served.has('util.mjs'));
  } finally {
    release();
    app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
  }
});

test('a lock of a reused process ID does not block the start; a running or starting instance does', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gedankenraum-instance-'));
  const lockPath = join(directory, '.instance.json');
  const lock = (url) => writeFileSync(lockPath, JSON.stringify({ identity: 'alt', pid: process.pid, url }));
  const other = createServer((req, res) => { res.writeHead(404); res.end(); });
  await new Promise((resolve) => other.listen(0, '127.0.0.1', resolve));
  const app = createGedankenraumServer({ statePath: join(directory, 'ideas.json'), settingsPath: join(directory, 'settings.json'), analyzer: createLocalAnalyzer() });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const running = `http://127.0.0.1:${app.server.address().port}`; app.setOrigin(running);
  try {
    lock(null);
    assert.equal((await claimInstance(lockPath)).existing.pid, process.pid);
    lock(running);
    assert.equal((await claimInstance(lockPath)).existing.url, running);

    lock(`http://127.0.0.1:${other.address().port}`);
    const claimed = await claimInstance(lockPath);
    assert.equal(claimed.existing, null);
    assert.notEqual(JSON.parse(readFileSync(lockPath, 'utf8')).identity, 'alt');
    claimed.release();
    assert.equal(existsSync(lockPath), false);
  } finally {
    other.close();
    app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
  }
});

test('choosing the current storage directory in other letter case is no conflict on Windows', { skip: process.platform !== 'win32' }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gedankenraum-case-'));
  const app = createGedankenraumServer({ statePath: join(directory, 'ideas.json'), settingsPath: join(directory, 'settings.json'), token: 'test-token', analyzer: createLocalAnalyzer(), storageConfigurable: true });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`; app.setOrigin(origin);
  const post = (path, body) => fetch(`${origin}${path}`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-gedankenraum-token': 'test-token' }, body: JSON.stringify(body) });
  try {
    await post('/api/ideas/execute', { type: 'capture', input: 'Ein Gedanke' });
    const response = await post('/api/storage', { directory: directory.toUpperCase() });
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(readFileSync(join(directory, 'ideas.json'), 'utf8')).ideas.length, 1);
  } finally {
    app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
  }
});

test('a failed storage switch leaves the target file and the saved location as they were', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gedankenraum-switch-fail-'));
  const target = mkdtempSync(join(tmpdir(), 'gedankenraum-switch-target-'));
  const targetContent = `${JSON.stringify({ version: 1, ideas: [{ id: 'dort', title: 'Dort', input: 'Dort' }] })}\n`;
  writeFileSync(join(target, 'ideas.json'), targetContent);
  // Die Einstellungen lassen sich nicht schreiben: Ihr Ordner ist eine Datei.
  writeFileSync(join(directory, 'blockiert'), '');
  const start = async (settingsPath) => {
    const app = createGedankenraumServer({ statePath: join(directory, 'ideas.json'), settingsPath, token: 'test-token', analyzer: createLocalAnalyzer(), storageConfigurable: true });
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${app.server.address().port}`; app.setOrigin(origin);
    const post = (path, body) => fetch(`${origin}${path}`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-gedankenraum-token': 'test-token' }, body: JSON.stringify(body) });
    const close = async () => { app.server.closeAllConnections(); await new Promise((resolve) => app.server.close(resolve)); };
    return { origin, post, close };
  };
  const blocked = await start(join(directory, 'blockiert', 'settings.json'));
  try {
    await blocked.post('/api/ideas/execute', { type: 'capture', input: 'Hier' });
    const replaced = await blocked.post('/api/storage', { directory: target, mode: 'replace' });
    assert.equal(replaced.status, 500);
    assert.equal(readFileSync(join(target, 'ideas.json'), 'utf8'), targetContent);
    assert.equal((await fetch(`${blocked.origin}/api/storage`).then((response) => response.json())).filePath, join(directory, 'ideas.json'));
  } finally { await blocked.close(); }

  const settingsPath = join(directory, 'settings.json');
  const settings = `${JSON.stringify({ version: 1, directory })}\n`;
  writeFileSync(settingsPath, settings);
  writeFileSync(join(target, 'ideas.json'), 'kein JSON');
  const broken = await start(settingsPath);
  try {
    assert.notEqual((await broken.post('/api/storage', { directory: target, mode: 'merge' })).status, 200);
    assert.equal(readFileSync(settingsPath, 'utf8'), settings);
  } finally { await broken.close(); }
});

test('polling with the known revision answers 204 without a body until the board changes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gedankenraum-since-'));
  const app = createGedankenraumServer({ statePath: join(directory, 'ideas.json'), settingsPath: join(directory, 'settings.json'), token: 'test-token', analyzer: createLocalAnalyzer() });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`; app.setOrigin(origin);
  const since = (revision) => fetch(`${origin}/api/ideas?since=${encodeURIComponent(revision)}`);
  try {
    const { revision } = await fetch(`${origin}/api/ideas`).then((response) => response.json());
    const unchanged = await since(revision);
    assert.equal(unchanged.status, 204);
    assert.equal(await unchanged.text(), '');
    assert.equal((await since('veraltet')).status, 200);
    await fetch(`${origin}/api/ideas/execute`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-gedankenraum-token': 'test-token' }, body: JSON.stringify({ type: 'capture', input: 'Neu' }) });
    const changed = await since(revision);
    assert.equal(changed.status, 200);
    const snapshot = await changed.json();
    assert.notEqual(snapshot.revision, revision);
    assert.equal(snapshot.ideas.length, 1);
  } finally {
    app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
  }
});
