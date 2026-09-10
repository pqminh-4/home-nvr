import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Camera, LiveSession } from '@home-nvr/contracts';

export interface MediaSource {
  profile: 'main' | 'sub';
  sourceUrl: string;
  record?: boolean;
  recordRoot?: string;
}

export interface MediaGateway {
  start(): Promise<void>;
  health(): 'not-configured' | 'starting' | 'ready' | 'error';
  configure(cameraId: string, sources: readonly MediaSource[]): Promise<void>;
  remove(cameraId: string): Promise<void>;
  getState(cameraId: string): Promise<Camera['state']>;
  openSession(input: { cameraId: string; userId: string; profile: 'main' | 'sub'; transport: 'webrtc' | 'll-hls' }): Promise<LiveSession>;
  whepOffer(sessionId: string, sdp: string): Promise<{ status: number; body: string; location?: string; link?: string }>;
  fetchHls(sessionId: string, asset: string, query?: URLSearchParams): Promise<Response>;
  closeSession(sessionId: string): Promise<void>;
  shutdown(): Promise<void>;
}

export interface MediaMtxOptions {
  binary: string;
  dataDir: string;
  apiUrl?: string;
  hlsUrl?: string;
  webrtcUrl?: string;
}

interface RuntimeSession extends LiveSession {
  userId: string;
  path: string;
  upstreamLocation?: string;
}

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
const cameraPath = (cameraId: string, profile: string) => 'camera_' + cameraId.replaceAll('-', '') + '_' + profile;

export class MediaMtxGateway implements MediaGateway {
  private state: ReturnType<MediaGateway['health']> = 'not-configured';
  private process: ChildProcess | null = null;
  private sessions = new Map<string, RuntimeSession>();
  private configured = new Set<string>();
  private recording = new Map<string, { enabled: boolean; root?: string | undefined }>();
  private readonly apiUrl: string;
  private readonly hlsUrl: string;
  private readonly webrtcUrl: string;

  constructor(private readonly options: MediaMtxOptions) {
    this.apiUrl = options.apiUrl ?? 'http://127.0.0.1:9997';
    this.hlsUrl = options.hlsUrl ?? 'http://127.0.0.1:8888';
    this.webrtcUrl = options.webrtcUrl ?? 'http://127.0.0.1:8889';
  }

  health() { return this.state; }

