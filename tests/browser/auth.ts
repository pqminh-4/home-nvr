import type { Page } from '@playwright/test';

export const reviewUser = { username: 'review-owner', password: 'review-password-2026', setupToken: 'review-setup-token-32-characters-ok' };

export async function enterApp(page: Page, route = '/') {
  await page.goto(route);
  const setup = page.getByRole('heading', { name: 'Tạo tài khoản chủ nhà' });
  if (await setup.count() && await setup.isVisible()) {
    await page.getByLabel('Setup token').fill(reviewUser.setupToken);
    await page.getByLabel('Tên đăng nhập').fill(reviewUser.username);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(reviewUser.password);
    await page.getByLabel('Xác nhận mật khẩu').fill(reviewUser.password);
    await page.getByRole('button', { name: 'Khởi tạo Home NVR' }).click();
  } else {
    await page.getByLabel('Tên đăng nhập').fill(reviewUser.username);
    await page.getByLabel('Mật khẩu').fill(reviewUser.password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
  }
  await page.waitForSelector('.app-shell');
  if (route.includes('#')) await page.goto(route);
}
