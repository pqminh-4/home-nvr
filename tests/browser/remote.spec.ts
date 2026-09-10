import { expect, test } from '@playwright/test';
import { enterApp } from './auth';

test('truy cập từ xa hiển thị trạng thái thật và lỗi cấu hình rõ ràng', async ({ page }, testInfo) => {
  await enterApp(page, '/#settings');
  await page.getByRole('tab', { name: 'Truy cập từ xa' }).click();
  await expect(page.getByRole('heading', { name: 'Kết nối ngoài mạng' })).toBeVisible();
  await expect(page.getByText('Chưa khai báo NVR_PUBLIC_ORIGIN')).toBeVisible();
  await expect(page.getByText(/LAN vẫn hoạt động/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Zone domain' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Hostname' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Tunnel target' })).toBeVisible();
  await expect(page.getByLabel('Cloudflare API token')).toHaveAttribute('type', 'password');
  await page.getByLabel('Bật truy cập từ xa').check();
  await page.getByRole('button', { name: 'Lưu cài đặt' }).click();
  await expect(page.getByText('Cần kiểm tra').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('remote-settings.png'), fullPage: false });
});
