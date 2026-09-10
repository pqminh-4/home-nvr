import { expect, test } from '@playwright/test';
import { enterApp } from './auth';

test('sáu màn hình giữ đúng viewport và không có lỗi JavaScript', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await enterApp(page);
  for (const route of ['dashboard', 'cameras', 'recordings', 'events', 'alerts', 'settings']) {
    await page.goto('/#' + route);
    await expect(page.getByRole('heading').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('menu nhận click thật và giữ focus sau khi đóng dialog bằng Escape', async ({ page }, testInfo) => {
  await enterApp(page, '/#recordings');
  const nav = page.getByRole('navigation', { name: testInfo.project.name === 'mobile' ? 'Điều hướng di động' : 'Điều hướng chính', exact: true });
  const cameraLink = nav.getByRole('link', { name: 'Camera', exact: true });
  if (testInfo.project.name === 'mobile') await cameraLink.tap(); else await cameraLink.click();
  const opener = page.getByRole('button', { name: 'Kết nối camera', exact: true });
  await opener.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('bố cục một camera phản hồi trạng thái và chế độ giảm chuyển động', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterApp(page);
  if (testInfo.project.name === 'desktop') await page.getByRole('button', { name: 'Bố cục 1 ô' }).click();
  await page.locator('.scenario-picker select').selectOption('denied');
  const frame = page.locator(testInfo.project.name === 'mobile' ? '.mobile-feed' : '.desktop-feeds');
  await expect(frame.locator('.feed-message strong')).toHaveText('Không có quyền');
  expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
});

test('không phục vụ file bí mật trong bản giao diện mới', async ({ request }) => {
  for (const path of ['/.env', '/package.json', '/.git/config', '/%2e%2e/%2e%2e/.env']) {
    const response = await request.get(path);
    expect([400, 403, 404]).toContain(response.status());
    expect(await response.text()).not.toContain('NVR_LOG_LEVEL=');
  }
});
