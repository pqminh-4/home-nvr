import { requestSchemas } from './requests.js';
export * from './requests.js';
import { Type, type Static } from '@sinclair/typebox';

// Các schema công khai không chứa URL nguồn, thông tin đăng nhập hay đường dẫn đĩa.
const objectOptions = { additionalProperties: false } as const;
const Id = Type.String({ format: 'uuid' });
const Timestamp = Type.String({ format: 'date-time' });
const Enum = <T extends string[]>(...values: T) => Type.Unsafe<T[number]>({ type: 'string', enum: values });

export const CameraStateSchema = Enum('disabled', 'connecting', 'online', 'offline', 'error');
export const RecordingModeSchema = Enum('off', 'continuous', 'event');
export const CameraSchema = Type.Object({
  id: Id, name: Type.String({ minLength: 1, maxLength: 120 }),
  location: Type.String({ maxLength: 120 }), enabled: Type.Boolean(),
  state: CameraStateSchema, recordingMode: RecordingModeSchema,
  capabilities: Type.Object({ ptz: Type.Boolean(), audio: Type.Boolean(), talk: Type.Boolean(), substream: Type.Boolean() }, objectOptions),
  createdAt: Timestamp, updatedAt: Timestamp,
}, objectOptions);

export const UserSchema = Type.Object({
  id: Id, username: Type.String({ minLength: 3, maxLength: 80 }),
  role: Enum('owner', 'guest'), expiresAt: Type.Union([Timestamp, Type.Null()]),
  cameraIds: Type.Array(Id), createdAt: Timestamp,
}, objectOptions);

export const LiveSessionSchema = Type.Object({
  id: Id, cameraId: Id, profile: Enum('main', 'sub'),
  transport: Enum('webrtc', 'll-hls'), state: Enum('starting', 'playing', 'reconnecting', 'closed', 'failed'),
  endpoint: Type.String({ pattern: '^/api/v1/' }), expiresAt: Timestamp,
}, objectOptions);

export const RecordingSchema = Type.Object({
  id: Id, cameraId: Id, startAt: Timestamp, endAt: Type.Union([Timestamp, Type.Null()]),
  state: Enum('writing', 'ready', 'failed', 'deleting'), bytes: Type.Integer({ minimum: 0 }),
}, objectOptions);

export const EventSchema = Type.Object({
  id: Id, cameraId: Id, type: Enum('motion', 'camera-offline', 'camera-online'),
  startAt: Timestamp, endAt: Type.Union([Timestamp, Type.Null()]), confidence: Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Type.Null()]),
  recordingIds: Type.Array(Id),
}, objectOptions);

export const SettingsSchema = Type.Object({
  timezone: Type.String({ minLength: 1 }),
  retentionDays: Type.Integer({ minimum: 1, maximum: 365 }),
  storageLimitBytes: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  remoteEnabled: Type.Boolean(),
}, objectOptions);

export const HealthSchema = Type.Object({ status: Enum('ok', 'error') }, objectOptions);
export const SystemStatusSchema = Type.Object({
  phase: Type.Literal(7), database: Enum('ok', 'error'),
  media: Enum('not-configured', 'starting', 'ready', 'error'), recording: Enum('not-configured', 'starting', 'ready', 'error'), events: Enum('ready', 'error'), remote: Enum('disabled', 'configured', 'starting', 'ready', 'error'), setup: Enum('owner-required', 'ready'),
}, objectOptions);
export const CloudflareDnsPlanSchema = Type.Object({ action: Enum('create', 'update', 'unchanged'), zoneName: Type.String(), hostname: Type.String(), tunnelTarget: Type.String(), proxied: Type.Boolean(), recordId: Type.Union([Type.String(), Type.Null()]) }, objectOptions);
export const RemoteStatusSchema = Type.Object({
  state: Enum('disabled', 'configured', 'starting', 'ready', 'error'),
  publicOrigin: Type.Union([Type.String({ format: 'uri' }), Type.Null()]),
  lanIndependent: Type.Literal(true),
}, objectOptions);
export const SystemMessageSchema = Type.Object({
  type: Type.Literal('system.status'), version: Type.Literal(1),
  timestamp: Timestamp, data: SystemStatusSchema,
}, objectOptions);
export const ErrorSchema = Type.Object({
  error: Type.Object({ code: Type.String(), message: Type.String(), requestId: Type.String() }, objectOptions),
}, objectOptions);

