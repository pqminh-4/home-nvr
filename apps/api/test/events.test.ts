import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../src/database.js';
import { EventService } from '../src/events.js';

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(fn => fn()); });

function setup(fetcher?: typeof fetch) {
  const directory = mkdtempSync(join(tmpdir(), 'home-nvr-event-test-'));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const database = openDatabase(directory); cleanup.push(() => database.close());
  const cameraId = randomUUID(); const recordingId = randomUUID();
  database.db.prepare('INSERT INTO cameras(id,name,created_at,updated_at,recording_mode) VALUES (?,?,?,?,?)').run(cameraId, 'Cổng trước', '2026-09-08T00:00:00.000Z', '2026-09-08T00:00:00.000Z', 'event');
  database.db.prepare('INSERT INTO recordings VALUES (?,?,?,?,?,?,?)').run(recordingId, cameraId, 'recordings/test.mp4', '2026-09-08T15:59:00.000Z', '2026-09-08T16:02:00.000Z', 'ready', 10);
  const service = new EventService({ database, secretKey: 'event-test-secret-key-32-characters', ...(fetcher ? { fetcher } : {}) });
  return { database, cameraId, recordingId, service };
}

describe('Motion event, lịch và webhook', () => {
  it('lọc theo độ nhạy, hỗ trợ lịch qua nửa đêm và gộp tín hiệu liên tiếp', () => {
    const { cameraId, recordingId, service } = setup();
    service.updateRule(cameraId, { enabled: true, sensitivity: 60, preSeconds: 10, postSeconds: 20, schedule: { days: [2], start: '22:00', end: '06:00' } });
    expect(service.ingest(cameraId, 0.4, new Date('2026-09-08T16:00:00.000Z'))).toBeNull();
    const first = service.ingest(cameraId, 0.8, new Date('2026-09-08T16:00:00.000Z'))!;
    const second = service.ingest(cameraId, 0.9, new Date('2026-09-08T16:00:01.000Z'))!;
    expect(second.id).toBe(first.id);
    expect(second.recordingIds).toContain(recordingId);
    expect(second.endAt).toBe('2026-09-08T16:00:21.000Z');
  });

  it('retry webhook và chỉ đánh delivered khi upstream thành công', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 500 })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { database, cameraId, service } = setup(fetcher);
    service.updateRule(cameraId, { enabled: true, sensitivity: 50, preSeconds: 5, postSeconds: 10, schedule: { days: [2], start: '00:00', end: '24:00' }, webhookUrl: 'https://example.test/hooks/home' });
    service.ingest(cameraId, 0.9, new Date('2026-09-08T10:00:00.000Z'));
    await service.deliverDue();
    expect(database.db.prepare('SELECT state,attempts FROM webhook_deliveries').get()).toMatchObject({ state: 'pending', attempts: 1 });
    database.db.prepare("UPDATE webhook_deliveries SET next_attempt_at='2020-01-01T00:00:00.000Z'").run();
    await service.deliverDue();
    expect(database.db.prepare('SELECT state,attempts FROM webhook_deliveries').get()).toMatchObject({ state: 'delivered', attempts: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
