import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, copyFile, rm, stat, unlink } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { AppDatabase } from './database.js';
import type { MediaGateway } from './media.js';
import { decryptSecret, deriveSecretKey } from './secrets.js';

type RecordingHealth = 'not-configured' | 'starting' | 'ready' | 'error';
interface ExportAsset { directory: string; expiresAt: number; bytes: number }

export interface RecordingManager {
  start(): Promise<void>;
  health(): RecordingHealth;
  reconcile(): Promise<void>;
  stopCamera(cameraId: string): Promise<void>;
  list(input: { cameraId?: string | undefined; from?: string | undefined; to?: string | undefined; limit?: number | undefined }): unknown[];
  playback(recordingId: string): Promise<{ path: string; size: number; contentType: string } | null>;
  export(recordingIds: readonly string[]): Promise<{ id: string; endpoint: string; expiresAt: string; bytes: number }>;
  exportAsset(exportId: string, asset: string): Promise<{ path: string; size: number; contentType: string } | null>;
  shutdown(): Promise<void>;
}

const isWithin = (root: string, target: string) => {
  const base = resolve(root) + sep;
  return resolve(target).startsWith(base);
};
const contentType = (path: string) => path.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream';
const idForPath = (value: string) => { const hash = createHash('sha256').update(value).digest('hex'); return hash.slice(0, 8) + '-' + hash.slice(8, 12) + '-' + hash.slice(12, 16) + '-' + hash.slice(16, 20) + '-' + hash.slice(20, 32); };

// MediaMTX ghi fMP4 native; service này chỉ lập chỉ mục, retention và export.
export class RecordingManagerService implements RecordingManager {
  private state: RecordingHealth = 'not-configured';
  private interval: NodeJS.Timeout | null = null;
  private readonly exports = new Map<string, ExportAsset>();
  private readonly root: string;
  private readonly key: Buffer;
  private readonly recordingCameras = new Set<string>();

  constructor(private readonly options: { database: AppDatabase; dataDir: string; secretKey: string; mediaGateway: MediaGateway | undefined }) {
    this.root = resolve(options.dataDir, 'recordings');
    this.key = options.secretKey.length >= 32 ? deriveSecretKey(options.secretKey) : Buffer.alloc(32);
  }

  health() { return this.state; }

