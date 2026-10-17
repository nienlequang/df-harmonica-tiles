import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { PNG } from 'pngjs';
import { stubClipboard } from './helpers';

/**
 * Chế độ tương phản cao của Windows (forced-colors): trình duyệt ép nền về Canvas, nên trạng thái vẽ bằng
 * nền (chốt switch, nút aria-pressed) phải dùng màu hệ thống (app.css). Kiểm tra bằng PIXEL vì computed
 * style không thấy tấm nền Canvas Chromium vẽ sau chữ (HighlightText trên tấm nền đó = chữ biến mất).
 */

test.use({ forcedColors: 'active', colorScheme: 'dark' });

test.beforeEach(async ({ context }) => {
  await stubClipboard(context);
});

interface Shot {
  width: number;
  height: number;
  /** Màu tại (x, y) theo tỉ lệ 0..1 của khung, dạng 0xRRGGBB. */
  at: (fx: number, fy: number) => number;
  /** Mọi pixel của hàng giữa. */
  middleRow: () => number[];
}

async function shoot(el: Locator): Promise<Shot> {
  const png = PNG.sync.read(await el.screenshot());
  const px = (x: number, y: number) => {
    const i = (png.width * y + x) * 4;
    return (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2];
  };
  const clampX = (fx: number) => Math.min(png.width - 1, Math.max(0, Math.round(fx * png.width)));
  const clampY = (fy: number) => Math.min(png.height - 1, Math.max(0, Math.round(fy * png.height)));
  return {
    width: png.width,
    height: png.height,
    at: (fx, fy) => px(clampX(fx), clampY(fy)),
    middleRow: () => {
      const y = clampY(0.5);
      return Array.from({ length: png.width }, (_, x) => px(x, y));
    },
  };
}

test('switch: chốt luôn thấy được, bật / tắt khác màu nền', async ({ page }) => {
  await page.goto('/#/settings');
  expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);

  const on = page.getByRole('switch', { name: /Đếm vào khi bấm Phát/ });
  await expect(on).toBeChecked();
  const off = page.locator('.toggle:not(:checked):not(:disabled)').first();
  await expect(off).toBeVisible();

  // Bật: chốt bên phải (~70 %), nền ở bên trái (~20 %). Tắt: chốt bên trái (~27 %), nền bên phải (~75 %).
  const a = await shoot(on);
  const b = await shoot(off);
  expect(a.at(0.7, 0.5)).not.toBe(a.at(0.2, 0.5));
  expect(b.at(0.27, 0.5)).not.toBe(b.at(0.75, 0.5));
  // Trạng thái không chỉ nằm ở vị trí chốt: nền bật ≠ nền tắt.
  expect(a.at(0.2, 0.5)).not.toBe(b.at(0.75, 0.5));
});

test('nút aria-pressed: nền khác nút thường và chữ vẫn đọc được', async ({ page }) => {
  // Thanh phát không còn nút "Đếm vào" (góp ý 2026-10-16) → dùng hai nút của nhóm "Chế độ luyện tập"
  // (cùng cỡ, chỉ có chữ): "Chờ" (chữ ngắn) đang chọn, "Chấm điểm" thường.
  await page.goto('/#/play/seed-quoc-ca-viet-nam');
  await page.getByRole('button', { name: 'Luyện tập', pressed: false }).click();
  const modes = page.getByRole('group', { name: 'Chế độ luyện tập' });
  await modes.getByRole('button', { name: 'Chờ', exact: true }).click();
  const pressed = modes.getByRole('button', { name: 'Chờ', exact: true, pressed: true });
  const normal = modes.getByRole('button', { name: 'Chấm điểm', pressed: false });
  await expect(pressed).toBeVisible();
  await expect(normal).toBeVisible();

  const p = await shoot(pressed);
  const n = await shoot(normal);
  const fill = p.at(0.04, 0.5);
  expect(fill).not.toBe(n.at(0.04, 0.5));

  // Hàng giữa đi qua chữ: phần lớn là màu nền của nút (không có tấm nền Canvas che sau chữ) và có pixel
  // chữ khác hẳn màu nền.
  const row = p.middleRow();
  const share = row.filter((c) => c === fill).length / row.length;
  expect(share).toBeGreaterThan(0.5);
  expect(row.some((c) => c !== fill)).toBe(true);
});

test('game bar: chấm quãng của "1̇" vẫn thấy được (vẽ bằng màu hệ thống)', async ({ page }) => {
  await page.goto('/#/play/seed-quoc-ca-viet-nam');
  const cell = page.locator('.gb-degree', { has: page.locator('.gb-degree-dot') }).first();
  await expect(cell).toBeVisible();
  const withDot = await cell.screenshot();
  // Cùng ô, giấu chấm: ảnh phải khác (chấm bị ép về Canvas thì hai ảnh giống hệt).
  await page.addStyleTag({ content: '.gb-degree-dot::after { visibility: hidden !important; }' });
  const withoutDot = await cell.screenshot();
  expect(withDot.equals(withoutDot)).toBe(false);
});

test('thanh trượt Tempo: rãnh vẫn thấy được (gradient bị bỏ → vẽ lại bằng màu hệ thống)', async ({
  page,
}) => {
  await page.goto('/#/play/seed-quoc-ca-viet-nam');
  const slider = page.locator('.transport-slider input[type="range"]').first();
  await expect(slider).toBeVisible();
  const shot = await shoot(slider);
  // Góc trên trái = nền; hàng giữa đi qua rãnh: phần lớn khác nền (không chỉ có thumb).
  const bg = shot.at(0, 0);
  const row = shot.middleRow();
  expect(row.filter((c) => c !== bg).length / row.length).toBeGreaterThan(0.6);
});

/** Tỉ lệ tương phản WCAG giữa hai màu 0xRRGGBB. */
function contrast(a: number, b: number): number {
  const lum = (c: number) => {
    const ch = [(c >> 16) & 255, (c >> 8) & 255, c & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('bàn nút Mobile: tên trong nút chế độ đang chọn đọc được trên nền Highlight', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('fc-mobile')) return;
    sessionStorage.setItem('fc-mobile', '1');
    localStorage.setItem(
      'dfht-settings',
      JSON.stringify({ state: { controlScheme: 'mobile', language: 'vi' }, version: 3 }),
    );
  });
  // Bàn nút kiểu game ở 1366 px: nút chế độ lớn, tên nằm TRONG hình tròn (nút đang chọn = nền Highlight).
  await page.goto('/#/play/seed-quoc-ca-viet-nam?line=4');
  const pad = page.getByRole('group', { name: 'Gợi ý phím như trong game' });
  await expect(pad).toHaveAttribute('data-label', 'inside');
  const circle = pad.locator('.gbm-mode.is-selected .mpad-mode-circle');
  await expect(circle).toHaveCount(1);
  await expect(circle.locator('.mpad-mode-name')).not.toBeEmpty();
  const shot = await shoot(circle);
  // Nền của hình tròn ngay trên chữ; chữ ở giữa phải tương phản rõ với nền đó (trước đây: chữ màu chế độ
  // tối trên Highlight tối ≈ 1.3:1).
  const fill = shot.at(0.5, 0.18);
  let best = 1;
  for (let y = 0.3; y <= 0.7; y += 0.02) {
    for (let x = 0.15; x <= 0.85; x += 0.01) best = Math.max(best, contrast(fill, shot.at(x, y)));
  }
  expect(best).toBeGreaterThan(4.5);
});