  async start() {
    if (!this.options.binary) return;
    this.state = 'starting';
    try {
      const directory = join(this.options.dataDir, 'runtime');
      await mkdir(directory, { recursive: true });
      const configPath = join(directory, 'mediamtx.yml');
      const config = [
        'logLevel: warn',
        'logDestinations: [stdout]',
        'api: yes',
        'apiAddress: 127.0.0.1:9997',
        'metrics: yes',
        'metricsAddress: 127.0.0.1:9998',
        'pprof: no',
        'playback: no',
        'rtsp: true',
        'rtspAddress: 127.0.0.1:8554',
        'rtspTransports: [tcp]',
        'rtmp: no',
        'hls: yes',
        'hlsAddress: 127.0.0.1:8888',
        'hlsVariant: lowLatency',
        'hlsSegmentCount: 7',
        'hlsSegmentDuration: 1s',
        'hlsPartDuration: 200ms',
        'hlsAlwaysRemux: no',
        'webrtc: yes',
        'webrtcAddress: 127.0.0.1:8889',
        'webrtcLocalUDPAddress: 127.0.0.1:8189',
        'webrtcLocalTCPAddress: 127.0.0.1:8189',
        'webrtcAdditionalHosts: [127.0.0.1]',
        'srt: no',
        'pathDefaults:',
        '  record: no',
        '  recordFormat: fmp4',
        '  recordPartDuration: 1s',
        '  recordSegmentDuration: 1m',
        '  recordDeleteAfter: 0s',
        'paths: {}',
      ].join(String.fromCharCode(10));
      await writeFile(configPath, config, { mode: 0o600 });
      if (process.platform !== 'win32') await chmod(configPath, 0o600);
      this.process = spawn(this.options.binary, [configPath], { stdio: 'ignore', windowsHide: true });
      this.process.once('exit', () => { if (this.state !== 'not-configured') this.state = 'error'; });
      this.process.once('error', () => { this.state = 'error'; });
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (this.process?.exitCode !== null) throw new Error('MEDIAMTX_EXITED');
        try {
          const response = await fetch(this.apiUrl + '/v3/config/global/get', { signal: AbortSignal.timeout(500) });
          if (response.ok) { this.state = 'ready'; return; }
        } catch { /* Chờ tiến trình mở cổng điều khiển. */ }
        await wait(150);
      }
      throw new Error('MEDIAMTX_START_TIMEOUT');
    } catch (error) {
      this.state = 'error';
      this.process?.kill();
      this.process = null;
      throw error;
    }
  }

  private ensureReady() {
    if (this.state !== 'ready') throw new Error('MEDIA_NOT_READY');
  }

  async configure(cameraId: string, sources: readonly MediaSource[]) {
    this.ensureReady();
    for (const source of sources) {
      const path = cameraPath(cameraId, source.profile);
      const prior = this.recording.get(path);
      const record = source.record ?? prior?.enabled ?? false;
      const recordRoot = source.recordRoot ?? prior?.root;
      const payload: Record<string, unknown> = { source: source.sourceUrl, sourceOnDemand: !record, sourceOnDemandStartTimeout: '8s', sourceOnDemandCloseAfter: '20s', rtspTransport: 'tcp', record };
      if (recordRoot) { payload.recordPath = recordRoot.replaceAll('\\', '/') + '/%Y-%m-%d_%H-%M-%S-%f'; payload.recordFormat = 'fmp4'; payload.recordPartDuration = '1s'; payload.recordSegmentDuration = '1m'; payload.recordDeleteAfter = '0s'; }
      let response = await fetch(this.apiUrl + '/v3/config/paths/add/' + path, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(3000),
      });
      if (response.status === 400) response = await fetch(this.apiUrl + '/v3/config/paths/patch/' + path, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error('MEDIA_CONFIG_FAILED');
      this.configured.add(path);
      this.recording.set(path, { enabled: record, root: recordRoot });
    }
  }

  async remove(cameraId: string) {
    if (this.state !== 'ready') return;
    for (const profile of ['main', 'sub']) {
      const path = cameraPath(cameraId, profile);
      if (!this.configured.has(path)) continue;
      await fetch(this.apiUrl + '/v3/config/paths/delete/' + path, { method: 'DELETE', signal: AbortSignal.timeout(2000) }).catch(() => undefined);
      this.configured.delete(path);
      this.recording.delete(path);
    }
  }

  async getState(cameraId: string): Promise<Camera['state']> {
    if (this.state !== 'ready') return 'error';
    try {
      const response = await fetch(this.apiUrl + '/v3/paths/get/' + cameraPath(cameraId, 'main'), { signal: AbortSignal.timeout(1000) });
      if (!response.ok) return 'offline';
      const data = await response.json() as { ready?: boolean; readers?: unknown[] };
      return data.ready ? 'online' : 'connecting';
    } catch { return 'offline'; }
  }

  async openSession(input: { cameraId: string; userId: string; profile: 'main' | 'sub'; transport: 'webrtc' | 'll-hls' }): Promise<LiveSession> {
    this.ensureReady();
    const path = cameraPath(input.cameraId, input.profile);
    if (!this.configured.has(path)) throw new Error('MEDIA_PATH_MISSING');
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const endpoint = input.transport === 'webrtc' ? '/api/v1/live-sessions/' + id + '/whep' : '/api/v1/live-sessions/' + id + '/hls/index.m3u8';
    const session: RuntimeSession = { id, cameraId: input.cameraId, userId: input.userId, profile: input.profile, transport: input.transport, state: 'starting', endpoint, expiresAt, path };
    this.sessions.set(id, session);
    return session;
  }

  private session(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || Date.parse(session.expiresAt) <= Date.now()) throw new Error('MEDIA_SESSION_MISSING');
    return session;
  }

  async whepOffer(sessionId: string, sdp: string) {
    this.ensureReady();
    const session = this.session(sessionId);
    if (session.transport !== 'webrtc') throw new Error('MEDIA_TRANSPORT_MISMATCH');
    const response = await fetch(this.webrtcUrl + '/' + session.path + '/whep', {
      method: 'POST',
      headers: { 'content-type': 'application/sdp' },
      body: sdp,
      signal: AbortSignal.timeout(12_000),
    });
    const body = await response.text();
    const upstreamLocation = response.headers.get('location') ?? undefined;
    if (upstreamLocation) session.upstreamLocation = new URL(upstreamLocation, this.webrtcUrl).href;
    if (response.ok) session.state = 'playing';
    const result: { status: number; body: string; location?: string; link?: string } = { status: response.status, body };
    if (upstreamLocation) result.location = session.endpoint;
    const link = response.headers.get('link');
    if (link) result.link = link;
    return result;
  }

  async fetchHls(sessionId: string, asset: string, query = new URLSearchParams()) {
    this.ensureReady();
    const session = this.session(sessionId);
    if (session.transport !== 'll-hls') throw new Error('MEDIA_TRANSPORT_MISMATCH');
    if (!/^[A-Za-z0-9._~-]+$/.test(asset)) throw new Error('MEDIA_ASSET_INVALID');
    const queryText = query.toString();
    return fetch(this.hlsUrl + '/' + session.path + '/' + asset + (queryText ? '?' + queryText : ''), { signal: AbortSignal.timeout(12_000) });
  }

  async closeSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    if (session?.upstreamLocation) await fetch(session.upstreamLocation, { method: 'DELETE', signal: AbortSignal.timeout(2000) }).catch(() => undefined);
  }

  async shutdown() {
    for (const id of [...this.sessions.keys()]) await this.closeSession(id);
    this.state = 'not-configured';
    if (this.process && !this.process.killed) this.process.kill();
    this.process = null;
  }
}
