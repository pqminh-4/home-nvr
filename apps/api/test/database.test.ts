import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations, openDatabase } from '../src/database.js';
import { migrations } from '../src/migrations.js';

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(fn => fn()); });
function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'home-nvr-db-test-'));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const database = openDatabase(directory);
  cleanup.push(() => database.close());
  return { ...database, directory };
}
const now = '2026-09-05T00:00:00.000Z';
function addCamera(db: DatabaseSync) {
  db.prepare('INSERT INTO cameras (id,name,created_at,updated_at) VALUES (?,?,?,?)').run('cam-1', 'Cổng nhà', now, now);
}

describe('SQLite và migration', () => {
  it('lưu bền dữ liệu, bật WAL/foreign key, chạy migration nhiều lần không mất dữ liệu', () => {
    const first = temporaryDatabase();
    addCamera(first.db);
    expect(first.db.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal');
    expect(first.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
    first.close();
    const second = openDatabase(first.directory);
    cleanup.push(() => second.close());
    expect(second.db.prepare('SELECT name FROM cameras').get()?.name).toBe('Cổng nhà');
    expect(second.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()?.n).toBe(4);
    expect(second.isHealthy()).toBe(true);
  });
  it('rollback toàn bộ migration lỗi, giữ phiên bản và dữ liệu trước đó', () => {
    const { db } = temporaryDatabase();
    addCamera(db);
    expect(() => applyMigrations(db, [...migrations, { version: 5, name: 'broken', sql: 'CREATE TABLE marker (id INTEGER); INSERT INTO not_a_table VALUES (1);' }])).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='marker'").get()).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()?.n).toBe(4);
    expect(db.prepare('SELECT COUNT(*) AS n FROM cameras').get()?.n).toBe(1);
  });
  it('từ chối migration bị sửa hoặc database mới hơn ứng dụng', () => {
    const { db } = temporaryDatabase();
    expect(() => applyMigrations(db, [{ ...migrations[0]!, sql: `${migrations[0]!.sql}\nSELECT 1;` }])).toThrow(/không tương thích/);
    expect(() => applyMigrations(db, [])).toThrow(/không tương thích/);
  });
  it('không cho tạo hai chủ nhà hoặc username trùng khác hoa/thường', () => {
    const { db } = temporaryDatabase();
    const insert = db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)');
    insert.run('owner-1', 'Minh', 'hash', 'owner', null, now);
    expect(() => insert.run('owner-2', 'Other', 'hash', 'owner', null, now)).toThrow();
    expect(() => insert.run('guest-1', 'minh', 'hash', 'guest', null, now)).toThrow();
    expect(() => insert.run('owner-3', 'New', 'hash', 'owner', now, now)).toThrow();
  });
  it('thu hồi grants/session khi xóa khách, từ chối grant camera không tồn tại', () => {
    const { db } = temporaryDatabase();
    addCamera(db);
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('guest-1', 'guest', 'hash', 'guest', null, now);
    const grant = db.prepare('INSERT INTO camera_grants VALUES (?,?)');
    expect(() => grant.run('guest-1', 'missing')).toThrow();
    grant.run('guest-1', 'cam-1');
    db.prepare('INSERT INTO auth_sessions VALUES (?,?,?,?)').run('digest', 'guest-1', now, now);
    db.prepare('DELETE FROM users WHERE id=?').run('guest-1');
    expect(db.prepare('SELECT COUNT(*) AS n FROM camera_grants').get()?.n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get()?.n).toBe(0);
  });
  it('bảo vệ bản ghi khi xóa camera, ràng buộc trạng thái/thời gian', () => {
    const { db } = temporaryDatabase();
    addCamera(db);
    const insert = db.prepare('INSERT INTO recordings VALUES (?,?,?,?,?,?,?)');
    insert.run('rec-1', 'cam-1', 'cam-1/segment.mp4', now, null, 'writing', 0);
    expect(() => db.prepare('DELETE FROM cameras WHERE id=?').run('cam-1')).toThrow();
    expect(() => insert.run('rec-2', 'cam-1', 'other.mp4', now, '2020-01-01T00:00:00.000Z', 'ready', 5)).toThrow();
    expect(() => db.prepare("UPDATE recordings SET state='unknown'").run()).toThrow();
    expect(() => db.prepare('UPDATE recordings SET bytes=-1').run()).toThrow();
  });
  it('readiness giảm khi đóng database và close gọi lại an toàn', () => {
    const database = temporaryDatabase();
    expect(database.isHealthy()).toBe(true);
    database.close();
    expect(database.isHealthy()).toBe(false);
    expect(() => database.close()).not.toThrow();
  });
});
