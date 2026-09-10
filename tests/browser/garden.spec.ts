import { expect, test } from '@playwright/test';
import { enterApp } from './auth';

test('dashboard hiển thị shell sản phẩm, feed minh họa và không tràn ngang', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await enterApp(page);
  await expect(page.getByRole('heading', { name: 'Live Matrix' })).toBeVisible();
  await expect(page.getByText('Phần 7 đang hoạt động')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Camera Phòng khách' }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  expect(errors).toEqual([]);
});

test('cổng đăng nhập xử lý lỗi API rõ ràng', async ({ page }) => {
  await page.route('**/api/v1/auth/status', route => route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'API chưa sẵn sàng' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kiểm tra lại' })).toBeVisible();
});

test('quản lý camera có modal, validation và trạng thái trống', async ({ page }) => {
  await enterApp(page, '/#cameras');
  await expect(page.getByRole('heading', { name: 'Camera', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Kết nối camera', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Tên camera').fill('Ban công');
  await page.getByLabel('Địa chỉ luồng').fill('http://invalid.example/stream');
  await page.getByRole('button', { name: 'Lưu và kiểm tra' }).click();
  await expect(page.getByRole('alert')).toContainText('rtsp://');
  await page.getByRole('button', { name: 'Đóng hộp thoại' }).click();
  await expect(page.getByRole('heading', { name: 'Chưa có camera nào' })).toBeVisible();
});

test('bản ghi và điều hướng di động hoạt động', async ({ page }) => {
  await enterApp(page, '/#recordings');
  await expect(page.getByRole('heading', { name: 'Bản ghi' })).toBeVisible();
  await page.getByRole('slider', { name: 'Chọn thời điểm bản ghi minh họa' }).fill('900');
  await expect(page.getByText('15:00')).toBeVisible();
  await page.getByRole('link', { name: 'Live Matrix' }).last().click();
  await expect(page).toHaveURL(/#dashboard$/);
});
