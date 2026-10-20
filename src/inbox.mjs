import { watch } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { atomicReplaceText } from './atomic-file.mjs';

// Digest-Eingang: Andere Programme (etwa ein geplanter Agent) legen Digests als JSON-Dateien in einen Ordner.
// Gedankenraum übernimmt sie beim Start und, solange es läuft, sobald sie erscheinen:
// erst holen (Fast-Forward), dann übernehmen, nach der Analyse ideas.json pushen.
// Verarbeitete Dateien wandern nach done/, ungültige nach failed/; nichts wird gelöscht.
// Scheitert der Push, merkt sich der Eingang das in .push-pending und versucht es beim nächsten Lauf erneut,
// auch wenn keine neue Datei kommt.
export const INBOX_FORMAT = 'gedankenraum-inbox';
const SETTLE_MS = 10_000;
const PUSH_PENDING = '.push-pending';

export function defaultInboxDirectory(env = process.env) {
  if (env.GEDANKENRAUM_INBOX) return resolve(env.GEDANKENRAUM_INBOX);
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '.gedankenraum', 'inbox');
}

export class InboxEntryError extends Error {}

// Format: { "format": "gedankenraum-inbox", "version": 1, "type": "digest", "title": "…", "text": "…", "sourceUrls": ["https://…"] }
export function inboxCommand(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new InboxEntryError('Die Datei enthält kein JSON-Objekt.');
  if (entry.format !== INBOX_FORMAT || entry.version !== 1) throw new InboxEntryError(`Erwartet wird format "${INBOX_FORMAT}" mit version 1.`);
  if (entry.type !== 'digest') throw new InboxEntryError('Nur type "digest" wird unterstützt.');
  if (typeof entry.title !== 'string' || typeof entry.text !== 'string') throw new InboxEntryError('title und text müssen Texte sein.');
  if (entry.sourceUrls !== undefined && !Array.isArray(entry.sourceUrls)) throw new InboxEntryError('sourceUrls muss eine Liste sein.');
  return { type: 'capture', source: 'digest', title: entry.title, input: entry.text, sourceUrls: entry.sourceUrls ?? [] };
}

const sameDigest = (idea, command) => !idea.deletedAt && idea.source === 'digest'
  && idea.title === command.title.trim().replace(/\s+/g, ' ') && idea.input === command.input.replace(/\r\n?/g, '\n').trim();

async function moveTo(directory, folder, name) {
  const target = join(directory, folder);
  await mkdir(target, { recursive: true });
  let destination = join(target, name);
  // Gleichnamige Altfälle bleiben erhalten.
  for (let index = 1; await stat(destination).then(() => true, () => false); index += 1) {
    destination = join(target, name.replace(/\.json$/i, `.${index}.json`));
  }
  await rename(join(directory, name), destination);
  return destination;
}

