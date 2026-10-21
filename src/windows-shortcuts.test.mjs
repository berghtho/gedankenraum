import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { iconFile, shortcutPlan, writeShortcuts } from './windows-shortcuts.mjs';

test('desktop shortcut opens the browser, the startup shortcut only starts the server, both without a window', () => {
  const plan = shortcutPlan({ root: 'C:\\Apps\\Gedankenraum', nodePath: 'C:\\Node\\node.exe', systemRoot: 'C:\\Windows', icon: 'C:\\x.ico' });
  const desktop = plan.find((item) => item.folder === 'Desktop');
  const startup = plan.find((item) => item.folder === 'Startup');
  for (const item of [desktop, startup]) {
    assert.equal(item.target, join('C:\\Windows', 'System32', 'conhost.exe'));
    assert.match(item.arguments, /^--headless "C:\\Node\\node\.exe" ".*server\.mjs"/);
    assert.equal(item.workingDirectory, 'C:\\Apps\\Gedankenraum');
    assert.equal(item.icon, 'C:\\x.ico');
  }
  assert.match(desktop.arguments, / --open$/);
  assert.doesNotMatch(startup.arguments, /--open/);
});

test('the icon is a valid multi-size ICO', () => {
  const icon = iconFile([16, 32]);
  assert.equal(icon.readUInt16LE(2), 1);
  assert.equal(icon.readUInt16LE(4), 2);
  assert.equal(icon.readUInt8(6 + 16), 32);
  const offset = icon.readUInt32LE(6 + 16 + 12);
  assert.equal(offset + icon.readUInt32LE(6 + 16 + 8), icon.length);
  assert.equal(icon.readUInt32LE(offset), 40);
});

test('shortcuts can be created and removed again', { skip: process.platform !== 'win32' }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gedankenraum-shortcuts-'));
  try {
    const created = await writeShortcuts({ shortcutDirectory: directory, appDirectory: directory });
    assert.equal(created.length, 2);
    for (const path of created) assert.ok(existsSync(path), path);
    assert.ok(existsSync(join(directory, 'gedankenraum.ico')));
    const removed = await writeShortcuts({ remove: true, shortcutDirectory: directory, appDirectory: directory });
    assert.deepEqual(removed, created);
    for (const path of created) assert.ok(!existsSync(path), path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
