import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createLocalAnalyzer } from './local-analysis.mjs';
import { createGedankenraumServer, defaultStatePath } from './server.mjs';

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

test('the local HTTP interface serves, protects, persists and shuts down', async () => {
  const statePath = join(mkdtempSync(join(tmpdir(), 'gedankenraum-server-')), 'ideas.json');
  const app = createGedankenraumServer({
    statePath,
    token: 'secret',
    analyzer: createLocalAnalyzer(),
    readLink: async () => { throw new Error('not used'); },
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
