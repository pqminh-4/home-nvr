export interface Migration { version: number; name: string; sql: string }

// Lịch sử migration là bất biến; mọi thay đổi về sau phải thêm phiên bản mới.
export const migrations: readonly Migration[] = [{ version: 1, name: 'foundation', sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','guest')),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (role <> 'owner' OR expires_at IS NULL)
) STRICT;
CREATE UNIQUE INDEX one_owner ON users(role) WHERE role = 'owner';
CREATE TABLE cameras (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  recording_mode TEXT NOT NULL DEFAULT 'off' CHECK (recording_mode IN ('off','continuous','event')),
  capabilities_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(capabilities_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;
CREATE TABLE camera_streams (
  camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  profile TEXT NOT NULL CHECK (profile IN ('main','sub')),
  source_ciphertext TEXT NOT NULL,
  PRIMARY KEY (camera_id, profile)
) STRICT;
CREATE TABLE camera_grants (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, camera_id)
) STRICT;
CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX auth_session_expiry ON auth_sessions(expires_at);
CREATE TABLE recordings (
  id TEXT PRIMARY KEY NOT NULL,
  camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE RESTRICT,
  relative_path TEXT NOT NULL UNIQUE,
  start_at TEXT NOT NULL,
  end_at TEXT,
  state TEXT NOT NULL CHECK (state IN ('writing','ready','failed','deleting')),
  bytes INTEGER NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  CHECK (end_at IS NULL OR end_at >= start_at)
) STRICT;
CREATE INDEX recordings_camera_time ON recordings(camera_id, start_at);
CREATE TABLE events (
  id TEXT PRIMARY KEY NOT NULL,
  camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('motion','camera-offline','camera-online')),
  start_at TEXT NOT NULL,
  end_at TEXT,
  CHECK (end_at IS NULL OR end_at >= start_at)
) STRICT;
CREATE INDEX events_camera_time ON events(camera_id, start_at);
CREATE TABLE event_recordings (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, recording_id)
) STRICT;
CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json))
) STRICT;
INSERT INTO settings VALUES ('system', '{"timezone":"Asia/Ho_Chi_Minh","retentionDays":7,"storageLimitBytes":null,"remoteEnabled":false}');
` }, {
  version: 2,
  name: 'camera-probe-state',
  sql: `
ALTER TABLE cameras ADD COLUMN last_probe_code TEXT CHECK (last_probe_code IS NULL OR last_probe_code IN ('READY','INVALID_URL','TIMEOUT','UNREACHABLE','TLS_ERROR','AUTH_FAILED','AUTH_UNSUPPORTED','NOT_FOUND','INVALID_RESPONSE','NO_VIDEO'));
ALTER TABLE cameras ADD COLUMN last_probe_at TEXT;
ALTER TABLE cameras ADD COLUMN probe_latency_ms INTEGER CHECK (probe_latency_ms IS NULL OR probe_latency_ms >= 0);
`
}, {
  version: 3,
  name: 'live-sessions',
  sql: `
CREATE TABLE live_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile TEXT NOT NULL CHECK (profile IN ('main','sub')),
  transport TEXT NOT NULL CHECK (transport IN ('webrtc','ll-hls')),
  state TEXT NOT NULL CHECK (state IN ('starting','playing','reconnecting','closed','failed')),
  endpoint TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  closed_at TEXT
) STRICT;
CREATE INDEX live_sessions_user_expiry ON live_sessions(user_id, expires_at);

`
}, {
  version: 4,
  name: 'motion-events',
  sql: `
ALTER TABLE events ADD COLUMN confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));
ALTER TABLE events ADD COLUMN updated_at TEXT;
CREATE TABLE camera_event_rules (
  camera_id TEXT PRIMARY KEY NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  sensitivity INTEGER NOT NULL DEFAULT 60 CHECK (sensitivity BETWEEN 1 AND 100),
  pre_seconds INTEGER NOT NULL DEFAULT 10 CHECK (pre_seconds BETWEEN 0 AND 120),
  post_seconds INTEGER NOT NULL DEFAULT 20 CHECK (post_seconds BETWEEN 1 AND 300),
  schedule_json TEXT NOT NULL DEFAULT '{"days":[0,1,2,3,4,5,6],"start":"00:00","end":"24:00"}' CHECK (json_valid(schedule_json)),
  webhook_ciphertext TEXT
) STRICT;
CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  url_ciphertext TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','delivered','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX webhook_delivery_due ON webhook_deliveries(state,next_attempt_at);
`
}];
