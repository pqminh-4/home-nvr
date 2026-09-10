import { backup, DatabaseSync } from 'node:sqlite';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const value = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const metadataOnly = args.includes('--metadata-only');
const includeSecrets = args.includes('--include-secrets');
const dataDir = resolve(process.env.NVR_DATA_DIR || '.data');
const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const output = resolve(value('--output') || join('backups', 'home-nvr-' + timestamp));
const databasePath = join(dataDir, 'home-nvr.sqlite');

const inside = (root, path) => {
  const item = relative(resolve(root), resolve(path));
  return item !== '..' && !item.startsWith('..' + sep) && !isAbsolute(item);
};
const digest = async path => { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); };

await mkdir(dirname(output), { recursive: true, mode: 0o700 });
await mkdir(output, { recursive: false, mode: 0o700 });
const snapshotPath = join(output, 'home-nvr.sqlite');
const source = new DatabaseSync(databasePath, { readOnly: true });
try { await backup(source, snapshotPath); } finally { source.close(); }
if (process.platform !== 'win32') await chmod(snapshotPath, 0o600);

const snapshot = new DatabaseSync(snapshotPath, { readOnly: true });
const rows = metadataOnly ? [] : snapshot.prepare("SELECT relative_path FROM recordings WHERE state='ready' ORDER BY relative_path").all();
snapshot.close();
const files = [];
for (const row of rows) {
  const relativePath = String(row.relative_path);
  const sourcePath = resolve(dataDir, relativePath);
  if (!relativePath.startsWith('recordings/') || !inside(dataDir, sourcePath)) throw new Error('Bản ghi có đường dẫn không an toàn.');
  try {
    const info = await stat(sourcePath);
    if (!info.isFile()) continue;
    const target = join(output, ...relativePath.split('/'));
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(sourcePath, target);
    files.push({ path: relativePath, bytes: info.size, sha256: await digest(target) });
  } catch (error) {
    if (error && error.code === 'ENOENT') continue;
    throw error;
  }
}

let secret = null;
if (includeSecrets) {
  if (!process.env.NVR_SECRET_KEY || process.env.NVR_SECRET_KEY.length < 32) throw new Error('NVR_SECRET_KEY chưa sẵn sàng để đưa vào backup.');
  const secretPath = join(output, 'secret-key.txt');
  await writeFile(secretPath, process.env.NVR_SECRET_KEY + '\n', { mode: 0o600, flag: 'wx' });
  if (process.platform !== 'win32') await chmod(secretPath, 0o600);
  secret = { path: 'secret-key.txt', sha256: await digest(secretPath) };
}
const manifest = {
  format: 'home-nvr-backup', version: 1, createdAt: new Date().toISOString(),
  database: { path: basename(snapshotPath), sha256: await digest(snapshotPath) },
  recordings: { included: !metadataOnly, count: files.length, files },
  secretsIncluded: includeSecrets, secret,
};
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ ok: true, output, recordings: files.length, secretsIncluded: includeSecrets }));
