import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { LiveSession } from '@home-nvr/contracts';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/database.js';
import { createLogger } from '../src/logger.js';
import type { MediaGateway, MediaSource } from '../src/media.js';

class FakeMedia implements MediaGateway {
  configured: MediaSource[] = [];
  closed: string[] = [];
  health() { return 'ready' as const; }
  async start() {}
  async configure(_cameraId: string, sources: readonly MediaSource[]) { this.configured.push(...sources); }
  async remove() {}
  async getState() { return 'online' as const; }
  async openSession(input: { cameraId: string; userId: string; profile: 'main' | 'sub'; transport: 'webrtc' | 'll-hls' }): Promise<LiveSession> {
    return { id: randomUUID(), cameraId: input.cameraId, profile: input.profile, transport: input.transport, state: 'starting', endpoint: '/api/v1/live-sessions/fake/whep', expiresAt: new Date(Date.now() + 60_000).toISOString() };
  }
  async whepOffer() { return { status: 201, body: 'v=0\\r\\n', location: '/api/v1/live-sessions/fake/whep' }; }
  async fetchHls(_sessionId: string, _asset: string, _query?: URLSearchParams) { return new Response('#EXTM3U\\n', { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' } }); }
  async closeSession(id: string) { this.closed.push(id); }
  async shutdown() {}
}

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'home-nvr-media-test-'));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const database = openDatabase(directory);
  const media = new FakeMedia();
  const app = await buildApp(loadConfig({ NVR_DATA_DIR: directory, NVR_SETUP_TOKEN: 's'.repeat(32), NVR_SECRET_KEY: 'k'.repeat(32) }), { database, mediaGateway: media, logger: createLogger('silent'), serveWeb: false });
  cleanup.push(() => app.close());
  const owner = await app.inject({ method: 'POST', url: '/api/v1/auth/setup', payload: { username: 'owner', password: 'strong-password-123', setupToken: 's'.repeat(32) } });
  const cookie = String(owner.headers['set-cookie']).split(';')[0];
  const camera = await app.inject({ method: 'POST', url: '/api/v1/cameras', headers: { cookie, origin: 'http://127.0.0.1:5173' }, payload: { name: 'Cổng trước', location: 'Sân', mainSourceUrl: 'rtsp://admin:secret@127.0.0.1/live' } });
  return { app, media, cookie, camera: camera.json() as { id: string } };
}

describe('Media gateway và live session', () => {
  it('kiểm quyền, giải mã nguồn trong bộ nhớ và proxy WHEP/LL-HLS', async () => {
    const { app, media, cookie, camera } = await setup();
    const webRtc = (await app.inject({ method: 'POST', url: '/api/v1/live-sessions', headers: { cookie, origin: 'http://127.0.0.1:5173' }, payload: { cameraId: camera.id, profile: 'main', transport: 'webrtc' } })).json() as LiveSession;
    expect(media.configured[0]?.sourceUrl).toBe('rtsp://admin:secret@127.0.0.1/live');
    const live = (await app.inject({ method: 'POST', url: '/api/v1/live-sessions', headers: { cookie, origin: 'http://127.0.0.1:5173' }, payload: { cameraId: camera.id, profile: 'main', transport: 'll-hls' } })).json() as LiveSession;
    const hls = await app.inject({ method: 'GET', url: '/api/v1/live-sessions/' + live.id + '/hls/index.m3u8?_HLS_msn=4', headers: { cookie } });
    expect(hls.statusCode).toBe(200);
    expect(hls.headers['content-type']).toContain('application/vnd.apple.mpegurl');
    const whep = await app.inject({ method: 'POST', url: '/api/v1/live-sessions/' + webRtc.id + '/whep', headers: { cookie, origin: 'http://127.0.0.1:5173', 'content-type': 'application/sdp' }, payload: 'v=0\\r\\n' });
    expect(whep.statusCode).toBe(201);
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/live-sessions/' + live.id, headers: { cookie, origin: 'http://127.0.0.1:5173' } })).statusCode).toBe(204);
    expect(media.closed).toContain(live.id);
  });

  it('từ chối live session chưa đăng nhập và camera không tồn tại', async () => {
    const { app, cookie } = await setup();
    expect((await app.inject({ method: 'POST', url: '/api/v1/live-sessions', payload: { cameraId: randomUUID(), profile: 'main', transport: 'webrtc' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/v1/live-sessions', headers: { cookie }, payload: { cameraId: randomUUID(), profile: 'main', transport: 'webrtc' } })).statusCode).toBe(403);
  });
});