  async start() {
    this.state = 'starting';
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      await this.syncSegments();
      await this.retention();
      await this.reconcile();
      this.interval = setInterval(() => { void this.tick(); }, 30_000);
      this.interval.unref();
      this.state = this.options.mediaGateway ? 'ready' : 'not-configured';
    } catch {
      this.state = 'error';
      throw new Error('RECORDING_START_FAILED');
    }
  }

  private async tick() {
    try { await this.reconcile(); await this.syncSegments(); await this.retention(); await this.cleanupExports(); if (this.options.mediaGateway) this.state = 'ready'; }
    catch { this.state = 'error'; }
  }

  async reconcile() {
    const rows = this.options.database.db.prepare("SELECT c.id, s.source_ciphertext FROM cameras c JOIN camera_streams s ON s.camera_id=c.id AND s.profile='main' WHERE c.enabled=1 AND c.deleted_at IS NULL AND c.recording_mode IN ('continuous','event')").all() as { id: string; source_ciphertext: string }[];
    const wanted = new Set(rows.map(row => row.id));
    for (const row of rows) {
      if (this.recordingCameras.has(row.id)) continue;
      if (!this.options.mediaGateway || this.options.mediaGateway.health() !== 'ready') continue;
      const sourceUrl = decryptSecret(row.source_ciphertext, this.key);
      await this.options.mediaGateway.configure(row.id, [{ profile: 'main', sourceUrl, record: true, recordRoot: join(this.root, row.id) }]);
      this.recordingCameras.add(row.id);
    }
    for (const cameraId of [...this.recordingCameras]) {
      if (wanted.has(cameraId)) continue;
      await this.stopCamera(cameraId);
    }
  }

  async stopCamera(cameraId: string) {
    if (!this.recordingCameras.has(cameraId)) return;
    const row = this.options.database.db.prepare("SELECT source_ciphertext FROM camera_streams WHERE camera_id=? AND profile='main'").get(cameraId) as { source_ciphertext?: string } | undefined;
    if (row && this.options.mediaGateway?.health() === 'ready') {
      const sourceUrl = decryptSecret(row.source_ciphertext!, this.key);
      await this.options.mediaGateway.configure(cameraId, [{ profile: 'main', sourceUrl, record: false }]).catch(() => undefined);
    }
    this.recordingCameras.delete(cameraId);
  }

  private async files(root = this.root): Promise<string[]> {
    const output: string[] = [];
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(root, entry.name);
      if (entry.isDirectory() && !(root === this.root && entry.name === 'exports')) output.push(...await this.files(path));
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp4')) output.push(path);
    }
    return output;
  }

  private async syncSegments() {
    const paths = await this.files().catch(() => []);
    const known = new Set<string>();
    const insert = this.options.database.db.prepare('INSERT INTO recordings(id,camera_id,relative_path,start_at,end_at,state,bytes) VALUES (?,?,?,?,?,?,?)');
    const update = this.options.database.db.prepare('UPDATE recordings SET start_at=?,end_at=?,state=?,bytes=? WHERE relative_path=?');
    for (const path of paths) {
      const relativePath = relative(this.options.dataDir, path).split(sep).join('/');
      const cameraId = relativePath.split('/')[1];
      if (!cameraId) continue;
      const details = await stat(path).catch(() => null);
      if (!details || details.size <= 0) continue;
      known.add(relativePath);
      const active = this.recordingCameras.has(cameraId) && Date.now() - details.mtimeMs < 75_000;
      const startMs = details.birthtimeMs > 0 ? Math.min(details.birthtimeMs, details.mtimeMs) : details.mtimeMs;
      const startAt = new Date(startMs).toISOString();
      const endAt = active ? null : new Date(details.mtimeMs).toISOString();
      const state = active ? 'writing' : 'ready';
      const existing = this.options.database.db.prepare('SELECT id FROM recordings WHERE relative_path=?').get(relativePath);
      if (existing) update.run(startAt, endAt, state, details.size, relativePath);
      else insert.run(idForPath(relativePath), cameraId, relativePath, startAt, endAt, state, details.size);
this.options.database.db.prepare("INSERT OR IGNORE INTO event_recordings(event_id,recording_id) SELECT e.id,r.id FROM recordings r JOIN events e ON e.camera_id=r.camera_id WHERE r.relative_path=? AND r.start_at<=COALESCE(e.end_at,e.start_at) AND COALESCE(r.end_at,e.end_at,e.start_at)>=e.start_at").run(relativePath);
    }
    const stale = this.options.database.db.prepare("SELECT relative_path FROM recordings WHERE state='writing'").all() as { relative_path: string }[];
    const markFailed = this.options.database.db.prepare("UPDATE recordings SET state='failed',end_at=? WHERE relative_path=? AND state='writing'");
    for (const row of stale) if (!known.has(row.relative_path)) markFailed.run(new Date().toISOString(), row.relative_path);
  }

  private async retention() {
    const row = this.options.database.db.prepare("SELECT value_json FROM settings WHERE key='system'").get() as { value_json?: string } | undefined;
    const settings = JSON.parse(row?.value_json ?? '{}') as { retentionDays?: number; storageLimitBytes?: number | null };
    const threshold = Date.now() - Math.max(1, settings.retentionDays ?? 7) * 86400000;
    const candidates = this.options.database.db.prepare("SELECT r.id,r.relative_path,r.bytes,r.end_at,c.recording_mode,EXISTS(SELECT 1 FROM event_recordings er WHERE er.recording_id=r.id) AS linked FROM recordings r JOIN cameras c ON c.id=r.camera_id WHERE r.state='ready' ORDER BY COALESCE(r.end_at,r.start_at) ASC").all() as { id: string; relative_path: string; bytes: number; end_at: string | null; recording_mode: string; linked: number }[];
    let total = candidates.reduce((sum, item) => sum + item.bytes, 0);
    const limit = settings.storageLimitBytes ?? Number.POSITIVE_INFINITY;
    for (const item of candidates) {
      const expiredRolling = item.recording_mode === 'event' && !item.linked && Boolean(item.end_at) && Date.parse(item.end_at!) < Date.now() - 180_000;
      if (!expiredRolling && !(item.end_at && Date.parse(item.end_at) < threshold) && total <= limit) continue;
      const path = resolve(this.options.dataDir, item.relative_path);
      if (!isWithin(this.options.dataDir, path)) continue;
      this.options.database.db.prepare("UPDATE recordings SET state='deleting' WHERE id=? AND state='ready'").run(item.id);
      try { await unlink(path); this.options.database.db.prepare('DELETE FROM recordings WHERE id=?').run(item.id); total -= item.bytes; }
      catch { this.options.database.db.prepare("UPDATE recordings SET state='failed' WHERE id=?").run(item.id); }
    }
  }

  list(input: { cameraId?: string | undefined; from?: string | undefined; to?: string | undefined; limit?: number | undefined }) {
    const limit = Math.min(100, Math.max(1, input.limit ?? 50));
    return this.options.database.db.prepare("SELECT id,camera_id,start_at,end_at,state,bytes FROM recordings WHERE state='ready' AND (? IS NULL OR camera_id=?) AND (end_at IS NULL OR end_at>=?) AND start_at<=? ORDER BY start_at DESC LIMIT ?").all(input.cameraId ?? null, input.cameraId ?? null, input.from ?? '1970-01-01T00:00:00.000Z', input.to ?? '9999-12-31T23:59:59.999Z', limit);
  }

  async playback(recordingId: string) {
    const row = this.options.database.db.prepare("SELECT relative_path FROM recordings WHERE id=? AND state='ready'").get(recordingId) as { relative_path?: string } | undefined;
    if (!row?.relative_path) return null;
    const path = resolve(this.options.dataDir, row.relative_path);
    if (!isWithin(this.options.dataDir, path)) return null;
    const details = await stat(path).catch(() => null);
    if (!details?.isFile()) return null;
    return { path, size: details.size, contentType: contentType(path) };
  }

  async export(recordingIds: readonly string[]) {
    const id = randomUUID();
    const directory = join(this.root, 'exports', id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let bytes = 0;
    for (const recordingId of recordingIds) {
      const asset = await this.playback(recordingId);
      if (!asset) throw new Error('RECORDING_NOT_FOUND');
      await copyFile(asset.path, join(directory, recordingId + '.mp4'));
      bytes += asset.size;
    }
    const expiresAt = Date.now() + 30 * 60_000;
    this.exports.set(id, { directory, expiresAt, bytes });
    return { id, endpoint: '/api/v1/recordings/exports/' + id, expiresAt: new Date(expiresAt).toISOString(), bytes };
  }

  private async cleanupExports(force = false) {
    const now = Date.now();
    for (const [id, item] of this.exports) if (force || item.expiresAt <= now) { await rm(item.directory, { recursive: true, force: true }).catch(() => undefined); this.exports.delete(id); }
  }

  async exportAsset(exportId: string, asset: string) {
    const item = this.exports.get(exportId);
    if (!item || item.expiresAt <= Date.now() || !/^[a-f0-9-]+\.mp4$/.test(asset)) return null;
    const path = resolve(item.directory, asset);
    if (!isWithin(item.directory, path)) return null;
    const details = await stat(path).catch(() => null);
    if (!details?.isFile()) return null;
    return { path, size: details.size, contentType: contentType(path) };
  }

  async shutdown() {
    if (this.interval) clearInterval(this.interval);
    await this.cleanupExports(true);
    this.interval = null;
    for (const cameraId of [...this.recordingCameras]) await this.stopCamera(cameraId);
    this.state = 'not-configured';
  }
}