export function createInbox({
  board, directory = defaultInboxDirectory(), pull = async () => null, push = async () => null,
  analysisTimeout = 15 * 60_000, now = () => Date.now(), log = () => {},
}) {
  let running = null;
  let again = false;
  let watcher = null;
  let timer = null;
  let stopped = false;
  let wake = () => {};

  async function pending() {
    let names;
    try { names = await readdir(directory); } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    return names.filter((name) => /\.json$/i.test(name) && !name.startsWith('.')).sort();
  }

  const marker = () => join(directory, PUSH_PENDING);

  async function processOnce() {
    const names = await pending();
    const retry = await stat(marker()).then(() => true, () => false);
    if (!names.length && !retry) return null;
    const report = { at: new Date(now()).toISOString(), pull: null, entries: [], push: null };
    // Holen läuft in der Warteschlange der Sammlung, damit keine Analyse gleichzeitig schreibt.
    report.pull = await board.exclusive(() => pull(board.path)).catch((error) => ({ error: error.message }));
    const imported = [];
    for (const name of names) {
      const path = join(directory, name);
      let entry;
      try {
        const [text, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
        try { entry = JSON.parse(text); } catch (error) {
          // Eine Datei, die gerade noch geschrieben wird, bekommt Zeit.
          if (now() - info.mtimeMs < SETTLE_MS) { again = true; continue; }
          throw new InboxEntryError(`Kein gültiges JSON: ${error.message}`);
        }
        const command = inboxCommand(entry);
        const existing = board.snapshot().ideas.find((idea) => sameDigest(idea, command));
        const idea = existing ?? (await board.execute(command)).idea;
        const done = await moveTo(directory, 'done', name);
        report.entries.push({ file: name, status: existing ? 'duplicate' : 'imported', ideaId: idea.id, title: idea.title, movedTo: done });
        if (!existing) imported.push(idea.id);
        log(`Digest übernommen: ${idea.title}`);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        let movedTo = null;
        try { movedTo = await moveTo(directory, 'failed', name); } catch { /* Bleibt liegen und wird erneut versucht. */ }
        report.entries.push({ file: name, status: 'failed', error: error.message, movedTo });
        log(`Digest nicht übernommen (${name}): ${error.message}`);
      }
    }
    if (imported.length || retry) {
      // Erst nach der Analyse pushen, damit Titel, Thema und Zusammenfassung mitgehen; notfalls ohne sie.
      // Beim Beenden wird nicht auf die Analyse gewartet; dann bleibt PUSH im Menü.
      let timeout;
      await Promise.race([
        board.whenIdle(),
        new Promise((resolveWait) => { wake = resolveWait; timeout = setTimeout(resolveWait, analysisTimeout); timeout.unref?.(); }),
      ]);
      clearTimeout(timeout);
      report.push = stopped
        ? { skipped: 'Gedankenraum wurde beendet, bevor gepusht wurde.' }
        : await push(board.path).catch((error) => ({ error: error.message }));
      if (report.push.error || report.push.skipped) {
        await mkdir(directory, { recursive: true }).catch(() => {});
        await writeFile(marker(), `${report.at}
`, 'utf8').catch(() => {});
      } else {
        await rm(marker(), { force: true }).catch(() => {});
      }
    }
    try {
      await mkdir(directory, { recursive: true });
      atomicReplaceText(join(directory, '.last-run.json'), `${JSON.stringify(report, null, 2)}\n`);
    } catch { /* Der Bericht ist nur eine Hilfe. */ }
    return report;
  }

  // Läufe überlappen nie; was währenddessen ankommt, holt ein weiterer Lauf ab.
  function scan() {
    if (stopped) return Promise.resolve(null);
    if (running) { again = true; return running; }
    again = false;
    running = processOnce().catch((error) => { log(`Digest-Eingang: ${error.message}`); return null; }).finally(() => {
      running = null;
      if (again && !stopped) setTimeout(scan, 1_000).unref?.();
    });
    return running;
  }

  return {
    directory,
    scan,
    // Beim nächsten Lauf pushen, auch ohne neue Datei.
    async requestPush() {
      await mkdir(directory, { recursive: true });
      await writeFile(marker(), `${new Date(now()).toISOString()}
`, 'utf8');
    },
    async start({ interval = 60_000 } = {}) {
      await mkdir(directory, { recursive: true }).catch(() => {});
      try {
        let debounce = null;
        // Eigene Dateien mit führendem Punkt (Bericht, Push-Merker) lösen keinen neuen Lauf aus.
        watcher = watch(directory, (event, name) => {
          if (String(name ?? '').startsWith('.')) return;
          clearTimeout(debounce);
          debounce = setTimeout(scan, 1_000);
          debounce.unref?.();
        });
        watcher.on('error', () => {});
      } catch { /* Ohne Watcher bleibt die regelmäßige Prüfung. */ }
      timer = setInterval(scan, interval);
      timer.unref?.();
      return scan();
    },
    async stop() {
      stopped = true;
      wake();
      watcher?.close();
      clearInterval(timer);
      await running;
    },
  };
}

// Für Tests und Skripte: Eine Eingangsdatei atomar ablegen.
export async function dropDigest(directory, name, digest) {
  await mkdir(directory, { recursive: true });
  const body = `${JSON.stringify({ format: INBOX_FORMAT, version: 1, type: 'digest', ...digest }, null, 2)}\n`;
  await writeFile(join(directory, `.${name}.tmp`), body, 'utf8');
  await rename(join(directory, `.${name}.tmp`), join(directory, name));
}
