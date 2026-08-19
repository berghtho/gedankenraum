import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

import { atomicReplaceText } from './atomic-file.mjs';
import { createCodexAnalyzer } from './codex-analysis.mjs';
import { IdeaBoard, IdeaBoardValidationError } from './idea-board.mjs';
import { createIdeaLinkReader } from './idea-link-reader.mjs';

const sourceHome = dirname(fileURLToPath(import.meta.url));

export function defaultStatePath(env = process.env, platform = process.platform) {
  const home = env.GEDANKENRAUM_HOME || (platform === 'win32' && env.LOCALAPPDATA
    ? join(env.LOCALAPPDATA, 'Gedankenraum')
    : join(homedir(), '.gedankenraum'));
  return join(resolve(home), 'ideas.json');
}

function writeJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

async function readBody(req, limit = 16 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new IdeaBoardValidationError('Anfrage ist zu groß.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new IdeaBoardValidationError('Anfrage enthält kein gültiges JSON.');
  }
}

function openBrowser(url, platform = process.platform) {
  const [command, args] = platform === 'win32'
    ? ['explorer.exe', [url]]
    : platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function claimInstance(statePath) {
  const lockPath = join(dirname(statePath), '.instance.json');
  mkdirSync(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = openSync(lockPath, 'wx');
      const identity = randomBytes(12).toString('hex');
      let url = null;
      writeFileSync(descriptor, `${JSON.stringify({ identity, pid: process.pid, url })}\n`, 'utf8');
      closeSync(descriptor);
      return {
        existing: null,
        update(nextUrl) {
          url = nextUrl;
          atomicReplaceText(lockPath, `${JSON.stringify({ identity, pid: process.pid, url })}\n`);
        },
        release() {
          try {
            const current = JSON.parse(readFileSync(lockPath, 'utf8'));
            if (current.identity === identity) unlinkSync(lockPath);
          } catch { /* A missing or replaced lock no longer belongs to this process. */ }
        },
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let existing = null;
      try { existing = JSON.parse(readFileSync(lockPath, 'utf8')); } catch { /* Incomplete stale lock. */ }
      if (processIsRunning(existing?.pid)) return { existing, update() {}, release() {} };
      try { unlinkSync(lockPath); } catch (unlinkError) {
        if (unlinkError.code !== 'ENOENT') throw unlinkError;
      }
    }
  }
  throw new Error('Die vorhandene Gedankenraum-Instanz konnte nicht geprüft werden.');
}

export function createGedankenraumServer({
  statePath = defaultStatePath(),
  token = randomBytes(24).toString('hex'),
  analyzer = createCodexAnalyzer(),
  readLink = createIdeaLinkReader(),
} = {}) {
  const board = new IdeaBoard({ path: statePath, analyze: analyzer.analyze, readLink });
  let expectedOrigin = null;
  let expectedHost = null;
  let requestShutdown = () => {};
  const assets = new Map([
    ['/', { path: join(sourceHome, 'index.html'), type: 'text/html; charset=utf-8' }],
    ['/app.mjs', { path: join(sourceHome, 'app.mjs'), type: 'text/javascript; charset=utf-8' }],
    ['/style.css', { path: join(sourceHome, 'style.css'), type: 'text/css; charset=utf-8' }],
  ]);

  const guard = (req) => {
    if (req.headers.origin !== expectedOrigin) return 'Anfrage stammt nicht aus Gedankenraum.';
    if (req.headers['x-gedankenraum-token'] !== token) return 'Sitzung ist nicht mehr gültig.';
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) return 'JSON wird erwartet.';
    return null;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, expectedOrigin ?? 'http://127.0.0.1');
    try {
      if (!expectedHost || req.headers.host !== expectedHost) {
        return writeJson(res, 421, { error: 'Ungültiges lokales Ziel.' });
      }
      if (req.method === 'GET' && url.pathname === '/api/session') {
        return writeJson(res, 200, { app: 'gedankenraum', token });
      }
      if (req.method === 'GET' && url.pathname === '/api/ideas') {
        return writeJson(res, 200, board.snapshot());
      }
      if (req.method === 'GET' && url.pathname === '/api/ideas/status') {
        return writeJson(res, 200, await analyzer.status());
      }
      if (req.method === 'POST' && url.pathname === '/api/ideas/execute') {
        const refusal = guard(req);
        if (refusal) return writeJson(res, 403, { error: refusal });
        return writeJson(res, 200, await board.execute(await readBody(req)));
      }
      if (req.method === 'POST' && url.pathname === '/api/shutdown') {
        const refusal = guard(req);
        if (refusal) return writeJson(res, 403, { error: refusal });
        writeJson(res, 200, { stopped: true });
        setImmediate(() => requestShutdown().catch(() => server.close()));
        return;
      }
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const asset = assets.get(url.pathname);
        const contents = await readFile(asset.path);
        res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-store' });
        return res.end(contents);
      }
      return writeJson(res, 404, { error: 'Nicht gefunden.' });
    } catch (error) {
      const code = error instanceof IdeaBoardValidationError ? 400 : 500;
      return writeJson(res, code, { error: error.message || 'Unbekannter Fehler.' });
    }
  });

  requestShutdown = async () => {
    await analyzer.stop?.();
    server.close();
  };
  return {
    server,
    statePath,
    setOrigin(origin) {
      expectedOrigin = origin;
      expectedHost = new URL(origin).host;
    },
  };
}

async function listen(server, preferredPort) {
  for (let port = preferredPort; port < preferredPort + 20; port += 1) {
    const listening = await new Promise((resolveAttempt) => {
      const onError = (error) => {
        server.off('listening', onListening);
        resolveAttempt(error.code === 'EADDRINUSE' ? null : error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolveAttempt(port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    });
    if (Number.isInteger(listening)) return listening;
    if (listening instanceof Error) throw listening;
  }
  throw new Error('Kein freier lokaler Port gefunden.');
}

export async function start({ open = false, preferredPort = Number(process.env.GEDANKENRAUM_PORT) || 7788 } = {}) {
  const statePath = defaultStatePath();
  const instance = claimInstance(statePath);
  if (instance.existing) {
    console.log('Gedankenraum läuft bereits.');
    if (open && instance.existing.url) openBrowser(instance.existing.url);
    return { existing: true, statePath, url: instance.existing.url ?? null };
  }
  const app = createGedankenraumServer({ statePath });
  app.server.once('close', instance.release);
  try {
    const port = await listen(app.server, preferredPort);
    const url = `http://127.0.0.1:${port}`;
    app.setOrigin(url);
    instance.update(url);
    console.log(`Gedankenraum: ${url}`);
    console.log(`Daten: ${app.statePath}`);
    console.log('Zum Beenden oben rechts auf BEENDEN klicken.');
    if (open) openBrowser(url);
    return { ...app, url };
  } catch (error) {
    instance.release();
    throw error;
  }
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  start({ open: process.argv.includes('--open') }).catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
