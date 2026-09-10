import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  RELEASE_FILES,
  checksumForAsset,
  cloudflaredReleaseAsset,
  createInstallLayout,
  isInside,
  mediaMtxAsset,
  renderEnvironment,
  renderSystemdService,
  validateReleaseSource,
} from './installer-lib.mjs';

const cleanup = [];
afterEach(async () => {
  while (cleanup.length) await rm(cleanup.pop(), { recursive: true, force: true });
});

describe('installer Ubuntu', () => {
  it('tạo cấu hình secret và systemd bị giới hạn quyền', () => {
    const layout = createInstallLayout('/');
    const environment = renderEnvironment(layout, { setupToken: 's'.repeat(48), secretKey: 'k'.repeat(64) });
    const service = renderSystemdService(layout, '/usr/bin/node');
    expect(environment).toContain('NVR_HOST=127.0.0.1');
    expect(environment).toContain('NVR_DATA_DIR=/var/lib/home-nvr');
    expect(environment).toContain('NVR_CLOUDFLARED_BIN=/opt/home-nvr/bin/cloudflared');
    expect(environment).toContain('NVR_SETUP_TOKEN=' + 's'.repeat(48));
    expect(service).toContain('User=home-nvr');
    expect(service).toContain('ProtectSystem=strict');
    expect(service).toContain('ReadWritePaths=/var/lib/home-nvr /var/backups/home-nvr');
    expect(service).toContain('ExecStart=/usr/bin/node /opt/home-nvr/current/apps/api/dist/main.js');
  });

  it('chọn đúng asset và checksum MediaMTX', () => {
    const asset = mediaMtxAsset('x64');
    const checksum = 'a'.repeat(64);
    expect(asset).toBe('mediamtx_v1.21.0_linux_amd64.tar.gz');
    expect(checksumForAsset(`${checksum}  ${asset}\n`, asset)).toBe(checksum);
    expect(() => mediaMtxAsset('ia32')).toThrow(/x64 hoặc arm64/);
    const cloudflared = cloudflaredReleaseAsset({ assets: [{ name: 'cloudflared-linux-amd64', browser_download_url: 'https://github.com/cloudflare/cloudflared/releases/download/2026.8.3/cloudflared-linux-amd64', digest: 'sha256:' + checksum }] }, 'x64');
    expect(cloudflared).toMatchObject({ name: 'cloudflared-linux-amd64', sha256: checksum });
  });

  it('chỉ nhận gói release đã có bản build và đủ file runtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'home-nvr-release-test-'));
    cleanup.push(root);
    for (const item of RELEASE_FILES) {
      const target = join(root, item);
      if (['apps/api/dist', 'apps/web/dist', 'packages/contracts/dist'].includes(item)) await mkdir(target, { recursive: true });
      else {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, item === 'package.json' ? JSON.stringify({ name: 'home-nvr', version: '0.1.0' }) : 'test');
      }
    }
    await writeFile(join(root, 'apps/api/dist/main.js'), 'export {};');
    await writeFile(join(root, 'apps/web/dist/index.html'), '<!doctype html>');
    await writeFile(join(root, 'packages/contracts/dist/index.js'), 'export {};');
    await expect(validateReleaseSource(root)).resolves.toMatchObject({ version: '0.1.0' });
    expect(isInside(join(root, 'apps'), join(root, 'apps/api'))).toBe(true);
    expect(isInside(join(root, 'apps'), join(root, 'outside'))).toBe(false);
  });
});
