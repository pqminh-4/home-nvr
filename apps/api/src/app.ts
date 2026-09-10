import Fastify, { LogController } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Logger } from 'pino';
import {
  createOpenApiDocument, HealthSchema, SystemStatusSchema, RemoteStatusSchema, CloudflareDnsPlanSchema, CloudflareDnsSchema, OwnerSetupSchema, LoginSchema, CameraCreateSchema, CameraUpdateSchema, GuestCreateSchema, GuestUpdateSchema, OnvifProbeSchema, LiveSessionCreateSchema, RecordingExportSchema, EventRuleUpdateSchema, MotionSignalSchema, SettingsUpdateSchema,
  type ApiError, type SystemMessage, type SystemStatus,
} from '@home-nvr/contracts';
import type { AppConfig } from './config.js';
import { openDatabase, type AppDatabase } from './database.js';
import { createLogger } from './logger.js';
import { createSessionToken, hashPassword, hashSessionToken, needsPasswordRehash, verifyPassword } from './auth.js';
import { deriveSecretKey, encryptSecret, decryptSecret } from './secrets.js';
import { parseSource, probeRtsp } from './probe.js';
import { discoverOnvif } from './onvif.js';
import { probeOnvif } from './onvif-probe.js';
import type { MediaGateway } from './media.js';
import { RecordingManagerService, type RecordingManager } from './recording.js';
import { createReadStream } from 'node:fs';
import { EventService } from './events.js';
import { CloudflareTunnelService, type RemoteManager } from './remote.js';
import { CloudflareDnsService } from './cloudflare.js';

export interface AppOptions { database?: AppDatabase; logger?: Logger; serveWeb?: boolean; mediaGateway?: MediaGateway; recordingManager?: RecordingManager; eventService?: EventService; remoteManager?: RemoteManager; cloudflareDnsService?: CloudflareDnsService }

