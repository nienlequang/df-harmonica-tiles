import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { canvasColorCount, canvasSignature, collectErrors, stubClipboard } from './helpers';

/**
 * Màn đầu (góp ý 2026-10-15 B): mở `/` = MÀN CHƠI ĐẦY ĐỦ với bài mẫu (không còn màn "chơi thử" + ☰
 * Menu): header "◂ Thư viện" + ngôn ngữ / theme, thanh điều khiển, cột phím tắt, thanh dọc (Kiểu điều
 * khiển · Cửa sổ nổi · OBS · Chia sẻ · Cài đặt), thanh tiến độ ở đáy. Đếm ngược mặc định 3 giây.
 * Các trang khác: tên app thành "◂ Về màn chơi".
 */

// Hai bài mẫu đầu thư viện (góp ý 2026-10-16); bài đầu là bài của màn `#/` (DEMO_SONG_ID).
const SEEDS = ['Quốc ca Việt Nam', 'TAKEDISKRUSH!'] as const;

test.beforeEach(async ({ context }) => {
  await stubClipboard(context);
});

/** Nút Phát của thanh điều khiển. */
function playButton(page: Page): Locator {
  return page.locator('.transport').getByRole('button', { name: 'Phát', exact: true });
}

function sideBar(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Công cụ màn chơi' });
}

/** Chờ tới khi chữ ký canvas khác `from` (ô đã dịch). Trả thời gian chờ (ms). */
async function waitCanvasChange(page: Page, from: number, timeoutMs: number): Promise<number> {
  const t0 = Date.now();
  await expect
    .poll(() => canvasSignature(page), { timeout: timeoutMs, intervals: [50] })
    .not.toBe(from);
  return Date.now() - t0;
}

test('mở / → màn chơi đầy đủ với bài mẫu: thanh dọc đúng thứ tự, cột phím tắt, tiến độ ở đáy', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: SEEDS[0] })).toBeVisible();
  await expect(page.locator('canvas.player-canvas')).toBeVisible();
  await expect(playButton(page)).toBeVisible();
  // Màn chơi có header riêng (không thanh điều hướng của trang phụ), không còn ☰ Menu.
  await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /menu/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Về thư viện' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Đổi ngôn ngữ (VI/EN)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Đổi giao diện sáng/tối' })).toBeVisible();

  // Thanh dọc bên phải, trên → dưới.
  const bar = sideBar(page);
  const items = bar.locator('button, a');
  await expect(items).toHaveCount(6);
  const tops: number[] = [];
  for (const name of ['Cửa sổ nổi', 'OBS', 'Chia sẻ', 'Cài đặt']) {
    const el = bar.getByRole(name === 'Cài đặt' ? 'link' : 'button', {
      name: new RegExp(`^${name}`),
    });
    await expect(el).toBeVisible();
    tops.push((await el.boundingBox())?.y ?? -1);
  }
  const scheme = bar.getByRole('group', { name: 'Kiểu điều khiển' });
  tops.unshift((await scheme.boundingBox())?.y ?? -1);
  expect([...tops].sort((a, b) => a - b)).toEqual(tops);
  // Không còn nút Sửa trên màn chơi.
  await expect(page.getByRole('link', { name: /^Sửa/ })).toHaveCount(0);

  // Cột phím tắt (màn rộng) + "?" ẩn; thanh tiến độ ở đáy, dưới khu tiles.
  const shortcuts = page.getByRole('complementary', { name: 'Phím tắt và cách bấm' });
  await expect(shortcuts.getByText('Hủy đếm ngược')).toBeVisible();
  await expect(shortcuts.getByRole('link', { name: 'Xem hướng dẫn' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Phím tắt', exact: true })).toBeHidden();
  const seek = page.getByRole('slider', { name: 'Vị trí trong bài' });
  const stageBox = await page.locator('.player-canvas-wrap').boundingBox();
  const seekBox = await seek.boundingBox();
  expect(seekBox && stageBox && seekBox.y > stageBox.y + stageBox.height).toBe(true);
  expect(errors).toEqual([]);
});

test('Phát → đếm ngược 3 giây (mặc định) rồi ô rơi; Space tạm dừng', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  const play = playButton(page);
  await expect(play).toBeVisible();
  // Khung đầu đã vẽ (ô hiện sẵn, không trống) và đứng yên trước khi bấm.
  await expect.poll(() => canvasColorCount(page)).toBeGreaterThan(3);
  let before = await canvasSignature(page);
  await expect
    .poll(async () => {
      const prev = before;
      before = await canvasSignature(page);
      return before === prev;
    })
    .toBe(true);

  // Đếm vào / Đếm ngược chỉnh ở Cài đặt → Phát bài, không nằm trên thanh điều khiển (góp ý 2026-10-16).
  await expect(page.locator('.transport').getByRole('button', { name: 'Đếm vào' })).toHaveCount(0);
  await expect(page.locator('.transport').getByLabel('Đếm ngược')).toHaveCount(0);
  await play.click();
  await expect(page.locator('.player-countdown-num')).toHaveText('3');
  // Đếm ngược 3 s (ô đứng yên, số lớn) + đếm vào (ô rơi dẫn vào, KHÔNG có số) → ô rơi.
  await waitCanvasChange(page, before, 10_000);
  await expect(page.locator('.player-countdown')).toHaveCount(0);
  const a = await canvasSignature(page);
  await waitCanvasChange(page, a, 2_000);

  // Space: tạm dừng → canvas đứng yên (dừng giữa lúc đếm vào: ô trượt mượt ~0,36 s về điểm bắt đầu — D-389).
  await page.keyboard.press('Space');
  await page.waitForTimeout(600);
  const paused = await canvasSignature(page);
  await page.waitForTimeout(500);
  expect(await canvasSignature(page)).toBe(paused);
  expect(errors).toEqual([]);
});

