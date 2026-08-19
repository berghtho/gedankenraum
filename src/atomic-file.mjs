import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

let writeSeq = 0;

export function atomicReplaceText(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${writeSeq++}.tmp`;
  writeFileSync(tmp, contents, 'utf8');
  const transient = new Set(['EPERM', 'EBUSY', 'EACCES']);
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(tmp, path);
      return;
    } catch (error) {
      if (attempt >= 5 || !transient.has(error.code)) {
        try { rmSync(tmp, { force: true }); } catch { /* Cleanup must not hide the write error. */ }
        throw error;
      }
      const until = Date.now() + 20 * (attempt + 1);
      while (Date.now() < until) { /* Returning means the replacement is complete. */ }
    }
  }
}
