import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { openDatabase } from '../src/database.js';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
const projectRoot = resolve(import.meta.dirname, '../../..');

describe('backup và restore', () => {
  it('tạo snapshot có checksum và giữ bản dữ liệu cũ khi restore', () => {
    const root = mkdtempSync(join(tmpdir(), 'home-nvr-backup-test-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const dataDir = join(root, 'data');
    const output = join(root, 'backup');
    openDatabase(dataDir).close();
    const env = { ...process.env, NVR_DATA_DIR: dataDir, NVR_SECRET_KEY: 'backup-test-secret-key-32-characters' };
    const backup = spawnSync(process.execPath, ['scripts/backup.mjs', '--output', output, '--metadata-only'], { cwd: projectRoot, env, encoding: 'utf8' });
    expect(backup.status, backup.stderr).toBe(0);
    const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ format: 'home-nvr-backup', version: 1, recordings: { included: false }, secretsIncluded: false });
    const secretOutput = join(root, 'backup-with-secret');
    const secretBackup = spawnSync(process.execPath, ['scripts/backup.mjs', '--output', secretOutput, '--metadata-only', '--include-secrets'], { cwd: projectRoot, env, encoding: 'utf8' });
    expect(secretBackup.status, secretBackup.stderr).toBe(0);
    const secretManifest = JSON.parse(readFileSync(join(secretOutput, 'manifest.json'), 'utf8'));
    expect(secretManifest.secret.sha256).toMatch(/^[a-f0-9]{64}$/);
    const restore = spawnSync(process.execPath, ['scripts/restore.mjs', '--input', secretOutput, '--force'], { cwd: projectRoot, env, encoding: 'utf8' });
    expect(restore.status, restore.stderr).toBe(0);
    const result = JSON.parse(restore.stdout);
    expect(result.ok).toBe(true);
    expect(result.previous).toContain('.before-restore-');
    const database = openDatabase(dataDir);
    expect(database.isHealthy()).toBe(true);
    database.close();
  });
});
