export class ApiRequestError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | T | null;
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && 'error' in payload ? payload.error : undefined;
    throw new ApiRequestError(detail?.message ?? 'Không thể hoàn tất yêu cầu.', detail?.code ?? 'REQUEST_FAILED', response.status);
  }
  return payload as T;
}

export interface SessionUser {
  id: string;
  username: string;
  role: 'owner' | 'guest';
  expiresAt: string | null;
  cameraIds: string[];
  createdAt: string;
}

export interface ApiCamera {
  id: string;
  name: string;
  location: string;
  enabled: boolean;
  state: 'online' | 'offline' | 'error' | 'disabled';
  recordingMode: 'off' | 'continuous' | 'event';
  capabilities: { ptz: boolean; audio: boolean; talk: boolean; substream: boolean };
  lastProbe: { code: string; at: string; latencyMs: number } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiEvent {
  id: string; cameraId: string; type: 'motion' | 'camera-offline' | 'camera-online';
  startAt: string; endAt: string | null; confidence: number | null; recordingIds: string[];
}
export interface ApiEventRule {
  enabled: boolean; sensitivity: number; preSeconds: number; postSeconds: number;
  schedule: { days: number[]; start: string; end: string }; webhookEnabled: boolean;
}
export interface ApiSettings {
  timezone: string; retentionDays: number; storageLimitBytes: number | null; remoteEnabled: boolean;
}


export interface ApiRemoteStatus {
  state: 'disabled' | 'configured' | 'starting' | 'ready' | 'error';
  publicOrigin: string | null;
  lanIndependent: true;
}


export interface ApiCloudflareDnsPlan {
  action: 'create' | 'update' | 'unchanged';
  zoneName: string;
  hostname: string;
  tunnelTarget: string;
  proxied: boolean;
  recordId: string | null;
}
