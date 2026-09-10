import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AppConfig {
  host: '127.0.0.1';
  port: number;
  dataDir: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  webOrigin: string;
  publicOrigin: string;
  setupToken: string;
  secretKey: string;
  mediaMtxBinary: string;
  ffmpegBinary: string;
  cloudflaredBinary: string;
  tunnelTokenFile: string;
}

export const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));

// Chỉ báo tên biến sai để tránh phản chiếu dữ liệu nhạy cảm trong lỗi cấu hình.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const host = env.NVR_HOST ?? '127.0.0.1';
  if (host !== '127.0.0.1') throw new Error('NVR_HOST chỉ hỗ trợ loopback để tránh mở trực tiếp dịch vụ.');
  const portText = env.NVR_PORT ?? '3000';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('NVR_PORT không hợp lệ.');
  const logLevel = env.NVR_LOG_LEVEL ?? 'info';
  if (!['debug', 'info', 'warn', 'error', 'silent'].includes(logLevel)) throw new Error('NVR_LOG_LEVEL không hợp lệ.');
  const dataDir = env.NVR_DATA_DIR ?? '.data';
  if (!dataDir.trim() || dataDir.includes('\0')) throw new Error('NVR_DATA_DIR không hợp lệ.');
  const webOrigin = env.NVR_WEB_ORIGIN ?? 'http://127.0.0.1:5173';
  const publicOrigin = env.NVR_PUBLIC_ORIGIN ?? '';
  const setupToken = env.NVR_SETUP_TOKEN ?? '';
  const secretKey = env.NVR_SECRET_KEY ?? '';
  const mediaMtxBinary = env.NVR_MEDIAMTX_BIN ?? (process.platform === 'win32' ? resolve(projectRoot, '.tools/mediamtx/mediamtx.exe') : 'mediamtx');
  const ffmpegBinary = env.NVR_FFMPEG_BIN ?? 'ffmpeg';
  const cloudflaredBinary = env.NVR_CLOUDFLARED_BIN ?? 'cloudflared';
  const tunnelTokenFile = env.NVR_TUNNEL_TOKEN_FILE ? resolve(projectRoot, env.NVR_TUNNEL_TOKEN_FILE) : '';
  if (setupToken && setupToken.length < 32) throw new Error('NVR_SETUP_TOKEN phải có ít nhất 32 ký tự.');
  if (secretKey && secretKey.length < 32) throw new Error('NVR_SECRET_KEY phải có ít nhất 32 ký tự.');
  try {
    const url = new URL(webOrigin);
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.origin !== webOrigin) throw new Error();
  } catch { throw new Error('NVR_WEB_ORIGIN phải là origin loopback hợp lệ.'); }
  if (publicOrigin) {
    try {
      const url = new URL(publicOrigin);
      if (url.protocol !== 'https:' || url.origin !== publicOrigin || url.username || url.password || ['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error();
    } catch { throw new Error('NVR_PUBLIC_ORIGIN phải là HTTPS origin công khai hợp lệ.'); }
  }
  return { host, port, dataDir: resolve(projectRoot, dataDir), logLevel: logLevel as AppConfig['logLevel'], webOrigin, publicOrigin, setupToken, secretKey, mediaMtxBinary, ffmpegBinary, cloudflaredBinary, tunnelTokenFile };
}
