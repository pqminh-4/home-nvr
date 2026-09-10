import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const value = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const inputValue = value('--input');
if (!inputValue) throw new Error('Thiếu --input trỏ tới thư mục backup.');
if (!args.includes('--force')) throw new Error('Restore cần --force và phải dừng Home NVR trước khi chạy.');
const input = resolve(inputValue);
const dataDir = resolve(process.env.NVR_DATA_DIR || '.data');
const manifest = JSON.parse(await readFile(join(input, 'manifest.json'), 'utf8'));
if (manifest?.format !== 'home-nvr-backup' || manifest?.version !== 1) throw new Error('Định dạng backup không được hỗ trợ.');

const inside = (root, path) => {
  const item = relative(resolve(root), resolve(path));
  return item !== '..' && !item.startsWith('..' + sep) && !isAbsolute(item);
};
const digest = async path => { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); };
const verify = async (path, expected) => { if ((await digest(path)) !== expected) throw new Error('Checksum backup không khớp.'); };
const databaseSource = resolve(input, manifest.database.path);
if (!inside(input, databaseSource)) throw new Error('Đường dẫn database trong backup không an toàn.');
await verify(databaseSource, manifest.database.sha256);
if (manifest.secretsIncluded) { const secretSource = resolve(input, manifest.secret?.path || ''); if (!manifest.secret?.sha256 || !inside(input, secretSource)) throw new Error('Metadata khóa bí mật không hợp lệ.'); await verify(secretSource, manifest.secret.sha256); }
const check = new DatabaseSync(databaseSource, { readOnly: true });
try { const integrity = check.prepare('PRAGMA integrity_check').get(); if (integrity?.integrity_check !== 'ok') throw new Error('SQLite backup không toàn vẹn.'); check.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get(); } finally { check.close(); }

await mkdir(dirname(dataDir), { recursive: true, mode: 0o700 });
const stage = resolve(dirname(dataDir), '.' + basenameSafe(dataDir) + '-restore-' + Date.now());
await mkdir(stage, { recursive: false, mode: 0o700 });
await copyFile(databaseSource, join(stage, 'home-nvr.sqlite'));
for (const item of manifest.recordings?.files || []) {
  const source = resolve(input, item.path);
  const target = resolve(stage, item.path);
  if (!String(item.path).startsWith('recordings/') || !inside(input, source) || !inside(stage, target)) throw new Error('Đường dẫn bản ghi trong backup không an toàn.');
  await verify(source, item.sha256);
  const info = await stat(source);
  if (info.size !== item.bytes) throw new Error('Kích thước bản ghi trong backup không khớp.');
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await copyFile(source, target);
}
await writeFile(join(stage, 'restore-source.txt'), input + '\n', { mode: 0o600 });
let previous = null;
try {
  await stat(dataDir);
  previous = dataDir + '.before-restore-' + new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  await rename(dataDir, previous);
} catch (error) {
  if (!error || error.code !== 'ENOENT') throw error;
}
try { await rename(stage, dataDir); }
catch (error) {
  if (previous) await rename(previous, dataDir).catch(() => undefined);
  throw error;
}
console.log(JSON.stringify({ ok: true, dataDir, previous, secretKeyFile: manifest.secretsIncluded ? join(input, 'secret-key.txt') : null }));

function basenameSafe(path) {
  const parts = resolve(path).split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || 'home-nvr-data';
}
