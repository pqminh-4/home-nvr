import { Type, type Static } from '@sinclair/typebox';

const options = { additionalProperties: false } as const;
const Id = Type.String({ format: 'uuid' });
const username = Type.String({ pattern: '^[A-Za-z0-9._-]{3,80}$' });
const password = Type.String({ minLength: 12, maxLength: 128, writeOnly: true });
const sourceUrl = Type.String({ minLength: 1, maxLength: 4096, pattern: '^rtsps?://', writeOnly: true });

// Schema đầu vào tách khỏi DTO đầu ra; các giá trị writeOnly không được trả ngược cho client.
export const CameraCreateSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  location: Type.Optional(Type.String({ maxLength: 120 })),
  mainSourceUrl: sourceUrl,
  subSourceUrl: Type.Optional(sourceUrl),
}, options);
export const CameraUpdateSchema = Type.Partial(Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  location: Type.String({ maxLength: 120 }),
  enabled: Type.Boolean(),
  recordingMode: Type.Union([Type.Literal('off'), Type.Literal('continuous'), Type.Literal('event')]),
  mainSourceUrl: sourceUrl,
  subSourceUrl: Type.Union([sourceUrl, Type.Null()]),
}, options), { minProperties: 1 });
export const OnvifProbeSchema = Type.Object({
  endpoint: Type.String({ minLength: 8, maxLength: 2048, pattern: '^https?://', writeOnly: true }),
  username: Type.String({ minLength: 1, maxLength: 80, writeOnly: true }),
  password: Type.String({ minLength: 1, maxLength: 128, writeOnly: true }),
}, options);
export const LoginSchema = Type.Object({ username, password: Type.String({ minLength: 1, maxLength: 128, writeOnly: true }) }, options);
export const OwnerSetupSchema = Type.Object({ username, password, setupToken: Type.String({ minLength: 32, writeOnly: true }) }, options);
export const GuestCreateSchema = Type.Object({
  username, password, expiresAt: Type.String({ format: 'date-time' }),
  cameraIds: Type.Array(Id, { uniqueItems: true }),
}, options);
export const GuestUpdateSchema = Type.Partial(Type.Object({
  password, expiresAt: Type.String({ format: 'date-time' }), cameraIds: Type.Array(Id, { uniqueItems: true }),
}, options), { minProperties: 1 });
export const LiveSessionCreateSchema = Type.Object({
  cameraId: Id, profile: Type.Union([Type.Literal('main'), Type.Literal('sub')]),
  transport: Type.Union([Type.Literal('webrtc'), Type.Literal('ll-hls')]),
}, options);
export const EventRuleUpdateSchema = Type.Object({
  enabled: Type.Boolean(), sensitivity: Type.Integer({ minimum: 1, maximum: 100 }),
  preSeconds: Type.Integer({ minimum: 0, maximum: 120 }), postSeconds: Type.Integer({ minimum: 1, maximum: 300 }),
  schedule: Type.Object({ days: Type.Array(Type.Integer({ minimum: 0, maximum: 6 }), { minItems: 1, uniqueItems: true }), start: Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }), end: Type.String({ pattern: '^(([01]\\d|2[0-3]):[0-5]\\d|24:00)$' }) }, options),
  webhookUrl: Type.Optional(Type.Union([Type.String({ minLength: 8, maxLength: 2048, pattern: '^https?://' }), Type.Null()])),
}, options);
export const MotionSignalSchema = Type.Object({ confidence: Type.Number({ minimum: 0, maximum: 1 }), at: Type.Optional(Type.String({ format: 'date-time' })) }, options);
export const SettingsUpdateSchema = Type.Object({ timezone: Type.String({ minLength: 1, maxLength: 80 }), retentionDays: Type.Integer({ minimum: 1, maximum: 365 }), storageLimitBytes: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]), remoteEnabled: Type.Boolean() }, options);
export const RecordingExportSchema = Type.Object({ recordingIds: Type.Array(Id, { minItems: 1, maxItems: 100, uniqueItems: true }) }, options);
export const CloudflareDnsSchema = Type.Object({
  zoneName: Type.String({ minLength: 3, maxLength: 253, pattern: '^[A-Za-z0-9.-]+$' }),
  hostname: Type.String({ minLength: 3, maxLength: 253, pattern: '^[A-Za-z0-9.-]+$' }),
  tunnelTarget: Type.String({ minLength: 10, maxLength: 253, pattern: '^[A-Za-z0-9.-]+$' }),
  proxied: Type.Boolean(),
  apiToken: Type.String({ minLength: 20, maxLength: 512, writeOnly: true }),
}, options);

export const TimeRangeSchema = Type.Object({
  cameraId: Id, from: Type.String({ format: 'date-time' }), to: Type.String({ format: 'date-time' }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
  cursor: Type.Optional(Type.String({ maxLength: 512 })),
}, options);

export type CameraCreate = Static<typeof CameraCreateSchema>;
export type CameraUpdate = Static<typeof CameraUpdateSchema>;
export type OnvifProbe = Static<typeof OnvifProbeSchema>;
export type Login = Static<typeof LoginSchema>;
export type OwnerSetup = Static<typeof OwnerSetupSchema>;
export type GuestCreate = Static<typeof GuestCreateSchema>;
export type GuestUpdate = Static<typeof GuestUpdateSchema>;
export type LiveSessionCreate = Static<typeof LiveSessionCreateSchema>;
export type RecordingExport = Static<typeof RecordingExportSchema>;
export type EventRuleUpdate = Static<typeof EventRuleUpdateSchema>;
export type MotionSignal = Static<typeof MotionSignalSchema>;
export type SettingsUpdate = Static<typeof SettingsUpdateSchema>;
export type TimeRange = Static<typeof TimeRangeSchema>;
export type CloudflareDns = Static<typeof CloudflareDnsSchema>;

export const requestSchemas = {
  CameraCreate: CameraCreateSchema, CameraUpdate: CameraUpdateSchema, OnvifProbe: OnvifProbeSchema, Login: LoginSchema,
  OwnerSetup: OwnerSetupSchema, GuestCreate: GuestCreateSchema, GuestUpdate: GuestUpdateSchema,
  LiveSessionCreate: LiveSessionCreateSchema, RecordingExport: RecordingExportSchema, EventRuleUpdate: EventRuleUpdateSchema, MotionSignal: MotionSignalSchema, SettingsUpdate: SettingsUpdateSchema, TimeRange: TimeRangeSchema, CloudflareDns: CloudflareDnsSchema,
};
