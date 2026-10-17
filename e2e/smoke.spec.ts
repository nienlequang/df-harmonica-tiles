import { expect, test } from '@playwright/test';
import { canvasColorCount, collectErrors, stubClipboard } from './helpers';

/**
 * Smoke (spec §9): mở thư viện (`#/library` — `#/` là màn chơi với bài mẫu, xem first-run.spec.ts), thấy mọi bài
 * seed, mỗi bài play ~3 giây không lỗi console.
 * Chạy trên bản build (`vite preview`), settings mặc định (tiếng Việt, âm thanh tắt).
 */

const SEEDS = [
  { id: 'seed-quoc-ca-viet-nam', title: 'Quốc ca Việt Nam' },
  { id: 'seed-takediskrush', title: 'TAKEDISKRUSH!' },
  { id: 'seed-ji-mo-de-ren', title: '寂寞的人伤心的歌 (Bài Ca Đau Khổ Của Kẻ Cô Đơn)' },
  { id: 'seed-sao-minh-chua-nam-tay-nhau', title: 'Sao Mình Chưa Nắm Tay Nhau' },
] as const;

test.beforeEach(async ({ context }) => {
  await stubClipboard(context);
});

test('library lists every seed song', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/#/library');
  await expect(page.getByRole('heading', { level: 1, name: 'Thư viện bài hát' })).toBeVisible();
  for (const seed of SEEDS) {
    await expect(page.getByRole('heading', { level: 2, name: seed.title })).toBeVisible();
    await expect(page.getByRole('link', { name: `Phát "${seed.title}"` })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

for (const seed of SEEDS) {
  test(`plays "${seed.title}" for 3 s without console errors`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/#/library');
    await page.getByRole('link', { name: `Phát "${seed.title}"` }).click();
    await expect(page).toHaveURL(new RegExp(`#/play/${seed.id}$`));
    await expect(page.getByRole('heading', { level: 1, name: seed.title })).toBeVisible();

    // Canvas có kích thước thật (CSS + backing store) và đã vẽ khung đầu.
    const canvas = page.locator('canvas.player-canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(100);
    expect(box?.height ?? 0).toBeGreaterThan(100);
    const backing = await canvas.evaluate((el) => {
      const c = el as HTMLCanvasElement;
      return { w: c.width, h: c.height };
    });
    expect(backing.w).toBeGreaterThan(0);
    expect(backing.h).toBeGreaterThan(0);
    expect(await canvasColorCount(page)).toBeGreaterThan(3);

    // Game bar: 8 phím theo thứ tự lane.
    const gameBar = page.getByRole('group', { name: 'Gợi ý phím như trong game' });
    await expect(gameBar.locator('kbd')).toHaveText(['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',']);

    const play = page.locator('button.transport-play');
    const seek = page.getByRole('slider', { name: 'Vị trí trong bài', exact: true });
    const time = page.locator('.seekbar-time');
    await expect(play).toHaveAttribute('data-playing', 'false');
    expect(Number(await seek.inputValue())).toBe(0);
    const initialTime = (await time.textContent()) ?? '';
    expect(initialTime).toMatch(/^0:00 \/ \d+:\d{2}$/);

    await play.click();
    await expect(play).toHaveAttribute('data-playing', 'true');
    await expect(play).toHaveAccessibleName('Tạm dừng');
    await page.waitForTimeout(3_000);

    // Đếm vào (≈ 1,2–1,3 s ở 80–122 BPM — src/player/leadIn.ts) rồi tiến độ phải chạy.
    await expect(play).toHaveAttribute('data-playing', 'true');
    await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThan(0);
    await expect.poll(async () => (await time.textContent()) ?? '').not.toBe(initialTime);
    expect(await canvasColorCount(page)).toBeGreaterThan(3);

    await play.click();
    await expect(play).toHaveAttribute('data-playing', 'false');

    await page.getByRole('link', { name: 'Về thư viện' }).click();
    await expect(page).toHaveURL(/#\/library$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Thư viện bài hát' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: seed.title })).toBeVisible();

    expect(errors).toEqual([]);
  });
}

// Overlay route (nền trong suốt, spec §9): e2e/overlay.spec.ts.
