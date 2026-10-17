import { expect, test } from '@playwright/test';
import { collectErrors, stubClipboard } from './helpers';

/**
 * "Tự chơi để tạo bài" (Phase 3b, route #/record): đếm vào bằng hình, thu phím thật (KeyZ / KeyX /
 * KeyC) + giữ chuột phải trên khung thu cho một nốt, dừng, mở bài trong Editor dạng bản nháp (chưa
 * vào thư viện cho tới khi Lưu). Settings mặc định (PC, âm thanh tắt).
 */

test.beforeEach(async ({ context }) => {
  await stubClipboard(context);
});

test('thu Z X C (C giữ chuột phải) → Mở trong Editor, không lỗi', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/#/record');
  await expect(page.getByRole('heading', { level: 1, name: 'Tự chơi để tạo bài' })).toBeVisible();
  await page.getByLabel('Tên bài').fill('Thu e2e');
  await page.getByLabel('Tempo (BPM)').fill('120');

  await page.getByRole('button', { name: 'Thu', exact: true }).click();
  const readout = page.locator('.rec-readout');
  await expect(readout).toHaveText(/Đếm vào: \d/);
  // 1 ô nhịp 4/4 ở 120 BPM ≈ 2,1 s
  await expect(readout).toHaveText(/Đang thu · ô nhịp 1/, { timeout: 5_000 });

  const surface = page.getByRole('group', {
    name: 'Khung thu: giữ chuột trong khung này làm modifier',
  });
  const box = await page.locator('.rec-roll-wrap').boundingBox();
  if (!box) throw new Error('không thấy cuộn nốt');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  const note = async (code: string) => {
    await page.keyboard.down(code);
    await page.waitForTimeout(350);
    await page.keyboard.up(code);
    await page.waitForTimeout(200);
  };
  await note('KeyZ');
  await note('KeyX');
  await page.mouse.down({ button: 'right' });
  await expect(surface.locator('.gb-mod-right')).toHaveClass(/is-pressed/);
  await page.keyboard.down('KeyC');
  await expect(surface.locator('.gb-key[data-key="C"]')).toHaveClass(/is-active/);
  await page.waitForTimeout(350);
  await page.keyboard.up('KeyC');
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(200);
  await expect(page.getByRole('img', { name: 'Cuộn nốt đang thu' })).toBeVisible();

  await page.getByRole('button', { name: 'Dừng', exact: true }).click();
  const result = page.getByRole('region', { name: 'Bản thu' });
  await expect(result).toContainText('3 nốt');

  await result.getByRole('button', { name: 'Mở trong Editor' }).click();
  await expect(page).toHaveURL(/#\/edit\/draft-[^/]+$/);
  await expect(page.getByText('Bản nháp — chưa lưu', { exact: true })).toBeVisible();
  const source = page.getByLabel('Nội dung bài (.harm)');
  await expect(source).toHaveValue(/^@title Thu e2e\n@bpm 120\n@time 4\/4\n/);
  // Máy bận làm khoảng nghỉ giữa hai phím ≥ 1 beat → bài tự xuống dòng ở đó (chia dòng như tạo bài từ file).
  await expect(source).toHaveValue(
    /Z(\*[\d.]+)?\s+(_(\*[\d.]+)?\s+)*X(\*[\d.]+)?\s+(_(\*[\d.]+)?\s+)*\[giữ chuột phải\] C/,
  );
  await expect(source).not.toHaveAttribute('aria-invalid', 'true');
  expect(errors).toEqual([]);
});
