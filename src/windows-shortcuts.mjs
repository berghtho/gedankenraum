import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultAppDirectory } from './server.mjs';

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const NAME = 'Gedankenraum.lnk';

// conhost --headless startet Node ohne sichtbares Fenster. Codex- und Git-Aufrufe erben diese
// unsichtbare Konsole, statt jeweils ein eigenes Fenster aufzumachen.
export function shortcutPlan({ root = repository, nodePath = process.execPath, systemRoot = process.env.SystemRoot || 'C:\\Windows', icon } = {}) {
  const server = join(root, 'src', 'server.mjs');
  const target = join(systemRoot, 'System32', 'conhost.exe');
  const base = { name: NAME, target, workingDirectory: root, icon };
  return [
    { ...base, folder: 'Desktop', arguments: `--headless "${nodePath}" "${server}" --open`, description: 'Gedankenraum öffnen' },
    { ...base, folder: 'Startup', arguments: `--headless "${nodePath}" "${server}"`, description: 'Gedankenraum im Hintergrund starten' },
  ];
}

// Gedankenblase in Lime auf dem dunklen Grund der Anwendung, als 32-Bit-ICO in mehreren Größen.
export function iconFile(sizes = [16, 24, 32, 48, 64]) {
  const images = sizes.map(iconImage);
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((image, index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(sizes[index] % 256, entry);
    header.writeUInt8(sizes[index] % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  return Buffer.concat([header, ...images]);
}

function iconImage(size) {
  const ink = [0x11, 0x12, 0x0f];
  const lime = [0xd5, 0xff, 0x65];
  const shapes = [[0.56, 0.42, 0.3], [0.27, 0.74, 0.1], [0.14, 0.88, 0.055]];
  const radius = 0.2;
  const coverage = (test) => {
    let hits = 0;
    for (let sy = 0; sy < 4; sy += 1) for (let sx = 0; sx < 4; sx += 1) if (test(sx, sy)) hits += 1;
    return hits / 16;
  };
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const point = (sx, sy) => [(x + (sx + 0.5) / 4) / size, (y + (sy + 0.5) / 4) / size];
      const tile = coverage((sx, sy) => {
        const [u, v] = point(sx, sy);
        const dx = Math.max(radius - u, 0, u - (1 - radius));
        const dy = Math.max(radius - v, 0, v - (1 - radius));
        return dx * dx + dy * dy <= radius * radius;
      });
      const bubble = coverage((sx, sy) => {
        const [u, v] = point(sx, sy);
        return shapes.some(([cx, cy, r]) => (u - cx) ** 2 + (v - cy) ** 2 <= r * r);
      });
      const color = ink.map((channel, index) => Math.round(channel + (lime[index] - channel) * bubble));
      // BMP-Zeilen liegen von unten nach oben, Kanäle als BGRA.
      const at = ((size - 1 - y) * size + x) * 4;
      pixels[at] = color[2];
      pixels[at + 1] = color[1];
      pixels[at + 2] = color[0];
      pixels[at + 3] = Math.round(255 * tile);
    }
  }
  const info = Buffer.alloc(40);
  info.writeUInt32LE(40, 0);
  info.writeInt32LE(size, 4);
  info.writeInt32LE(size * 2, 8);
  info.writeUInt16LE(1, 12);
  info.writeUInt16LE(32, 14);
  info.writeUInt32LE(pixels.length, 20);
  const maskRow = Math.ceil(size / 32) * 4;
  return Buffer.concat([info, pixels, Buffer.alloc(maskRow * size)]);
}

const script = [
  '$ErrorActionPreference = "Stop"',
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$shell = New-Object -ComObject WScript.Shell',
  '$plan = $env:GEDANKENRAUM_SHORTCUTS | ConvertFrom-Json',
  'foreach ($item in $plan) {',
  '  $folder = if ($env:GEDANKENRAUM_SHORTCUT_DIR) { Join-Path $env:GEDANKENRAUM_SHORTCUT_DIR $item.folder } else { [Environment]::GetFolderPath($item.folder) }',
  '  $path = Join-Path $folder $item.name',
  '  if ($env:GEDANKENRAUM_SHORTCUT_REMOVE) {',
  '    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path; [Console]::WriteLine($path) }',
  '  } else {',
  '    New-Item -ItemType Directory -Force -Path $folder | Out-Null',
  '    $link = $shell.CreateShortcut($path)',
  '    $link.TargetPath = $item.target',
  '    $link.Arguments = $item.arguments',
  '    $link.WorkingDirectory = $item.workingDirectory',
  '    $link.Description = $item.description',
  '    if ($item.icon) { $link.IconLocation = "$($item.icon),0" }',
  '    $link.Save()',
  '    [Console]::WriteLine($path)',
  '  }',
  '}',
].join('\n');

export async function writeShortcuts({ remove = false, shortcutDirectory, appDirectory = defaultAppDirectory(), ...options } = {}) {
  if (process.platform !== 'win32') throw new Error('Verknüpfungen gibt es nur unter Windows.');
  let icon;
  if (!remove) {
    mkdirSync(appDirectory, { recursive: true });
    icon = join(appDirectory, 'gedankenraum.ico');
    writeFileSync(icon, iconFile());
  }
  const plan = shortcutPlan({ ...options, icon });
  const stdout = await new Promise((resolveRun, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        GEDANKENRAUM_SHORTCUTS: JSON.stringify(plan),
        GEDANKENRAUM_SHORTCUT_DIR: shortcutDirectory ?? '',
        GEDANKENRAUM_SHORTCUT_REMOVE: remove ? '1' : '',
      },
    }, (error, out, stderr) => (error ? reject(new Error(stderr.trim() || error.message)) : resolveRun(out)));
  });
  return stdout.split(/\r?\n/).filter(Boolean);
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const remove = process.argv.includes('--remove');
  writeShortcuts({ remove }).then((paths) => {
    for (const path of paths) console.log(`${remove ? 'Entfernt' : 'Angelegt'}: ${path}`);
    if (!remove) console.log('Gedankenraum startet ab der nächsten Anmeldung im Hintergrund.');
  }).catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