export type Camera = Static<typeof CameraSchema>;
export type User = Static<typeof UserSchema>;
export type LiveSession = Static<typeof LiveSessionSchema>;
export type Recording = Static<typeof RecordingSchema>;
export type CameraEvent = Static<typeof EventSchema>;
export type Settings = Static<typeof SettingsSchema>;
export type SystemStatus = Static<typeof SystemStatusSchema>;
export type SystemMessage = Static<typeof SystemMessageSchema>;
export type ApiError = Static<typeof ErrorSchema>;

// Danh mục này khóa giao diện giữa các phần, không đăng ký route giả trên server.
export const plannedOperations = [
  { method: 'POST', path: '/auth/setup', phase: 3, access: 'setup-token', response: 'User' },
  { method: 'POST', path: '/auth/login', phase: 3, access: 'public-rate-limited', response: 'User' },
  { method: 'POST', path: '/auth/logout', phase: 3, access: 'session', response: null },
  { method: 'GET', path: '/users', phase: 3, access: 'owner', response: 'User', list: true },
  { method: 'POST', path: '/users', phase: 3, access: 'owner', response: 'User' },
  { method: 'PATCH', path: '/users/{id}', phase: 3, access: 'owner', response: 'User' },
  { method: 'DELETE', path: '/users/{id}', phase: 3, access: 'owner', response: null },
  { method: 'GET', path: '/cameras', phase: 3, access: 'camera-grant', response: 'Camera', list: true },
  { method: 'POST', path: '/cameras', phase: 3, access: 'owner', response: 'Camera' },
  { method: 'PATCH', path: '/cameras/{id}', phase: 3, access: 'owner', response: 'Camera' },
  { method: 'DELETE', path: '/cameras/{id}', phase: 3, access: 'owner', response: null },
  { method: 'POST', path: '/cameras/discovery', phase: 3, access: 'owner', response: null },
  { method: 'POST', path: '/cameras/onvif-probe', phase: 3, access: 'owner', response: null },
  { method: 'POST', path: '/cameras/{id}/probe', phase: 3, access: 'owner', response: null },
  { method: 'POST', path: '/live-sessions', phase: 4, access: 'camera-grant', response: 'LiveSession' },
  { method: 'DELETE', path: '/live-sessions/{id}', phase: 4, access: 'session-owner', response: null },
  { method: 'POST', path: '/cameras/{id}/ptz', phase: 4, access: 'owner', response: null },
  { method: 'POST', path: '/cameras/{id}/snapshot', phase: 4, access: 'camera-grant', response: null },
  { method: 'GET', path: '/recordings', phase: 5, access: 'owner', response: 'Recording', list: true },
  { method: 'GET', path: '/recordings/{id}/playback', phase: 5, access: 'owner', response: null },
  { method: 'POST', path: '/recordings/export', phase: 5, access: 'owner', response: null },
  { method: 'GET', path: '/events', phase: 6, access: 'owner', response: 'Event', list: true },
  { method: 'GET', path: '/cameras/{id}/event-rule', phase: 6, access: 'owner', response: null },
  { method: 'PATCH', path: '/cameras/{id}/event-rule', phase: 6, access: 'owner', response: null },
  { method: 'POST', path: '/cameras/{id}/motion', phase: 6, access: 'owner', response: 'Event' },
  { method: 'GET', path: '/settings', phase: 6, access: 'owner', response: 'Settings' },
  { method: 'PATCH', path: '/settings', phase: 6, access: 'owner', response: 'Settings' },
  { method: 'GET', path: '/remote/status', phase: 7, access: 'owner', response: 'RemoteStatus' },
  { method: 'POST', path: '/remote/cloudflare/dns/preview', phase: 7, access: 'owner', response: 'CloudflareDnsPlan' },
  { method: 'POST', path: '/remote/cloudflare/dns/apply', phase: 7, access: 'owner', response: 'CloudflareDnsPlan' },
] as const;

