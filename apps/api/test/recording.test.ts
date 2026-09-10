import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/database.js';
import { createLogger } from '../src/logger.js';
import { RecordingManagerService } from '../src/recording.js';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'home-nvr-recording-test-'));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const database = openDatabase(directory);
  const recorder = new RecordingManagerService({ database, dataDir: directory, secretKey: 'recording-test-secret-key-32-characters', mediaGateway: undefined });
  const app = await buildApp(loadConfig({ NVR_DATA_DIR: directory, NVR_SETUP_TOKEN: 'r'.repeat(32), NVR_SECRET_KEY: 's'.repeat(32) }), { database, recordingManager: recorder, logger: createLogger('silent'), serveWeb: false });
  cleanup.push(() => app.close());
  const owner = await app.inject({ method: 'POST', url: '/api/v1/auth/setup', payload: { username: 'owner', password: 'strong-password-123', setupToken: 'r'.repeat(32) } });
  const cookie = String(owner.headers['set-cookie']).split(';')[0];
  const camera = await app.inject({ method: 'POST', url: '/api/v1/cameras', headers: { cookie, origin: 'http://127.0.0.1:5173' }, payload: { name: 'Cổng trước', location: 'Sân', mainSourceUrl: 'rtsp://127.0.0.1/live' } });
  const cameraId = camera.json().id as string;
  const recordingId = randomUUID();
  const relativePath = 'recordings/' + cameraId + '/segment.mp4';
  const absolutePath = join(directory, 'recordings', cameraId, 'segment.mp4');
  mkdirSync(join(directory, 'recordings', cameraId), { recursive: true });
  writeFileSync(absolutePath, Buffer.from('abcde'));
  database.db.prepare('INSERT INTO recordings(id,camera_id,relative_path,start_at,end_at,state,bytes) VALUES (?,?,?,?,?,?,?)').run(recordingId, cameraId, relativePath, '2026-09-08T00:00:00.000Z', '2026-09-08T00:00:05.000Z', 'ready', 5);
  return { app, cookie, recordingId, directory, database, cameraId };
}

describe('Recordings API', () => {
  it('liệt kê, phát range và export bản ghi ready', async () => {
    const { app, cookie, recordingId } = await setup();
    const list = await app.inject({ method: 'GET', url: '/api/v1/recordings', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json()[0]).toMatchObject({ id: recordingId, state: 'ready', bytes: 5 });
    const playback = await app.inject({ method: 'GET', url: '/api/v1/recordings/' + recordingId + '/playback', headers: { cookie, range: 'bytes=1-2' } });
    expect(playback.statusCode).toBe(206);
    expect(playback.body).toBe('bc');
    const suffix = await app.inject({ method: 'GET', url: '/api/v1/recordings/' + recordingId + '/playback', headers: { cookie, range: 'bytes=-2' } });
    expect(suffix.statusCode).toBe(206);
    expect(suffix.body).toBe('de');
    const exported = await app.inject({ method: 'POST', url: '/api/v1/recordings/export', headers: { cookie, origin: 'http://127.0.0.1:5173' }, payload: { recordingIds: [recordingId] } });
    expect(exported.statusCode).toBe(202);
    const exportBody = exported.json() as { endpoint: string };
    const download = await app.inject({ method: 'GET', url: exportBody.endpoint + '/' + recordingId + '.mp4', headers: { cookie } });
    expect(download.statusCode).toBe(200);
    expect(download.body).toBe('abcde');
  });
  it('lập lại chỉ mục sau restart và xóa segment quá hạn theo retention', async () => {
    const { directory, database, cameraId } = await setup();
    const oldPath = join(directory, 'recordings', cameraId, 'old.mp4');
    writeFileSync(oldPath, Buffer.alloc(4, 1));
    const old = new Date(Date.now() - 10 * 86400000);
    utimesSync(oldPath, old, old);
    database.db.prepare("UPDATE settings SET value_json=? WHERE key='system'").run(JSON.stringify({ retentionDays: 1, storageLimitBytes: null }));
    const restarted = new RecordingManagerService({ database, dataDir: directory, secretKey: 'recording-test-secret-key-32-characters', mediaGateway: undefined });
    await restarted.start();
    expect(database.db.prepare('SELECT 1 FROM recordings WHERE relative_path=?').get('recordings/' + cameraId + '/old.mp4')).toBeUndefined();
    expect(() => statSync(oldPath)).toThrow();
    await restarted.shutdown();
  });
  it('chỉ owner được truy cập playback và export', async () => {
    const { app, recordingId } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/v1/recordings' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/recordings/' + recordingId + '/playback' })).statusCode).toBe(401);
  });
});
