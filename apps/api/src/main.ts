import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { MediaMtxGateway } from './media.js';

// Giới hạn quyền file mới trên Ubuntu, không ảnh hưởng môi trường Windows.
if (process.platform !== 'win32') process.umask(0o077);

try {
  const config = loadConfig();
  const mediaGateway = new MediaMtxGateway({ binary: config.mediaMtxBinary, dataDir: config.dataDir });
  try { await mediaGateway.start(); } catch { /* API vẫn khởi động để hiển thị chẩn đoán media. */ }
  const app = await buildApp(config, { mediaGateway });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      const timeout = setTimeout(() => process.exit(1), 10_000);
      timeout.unref();
      void app.close().then(() => { clearTimeout(timeout); }).catch(() => { process.exitCode = 1; });
    });
  }
  try { await app.listen({ host: config.host, port: config.port }); }
  catch (error) { await app.close(); throw error; }
} catch {
  console.error('Không thể khởi động Home NVR. Kiểm tra cấu hình, quyền thư mục dữ liệu, migration và cổng dịch vụ.');
  process.exitCode = 1;
}
