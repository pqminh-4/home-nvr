import { randomUUID } from 'node:crypto';
import type { AppDatabase } from './database.js';
import { decryptSecret, deriveSecretKey, encryptSecret } from './secrets.js';

type Schedule = { days: number[]; start: string; end: string };
export type MotionRule = { enabled: boolean; sensitivity: number; preSeconds: number; postSeconds: number; schedule: Schedule; webhookEnabled: boolean };

const minutes = (value: string) => { const [hour, minute] = value.split(':').map(Number); return (hour ?? 0) * 60 + (minute ?? 0); };

export class EventService {
  private timer: NodeJS.Timeout | null = null;
  private readonly key: Buffer;
  constructor(private readonly options: { database: AppDatabase; secretKey: string; fetcher?: typeof fetch }) {
    this.key = options.secretKey.length >= 32 ? deriveSecretKey(options.secretKey) : Buffer.alloc(32);
  }
  start() { this.timer = setInterval(() => { void this.deliverDue(); }, 5_000); this.timer.unref(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private ensureRule(cameraId: string) {
    this.options.database.db.prepare('INSERT INTO camera_event_rules(camera_id) VALUES (?) ON CONFLICT(camera_id) DO NOTHING').run(cameraId);
    return this.options.database.db.prepare('SELECT * FROM camera_event_rules WHERE camera_id=?').get(cameraId) as any;
  }
  getRule(cameraId: string): MotionRule | null {
    if (!this.options.database.db.prepare('SELECT 1 FROM cameras WHERE id=? AND deleted_at IS NULL').get(cameraId)) return null;
    const row = this.ensureRule(cameraId);
    return { enabled: Boolean(row.enabled), sensitivity: row.sensitivity, preSeconds: row.pre_seconds, postSeconds: row.post_seconds, schedule: JSON.parse(row.schedule_json), webhookEnabled: Boolean(row.webhook_ciphertext) };
  }
  updateRule(cameraId: string, input: { enabled: boolean; sensitivity: number; preSeconds: number; postSeconds: number; schedule: Schedule; webhookUrl?: string | null }) {
    if (!this.getRule(cameraId)) return null;
    const current = this.ensureRule(cameraId);
    const webhook = input.webhookUrl === undefined ? current.webhook_ciphertext : input.webhookUrl ? encryptSecret(input.webhookUrl, this.key) : null;
    this.options.database.db.prepare('UPDATE camera_event_rules SET enabled=?,sensitivity=?,pre_seconds=?,post_seconds=?,schedule_json=?,webhook_ciphertext=? WHERE camera_id=?').run(Number(input.enabled), input.sensitivity, input.preSeconds, input.postSeconds, JSON.stringify(input.schedule), webhook, cameraId);
    return this.getRule(cameraId);
  }
  private scheduled(schedule: Schedule, at: Date, timezone: string) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const day = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(values.weekday ?? '');
    const point = Number(values.hour) * 60 + Number(values.minute);
    const start = minutes(schedule.start); const end = minutes(schedule.end);
    if (start <= end) return schedule.days.includes(day) && point >= start && point < end;
    const prior = (day + 6) % 7;
    return (schedule.days.includes(day) && point >= start) || (schedule.days.includes(prior) && point < end);
  }
  ingest(cameraId: string, confidence: number, at = new Date()) {
    const camera = this.options.database.db.prepare('SELECT id,recording_mode FROM cameras WHERE id=? AND enabled=1 AND deleted_at IS NULL').get(cameraId) as any;
    if (!camera) return null;
    const ruleRow = this.ensureRule(cameraId); const rule = this.getRule(cameraId)!;
    const settings = this.options.database.db.prepare("SELECT value_json FROM settings WHERE key='system'").get() as any;
    const timezone = JSON.parse(settings?.value_json ?? '{}').timezone ?? 'Asia/Ho_Chi_Minh';
    if (!rule.enabled || confidence < rule.sensitivity / 100 || !this.scheduled(rule.schedule, at, timezone)) return null;
    const startAt = new Date(at.getTime() - rule.preSeconds * 1000).toISOString();
    const endAt = new Date(at.getTime() + rule.postSeconds * 1000).toISOString();
    const open = this.options.database.db.prepare("SELECT id,end_at FROM events WHERE camera_id=? AND type='motion' AND end_at>=? ORDER BY end_at DESC LIMIT 1").get(cameraId, new Date(at.getTime() - 2_000).toISOString()) as any;
    const id = open?.id ?? randomUUID(); const now = new Date().toISOString();
    if (open) this.options.database.db.prepare('UPDATE events SET end_at=MAX(end_at,?),confidence=MAX(COALESCE(confidence,0),?),updated_at=? WHERE id=?').run(endAt, confidence, now, id);
    else this.options.database.db.prepare("INSERT INTO events(id,camera_id,type,start_at,end_at,confidence,updated_at) VALUES (?,?,'motion',?,?,?,?)").run(id, cameraId, startAt, endAt, confidence, now);
    this.options.database.db.prepare('INSERT OR IGNORE INTO event_recordings(event_id,recording_id) SELECT ?,id FROM recordings WHERE camera_id=? AND state IN (\'writing\',\'ready\') AND start_at<=? AND COALESCE(end_at,?)>=?').run(id, cameraId, endAt, endAt, startAt);
    if (!open && ruleRow.webhook_ciphertext) this.options.database.db.prepare("INSERT INTO webhook_deliveries VALUES (?,?,?,'pending',0,?,NULL,?)").run(randomUUID(), id, ruleRow.webhook_ciphertext, now, now);
    return this.get(id);
  }
  get(id: string) { const row = this.options.database.db.prepare('SELECT * FROM events WHERE id=?').get(id) as any; return row ? this.dto(row) : null; }
  list(input: { cameraId?: string | undefined; type?: string | undefined; from?: string | undefined; to?: string | undefined }) {
    const rows = this.options.database.db.prepare('SELECT * FROM events WHERE (? IS NULL OR camera_id=?) AND (? IS NULL OR type=?) AND start_at<=? AND COALESCE(end_at,start_at)>=? ORDER BY start_at DESC LIMIT 200').all(input.cameraId ?? null,input.cameraId ?? null,input.type ?? null,input.type ?? null,input.to ?? '9999-12-31T23:59:59.999Z',input.from ?? '1970-01-01T00:00:00.000Z') as any[];
    return rows.map(row => this.dto(row));
  }
  private dto(row: any) { const links = this.options.database.db.prepare('SELECT recording_id FROM event_recordings WHERE event_id=?').all(row.id) as any[]; return { id: row.id, cameraId: row.camera_id, type: row.type, startAt: row.start_at, endAt: row.end_at, confidence: row.confidence, recordingIds: links.map(item => item.recording_id) }; }
  async deliverDue() {
    const rows = this.options.database.db.prepare("SELECT * FROM webhook_deliveries WHERE state='pending' AND next_attempt_at<=? ORDER BY next_attempt_at LIMIT 20").all(new Date().toISOString()) as any[];
    for (const row of rows) {
      const event = this.get(row.event_id); if (!event) continue;
      try {
        const url = decryptSecret(row.url_ciphertext, this.key);
        const response = await (this.options.fetcher ?? fetch)(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'home-nvr.motion', version: 1, event }), signal: AbortSignal.timeout(5_000) });
        if (!response.ok) throw new Error('WEBHOOK_HTTP_' + response.status);
        this.options.database.db.prepare("UPDATE webhook_deliveries SET state='delivered',attempts=attempts+1,last_error=NULL WHERE id=?").run(row.id);
      } catch {
        const attempts = row.attempts + 1; const state = attempts >= 5 ? 'failed' : 'pending'; const next = new Date(Date.now() + Math.min(300_000, 10_000 * 2 ** attempts)).toISOString();
        this.options.database.db.prepare('UPDATE webhook_deliveries SET state=?,attempts=?,next_attempt_at=?,last_error=? WHERE id=?').run(state, attempts, next, 'DELIVERY_FAILED', row.id);
      }
    }
  }
}
