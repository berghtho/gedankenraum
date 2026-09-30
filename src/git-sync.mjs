import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname } from 'node:path';

// Liegt ideas.json eingecheckt in einem Git-Repository, bietet Gedankenraum bei Änderungen „Push“ an.
// Committet wird nur ideas.json; andere Dateien im Repository bleiben, wie sie sind.
const COMMIT_MESSAGE = 'Gedankenraum: ideas.json aktualisiert';

function git(args, cwd, timeout = 15_000) {
  return new Promise((resolveRun, rejectRun) => {
    // Ohne Terminal darf Git nicht auf eine Passworteingabe warten; die Anmeldung übernimmt der Credential Helper.
    execFile('git', args, {
      cwd, timeout, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (error, stdout, stderr) => {
      if (!error) return resolveRun(stdout);
      if (error.code === 'ENOENT') return rejectRun(new Error('Git wurde nicht gefunden.'));
      if (error.killed) return rejectRun(new Error('Git hat nicht rechtzeitig geantwortet.'));
      return rejectRun(new Error(String(stderr).trim() || error.message));
    });
  });
}

export async function gitStatus(filePath) {
  const cwd = dirname(filePath);
  const name = basename(filePath);
  try {
    if (!(await git(['ls-files', '--', name], cwd)).trim()) return { available: false, reason: `${name} ist nicht in Git eingecheckt.` };
    // Ohne optionale Sperren kommt die Abfrage einem gleichzeitigen Git-Befehl im Terminal nicht in die Quere.
    const lines = (await git(['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '--', name], cwd)).split(/\r?\n/);
    const header = (key) => lines.find((line) => line.startsWith(`# branch.${key} `))?.slice(key.length + 10) ?? null;
    const branch = header('head');
    if (!branch || branch === '(detached)') return { available: false, reason: 'Im Repository ist kein Branch ausgecheckt.' };
    const [, ahead = '0', behind = '0'] = /^\+(\d+) -(\d+)$/.exec(header('ab') ?? '') ?? [];
    // Ein Push nimmt alle ausgehenden Commits mit, auch solche, die nicht von Gedankenraum stammen.
    const subjects = Number(ahead) ? (await git(['log', '--format=%s', '@{u}..HEAD'], cwd)).split(/\r?\n/).filter(Boolean) : [];
    const foreign = subjects.filter((subject) => subject !== COMMIT_MESSAGE).length;
    return { available: true, branch, upstream: header('upstream'), changed: lines.some((line) => /^[12u] /.test(line)), ahead: Number(ahead), behind: Number(behind), foreign };
  } catch (error) {
    return { available: false, reason: error.message };
  }
}

// Beim Start holt Gedankenraum neue Commits, aber nur per Fast-Forward: Es entsteht nie ein Merge,
// der die JSON-Datei mit Konfliktmarkern beschädigen könnte. Offline startet die App ohne Update.
export async function pullFastForward(filePath, fetchTimeout = 15_000) {
  const status = await gitStatus(filePath);
  if (!status.available || !status.upstream) return null;
  const { upstream } = status;
  const cwd = dirname(filePath);
  try {
    await git(['fetch', '--quiet'], cwd, fetchTimeout);
    const fetched = await gitStatus(filePath);
    if (!fetched.behind) return { upstream, pulled: 0 };
    if (fetched.ahead) throw new Error(`Hier und in ${upstream} gibt es verschiedene neue Commits. Bitte im Repository zusammenführen.`);
    await git(['merge', '--ff-only', '--quiet', '@{u}'], cwd);
    return { upstream, pulled: fetched.behind };
  } catch (error) {
    return { upstream, pulled: 0, error: error.message };
  }
}

export async function commitAndPush(filePath) {
  const status = await gitStatus(filePath);
  if (!status.available) throw new Error(status.reason);
  if (!status.changed && !status.ahead) return { ...status, pushed: false };
  const cwd = dirname(filePath);
  if (status.changed) {
    if (!existsSync(filePath)) throw new Error(`${basename(filePath)} fehlt und wird nicht als gelöscht committet.`);
    await git(['commit', '--only', '-m', COMMIT_MESSAGE, '--', basename(filePath)], cwd);
  }
  try {
    await git(['push'], cwd, 120_000);
  } catch (error) {
    // Zusammengeführt wird nicht automatisch: Ein Textmerge kann die JSON-Datei beschädigen.
    const kept = status.changed ? ' Der Commit bleibt lokal erhalten.' : '';
    if (/\[rejected\]/.test(error.message)) throw new Error(`Das Remote-Repository hat neuere Änderungen. Bitte im Repository zuerst pullen und dann erneut pushen.${kept}`);
    throw new Error(`Push fehlgeschlagen: ${error.message}${kept}`);
  }
  return { ...(await gitStatus(filePath)), pushed: true };
}
