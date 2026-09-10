import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config.js';
import { CloudflareTunnelService } from '../src/remote.js';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });

describe('Cloudflare Tunnel', () => {
  it('không khởi động khi token file chưa tồn tại và không ảnh hưởng LAN', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'home-nvr-tunnel-'));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const service = new CloudflareTunnelService(loadConfig({
      NVR_DATA_DIR: directory,
      NVR_PUBLIC_ORIGIN: 'https://nvr.example.com',
      NVR_TUNNEL_TOKEN_FILE: join(directory, 'missing-token'),
    }));
    expect(service.health()).toBe('configured');
    await service.reconcile(true);
    expect(service.health()).toBe('error');
    expect(service.publicOrigin()).toBe('https://nvr.example.com');
    await service.shutdown();
  });
});
