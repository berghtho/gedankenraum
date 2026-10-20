import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createCodexAnalyzer } from './codex-analysis.mjs';
import { IdeaBoard } from './idea-board.mjs';
import { createIdeaLinkReader } from './idea-link-reader.mjs';
import { defaultInboxDirectory } from './inbox.mjs';
import { claimInstance, configuredStatePath, createGitInbox, defaultAppDirectory } from './server.mjs';

// Sync ohne Oberfläche, etwa als geplanter Job in GitHub Actions: einmal den Digest-Eingang verarbeiten
// (holen, übernehmen, analysieren, pushen) und beenden. Läuft Gedankenraum schon, übernimmt es den Eingang selbst.
export async function syncOnce({
  statePath = configuredStatePath(),
  inboxDirectory = defaultInboxDirectory(),
  analyzer = createCodexAnalyzer(),
  readLink = createIdeaLinkReader(),
  lockPath = join(defaultAppDirectory(), '.instance.json'),
  log = (message) => console.log(message),
} = {}) {
  const instance = await claimInstance(lockPath);
  if (instance.existing) return { running: true };
  const board = new IdeaBoard({ path: statePath, analyze: analyzer.analyze, reflect: analyzer.reflect, research: analyzer.research, readLink });
  const inbox = createGitInbox({ board, directory: inboxDirectory, log });
  try {
    const report = await inbox.scan();
    const imported = new Set(report?.entries.filter((entry) => entry.status === 'imported').map((entry) => entry.ideaId));
    const warnings = board.snapshot().ideas.filter((idea) => imported.has(idea.id) && idea.analysisWarning)
      .map((idea) => `${idea.title}: ${idea.analysisWarning}`);
    return { report, warnings };
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
  syncOnce().then(({ running, report, warnings = [] }) => {
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
