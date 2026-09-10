import { loadConfig } from './config.js';
import { openDatabase } from './database.js';

if (process.platform !== 'win32') process.umask(0o077);
try {
  const database = openDatabase(loadConfig().dataDir);
  const versions = database.db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all();
  database.close();
  console.log(JSON.stringify({ status: 'ok', migrations: versions }));
} catch {
  console.error('Migration thất bại. Kiểm tra quyền thư mục và lịch sử phiên bản; không tự xóa database.');
  process.exitCode = 1;
}
