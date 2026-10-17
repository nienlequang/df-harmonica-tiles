import { expect, test } from '@playwright/test';
import { collectErrors, stubClipboard } from './helpers';

/**
 * Trang Hướng dẫn (D-260): người dùng chỉ có link web, nên README (phần người dùng) và prompt AI cho cảm âm
 * nằm trong bản build — mở từ link "Xem hướng dẫn" ở cột phím tắt của màn chơi (hoặc link "Hướng dẫn" của
 * thanh điều hướng), mục lục cuộn tới đúng mục, ảnh tải được, điện thoại không cuộn ngang.
 */

test.beforeEach(async ({ context }) => {
  await stubClipboard(context);
});

test('màn chơi → Xem hướng dẫn: mục lục cuộn tới mục; link sang prompt AI cảm âm', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page
    .getByRole('complementary', { name: 'Phím tắt và cách bấm' })
    .getByRole('link', { name: 'Xem hướng dẫn' })
    .click();
  await expect(page).toHaveURL(/#\/guide$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Delta Force Harmonica Tiles' }),
  ).toBeVisible();
  // Ảnh minh họa (docs/images) có trong bản build.
  const img = page.locator('.guide-figure img').first();
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);

  await page.getByRole('link', { name: 'Chia sẻ link' }).first().click();
  await expect(page).toHaveURL(/#\/guide\?s=/);
  const heading = page.getByRole('heading', { level: 2, name: 'Chia sẻ link' });
  await expect(heading).toBeInViewport();
  await expect(heading).toBeFocused();

  await page.getByRole('link', { name: 'bản tiếng Anh' }).click();
  await expect(page).toHaveURL(/#\/guide\/cam-am\?s=english-version$/);
  await expect(page.getByRole('heading', { level: 2, name: 'English version' })).toBeInViewport();
  expect(errors).toEqual([]);
});

test('điện thoại 360 px: trang Hướng dẫn không cuộn ngang (bảng / code cuộn trong khung)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const route of ['/#/guide', '/#/guide/cam-am']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const [scrollWidth, innerWidth] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      window.innerWidth,
    ]);
    expect(scrollWidth).toBe(innerWidth);
  }
});
