import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/database.js';
import { createLogger } from '../src/logger.js';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'home-nvr-api-test-'));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const database = openDatabase(directory);
  cleanup.push(() => database.close());
  const logs: string[] = [];
  const app = await buildApp(loadConfig({ NVR_DATA_DIR: directory }), { database, logger: createLogger('info', { write: line => { logs.push(line); } }), serveWeb: false });
  cleanup.push(() => app.close());
  return { app, database, logs };
}

describe('HTTP và WebSocket nền tảng', () => {
  it('trả health thật và không khai media đã sẵn sàng', async () => {
    const { app } = await setup();
    expect((await app.inject('/health/live')).json()).toEqual({ status: 'ok' });
    expect((await app.inject('/health/ready')).statusCode).toBe(200);
    const response = await app.inject('/api/v1/system/status');
    expect(response.json()).toEqual({ phase: 7, database: 'ok', media: 'not-configured', recording: 'not-configured', events: 'ready', remote: 'disabled', setup: 'owner-required' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
  it('readiness 503 khi database lỗi, liveness vẫn 200', async () => {
    const { app, database } = await setup();
    database.close();
    expect((await app.inject('/health/ready')).statusCode).toBe(503);
    expect((await app.inject('/api/v1/system/status')).json().database).toBe('error');
    expect((await app.inject('/health/live')).statusCode).toBe(200);
  });
  it('route chưa triển khai trả 404 thay vì dữ liệu camera giả', async () => {
    const { app } = await setup();
    const response = await app.inject('/api/v1/cameras');
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
  });
  it('chặn host/origin lạ và cho phép Vite proxy', async () => {
    const { app } = await setup();
    expect((await app.inject({ url: '/health/live', headers: { host: 'evil.example' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/health/live', headers: { origin: 'https://evil.example' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/health/live', headers: { origin: 'http://127.0.0.1:5173' } })).statusCode).toBe(200);
  });
  it('không phản chiếu secret trên URL, request-id hoặc exception', async () => {
    const { app, logs } = await setup();
    app.get('/test-error', async () => { throw new Error('rtsp://admin:error-secret@camera/live'); });
    const response = await app.inject({ url: '/test-error?token=url-secret', headers: { authorization: 'Bearer auth-secret', 'x-request-id': 'request-secret' } });
    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('INTERNAL_ERROR');
    const output = response.body + logs.join('');
    for (const secret of ['error-secret', 'url-secret', 'auth-secret', 'request-secret']) expect(output).not.toContain(secret);
  });
  it('công bố OpenAPI và phân biệt danh mục tương lai', async () => {
    const { app } = await setup();
    const document = (await app.inject('/api/v1/openapi.json')).json();
    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document.paths)).toEqual(['/system/status', '/auth/status', '/auth/setup', '/auth/login', '/auth/logout', '/auth/me', '/users', '/users/{id}', '/cameras', '/cameras/{id}', '/cameras/discovery', '/cameras/onvif-probe', '/cameras/{id}/probe', '/live-sessions', '/live-sessions/{id}', '/live-sessions/{id}/whep', '/recordings', '/recordings/{id}/playback', '/recordings/export', '/recordings/exports/{exportId}/{asset}', '/events', '/cameras/{id}/event-rule', '/cameras/{id}/motion', '/settings', '/remote/status', '/remote/cloudflare/dns/preview', '/remote/cloudflare/dns/apply']);
    expect(document.paths['/recordings']).toBeDefined();
    expect(document['x-planned-operations'].length).toBeGreaterThan(10);
  });
  it('truyền trạng thái qua WebSocket thật và đóng kênh khi client gửi dữ liệu', async () => {
    const { app } = await setup();
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const socket = new WebSocket(`${address.replace('http:', 'ws:')}/ws/v1/system`, { origin: 'http://127.0.0.1:5173' });
    cleanup.push(() => socket.terminate());
    const message = await new Promise<string>((resolve, reject) => {
      socket.once('message', data => resolve(data.toString()));
      socket.once('error', reject);
    });
    expect(JSON.parse(message)).toMatchObject({ type: 'system.status', version: 1, data: { database: 'ok' } });
    const close = new Promise<number>(resolve => socket.once('close', code => resolve(code)));
    socket.send('không được ghi');
    expect(await close).toBe(1008);
  });
  it('từ chối WebSocket có origin khác trước khi upgrade', async () => {
    const { app } = await setup();
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const socket = new WebSocket(`${address.replace('http:', 'ws:')}/ws/v1/system`, { origin: 'https://evil.example' });
    cleanup.push(() => socket.terminate());
    const code = await new Promise<number>((resolve, reject) => {
      socket.once('unexpected-response', (_request, response) => { response.resume(); resolve(response.statusCode ?? 0); });
      socket.once('error', reject);
    });
    expect(code).toBe(403);
  });
  it('chỉ cho phép hostname Tunnel đã khai báo và dùng cookie Secure', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'home-nvr-remote-test-'));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const database = openDatabase(directory);
    cleanup.push(() => database.close());
    const remoteManager = {
      health: () => 'ready' as const,
      publicOrigin: () => 'https://nvr.example.com',
      reconcile: async () => undefined,
      shutdown: async () => undefined,
    };
    const config = loadConfig({ NVR_DATA_DIR: directory, NVR_SETUP_TOKEN: 't'.repeat(40), NVR_PUBLIC_ORIGIN: 'https://nvr.example.com' });
    const app = await buildApp(config, { database, remoteManager, logger: createLogger('silent'), serveWeb: false });
    cleanup.push(() => app.close());
    const owner = await app.inject({ method: 'POST', url: '/api/v1/auth/setup', headers: { host: 'nvr.example.com', origin: 'https://nvr.example.com' }, payload: { username: 'remote-owner', password: 'a-very-strong-password', setupToken: config.setupToken } });
    expect(owner.statusCode).toBe(201);
    expect(owner.headers['set-cookie']).toContain('Secure');
    expect(owner.headers['strict-transport-security']).toContain('max-age=');
    const remote = await app.inject({ url: '/api/v1/remote/status', headers: { host: 'nvr.example.com', origin: 'https://nvr.example.com', cookie: owner.headers['set-cookie'] } });
    expect(remote.json()).toEqual({ state: 'ready', publicOrigin: 'https://nvr.example.com', lanIndependent: true });
    expect((await app.inject({ url: '/health/live', headers: { host: 'another.example.com' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/health/ready', headers: { host: '127.0.0.1:3000' } })).statusCode).toBe(200);
  });
  it('chỉ owner được gọi cấu hình Cloudflare DNS', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/remote/cloudflare/dns/preview',
      payload: {
        zoneName: 'example.com',
        hostname: 'nvr.example.com',
        tunnelTarget: 'abc.cfargotunnel.com',
        proxied: true,
        apiToken: 'token-value-123456789',
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain('token-value-123456789');
  });});
