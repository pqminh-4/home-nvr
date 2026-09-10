import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import os from 'node:os';

// Chỉ kiểm tra công cụ cục bộ, không dò mạng LAN hay đọc tài khoản camera.
const probe = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 5000, windowsHide: true, shell: false });
  return { available: !result.error && result.status === 0, version: (result.stdout || result.stderr || '').split(/\r?\n/)[0]?.slice(0, 160) ?? '' };
};
const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const ubuntu = process.platform === 'linux' && existsSync('/etc/os-release') && /^ID=ubuntu$/m.test(readFileSync('/etc/os-release', 'utf8'));
const mediamtxCommand = process.env.NVR_MEDIAMTX_BIN ?? (process.platform === 'win32' ? join(process.cwd(), '.tools', 'mediamtx', 'mediamtx.exe') : 'mediamtx');
const ffmpegCommand = process.env.NVR_FFMPEG_BIN ?? 'ffmpeg';
const cloudflaredCommand = process.env.NVR_CLOUDFLARED_BIN ?? 'cloudflared';
const report = {
  platform: process.platform, arch: process.arch, ubuntu,
  cpu: os.cpus()[0]?.model ?? 'unknown', memoryGiB: Math.round(os.totalmem() / 1024 ** 3),
  node: { available: Number(process.versions.node.split('.')[0]) === 24, version: process.version },
  npm: probe(process.execPath, [npmCli, '--version']),
  git: probe('git', ['--version']),
  ffmpeg: probe(ffmpegCommand, ['-version']),
  mediamtx: probe(mediamtxCommand, ['--version']),
  cloudflared: probe(cloudflaredCommand, ['--version']),
  remoteConfigured: Boolean(process.env.NVR_PUBLIC_ORIGIN && process.env.NVR_TUNNEL_TOKEN_FILE && existsSync(process.env.NVR_TUNNEL_TOKEN_FILE)),
  systemd: probe('systemctl', ['--version']),
  note: 'MediaMTX/FFmpeg cần cho Phần 4; cloudflared và public origin/token file phục vụ Phần 7; systemd/Ubuntu nghiệm thu ở Phần 8. Cấu hình camera và máy đích chưa tự suy ra từ máy phát triển.',
};
console.log(JSON.stringify(report, null, 2));
if (!report.node.available || !report.npm.available) process.exitCode = 1;
