import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createCodexAnalyzer } from './codex-analysis.mjs';
import { IdeaBoard } from './idea-board.mjs';
import { createIdeaLinkReader } from './idea-link-reader.mjs';
import { gitStatus } from './git-sync.mjs';
import { defaultInboxDirectory, listDone, pruneDone } from './inbox.mjs';
import { claimInstance, configuredStatePath, createGitInbox, defaultAppDirectory } from './server.mjs';

// Sync ohne Oberfläche, etwa als geplanter Job in GitHub Actions: einmal den Digest-Eingang verarbeiten
// (holen, übernehmen, analysieren, pushen) und beenden. Läuft Gedankenraum schon, übernimmt es den Eingang selbst.
// Mit analyse: false werden Digests nur übernommen und gepusht; analysiert sie die App beim nächsten Start.
// Danach räumt der Lauf done/ auf: Dateien aus früheren Läufen, deren Digest gepusht in ideas.json steht,
// werden gelöscht (keepDone: true lässt sie liegen). Die Dateien dieses Laufs bleiben bis zum nächsten sichtbar.
export async function syncOnce({
  analyse = true,
  keepDone = false,
  statePath = configuredStatePath(),
  inboxDirectory = defaultInboxDirectory(),
  analyzer = createCodexAnalyzer(),
  readLink = createIdeaLinkReader(),
  lockPath = join(defaultAppDirectory(), '.instance.json'),
  log = (message) => console.log(message),
} = {}) {
  const instance = await claimInstance(lockPath);
  if (instance.existing) return { running: true };
  const board = new IdeaBoard({ path: statePath, analyze: analyzer.analyze, reflect: analyzer.reflect, research: analyzer.research, readLink, backgroundAnalysis: analyse });
  const inbox = createGitInbox({ board, directory: inboxDirectory, log });
  try {
    const doneBefore = keepDone ? [] : await listDone(inboxDirectory);
    const report = await inbox.scan();
    const pushOpen = report?.push?.error || report?.push?.skipped;
    // ideas.json gilt als veröffentlicht, wenn nichts davon ungepusht ist; ohne Git gibt es nichts zu verlieren.
    const isPublished = async () => {
      const status = await gitStatus(statePath);
      return !status.available || (!status.changed && !status.ahead);
    };
    const cleanup = pushOpen ? { pruned: [], kept: [], skipped: 'Push offen' } : await pruneDone({ board, directory: inboxDirectory, names: doneBefore, isPublished });
    if (cleanup.pruned.length) log(`Aufgeräumt: ${cleanup.pruned.length} überholte Datei(en) aus done/`);
    const imported = new Set(report?.entries.filter((entry) => entry.status === 'imported').map((entry) => entry.ideaId));
    const warnings = board.snapshot().ideas.filter((idea) => imported.has(idea.id) && idea.analysisWarning)
      .map((idea) => `${idea.title}: ${idea.analysisWarning}`);
    return { report, warnings, cleanup };
  } finally {
    await inbox.stop();
    board.stop();
    await analyzer.stop?.();
    instance.release();
  }
}

// Fehlgeschlagen ist der Lauf, wenn eine Datei nicht übernommen oder das Ergebnis nicht gepusht wurde.
export function syncProblems(report) {
  if (!report) return [];
  const problems = report.entries.filter((entry) => entry.status === 'failed').map((entry) => `${entry.file}: ${entry.error}`);
  if (report.pull?.error) problems.push(`Holen: ${report.pull.error}`);
  if (report.push?.error) problems.push(`Push: ${report.push.error}`);
  if (report.push?.skipped) problems.push(`Push übersprungen: ${report.push.skipped}`);
  return problems;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const analyse = !process.argv.includes('--ohne-analyse');
  const keepDone = process.argv.includes('--done-behalten');
  syncOnce({ analyse, keepDone, ...(analyse ? {} : { analyzer: { analyze: async () => { throw new Error('Analyse ist aus'); } } }) }).then(({ running, report, warnings = [] }) => {
    if (running) return console.log('Gedankenraum läuft bereits und verarbeitet den Digest-Eingang selbst.');
    if (!report) return console.log('Digest-Eingang ist leer.');
    for (const warning of warnings) console.log(`Warnung: ${warning}`);
    const problems = syncProblems(report);
    for (const problem of problems) console.error(problem);
    if (problems.length) process.exitCode = 1;
    else console.log(report.push?.pushed ? 'Fertig, ideas.json ist gepusht.' : 'Fertig, nichts zu pushen.');
  }).catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
