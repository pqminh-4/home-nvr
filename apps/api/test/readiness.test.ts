import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../src/database.js';

it('readiness phát hiện schema không thể đọc thay vì chỉ tính SELECT 1', () => {
  const directory = mkdtempSync(join(tmpdir(), 'home-nvr-readiness-'));
  const database = openDatabase(directory);
  try {
    expect(database.isHealthy()).toBe(true);
    database.db.exec('DROP TABLE schema_migrations');
    expect(database.isHealthy()).toBe(false);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
