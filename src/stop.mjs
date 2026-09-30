import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultAppDirectory } from './server.mjs';

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

// Erst wenn die alte Instanz ihre Sperre freigegeben hat, sagt ein sofortiger Neustart nicht „läuft bereits“.
async function released(lockPath, pid, wait) {
  const until = Date.now() + wait;
  while (Date.now() < until) {
    let current = null;
    try { current = JSON.parse(await readFile(lockPath, 'utf8')); } catch (error) {
      if (error.code === 'ENOENT') return true;
    }
    if ((current && current.pid !== pid) || !processIsRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

export async function stop({ appDirectory = defaultAppDirectory(), wait = 5000 } = {}) {
  const lockPath = join(appDirectory, '.instance.json');
  let instance;
  try {
    instance = JSON.parse(await readFile(lockPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { stopped: false };
    throw error;
  }
  if (!Number.isInteger(instance.pid) || instance.pid <= 0) {
    throw new Error('Die gespeicherte Gedankenraum-Instanz ist ungültig.');
  }
  try {
    process.kill(instance.pid, 0);
  } catch (error) {
    if (error.code === 'ESRCH') return { stopped: false };
    throw error;
  }
  if (!instance.url) throw new Error('Gedankenraum startet noch. Bitte gleich erneut versuchen.');
  const url = new URL(instance.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Die gespeicherte Gedankenraum-Adresse ist ungültig.');
  }
  const sessionResponse = await fetch(`${url.origin}/api/session`, {
    signal: AbortSignal.timeout(5000), redirect: 'error',
  });
  if (!sessionResponse.ok) throw new Error('Gedankenraum ist nicht erreichbar.');
  const session = await sessionResponse.json();
  if (session.app !== 'gedankenraum' || typeof session.token !== 'string' || !session.token) {
    throw new Error('Die laufende Anwendung ist kein Gedankenraum.');
  }
  const response = await fetch(`${url.origin}/api/shutdown`, {
    method: 'POST',
    headers: {
      origin: url.origin,
      'content-type': 'application/json',
      'x-gedankenraum-token': session.token,
    },
    body: '{}', signal: AbortSignal.timeout(5000), redirect: 'error',
  });
  if (!response.ok || (await response.json()).stopped !== true) {
    throw new Error('Gedankenraum konnte nicht beendet werden.');
  }
  await released(lockPath, instance.pid, wait);
  return { stopped: true };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  stop().then(({ stopped }) => {
    console.log(stopped ? 'Gedankenraum wird beendet.' : 'Gedankenraum läuft nicht.');
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