export const publicSchemas = {
  Camera: CameraSchema, User: UserSchema, LiveSession: LiveSessionSchema,
  Recording: RecordingSchema, Event: EventSchema, Settings: SettingsSchema,
  Error: ErrorSchema, SystemStatus: SystemStatusSchema, SystemMessage: SystemMessageSchema, RemoteStatus: RemoteStatusSchema, CloudflareDnsPlan: CloudflareDnsPlanSchema,
};

export function createOpenApiDocument() {
  const json = (schema: string) => ({ 'application/json': { schema: { $ref: '#/components/schemas/' + schema } } });
  const body = (schema: string) => ({ required: true, content: json(schema) });
  const ok = (schema: string, description = 'Thành công') => ({ description, content: json(schema) });
  const session = [{ cookieSession: [] }];
  return {
    openapi: '3.1.0',
    info: { title: 'Home NVR — API cục bộ', version: '0.7.0' },
    servers: [{ url: '/api/v1' }],
    paths: {
      '/system/status': { get: { operationId: 'getSystemStatus', responses: { '200': ok('SystemStatus', 'Trạng thái nền tảng'), '503': ok('SystemStatus', 'Database chưa sẵn sàng') } } },
      '/auth/status': { get: { operationId: 'getAuthStatus', responses: { '200': { description: 'Trạng thái khởi tạo và phiên' } } } },
      '/auth/setup': { post: { operationId: 'setupOwner', requestBody: body('OwnerSetup'), responses: { '201': ok('User'), '403': ok('Error'), '409': ok('Error') } } },
      '/auth/login': { post: { operationId: 'login', requestBody: body('Login'), responses: { '200': ok('User'), '401': ok('Error'), '429': ok('Error') } } },
      '/auth/logout': { post: { operationId: 'logout', security: session, responses: { '204': { description: 'Đã đăng xuất' } } } },
      '/auth/me': { get: { operationId: 'getCurrentUser', security: session, responses: { '200': ok('User'), '401': ok('Error') } } },
      '/users': {
        get: { operationId: 'listUsers', security: session, responses: { '200': { description: 'Danh sách người dùng', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/User' } } } } }, '403': ok('Error') } },
        post: { operationId: 'createGuest', security: session, requestBody: body('GuestCreate'), responses: { '201': ok('User'), '400': ok('Error'), '403': ok('Error'), '409': ok('Error') } },
      },
      '/users/{id}': {
        patch: { operationId: 'updateGuest', security: session, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: body('GuestUpdate'), responses: { '200': ok('User'), '404': ok('Error') } },
        delete: { operationId: 'deleteGuest', security: session, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '204': { description: 'Đã thu hồi khách' }, '404': ok('Error') } },
      },
      '/cameras': {
        get: { operationId: 'listCameras', security: session, responses: { '200': { description: 'Camera được phép xem', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Camera' } } } } }, '401': ok('Error') } },
        post: { operationId: 'createCamera', security: session, requestBody: body('CameraCreate'), responses: { '201': ok('Camera'), '400': ok('Error'), '403': ok('Error') } },
      },
      '/cameras/{id}': {
        patch: { operationId: 'updateCamera', security: session, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: body('CameraUpdate'), responses: { '200': ok('Camera'), '404': ok('Error') } },
        delete: { operationId: 'deleteCamera', security: session, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '204': { description: 'Đã xóa mềm camera' }, '404': ok('Error') } },
      },
      '/cameras/discovery': { post: { operationId: 'discoverOnvif', security: session, responses: { '200': { description: 'Kết quả WS-Discovery' }, '403': ok('Error') } } },
      '/cameras/onvif-probe': { post: { operationId: 'probeOnvif', security: session, requestBody: body('OnvifProbe'), responses: { '200': { description: 'Kết quả ONVIF' }, '403': ok('Error') } } },
      '/cameras/{id}/probe': { post: { operationId: 'probeRtsp', security: session, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Kết quả RTSP DESCRIBE' }, '404': ok('Error') } } },
      '/live-sessions': { post: { operationId: 'createLiveSession', security: session, requestBody: body('LiveSessionCreate'), responses: { '201': ok('LiveSession'), '403': ok('Error'), '503': ok('Error') } } },
      '/live-sessions/{id}': { delete: { operationId: 'closeLiveSession', security: session, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '204': { description: 'Đã đóng live session' }, '404': ok('Error') } } },
      '/live-sessions/{id}/whep': { post: { operationId: 'createWhepResource', security: session, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '201': { description: 'SDP answer WebRTC' }, '502': ok('Error') } } },
      '/recordings': { get: { operationId: 'listRecordings', security: session, responses: { '200': { description: 'Danh sách bản ghi' }, '403': ok('Error') } } },
      '/recordings/{id}/playback': { get: { operationId: 'playRecording', security: session, responses: { '200': { description: 'Media playback' }, '206': { description: 'Media range' }, '404': ok('Error') } } },
      '/recordings/export': { post: { operationId: 'exportRecordings', security: session, requestBody: body('RecordingExport'), responses: { '202': { description: 'Export đang sẵn sàng' }, '404': ok('Error') } } },
      '/recordings/exports/{exportId}/{asset}': { get: { operationId: 'downloadExport', security: session, responses: { '200': { description: 'Tệp export' }, '206': { description: 'Tệp export range' } } } },
      '/events': { get: { operationId: 'listEvents', security: session, responses: { '200': { description: 'Danh sách sự kiện motion' }, '403': ok('Error') } } },
      '/cameras/{id}/event-rule': { get: { operationId: 'getEventRule', security: session, responses: { '200': { description: 'Rule sự kiện camera' }, '404': ok('Error') } }, patch: { operationId: 'updateEventRule', security: session, requestBody: body('EventRuleUpdate'), responses: { '200': { description: 'Rule đã cập nhật' }, '404': ok('Error') } } },
      '/cameras/{id}/motion': { post: { operationId: 'ingestMotion', security: session, requestBody: body('MotionSignal'), responses: { '200': { description: 'Sự kiện đã gộp hoặc bị lịch bỏ qua' }, '404': ok('Error') } } },
      '/settings': { get: { operationId: 'getSettings', security: session, responses: { '200': ok('Settings'), '403': ok('Error') } }, patch: { operationId: 'updateSettings', security: session, requestBody: body('SettingsUpdate'), responses: { '200': ok('Settings'), '403': ok('Error') } } },
      '/remote/status': { get: { operationId: 'getRemoteStatus', security: session, responses: { '200': ok('RemoteStatus'), '403': ok('Error') } } },
      '/remote/cloudflare/dns/preview': { post: { operationId: 'previewCloudflareDns', security: session, requestBody: body('CloudflareDns'), responses: { '200': ok('CloudflareDnsPlan'), '400': ok('Error'), '403': ok('Error') } } },
      '/remote/cloudflare/dns/apply': { post: { operationId: 'applyCloudflareDns', security: session, requestBody: body('CloudflareDns'), responses: { '200': ok('CloudflareDnsPlan'), '400': ok('Error'), '403': ok('Error') } } },
    },
    components: {
      securitySchemes: { cookieSession: { type: 'apiKey', in: 'cookie', name: 'nvr_session' } },
      schemas: { ...publicSchemas, ...requestSchemas },
    },
    'x-planned-operations': plannedOperations,
    'x-websocket': { path: '/ws/v1/system', message: 'SystemMessage', intervalSeconds: 10, scope: 'loopback-foundation-only' },
  };
}
