import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';

import { atomicReplaceText } from './atomic-file.mjs';
import { createCodexAnalyzer } from './codex-analysis.mjs';
import { IdeaBoard, IdeaBoardValidationError } from './idea-board.mjs';
import { createIdeaLinkReader } from './idea-link-reader.mjs';

const sourceHome = dirname(fileURLToPath(import.meta.url));

export function defaultAppDirectory(env = process.env, platform = process.platform) {
  const home = platform === 'win32' && env.LOCALAPPDATA
    ? join(env.LOCALAPPDATA, 'Gedankenraum')
    : join(homedir(), '.gedankenraum');
  return resolve(home);
}

export function defaultStatePath(env = process.env, platform = process.platform) {
  return join(resolve(env.GEDANKENRAUM_HOME || defaultAppDirectory(env, platform)), 'ideas.json');
}

export function defaultSettingsPath(env = process.env, platform = process.platform) {
  return join(defaultAppDirectory(env, platform), 'settings.json');
}

export function configuredStatePath(env = process.env, platform = process.platform) {
  if (env.GEDANKENRAUM_HOME) return defaultStatePath(env, platform);
  const settingsPath = defaultSettingsPath(env, platform);
  if (!existsSync(settingsPath)) return defaultStatePath(env, platform);
  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch {
    throw new Error(`Die Einstellungen in ${settingsPath} konnten nicht gelesen werden.`);
  }
  if (settings?.version !== 1 || typeof settings.directory !== 'string' || !isAbsolute(settings.directory)) {
    throw new Error(`Die Einstellungen in ${settingsPath} enthalten keinen gültigen Speicherort.`);
  }
  const directory = resolve(settings.directory);
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error(`Der konfigurierte Speicherort ${directory} ist nicht verfügbar.`);
  }
  return join(directory, 'ideas.json');
}

function writeStorageSettings(settingsPath, directory) {
  atomicReplaceText(settingsPath, `${JSON.stringify({ version: 1, directory }, null, 2)}\n`);
}

function browseForDirectory(initialDirectory, platform = process.platform) {
  if (platform !== 'win32') throw new IdeaBoardValidationError('Die Ordnerauswahl ist auf diesem System nicht verfügbar.');
  const script = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = 'Speicherort für ideas.json wählen'",
    '$initial = $env:GEDANKENRAUM_INITIAL_DIRECTORY',
    'if ($initial -and (Test-Path -LiteralPath $initial -PathType Container)) { $dialog.SelectedPath = $initial }',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.SelectedPath) }',
  ].join('; ');
  return new Promise((resolveSelection, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, GEDANKENRAUM_INITIAL_DIRECTORY: initialDirectory ?? '' },
    }, (error, stdout) => {
      if (error) return reject(new Error('Die Windows-Ordnerauswahl konnte nicht geöffnet werden.'));
      return resolveSelection(stdout.trim() || null);
    });
  });
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

function claimInstance(lockPath) {
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
  settingsPath = defaultSettingsPath(),
  storageConfigurable = !process.env.GEDANKENRAUM_HOME,
  selectDirectory = browseForDirectory,
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
      if (req.method === 'GET' && url.pathname === '/api/storage') {
        return writeJson(res, 200, {
          directory: dirname(board.path),
          filePath: board.path,
          configurable: storageConfigurable,
          canBrowse: storageConfigurable && process.platform === 'win32',
        });
      }
      if (req.method === 'POST' && url.pathname === '/api/storage/browse') {
        const refusal = guard(req);
        if (refusal) return writeJson(res, 403, { error: refusal });
        if (!storageConfigurable) throw new IdeaBoardValidationError('Der Speicherort wird durch GEDANKENRAUM_HOME festgelegt.');
        const { initialDirectory } = await readBody(req);
        return writeJson(res, 200, { directory: await selectDirectory(initialDirectory) });
      }
      if (req.method === 'POST' && url.pathname === '/api/storage') {
        const refusal = guard(req);
        if (refusal) return writeJson(res, 403, { error: refusal });
        if (!storageConfigurable) throw new IdeaBoardValidationError('Der Speicherort wird durch GEDANKENRAUM_HOME festgelegt.');
        const { directory, mode } = await readBody(req);
        if (typeof directory !== 'string' || !directory.trim() || !isAbsolute(directory.trim())) {
          throw new IdeaBoardValidationError('Bitte einen vollständigen Ordnerpfad angeben.');
        }
        if (mode !== undefined && !['merge', 'replace'].includes(mode)) {
          throw new IdeaBoardValidationError('Unbekannte Auswahl für die vorhandene Datendatei.');
        }
        const nextDirectory = resolve(directory.trim());
        if (!existsSync(nextDirectory) || !statSync(nextDirectory).isDirectory()) {
          throw new IdeaBoardValidationError('Der gewählte Ordner existiert nicht.');
        }
        const nextPath = join(nextDirectory, 'ideas.json');
        const previousPath = board.path;
        if (nextPath !== previousPath && existsSync(nextPath) && !mode) {
          return writeJson(res, 409, {
            error: 'Am gewählten Speicherort existiert bereits eine ideas.json.',
            requiresDecision: true,
            filePath: nextPath,
          });
        }
        const result = await board.switchStorage(nextPath, mode ?? 'open');
        try {
          writeStorageSettings(settingsPath, nextDirectory);
        } catch (error) {
          await board.switchStorage(previousPath);
          throw error;
        }
        return writeJson(res, 200, { ...result, directory: nextDirectory, filePath: board.path });
      }
      if (req.method === 'POST' && url.pathname === '/api/ideas/execute') {
        const refusal = guard(req);
        if (refusal) return writeJson(res, 403, { error: refusal });
        return writeJson(res, 200, await board.execute(await readBody(req, 256 * 1024)));
      }
      if (req.method === 'POST' && url.pathname === '/api/ideas/import') {
        const refusal = guard(req);
        if (refusal) return writeJson(res, 403, { error: refusal });
        return writeJson(res, 200, await board.importState(await readBody(req, 10 * 1024 * 1024)));
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
  const statePath = configuredStatePath();
  const instance = claimInstance(join(defaultAppDirectory(), '.instance.json'));
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
