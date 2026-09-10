import pino, { type DestinationStream } from 'pino';
import type { AppConfig } from './config.js';

const sensitiveKey = /password|passwd|secret|token|cookie|authorization|credential|ciphertext|sourceurl|rtspurl|apikey/i;

// Bỏ toàn bộ URL trong thông báo vì cả đường dẫn và query cũng có thể chứa khóa camera.
function cleanText(value: string) {
  return value.replace(/\b(?:rtsps?|https?|wss?):\/\/[^\s"'<>]+/gi, '[URL ĐÃ ẨN]')
    .replace(/\bBearer\s+[^\s,"']+/gi, 'Bearer [ĐÃ ẨN]');
}

export function sanitizeLog(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return cleanText(value);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Error) return { type: value.name };
  if (seen.has(value)) return '[THAM CHIẾU LẶP]';
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => sanitizeLog(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitiveKey.test(key) ? '[ĐÃ ẨN]' : sanitizeLog(item, seen)]));
}

export function createLogger(level: AppConfig['logLevel'], destination?: DestinationStream) {
  const options: pino.LoggerOptions = {
    level,
    base: { service: 'home-nvr-api' },
    // Lọc trước serializer của Pino, bao gồm cả lỗi và chuỗi truyền trực tiếp.
    hooks: {
      logMethod(args, method) {
        const safeArgs = args.map(arg => sanitizeLog(arg));
        method.apply(this, safeArgs as Parameters<typeof method>);
      },
    },
    serializers: {
      req: req => ({ id: req.id, method: req.method }),
      res: res => ({ statusCode: res.statusCode }),
      err: err => ({ type: err?.name ?? 'Error' }),
    },
    redact: { paths: ['req.headers', 'request.body', 'body', 'password', 'token', 'secret'], censor: '[ĐÃ ẨN]' },
  };
  return destination ? pino(options, destination) : pino(options);
}
