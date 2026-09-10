import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mỗi lần chạy dùng database riêng, không đụng dữ liệu đang phát triển.
export default defineConfig({
  testDir: './tests/browser',
  timeout: 20_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4317',
    headless: true,
    ...(process.env.NVR_BROWSER_CHANNEL ? { channel: process.env.NVR_BROWSER_CHANNEL } : {}),
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' } },
  ],
  webServer: {
    command: 'node apps/api/dist/main.js',
    url: 'http://127.0.0.1:4317/health/ready',
    reuseExistingServer: false,
    timeout: 15_000,
    env: { NVR_HOST: '127.0.0.1', NVR_PORT: '4317', NVR_LOG_LEVEL: 'silent', NVR_DATA_DIR: mkdtempSync(join(tmpdir(), 'home-nvr-browser-')), NVR_SETUP_TOKEN: 'review-setup-token-32-characters-ok', NVR_SECRET_KEY: 'review-secret-key-32-characters-ok', NVR_WEB_ORIGIN: 'http://127.0.0.1:4317' },
  },
});