export async function buildApp(config: AppConfig, options: AppOptions = {}) {
  const database = options.database ?? openDatabase(config.dataDir);
  let remoteManager = options.remoteManager;
  const recordingManager = options.recordingManager ?? new RecordingManagerService({ database, dataDir: config.dataDir, secretKey: config.secretKey, mediaGateway: options.mediaGateway });
  const eventService = options.eventService ?? new EventService({ database, secretKey: config.secretKey });
  eventService.start();
  try { await recordingManager.start(); } catch { /* Hiển thị lỗi qua system status, không làm mất API. */ }
  const app = Fastify({
    loggerInstance: options.logger ?? createLogger(config.logLevel),
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    bodyLimit: 64 * 1024,
    requestTimeout: 15_000,
    connectionTimeout: 10_000,
    trustProxy: config.publicOrigin ? '127.0.0.1' : false,
  });
  app.addHook('onClose', async () => { eventService.stop(); await remoteManager?.shutdown(); await recordingManager.shutdown(); await options.mediaGateway?.shutdown(); database.close(); });
  const errorBody = (code: string, message: string, requestId: string): ApiError => ({ error: { code, message, requestId } });

  await app.register(websocket, { options: { maxPayload: 1024, perMessageDeflate: false } });
  app.addContentTypeParser('application/sdp', { parseAs: 'string', bodyLimit: 128 * 1024 }, (_request, body, done) => done(null, body));

  // Chặn DNS rebinding và chỉ chấp nhận hostname Tunnel đã khai báo.
  const publicHost = config.publicOrigin ? new URL(config.publicOrigin).host : '';
  const isRemoteRequest = (request: any) => Boolean(publicHost && String(request.headers.host ?? '').toLowerCase() === publicHost.toLowerCase());
  app.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host ?? '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) && host.toLowerCase() !== publicHost.toLowerCase()) {
      return reply.code(403).send(errorBody('INVALID_HOST', 'Host không được phép.', request.id));
    }
    const origin = request.headers.origin;
    const allowedOrigins = new Set([`http://${host}`, config.webOrigin, config.publicOrigin].filter(Boolean));
    if (origin && !allowedOrigins.has(origin)) {
      return reply.code(403).send(errorBody('INVALID_ORIGIN', 'Origin không được phép.', request.id));
    }
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (mutation && String(request.headers.cookie ?? '').includes('nvr_session=') && !origin) {
      return reply.code(403).send(errorBody('CSRF_ORIGIN_REQUIRED', 'Mutation cần Origin hợp lệ.', request.id));
    }
  });
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cache-Control', 'no-store');
    if (isRemoteRequest(request)) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  });
  app.addHook('onResponse', async (request, reply) => {
    app.log.info({ requestId: request.id, method: request.method, route: request.routeOptions.url ?? 'unknown', statusCode: reply.statusCode }, 'Yêu cầu đã hoàn tất');
  });
  app.setErrorHandler((error, request, reply) => {
    const statusCode = error instanceof Error && 'statusCode' in error ? error.statusCode : 500;
    const status = typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500 ? statusCode : 500;
    // Không đưa message/stack của lỗi nội bộ hoặc nội dung yêu cầu ra response/log.
    app.log.error({ requestId: request.id, statusCode: status }, 'Xử lý yêu cầu thất bại');
    void reply.code(status).send(errorBody(status >= 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST', status >= 500 ? 'Không thể xử lý yêu cầu.' : 'Yêu cầu không hợp lệ.', request.id));
  });


  // Auth phiên cookie HttpOnly; chỉ hash token phiên được lưu trong SQLite.
  const cookieToken = (request: any) => String(request.headers.cookie ?? '').split(';').map((item: string) => item.trim()).find((item: string) => item.startsWith('nvr_session='))?.slice('nvr_session='.length) ?? '';
  const publicUser = (row: any) => ({ id: row.id, username: row.username, role: row.role, expiresAt: row.expires_at, cameraIds: database.db.prepare('SELECT camera_id FROM camera_grants WHERE user_id = ?').all(row.id).map((item: any) => item.camera_id), createdAt: row.created_at });
  const sessionUser = (request: any) => { const token = cookieToken(request); if (!token) return null; const row = database.db.prepare('SELECT u.* FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?').get(hashSessionToken(token), new Date().toISOString()) as any; return row && (!row.expires_at || Date.parse(row.expires_at) > Date.now()) ? row : null; };
  const cookieFlags = (request: any) => `HttpOnly; SameSite=Strict; Path=/; ${isRemoteRequest(request) || config.webOrigin.startsWith('https://') ? 'Secure; ' : ''}`;
  const setSession = (request: any, reply: any, userId: string) => { const token = createSessionToken(); const now = new Date(); const expires = new Date(now.getTime() + 7 * 86400000).toISOString(); database.db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').run(hashSessionToken(token), userId, expires, now.toISOString()); reply.header('Set-Cookie', `nvr_session=${token}; ${cookieFlags(request)}Max-Age=604800`); };
  const loginAttempts = new Map<string, { count: number; resetAt: number }>();
  app.post('/api/v1/auth/setup', { schema: { body: OwnerSetupSchema } }, async (request, reply) => {
    const body = request.body as any;
    if (!config.setupToken || body?.setupToken !== config.setupToken) return reply.code(403).send(errorBody('SETUP_FORBIDDEN', 'Setup token không hợp lệ.', request.id));
    if (database.db.prepare("SELECT 1 FROM users WHERE role = 'owner'").get()) return reply.code(409).send(errorBody('ALREADY_SETUP', 'Owner đã được thiết lập.', request.id));
    const id = randomUUID(); const now = new Date().toISOString();
    database.db.prepare('INSERT INTO users(id,username,password_hash,role,expires_at,created_at) VALUES (?,?,?,?,?,?)').run(id, body.username, hashPassword(body.password), 'owner', null, now);
    const user = database.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any; setSession(request, reply, id); return reply.code(201).send(publicUser(user));
  });
  app.post('/api/v1/auth/login', { schema: { body: LoginSchema } }, async (request, reply) => {
    const body = request.body as any; const key = request.ip + ':' + body.username.toLocaleLowerCase('en-US'); const now = Date.now(); const attempt = loginAttempts.get(key);
    if (attempt && attempt.resetAt > now && attempt.count >= 5) return reply.code(429).send(errorBody('LOGIN_RATE_LIMITED', 'Thử lại sau ít phút.', request.id));
    const user = database.db.prepare('SELECT * FROM users WHERE username=?').get(body.username) as any;
    if (!user || !verifyPassword(body.password, user.password_hash) || (user.expires_at && user.expires_at <= new Date().toISOString())) { loginAttempts.set(key, { count: attempt && attempt.resetAt > now ? attempt.count + 1 : 1, resetAt: now + 300_000 }); if (loginAttempts.size > 1000) loginAttempts.clear(); return reply.code(401).send(errorBody('INVALID_CREDENTIALS', 'Tên đăng nhập hoặc mật khẩu không đúng.', request.id)); }
    loginAttempts.delete(key); if (needsPasswordRehash(user.password_hash)) database.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(body.password), user.id);
    setSession(request, reply, user.id); return reply.send(publicUser(user));
  });  app.post('/api/v1/auth/logout', async (request, reply) => { const token = cookieToken(request); if (token) database.db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hashSessionToken(token)); reply.header('Set-Cookie', `nvr_session=; ${cookieFlags(request)}Max-Age=0`); return reply.code(204).send(); });
  app.get('/api/v1/auth/me', async (request, reply) => { const user = sessionUser(request); if (!user) return reply.code(401).send(errorBody('UNAUTHENTICATED', 'Cần đăng nhập.', request.id)); return reply.send(publicUser(user)); });
  // Camera API kiểm tra session/quyền và chỉ lưu URL nguồn dưới dạng ciphertext.
  const cameraDto = (row: any) => { const stored = JSON.parse(row.capabilities_json); return { id: row.id, name: row.name, location: row.location, enabled: Boolean(row.enabled), state: !row.enabled ? 'disabled' : row.last_probe_code === 'READY' ? 'online' : row.last_probe_code ? 'error' : 'offline', recordingMode: row.recording_mode, capabilities: { ptz: Boolean(stored.ptz), audio: Boolean(stored.audio), talk: Boolean(stored.talk), substream: Boolean(stored.substream) }, lastProbe: row.last_probe_at ? { code: row.last_probe_code, at: row.last_probe_at, latencyMs: row.probe_latency_ms } : null, createdAt: row.created_at, updatedAt: row.updated_at }; };
  const ownerOnly = (request: any, reply: any) => { const user = sessionUser(request); if (!user) { void reply.code(401).send(errorBody('UNAUTHENTICATED', 'Cần đăng nhập.', request.id)); return null; } if (user.role !== 'owner') { void reply.code(403).send(errorBody('FORBIDDEN', 'Owner mới có quyền thao tác.', request.id)); return null; } return user; };
  app.get('/api/v1/cameras', async (request, reply) => { const user = sessionUser(request); if (!user) return reply.code(401).send(errorBody('UNAUTHENTICATED', 'Cần đăng nhập.', request.id)); const rows = user.role === 'owner' ? database.db.prepare('SELECT * FROM cameras WHERE deleted_at IS NULL ORDER BY created_at').all() : database.db.prepare('SELECT c.* FROM cameras c JOIN camera_grants g ON g.camera_id = c.id WHERE g.user_id = ? AND c.deleted_at IS NULL ORDER BY c.created_at').all(user.id); return reply.send((rows as any[]).map(cameraDto)); });
  app.post('/api/v1/cameras', { schema: { body: CameraCreateSchema } }, async (request, reply) => {
    if (!ownerOnly(request, reply)) return;
    const body = request.body as any;
    try { parseSource(body.mainSourceUrl); if (body.subSourceUrl) parseSource(body.subSourceUrl); }
    catch { return reply.code(400).send(errorBody('INVALID_CAMERA', 'Thông tin camera hoặc URL nguồn không hợp lệ.', request.id)); }
    if (!config.secretKey) return reply.code(503).send(errorBody('SECRET_KEY_MISSING', 'Chưa cấu hình khóa mã hóa camera.', request.id));
    const id = randomUUID(); const now = new Date().toISOString(); const key = deriveSecretKey(config.secretKey);
    transaction(() => {
      database.db.prepare('INSERT INTO cameras(id,name,location,capabilities_json,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id, body.name, body.location ?? '', JSON.stringify({ ptz: false, audio: false, talk: false, substream: Boolean(body.subSourceUrl) }), now, now);
      const insert = database.db.prepare('INSERT INTO camera_streams(camera_id,profile,source_ciphertext) VALUES (?,?,?)');
      insert.run(id, 'main', encryptSecret(body.mainSourceUrl, key)); if (body.subSourceUrl) insert.run(id, 'sub', encryptSecret(body.subSourceUrl, key));
    });
    return reply.code(201).send(cameraDto(database.db.prepare('SELECT * FROM cameras WHERE id=?').get(id)));
  });
  app.patch('/api/v1/cameras/:id', { schema: { body: CameraUpdateSchema } }, async (request, reply) => {
    if (!ownerOnly(request, reply)) return;
    const body = request.body as any; const id = (request.params as any).id;
    const row = database.db.prepare('SELECT * FROM cameras WHERE id=? AND deleted_at IS NULL').get(id) as any;
    if (!row) return reply.code(404).send(errorBody('NOT_FOUND', 'Không tìm thấy camera.', request.id));
    try { if (body.mainSourceUrl) parseSource(body.mainSourceUrl); if (body.subSourceUrl) parseSource(body.subSourceUrl); }
    catch { return reply.code(400).send(errorBody('INVALID_CAMERA', 'URL nguồn camera không hợp lệ.', request.id)); }
    if ((body.mainSourceUrl !== undefined || body.subSourceUrl !== undefined) && !config.secretKey) return reply.code(503).send(errorBody('SECRET_KEY_MISSING', 'Chưa cấu hình khóa mã hóa camera.', request.id));
    const now = new Date().toISOString(); const changedSource = body.mainSourceUrl !== undefined || body.subSourceUrl !== undefined;
    transaction(() => {
      database.db.prepare('UPDATE cameras SET name=?,location=?,enabled=?,recording_mode=?,last_probe_code=?,last_probe_at=?,probe_latency_ms=?,updated_at=? WHERE id=?').run(body.name ?? row.name, body.location ?? row.location, body.enabled === undefined ? row.enabled : Number(body.enabled), body.recordingMode ?? row.recording_mode, changedSource ? null : row.last_probe_code, changedSource ? null : row.last_probe_at, changedSource ? null : row.probe_latency_ms, now, id);
      if (changedSource) { const key = deriveSecretKey(config.secretKey); const upsert = database.db.prepare('INSERT INTO camera_streams(camera_id,profile,source_ciphertext) VALUES (?,?,?) ON CONFLICT(camera_id,profile) DO UPDATE SET source_ciphertext=excluded.source_ciphertext'); if (body.mainSourceUrl) upsert.run(id, 'main', encryptSecret(body.mainSourceUrl, key)); if (body.subSourceUrl === null) database.db.prepare("DELETE FROM camera_streams WHERE camera_id=? AND profile='sub'").run(id); else if (body.subSourceUrl) upsert.run(id, 'sub', encryptSecret(body.subSourceUrl, key)); const caps = JSON.parse(row.capabilities_json); caps.substream = body.subSourceUrl === undefined ? Boolean(caps.substream) : body.subSourceUrl !== null; database.db.prepare('UPDATE cameras SET capabilities_json=? WHERE id=?').run(JSON.stringify(caps), id); }
    });
    void recordingManager.reconcile().catch(() => undefined);
    return reply.send(cameraDto(database.db.prepare('SELECT * FROM cameras WHERE id=?').get(id)));
  });
  app.delete('/api/v1/cameras/:id', async (request, reply) => { const user = ownerOnly(request, reply); if (!user) return; const id = (request.params as any).id; const result = database.db.prepare('UPDATE cameras SET deleted_at=?, enabled=0, updated_at=? WHERE id=? AND deleted_at IS NULL').run(new Date().toISOString(), new Date().toISOString(), id); if (!result.changes) return reply.code(404).send(errorBody('NOT_FOUND', 'Không tìm thấy camera.', request.id)); await recordingManager.stopCamera(id); return reply.code(204).send(); });
  // Tạo và cập nhật khách trong transaction; thay quyền hoặc mật khẩu thu hồi mọi phiên cũ.
  const transaction = <T,>(work: () => T): T => { database.db.exec('BEGIN IMMEDIATE'); try { const result = work(); database.db.exec('COMMIT'); return result; } catch (error) { database.db.exec('ROLLBACK'); throw error; } };
  const checkGrants = (ids: string[]) => ids.every(id => Boolean(database.db.prepare('SELECT 1 FROM cameras WHERE id=? AND deleted_at IS NULL').get(id)));
  const replaceGrants = (id: string, cameras: string[]) => { database.db.prepare('DELETE FROM camera_grants WHERE user_id=?').run(id); const insert = database.db.prepare('INSERT INTO camera_grants(user_id,camera_id) VALUES (?,?)'); for (const camera of cameras) insert.run(id, camera); };
  app.get('/api/v1/auth/status', async request => ({ configured: Boolean(database.db.prepare("SELECT 1 FROM users WHERE role='owner'").get()), setupAvailable: Boolean(config.setupToken), authenticated: Boolean(sessionUser(request)) }));
  app.get('/api/v1/users', async (request, reply) => { if (!ownerOnly(request, reply)) return; return database.db.prepare('SELECT * FROM users ORDER BY created_at').all().map(publicUser); });
  app.post('/api/v1/users', { schema: { body: GuestCreateSchema } }, async (request, reply) => { if (!ownerOnly(request, reply)) return; const body = request.body as any; if (Date.parse(body.expiresAt) <= Date.now() || !checkGrants(body.cameraIds)) return reply.code(400).send(errorBody('INVALID_GRANT', 'Hạn dùng hoặc camera được cấp không hợp lệ.', request.id)); if (database.db.prepare('SELECT 1 FROM users WHERE username=?').get(body.username)) return reply.code(409).send(errorBody('USERNAME_EXISTS', 'Tên đăng nhập đã tồn tại.', request.id)); const id = randomUUID(); transaction(() => { database.db.prepare('INSERT INTO users(id,username,password_hash,role,expires_at,created_at) VALUES (?,?,?,?,?,?)').run(id, body.username, hashPassword(body.password), 'guest', new Date(body.expiresAt).toISOString(), new Date().toISOString()); replaceGrants(id, body.cameraIds); }); return reply.code(201).send(publicUser(database.db.prepare('SELECT * FROM users WHERE id=?').get(id))); });
  app.patch('/api/v1/users/:id', { schema: { body: GuestUpdateSchema } }, async (request, reply) => { if (!ownerOnly(request, reply)) return; const id = (request.params as any).id; const old = database.db.prepare("SELECT * FROM users WHERE id=? AND role='guest'").get(id) as any; if (!old) return reply.code(404).send(errorBody('NOT_FOUND', 'Không tìm thấy khách.', request.id)); const body = request.body as any; if ((body.expiresAt && Date.parse(body.expiresAt) <= Date.now()) || (body.cameraIds && !checkGrants(body.cameraIds))) return reply.code(400).send(errorBody('INVALID_GRANT', 'Hạn dùng hoặc camera được cấp không hợp lệ.', request.id)); transaction(() => { database.db.prepare('UPDATE users SET password_hash=?,expires_at=? WHERE id=?').run(body.password ? hashPassword(body.password) : old.password_hash, body.expiresAt ? new Date(body.expiresAt).toISOString() : old.expires_at, id); if (body.cameraIds) replaceGrants(id, body.cameraIds); database.db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(id); }); return publicUser(database.db.prepare('SELECT * FROM users WHERE id=?').get(id)); });
  app.delete('/api/v1/users/:id', async (request, reply) => { if (!ownerOnly(request, reply)) return; const result = database.db.prepare("DELETE FROM users WHERE id=? AND role='guest'").run((request.params as any).id); if (!result.changes) return reply.code(404).send(errorBody('NOT_FOUND', 'Không tìm thấy khách.', request.id)); return reply.code(204).send(); });
  // Kiểm tra ONVIF trực tiếp và quét WS-Discovery chỉ chạy khi owner chủ động yêu cầu.
  app.post('/api/v1/cameras/onvif-probe', { schema: { body: OnvifProbeSchema } }, async (request, reply) => {
    if (!ownerOnly(request, reply)) return;
    const body = request.body as any;
    if (typeof body?.endpoint !== 'string' || typeof body?.username !== 'string' || typeof body?.password !== 'string' || body.username.length > 80 || body.password.length > 128) return reply.code(400).send(errorBody('INVALID_ONVIF', 'Thông tin ONVIF không hợp lệ.', request.id));
    const result = await probeOnvif(body.endpoint, body.username, body.password);
    return reply.send(result);
  });  app.post('/api/v1/cameras/discovery', async (request, reply) => { if (!ownerOnly(request, reply)) return; return reply.send(await discoverOnvif()); });
  app.post('/api/v1/cameras/:id/probe', async (request, reply) => {
    if (!ownerOnly(request, reply)) return;
    const id = (request.params as any).id;
    if (!config.secretKey) return reply.code(503).send(errorBody('SECRET_KEY_MISSING', 'Chưa cấu hình khóa mã hóa camera.', request.id));
    const stream = database.db.prepare("SELECT s.source_ciphertext FROM camera_streams s JOIN cameras c ON c.id=s.camera_id WHERE s.camera_id=? AND s.profile='main' AND c.deleted_at IS NULL").get(id) as any;
    if (!stream) return reply.code(404).send(errorBody('NOT_FOUND', 'Không tìm thấy camera.', request.id));
    const result = await probeRtsp(decryptSecret(stream.source_ciphertext, deriveSecretKey(config.secretKey)));
    const current = database.db.prepare('SELECT capabilities_json FROM cameras WHERE id=?').get(id) as any;
    const capabilities = { ...JSON.parse(current?.capabilities_json ?? '{}'), audio: result.audio };
    const probedAt = new Date().toISOString();
    database.db.prepare('UPDATE cameras SET capabilities_json=?, last_probe_code=?, last_probe_at=?, probe_latency_ms=?, updated_at=? WHERE id=?').run(JSON.stringify(capabilities), result.code, probedAt, result.latencyMs, probedAt, id);
    return reply.send(result);
  });
  // Live session chỉ mở cho camera người dùng được cấp; URL nguồn chỉ được giải mã trong bộ nhớ.
  const canViewCamera = (user: any, cameraId: string) => user.role === 'owner'
    ? Boolean(database.db.prepare('SELECT 1 FROM cameras WHERE id=? AND enabled=1 AND deleted_at IS NULL').get(cameraId))
    : Boolean(database.db.prepare('SELECT 1 FROM cameras c JOIN camera_grants g ON g.camera_id=c.id WHERE c.id=? AND g.user_id=? AND c.enabled=1 AND c.deleted_at IS NULL').get(cameraId, user.id));
  const activeLiveSession = (id: string, userId: string) => database.db.prepare("SELECT * FROM live_sessions WHERE id=? AND user_id=? AND closed_at IS NULL AND expires_at>?").get(id, userId, new Date().toISOString()) as any;

  app.post('/api/v1/live-sessions', { schema: { body: LiveSessionCreateSchema } }, async (request, reply) => {
    const user = sessionUser(request);
    if (!user) return reply.code(401).send(errorBody('UNAUTHENTICATED', 'Cần đăng nhập.', request.id));
    const body = request.body as any;
    if (!canViewCamera(user, body.cameraId)) return reply.code(403).send(errorBody('CAMERA_FORBIDDEN', 'Bạn không có quyền xem camera này.', request.id));
    if (!options.mediaGateway || options.mediaGateway.health() !== 'ready') return reply.code(503).send(errorBody('MEDIA_UNAVAILABLE', 'MediaMTX chưa sẵn sàng.', request.id));
    if (!config.secretKey) return reply.code(503).send(errorBody('SECRET_KEY_MISSING', 'Chưa cấu hình khóa mã hóa camera.', request.id));
    const stream = database.db.prepare('SELECT source_ciphertext FROM camera_streams WHERE camera_id=? AND profile=?').get(body.cameraId, body.profile) as any;
    if (!stream) return reply.code(404).send(errorBody('STREAM_NOT_FOUND', 'Camera không có profile được chọn.', request.id));
    try {
      const sourceUrl = decryptSecret(stream.source_ciphertext, deriveSecretKey(config.secretKey));
      await options.mediaGateway.configure(body.cameraId, [{ profile: body.profile, sourceUrl }]);
      const session = await options.mediaGateway.openSession({ cameraId: body.cameraId, userId: user.id, profile: body.profile, transport: body.transport });
      database.db.prepare('INSERT INTO live_sessions(id,camera_id,user_id,profile,transport,state,endpoint,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(session.id, session.cameraId, user.id, session.profile, session.transport, session.state, session.endpoint, session.expiresAt, new Date().toISOString());
      return reply.code(201).send(session);
    } catch {
      return reply.code(502).send(errorBody('MEDIA_CONFIG_FAILED', 'Không thể chuẩn bị luồng camera.', request.id));
    }
  });

  app.post('/api/v1/live-sessions/:id/whep', async (request, reply) => {
    const user = sessionUser(request);
    if (!user) return reply.code(401).send(errorBody('UNAUTHENTICATED', 'Cần đăng nhập.', request.id));
    const id = (request.params as any).id;
    if (!activeLiveSession(id, user.id)) return reply.code(404).send(errorBody('LIVE_SESSION_NOT_FOUND', 'Live session không còn hiệu lực.', request.id));
    if (!options.mediaGateway || typeof request.body !== 'string') return reply.code(503).send(errorBody('MEDIA_UNAVAILABLE', 'MediaMTX chưa sẵn sàng.', request.id));
    try {
      const result = await options.mediaGateway.whepOffer(id, request.body);
      if (result.link) reply.header('Link', result.link);
      if (result.location) reply.header('Location', result.location);
      reply.type('application/sdp');
      if (result.status >= 200 && result.status < 300) database.db.prepare("UPDATE live_sessions SET state='playing' WHERE id=?").run(id);
      return reply.code(result.status).send(result.body);
    } catch {
      database.db.prepare("UPDATE live_sessions SET state='failed' WHERE id=?").run(id);
      return reply.code(502).send(errorBody('WHEP_FAILED', 'Không thể thiết lập WebRTC.', request.id));
    }
  });

  app.get('/api/v1/live-sessions/:id/hls/*', async (request, reply) => {
    const user = sessionUser(request);
    if (!user) return reply.code(401).send(errorBody('UNAUTHENTICATED', 'Cần đăng nhập.', request.id));
    const id = (request.params as any).id;
    const asset = String((request.params as any)['*'] ?? '');
    const incomingQuery = request.query as Record<string, unknown>;
    const hlsQuery = new URLSearchParams();
    for (const key of ['_HLS_msn', '_HLS_part', '_HLS_skip']) { const value = incomingQuery?.[key]; if (typeof value === 'string' && /^[A-Za-z0-9._~-]{1,40}$/.test(value)) hlsQuery.set(key, value); }
    if (!activeLiveSession(id, user.id)) return reply.code(404).send(errorBody('LIVE_SESSION_NOT_FOUND', 'Live session không còn hiệu lực.', request.id));
    if (!options.mediaGateway) return reply.code(503).send(errorBody('MEDIA_UNAVAILABLE', 'MediaMTX chưa sẵn sàng.', request.id));
    try {
      const upstream = await options.mediaGateway.fetchHls(id, asset, hlsQuery);
      const contentType = upstream.headers.get('content-type');
      if (contentType) reply.type(contentType);
      const bytes = Buffer.from(await upstream.arrayBuffer());
      if (bytes.byteLength > 8 * 1024 * 1024) return reply.code(502).send(errorBody('MEDIA_ASSET_TOO_LARGE', 'Phân đoạn media vượt giới hạn.', request.id));
      if (upstream.ok) database.db.prepare("UPDATE live_sessions SET state='playing' WHERE id=?").run(id);
      return reply.code(upstream.status).send(bytes);
    } catch {
      return reply.code(502).send(errorBody('HLS_FAILED', 'Không thể tải LL-HLS.', request.id));
    }
  });

  app.delete('/api/v1/live-sessions/:id', async (request, reply) => {
    const user = sessionUser(request);
    if (!user) return reply.code(401).send(errorBody('UNAUTHENTICATED', 'Cần đăng nhập.', request.id));
    const id = (request.params as any).id;
    if (!activeLiveSession(id, user.id)) return reply.code(404).send(errorBody('LIVE_SESSION_NOT_FOUND', 'Live session không còn hiệu lực.', request.id));
    await options.mediaGateway?.closeSession(id);
    database.db.prepare("UPDATE live_sessions SET state='closed',closed_at=? WHERE id=?").run(new Date().toISOString(), id);
    return reply.code(204).send();
  });

  // Playback chỉ đọc bản ghi ready; file đang ghi không được phát hoặc xóa bởi retention.
  const recordingDto = (row: any) => ({ id: row.id, cameraId: row.camera_id, startAt: row.start_at, endAt: row.end_at, state: row.state, bytes: row.bytes });
  const sendMediaFile = async (request: any, reply: any, asset: { path: string; size: number; contentType: string }) => {
    const range = String(request.headers.range ?? '');
    let start = 0; let end = asset.size - 1; let partial = false;
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) { partial = true; if (match[1]) start = Number(match[1]); else if (match[2]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) return reply.code(416).header('Content-Range', 'bytes */' + asset.size).send(); start = Math.max(0, asset.size - suffix); } if (match[2] && match[1]) end = Number(match[2]); if (!match[2] && match[1]) end = asset.size - 1; if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= asset.size) return reply.code(416).header('Content-Range', 'bytes */' + asset.size).send(); end = Math.min(end, asset.size - 1); }
    reply.type(asset.contentType).header('Accept-Ranges', 'bytes').header('Content-Length', String(end - start + 1));
    if (partial) reply.code(206).header('Content-Range', 'bytes ' + start + '-' + end + '/' + asset.size);
    return reply.send(createReadStream(asset.path, { start, end }));
  };
  app.get('/api/v1/recordings', async (request, reply) => {
    if (!ownerOnly(request, reply)) return;
    const query = request.query as Record<string, unknown>;
    const cameraId = typeof query.cameraId === 'string' ? query.cameraId : undefined;
    const from = typeof query.from === 'string' && !Number.isNaN(Date.parse(query.from)) ? new Date(query.from).toISOString() : undefined;
    const to = typeof query.to === 'string' && !Number.isNaN(Date.parse(query.to)) ? new Date(query.to).toISOString() : undefined;
    const limit = typeof query.limit === 'string' && /^\d+$/.test(query.limit) ? Number(query.limit) : 50;
    return reply.send((recordingManager.list({ cameraId, from, to, limit }) as any[]).map(recordingDto));
  });
  app.get('/api/v1/recordings/:id/playback', async (request, reply) => {
    if (!ownerOnly(request, reply)) return;
    const asset = await recordingManager.playback((request.params as any).id);
    if (!asset) return reply.code(404).send(errorBody('RECORDING_NOT_FOUND', 'Không tìm thấy bản ghi.', request.id));
    return sendMediaFile(request, reply, asset);
  });
  app.post('/api/v1/recordings/export', { schema: { body: RecordingExportSchema } }, async (request, reply) => {
    if (!ownerOnly(request, reply)) return;
    const body = request.body as any;
    if (!Array.isArray(body?.recordingIds) || body.recordingIds.length < 1 || body.recordingIds.length > 100 || body.recordingIds.some((id: unknown) => typeof id !== 'string' || !/^[a-f0-9-]{16,80}$/.test(id))) return reply.code(400).send(errorBody('INVALID_EXPORT', 'Danh sách bản ghi export không hợp lệ.', request.id));
    try { return reply.code(202).send(await recordingManager.export(body.recordingIds)); } catch { return reply.code(404).send(errorBody('RECORDING_NOT_FOUND', 'Có bản ghi không còn tồn tại.', request.id)); }
  });
  app.get('/api/v1/recordings/exports/:exportId/*', async (request, reply) => {
    if (!ownerOnly(request, reply)) return;
    const params = request.params as any;
    const asset = await recordingManager.exportAsset(params.exportId, String(params['*'] ?? ''));
    if (!asset) return reply.code(404).send(errorBody('EXPORT_NOT_FOUND', 'Tệp export không còn hiệu lực.', request.id));
    return sendMediaFile(request, reply, asset);
  });
  app.get('/api/v1/events', async (request, reply) => {
    if (!ownerOnly(request, reply)) return;
    const query = request.query as Record<string, unknown>;
    return eventService.list({ cameraId: typeof query.cameraId === 'string' ? query.cameraId : undefined, type: typeof query.type === 'string' ? query.type : undefined, from: typeof query.from === 'string' ? query.from : undefined, to: typeof query.to === 'string' ? query.to : undefined });
  });
  app.get('/api/v1/cameras/:id/event-rule', async (request, reply) => {
    if (!ownerOnly(request, reply)) return;
    const rule = eventService.getRule((request.params as any).id);
    return rule ? reply.send(rule) : reply.code(404).send(errorBody('NOT_FOUND', 'Không tìm thấy camera.', request.id));
  });
  app.patch('/api/v1/cameras/:id/event-rule', { schema: { body: EventRuleUpdateSchema } }, async (request, reply) => {
    if (!ownerOnly(request, reply)) return;
    const rule = eventService.updateRule((request.params as any).id, request.body as any);
    return rule ? reply.send(rule) : reply.code(404).send(errorBody('NOT_FOUND', 'Không tìm thấy camera.', request.id));
  });
  app.post('/api/v1/cameras/:id/motion', { schema: { body: MotionSignalSchema } }, async (request, reply) => {
    if (!ownerOnly(request, reply)) return;
    const body = request.body as any;
    const event = eventService.ingest((request.params as any).id, body.confidence, body.at ? new Date(body.at) : new Date());
    return reply.send({ accepted: Boolean(event), event });
  });
  const readSettings = () => JSON.parse((database.db.prepare("SELECT value_json FROM settings WHERE key='system'").get() as any).value_json);
  remoteManager ??= new CloudflareTunnelService(config);
  await remoteManager.reconcile(Boolean(readSettings().remoteEnabled));
  app.get('/api/v1/settings', async (request, reply) => { if (!ownerOnly(request, reply)) return; return readSettings(); });
  app.patch('/api/v1/settings', { schema: { body: SettingsUpdateSchema } }, async (request, reply) => { if (!ownerOnly(request, reply)) return; const body = request.body as any; try { new Intl.DateTimeFormat('vi-VN', { timeZone: body.timezone }).format(); } catch { return reply.code(400).send(errorBody('INVALID_TIMEZONE', 'Múi giờ không hợp lệ.', request.id)); } database.db.prepare("UPDATE settings SET value_json=? WHERE key='system'").run(JSON.stringify(body)); await remoteManager.reconcile(Boolean(body.remoteEnabled)); return readSettings(); });
  const cloudflareDns = options.cloudflareDnsService ?? new CloudflareDnsService();
  const handleDns = async (request: any, reply: any, apply: boolean) => {
    if (!ownerOnly(request, reply)) return;
    try { return reply.send(apply ? await cloudflareDns.apply(request.body) : await cloudflareDns.plan(request.body)); }
    catch (error) { const message = error instanceof Error ? error.message : 'Không thể cấu hình DNS Cloudflare.'; return reply.code(400).send(errorBody('CLOUDFLARE_DNS_FAILED', message, request.id)); }
  };
  app.post('/api/v1/remote/cloudflare/dns/preview', { schema: { body: CloudflareDnsSchema, response: { 200: CloudflareDnsPlanSchema } } }, async (request, reply) => handleDns(request, reply, false));
  app.post('/api/v1/remote/cloudflare/dns/apply', { schema: { body: CloudflareDnsSchema, response: { 200: CloudflareDnsPlanSchema } } }, async (request, reply) => handleDns(request, reply, true));
  app.get('/api/v1/remote/status', { schema: { response: { 200: RemoteStatusSchema } } }, async (request, reply) => {
    if (!ownerOnly(request, reply)) return;
    return { state: remoteManager.health(), publicOrigin: remoteManager.publicOrigin(), lanIndependent: true as const };
  });
  const status = (): SystemStatus => { const healthy = database.isHealthy(); return { phase: 7, database: healthy ? 'ok' : 'error', media: options.mediaGateway?.health() ?? 'not-configured', recording: recordingManager.health(), events: 'ready', remote: remoteManager.health(), setup: healthy && database.db.prepare("SELECT 1 FROM users WHERE role='owner'").get() ? 'ready' : 'owner-required' }; };

  app.get('/health/live', { schema: { response: { 200: HealthSchema } } }, async () => ({ status: 'ok' as const }));
  app.get('/health/ready', { schema: { response: { 200: HealthSchema, 503: HealthSchema } } }, async (_req, reply) => {
    const ready = database.isHealthy();
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ok' : 'error' });
  });
  app.get('/api/v1/system/status', { schema: { response: { 200: SystemStatusSchema, 503: SystemStatusSchema } } }, async (_req, reply) => {
    const data = status();
    return reply.code(data.database === 'ok' ? 200 : 503).send(data);
  });
  app.get('/api/v1/openapi.json', async () => createOpenApiDocument());
  app.get('/ws/v1/system', { websocket: true }, socket => {
    const sendStatus = () => {
      if (socket.readyState !== 1) return;
      if (socket.bufferedAmount > 64 * 1024) { socket.close(1013, 'Kết nối quá chậm'); return; }
      const message: SystemMessage = { type: 'system.status', version: 1, timestamp: new Date().toISOString(), data: status() };
      socket.send(JSON.stringify(message));
    };
    socket.on('error', () => { app.log.warn('WebSocket bị gián đoạn'); });
    socket.on('message', () => { socket.close(1008, 'Kênh chỉ đọc'); });
    const timer = setInterval(sendStatus, 10_000);
    timer.unref();
    socket.on('close', () => clearInterval(timer));
    sendStatus();
  });

  const webRoot = fileURLToPath(new URL('../../web/dist/', import.meta.url));
  const serveWeb = options.serveWeb !== false && existsSync(`${webRoot}/index.html`);
  if (serveWeb) await app.register(fastifyStatic, { root: webRoot, index: 'index.html', dotfiles: 'deny' });
  app.setNotFoundHandler(async (request, reply) => {
    return reply.code(404).send(errorBody('NOT_FOUND', 'Đường dẫn chưa được triển khai.', request.id));
  });
  return app;
}
