import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { stubClipboard } from './helpers';

/**
 * Thư viện: 4 cách thêm bài theo thứ tự (góp ý 2026-10-16: Tạo bài với AI đầu), lối vào Editor / MIDI đã bật ở Phase 2
 * (cờ D-060), modal giữ focus (Tab không lọt ra trang phía sau), bài lỗi cho xem dòng bị lỗi.
 */

test.beforeEach(async ({ context }) => {
  await stubClipboard(context);
});

async function importHarm(page: Page, name: string, text: string): Promise<void> {
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
}

/** Mô tả phần tử đang focus: nhãn + có nằm trong dialog không. */
async function focused(page: Page): Promise<{ label: string; inDialog: boolean }> {
  return page.evaluate(() => {
    const el = document.activeElement;
    return {
      label: (el?.getAttribute('aria-label') ?? el?.textContent ?? '').trim(),
      inDialog: Boolean(el?.closest('[role="dialog"]')),
    };
  });
}

test('"Thêm bài" theo thứ tự (AI đầu), link Sửa, "Tạo bài từ file MIDI / MusicXML"; route mở view thật', async ({
  page,
}) => {
  await page.goto('/#/library');
  await expect(page.getByRole('heading', { level: 1, name: 'Thư viện bài hát' })).toBeVisible();
  const actions = page.getByRole('list', { name: 'Các cách thêm bài' }).locator('.btn');
  // Góp ý 2026-10-16: "Tạo bài với AI" thay "Tạo bài mới thủ công" và đứng đầu.
  await expect(actions).toHaveText([
    'Tạo bài với AI',
    'Tạo bài từ file MIDI / MusicXML',
    'Nhập file ký tự (.harm / .txt / .json)',
    'Tự chơi để tạo bài',
  ]);
  await expect(page.getByRole('link', { name: 'Tạo bài với AI' })).toHaveAttribute('href', '#/ai');
  await expect(page.getByRole('button', { name: 'Tạo bài mới thủ công' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Tạo bài từ file MIDI / MusicXML' })).toHaveAttribute(
    'href',
    '#/midi',
  );
  await expect(page.getByRole('link', { name: 'Tự chơi để tạo bài' })).toHaveAttribute(
    'href',
    '#/record',
  );
  await expect(
    page.getByText('Fan-made · không liên kết với nhà phát hành Delta Force'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sửa "Quốc ca Việt Nam"' })).toHaveAttribute(
    'href',
    '#/edit/seed-quoc-ca-viet-nam',
  );

  await page.getByRole('link', { name: 'Sửa "Quốc ca Việt Nam"' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sửa: Quốc ca Việt Nam' }),
  ).toBeVisible();
  await expect(
    page.getByText('Tính năng này chưa có trong bản hiện tại', { exact: false }),
  ).toHaveCount(0);

  // Player không còn nút "Sửa" (góp ý 2026-10-15 B) — sửa bài đi từ Thư viện.
  await page.goto('/#/play/seed-quoc-ca-viet-nam');
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sửa bài "Quốc ca Việt Nam"' })).toHaveCount(0);
});

test('bài lỗi: xem được dòng bị lỗi; hộp xác nhận xóa giữ focus trong dialog', async ({ page }) => {
  await page.goto('/#/library');
  await importHarm(page, 'loi.harm', '@title Bài lỗi\n# A\nZ Q X\n');
  const card = page.getByRole('listitem', { name: 'Bài lỗi' });
  await expect(card.getByText('1 lỗi')).toBeVisible();
  await card.getByText('Xem dòng bị lỗi').click();
  await expect(card.getByText('Dòng 3, cột 3: Token lạ: "Q"')).toBeVisible();

  const del = card.getByRole('button', { name: 'Xóa "Bài lỗi"' });
  await del.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Xóa bài hát?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Đóng' })).toBeVisible();
  expect(await focused(page)).toEqual({ label: 'Hủy', inDialog: true });

  const seen: string[] = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    const f = await focused(page);
    expect(f.inDialog, `Tab ${i + 1}: ${f.label}`).toBe(true);
    seen.push(f.label);
  }
  expect(seen).toEqual(['Xóa', 'Đóng', 'Hủy', 'Xóa', 'Đóng']);
  await page.keyboard.press('Shift+Tab');
  expect(await focused(page)).toEqual({ label: 'Xóa', inDialog: true });

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect((await focused(page)).label).toBe('Xóa "Bài lỗi"');
});
