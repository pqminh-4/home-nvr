import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createLogger, sanitizeLog } from '../src/logger.js';

describe('Cấu hình', () => {
  it('mặc định loopback và giải quyết đường dẫn độc lập với cwd', () => {
    const config = loadConfig({});
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3000);
    expect(config.dataDir).toMatch(/[\\/]\.data$/);
  });
  it.each(['0', '65536', 'bad', '1.5', '1e3', ''])('từ chối cổng %s', port => {
    expect(() => loadConfig({ NVR_PORT: port })).toThrow(/NVR_PORT/);
  });
  it('từ chối public bind trước khi có xác thực', () => {
    expect(() => loadConfig({ NVR_HOST: '0.0.0.0' })).toThrow(/loopback/);
  });
  it.each(['https://evil.example', 'http://127.0.0.1:5173/path', 'http://user:password@localhost', 'null'])('từ chối origin %s', origin => {
    expect(() => loadConfig({ NVR_WEB_ORIGIN: origin })).toThrow(/NVR_WEB_ORIGIN/);
  });
  it('chỉ nhận public origin HTTPS không có path hay credential', () => {
    expect(loadConfig({ NVR_PUBLIC_ORIGIN: 'https://nvr.example.com' }).publicOrigin).toBe('https://nvr.example.com');
    for (const origin of ['http://nvr.example.com', 'https://nvr.example.com/path', 'https://user:secret@nvr.example.com', 'https://localhost']) {
      expect(() => loadConfig({ NVR_PUBLIC_ORIGIN: origin })).toThrow(/NVR_PUBLIC_ORIGIN/);
    }
  });
  it('không lộ giá trị biến khi báo lỗi', () => {
    expect(() => loadConfig({ NVR_LOG_LEVEL: 'private-password' })).toThrow('NVR_LOG_LEVEL không hợp lệ.');
  });
});

describe('Log bảo vệ thông tin nhạy cảm', () => {
  it('che secret lồng nhau, URL, token và thông báo lỗi thật qua Pino', () => {
    const lines: string[] = [];
    const logger = createLogger('info', { write: line => { lines.push(line); } });
    logger.info({ camera: { password: 'camera-secret', sourceUrl: 'rtsp://admin:source-secret@camera/live' }, authorization: 'Bearer header-secret' }, 'Kết nối rtsp://admin:message-secret@camera/live?token=query-secret');
    logger.error(new Error('rtsp://admin:exception-secret@camera/live'), 'Lỗi nguồn');
    logger.info('Bearer direct-secret');
    const output = lines.join('');
    for (const secret of ['camera-secret', 'source-secret', 'header-secret', 'message-secret', 'query-secret', 'exception-secret', 'direct-secret']) expect(output).not.toContain(secret);
    expect(output).toContain('ĐÃ ẨN');
    lines.forEach(line => expect(() => JSON.parse(line)).not.toThrow());
  });
  it('xử lý object lặp mà không làm crash logger', () => {
    const item: Record<string, unknown> = { token: 'hidden' };
    item.self = item;
    expect(() => JSON.stringify(sanitizeLog(item))).not.toThrow();
    expect(JSON.stringify(sanitizeLog(item))).not.toContain('hidden');
  });
});
