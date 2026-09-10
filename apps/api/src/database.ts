import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { migrations, type Migration } from './migrations.js';

const checksum = (sql: string) => createHash('sha256').update(sql).digest('hex');

export function applyMigrations(db: DatabaseSync, list: readonly Migration[] = migrations) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT');
    const applied = db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all();
    for (const row of applied) {
      const expected = list.find(item => item.version === row.version);
      if (!expected || row.checksum !== checksum(expected.sql)) throw new Error('Lịch sử migration không tương thích; cần khôi phục đúng phiên bản.');
    }
    for (const [index, migration] of list.entries()) {
      if (migration.version !== index + 1) throw new Error('Thứ tự migration không hợp lệ.');
      if (applied.some(row => row.version === migration.version)) continue;
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?, ?)').run(migration.version, migration.name, checksum(migration.sql), new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function openDatabase(dataDir: string) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, 'home-nvr.sqlite');
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true, allowExtension: false });
  try {
    if (process.platform !== 'win32') chmodSync(path, 0o600);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
    applyMigrations(db);
  } catch (error) { db.close(); throw error; }
  let closed = false;
  return {
    db,
    isHealthy() {
      if (closed) return false;
      try { return db.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get()?.version === migrations.at(-1)?.version; } catch { return false; }
    },
    close() { if (!closed) { db.close(); closed = true; } },
  };
}

export type AppDatabase = ReturnType<typeof openDatabase>;
