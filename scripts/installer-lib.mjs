import { access, readFile } from 'node:fs/promises';
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path';

export const APP_NAME = 'home-nvr';
export const SERVICE_NAME = 'home-nvr.service';
export const MEDIAMTX_VERSION = '1.21.0';

export const RELEASE_FILES = [
  'package.json',
  'release-lock.json',
  'apps/api/package.json',
  'apps/api/dist',
  'apps/web/package.json',
  'apps/web/dist',
  'packages/contracts/package.json',
  'packages/contracts/dist',
  'scripts/home-nvr.mjs',
  'scripts/installer-lib.mjs',
  'scripts/backup.mjs',
  'scripts/doctor.mjs',
  'scripts/restore.mjs',
];

const rooted = (root, absolutePath) => {
  if (root === '/') return absolutePath;
  return join(resolve(root), absolutePath.replace(/^[/\\]+/, ''));
};

export function createInstallLayout(root = '/') {
  return {
    root: root === '/' ? '/' : resolve(root),
    opt: rooted(root, '/opt/home-nvr'),
    releases: rooted(root, '/opt/home-nvr/releases'),
    current: rooted(root, '/opt/home-nvr/current'),
    bin: rooted(root, '/opt/home-nvr/bin'),
    stateFile: rooted(root, '/opt/home-nvr/install-state.json'),
    cli: rooted(root, '/usr/local/bin/home-nvr'),
    config: rooted(root, '/etc/home-nvr'),
    envFile: rooted(root, '/etc/home-nvr/home-nvr.env'),
    serviceFile: rooted(root, '/etc/systemd/system/home-nvr.service'),
    data: rooted(root, '/var/lib/home-nvr'),
    backups: rooted(root, '/var/backups/home-nvr'),
  };
}

export function isInside(parent, candidate) {
  const item = relative(resolve(parent), resolve(candidate));
  return item !== '..' && !item.startsWith('..' + sep) && !isAbsolute(item);
}

export function renderEnvironment(layout, secrets) {
  if (!/^[A-Za-z0-9_-]{32,}$/.test(secrets.setupToken)) throw new Error('Setup token do installer tạo không hợp lệ.');
  if (!/^[A-Za-z0-9_-]{32,}$/.test(secrets.secretKey)) throw new Error('Secret key do installer tạo không hợp lệ.');
  return [
    '# Home NVR: chỉ root được đọc tệp này.',
    'NODE_ENV=production',
    'NVR_HOST=127.0.0.1',
    'NVR_PORT=3000',
    `NVR_DATA_DIR=${layout.data}`,
    'NVR_LOG_LEVEL=info',
    'NVR_WEB_ORIGIN=http://127.0.0.1:3000',
    `NVR_SETUP_TOKEN=${secrets.setupToken}`,
    `NVR_SECRET_KEY=${secrets.secretKey}`,
    `NVR_MEDIAMTX_BIN=${posix.join(layout.bin, 'mediamtx')}`,
    'NVR_FFMPEG_BIN=/usr/bin/ffmpeg',
    'NVR_PUBLIC_ORIGIN=',
    `NVR_CLOUDFLARED_BIN=${posix.join(layout.bin, 'cloudflared')}`,
    'NVR_TUNNEL_TOKEN_FILE=',
    '',
  ].join('\n');
}

export function renderSystemdService(layout, nodePath = '/usr/bin/node') {
  if (!isAbsolute(nodePath) || /\s/.test(nodePath)) throw new Error('Đường dẫn Node dùng cho systemd không hợp lệ.');
  return [
    '[Unit]',
    'Description=Home NVR',
    'Wants=network-online.target',
    'After=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    'User=home-nvr',
    'Group=home-nvr',
    `WorkingDirectory=${layout.current}`,
    `EnvironmentFile=${layout.envFile}`,
    `ExecStart=${nodePath} ${posix.join(layout.current, 'apps/api/dist/main.js')}`,
    'Restart=on-failure',
    'RestartSec=5s',
    'TimeoutStopSec=20s',
    'UMask=0077',
    'NoNewPrivileges=true',
    'PrivateTmp=true',
    'PrivateDevices=true',
    'ProtectSystem=strict',
    'ProtectHome=true',
    'ProtectKernelTunables=true',
    'ProtectKernelModules=true',
    'ProtectKernelLogs=true',
    'ProtectControlGroups=true',
    'RestrictNamespaces=true',
    'RestrictSUIDSGID=true',
    'RestrictRealtime=true',
    'LockPersonality=true',
    'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',
    `ReadOnlyPaths=${layout.config}`,
    `ReadWritePaths=${layout.data} ${layout.backups}`,
    'LimitNOFILE=65536',
    'StandardOutput=journal',
    'StandardError=journal',
    'SyslogIdentifier=home-nvr',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');
}

export function mediaMtxAsset(arch) {
  if (arch === 'x64') return `mediamtx_v${MEDIAMTX_VERSION}_linux_amd64.tar.gz`;
  if (arch === 'arm64') return `mediamtx_v${MEDIAMTX_VERSION}_linux_arm64v8.tar.gz`;
  throw new Error('MediaMTX chỉ hỗ trợ kiến trúc x64 hoặc arm64 trong installer này.');
}

export function cloudflaredReleaseAsset(release, arch) {
  const suffix = arch === 'x64' ? 'amd64' : arch === 'arm64' ? 'arm64' : null;
  if (!suffix) throw new Error('cloudflared chỉ hỗ trợ kiến trúc x64 hoặc arm64 trong installer này.');
  const name = `cloudflared-linux-${suffix}`;
  const asset = Array.isArray(release?.assets) ? release.assets.find(item => item?.name === name) : null;
  if (!asset || typeof asset.browser_download_url !== 'string' || !asset.browser_download_url.startsWith('https://github.com/cloudflare/cloudflared/releases/')) throw new Error('Không tìm thấy binary cloudflared chính thức.');
  const digest = typeof asset.digest === 'string' ? asset.digest.replace(/^sha256:/, '') : '';
  if (!/^[a-f0-9]{64}$/i.test(digest)) throw new Error('cloudflared release không có SHA-256 hợp lệ.');
  return { name, url: asset.browser_download_url, sha256: digest.toLowerCase() };
}

export function checksumForAsset(checksumText, asset) {
  const line = checksumText.split(/\r?\n/).find(item => item.trim().endsWith('  ' + asset) || item.trim().endsWith(' *' + asset));
  const checksum = line?.trim().split(/\s+/)[0] ?? '';
  if (!/^[a-f0-9]{64}$/i.test(checksum)) throw new Error('Không tìm thấy checksum MediaMTX hợp lệ.');
  return checksum.toLowerCase();
}

export async function validateReleaseSource(packageRoot) {
  const root = resolve(packageRoot);
  for (const relativePath of RELEASE_FILES) await access(join(root, relativePath));
  await access(join(root, 'apps/api/dist/main.js'));
  await access(join(root, 'apps/web/dist/index.html'));
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (manifest?.name !== APP_NAME || typeof manifest?.version !== 'string') throw new Error('Gói phát hành Home NVR không hợp lệ.');
  return { root, version: manifest.version };
}

export function parseEnvironment(text) {
  const result = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    result[line.slice(0, index)] = line.slice(index + 1);
  }
  return result;
}
