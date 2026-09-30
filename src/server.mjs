import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';

import { atomicReplaceText } from './atomic-file.mjs';
import { createCodexAnalyzer } from './codex-analysis.mjs';
import { commitAndPush, gitStatus, pullFastForward } from './git-sync.mjs';
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

// Windows vergibt Prozess-IDs neu; ob die Instanz noch läuft, zeigt erst ihre Antwort.
async function answersAsGedankenraum(address) {
  try {
    const url = new URL(address);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return false;
    const response = await fetch(`${url.origin}/api/session`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
    return response.ok && (await response.json()).app === 'gedankenraum';
  } catch {
    return false;
  }
}

export async function claimInstance(lockPath) {
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
      // Ohne Adresse startet die Instanz noch.
      if (processIsRunning(existing?.pid) && (!existing.url || await answersAsGedankenraum(existing.url))) {
        return { existing, update() {}, release() {} };
      }
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
  update = null,
} = {}) {
  const board = new IdeaBoard({ path: statePath, analyze: analyzer.analyze, reflect: analyzer.reflect, research: analyzer.research, readLink });
  let expectedOrigin = null;
  let expectedHost = null;
  let requestShutdown = () => {};
  let pushing = null;
  const assets = new Map([
    ['/', { path: join(sourceHome, 'index.html'), type: 'text/html; charset=utf-8' }],
    ['/app.mjs', { path: join(sourceHome, 'app.mjs'), type: 'text/javascript; charset=utf-8' }],
    ['/mindmap.mjs', { path: join(sourceHome, 'mindmap.mjs'), type: 'text/javascript; charset=utf-8' }],
    ['/thinking-tools.mjs', { path: join(sourceHome, 'thinking-tools.mjs'), type: 'text/javascript; charset=utf-8' }],
    ['/workspace-ui.mjs', { path: join(sourceHome, 'workspace-ui.mjs'), type: 'text/javascript; charset=utf-8' }],
    ['/inline-thought.mjs', { path: join(sourceHome, 'inline-thought.mjs'), type: 'text/javascript; charset=utf-8' }],
    ['/search.mjs', { path: join(sourceHome, 'search.mjs'), type: 'text/javascript; charset=utf-8' }],
    ['/tag-match.mjs', { path: join(sourceHome, 'tag-match.mjs'), type: 'text/javascript; charset=utf-8' }],
    ['/tag-cleanup.mjs', { path: join(sourceHome, 'tag-cleanup.mjs'), type: 'text/javascript; charset=utf-8' }],
    ['/thought-kinds.mjs', { path: join(sourceHome, 'thought-kinds.mjs'), type: 'text/javascript; charset=utf-8' }],
    ['/room-summary.mjs', { path: join(sourceHome, 'room-summary.mjs'), type: 'text/javascript; charset=utf-8' }],
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
        // Unverändert: kein Snapshot, der Client behält seinen Stand.
        if (url.searchParams.get('since') === board.revision()) {
          res.writeHead(204, { 'cache-control': 'no-store' });
          return res.end();
        }
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
        // Windows-Pfade unterscheiden nicht zwischen Groß- und Kleinschreibung.
        const samePath = process.platform === 'win32' ? nextPath.toLowerCase() === previousPath.toLowerCase() : nextPath === previousPath;
        if (!samePath && existsSync(nextPath) && !mode) {
          return writeJson(res, 409, {
            error: 'Am gewählten Speicherort existiert bereits eine ideas.json.',
            requiresDecision: true,
            filePath: nextPath,
          });
        }
        // Erst die Einstellung, dann die Daten: Scheitert die Einstellung, ist die Zieldatei noch unberührt.
        const previousSettings = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : null;
        writeStorageSettings(settingsPath, nextDirectory);
        let result;
        try {
          result = await board.switchStorage(nextPath, mode ?? 'open');
        } catch (error) {
          try {
            if (previousSettings === null) rmSync(settingsPath, { force: true });
            else atomicReplaceText(settingsPath, previousSettings);
          } catch { /* Beide Dateien bleiben erhalten; nur der Speicherort beim nächsten Start weicht ab. */ }
          throw error;
        }
        return writeJson(res, 200, { ...result, directory: nextDirectory, filePath: board.path });
      }
      if (req.method === 'GET' && url.pathname === '/api/git') {
        return writeJson(res, 200, { ...(await gitStatus(board.path)), update });
      }
      if (req.method === 'POST' && url.pathname === '/api/git/push') {
        const refusal = guard(req);
        if (refusal) return writeJson(res, 403, { error: refusal });
        await readBody(req);
        if (pushing) throw new IdeaBoardValidationError('Push läuft bereits.');
        pushing = commitAndPush(board.path).finally(() => { pushing = null; });
        return writeJson(res, 200, await pushing);
      }
      if (req.method === 'POST' && url.pathname === '/api/ideas/execute') {
        const refusal = guard(req);
        if (refusal) return writeJson(res, 403, { error: refusal });
        return writeJson(res, 200, await board.execute(await readBody(req, 256 * 1024)));
      }
      if (req.method === 'POST' && url.pathname === '/api/tags/suggest') {
        const refusal = guard(req);
        if (refusal) return writeJson(res, 403, { error: refusal });
        await readBody(req);
        if (!analyzer.suggestTagMerges) throw new IdeaBoardValidationError('Tag-Vorschläge sind nicht verfügbar.');
        // Nur Tag-Namen und Häufigkeiten aus der Sammlung gehen an Codex, keine Gedanken.
        const counts = new Map();
        for (const idea of board.snapshot().ideas) for (const tag of idea.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
        if (counts.size < 2) return writeJson(res, 200, { groups: [] });
        const tags = [...counts].sort(([, left], [, right]) => right - left).map(([name, count]) => ({ name, count }));
        return writeJson(res, 200, await analyzer.suggestTagMerges({ tags }));
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
    board.stop();
    await analyzer.stop?.();
    server.close();
  };
  return {
    server,
    statePath,
    setOrigin(origin) {
      expectedOrigin = origin;
      expectedHost = new URL(origin).host;
      board.resumeAnalysis();
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
  const instance = await claimInstance(join(defaultAppDirectory(), '.instance.json'));
  if (instance.existing) {
    console.log('Gedankenraum läuft bereits.');
    if (open && instance.existing.url) openBrowser(instance.existing.url);
    return { existing: true, statePath, url: instance.existing.url ?? null };
  }
  // Vor dem ersten Lesen und Schreiben, damit keine Analyse in das Update hineinschreibt.
  const update = await pullFastForward(statePath);
  if (update?.error) console.log(`Nicht aktualisiert: ${update.error}`);
  else if (update?.pulled) console.log(`Aktualisiert: ${update.pulled} Commit${update.pulled === 1 ? '' : 's'} aus ${update.upstream} geholt.`);
  const app = createGedankenraumServer({ statePath, update });
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