test('◂ Thư viện → #/library liệt kê bài mẫu; "◂ Về màn chơi" quay lại bài vừa chơi', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Về thư viện' }).click();
  await expect(page).toHaveURL(/#\/library$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Thư viện bài hát' })).toBeVisible();
  for (const title of SEEDS) {
    await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
  }
  const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
  // Chưa mở bài nào khác → về `#/` (bài mẫu).
  await expect(nav.getByRole('link', { name: /^Về màn chơi/ })).toHaveAttribute('href', '#/');
  await expect(nav.getByRole('link', { name: 'Hướng dẫn' })).toHaveAttribute('href', '#/guide');

  // Mở bài thứ hai ở màn chơi rồi sang Cài đặt → "Về màn chơi" trỏ về bài đó.
  await page.goto('/#/play/seed-takediskrush');
  await expect(page.getByRole('heading', { level: 1, name: SEEDS[1] })).toBeVisible();
  await sideBar(page).getByRole('link', { name: 'Cài đặt' }).click();
  await expect(page).toHaveURL(/#\/settings$/);
  const back = nav.getByRole('link', { name: `Về màn chơi — ${SEEDS[1]}` });
  await expect(back).toHaveAttribute('href', '#/play/seed-takediskrush');
  await back.click();
  await expect(page.getByRole('heading', { level: 1, name: SEEDS[1] })).toBeVisible();
  expect(errors).toEqual([]);
});

test('màn chơi ở 375 px: thanh công cụ thành một hàng icon, không cuộn ngang', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto('/');
  await expect(playButton(page)).toBeInViewport();
  const bar = sideBar(page);
  for (const name of ['PC', 'Mobile']) {
    await expect(bar.getByRole('button', { name, exact: true })).toBeInViewport();
  }
  await expect(bar.getByRole('link', { name: 'Cài đặt' })).toBeInViewport();
  // Cột phím tắt ẩn ở màn hẹp → nút "?" mở danh sách.
  await expect(page.getByRole('complementary', { name: 'Phím tắt và cách bấm' })).toBeHidden();
  await page.getByRole('button', { name: 'Phím tắt', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Phím tắt của màn chơi' })).toBeVisible();
  await page.keyboard.press('Escape');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
