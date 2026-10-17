import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { collectErrors, stubClipboard } from './helpers';

/**
 * "Cửa sổ nổi" (Document Picture-in-Picture, src/pip): nút bật / tắt ở thanh dọc bên phải màn chơi (kiểu
 * PC) mở cửa sổ nổi (Edge headless có API; cửa sổ nổi là một page mới của context), canvas trong cửa sổ
 * nổi được vẽ và chạy bằng rAF của chính nó, Căn chỉnh hiện 8 vạch dẫn, bấm lại nút ở tab gốc để đóng;
 * "Chuyển sang bài này" khi cửa sổ nổi đang hiện bài khác; trình duyệt không có API → một dòng giải thích.
 */

const SEED = 'seed-quoc-ca-viet-nam';

test.beforeEach(async ({ context }) => {
  await stubClipboard(context);
});

/**
 * Cài đặt đặt trước khi app chạy (một lần mỗi tab). Đếm ngược của cửa sổ nổi theo Cài đặt → Phát bài (góp ý
 * 2026-10-16: không còn ô đếm ngược riêng trên thanh của cửa sổ nổi).
 */
async function presetSettings(page: Page, state: Record<string, unknown>): Promise<void> {
  await page.addInitScript((st) => {
    if (sessionStorage.getItem('pip-init')) return;
    sessionStorage.setItem('pip-init', '1');
    localStorage.setItem('dfht-settings', JSON.stringify({ state: st, version: 5 }));
  }, state);
}

/** Chữ ký điểm ảnh thưa của canvas cửa sổ nổi (khác nhau giữa hai lần = khung hình đã đổi). */
async function pipSignature(pip: Page): Promise<{ colors: number; hash: number }> {
  return pip.locator('canvas.pip-canvas').evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width === 0 || canvas.height === 0) return { colors: 0, hash: 0 };
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const seen = new Set<number>();
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i += 4 * 13) {
      const c = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      if (seen.size < 64) seen.add(c);
      h ^= c;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return { colors: seen.size, hash: h };
  });
}

test('Player → Cửa sổ nổi: mở cửa sổ luôn nằm trên, ô rơi chạy, Căn chỉnh, đóng từ tab gốc', async ({
  page,
  context,
}) => {
  const errors = collectErrors(page);
  await presetSettings(page, { language: 'vi', startDelaySec: 0 });
  await page.goto(`/#/play/${SEED}`);
  const open = page
    .getByRole('complementary', { name: 'Công cụ màn chơi' })
    .getByRole('button', { name: 'Cửa sổ nổi', exact: true });
  await expect(open).toBeVisible();
  await expect(open).toHaveAttribute('aria-pressed', 'false');

  const pending = context.waitForEvent('page');
  await open.click();
  const pip = await pending;
  const pipErrors = collectErrors(pip);
  await pip.setViewportSize({ width: 576, height: 600 });

  // Tab gốc: nút đang bật (nhãn "Đang mở") + câu trạng thái; cửa sổ nổi: chỉ làn ô rơi + thanh nhỏ.
  await expect(open).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('status').filter({ hasText: 'Đang mở cửa sổ nổi' })).toHaveCount(1);
  await expect(pip.getByRole('region', { name: 'Cửa sổ nổi' })).toBeVisible();
  await expect(pip.locator('canvas.pip-canvas')).toBeVisible();
  await expect.poll(async () => (await pipSignature(pip)).colors).toBeGreaterThan(3);

  // Cài đặt → Đếm ngược = tắt → cửa sổ nổi vẫn đếm tối thiểu 3 s (vòng R7) với ô đứng ở frame đầu đếm vào,
  // rồi chạy; khung hình đổi theo thời gian (rAF của cửa sổ nổi). Thanh nhỏ không có ô đếm ngược riêng.
  const toolbar = pip.getByRole('group', { name: 'Điều khiển cửa sổ nổi' });
  await expect(toolbar.getByLabel('Đếm ngược')).toHaveCount(0);
  const before = (await pipSignature(pip)).hash;
  await toolbar.getByRole('button', { name: 'Phát', exact: true }).click();
  await expect(pip.locator('.pip-countdown-num')).toHaveText('3');
  await expect
    .poll(async () => (await pipSignature(pip)).hash, { timeout: 8_000 })
    .not.toBe(before);
  await pip.keyboard.press('Space'); // tạm dừng

  // Căn chỉnh: 8 vạch dẫn Z … , + mép dưới; Esc tắt.
  await toolbar.getByRole('button', { name: 'Căn chỉnh' }).click();
  const guides = pip.getByRole('group', { name: 'Vạch căn chỉnh với bảng phím game' });
  await expect(guides).toBeVisible();
  await expect(guides.locator('.pip-align-col')).toHaveCount(8);
  await expect(guides.getByText('Mép dưới = mép trên bảng phím game')).toBeVisible();
  await pip.keyboard.press('Escape');
  await expect(guides).toHaveCount(0);

  // Bấm lại nút ở tab gốc → cửa sổ nổi đóng, nút về trạng thái tắt.
  const closed = pip.waitForEvent('close');
  await open.click();
  await closed;
  await expect(open).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
  expect(pipErrors).toEqual([]);
});

test('kiểu Mobile: cửa sổ nổi dùng bàn nút như màn chơi, vòng "CHẠM" rơi xuống đúng nút chế độ (Ø = nút), không nhãn "CHẠM: <chế độ>"', async ({
  page,
  context,
}) => {
  const errors = collectErrors(page);
  await presetSettings(page, { language: 'vi', startDelaySec: 0, countIn: false });
  await page.goto('/#/play/seed-quoc-ca-viet-nam?line=3');
  const bar = page.getByRole('complementary', { name: 'Công cụ màn chơi' });
  const pending = context.waitForEvent('page');
  await bar.getByRole('button', { name: 'Cửa sổ nổi', exact: true }).click();
  const pip = await pending;
  const pipErrors = collectErrors(pip);
  await pip.setViewportSize({ width: 576, height: 600 });
  const stage = pip.getByRole('region', { name: 'Cửa sổ nổi' });
  await expect(stage).toHaveAttribute('data-scheme', 'pc');
  await expect(stage.locator('.mpad')).toHaveCount(0);

  // Ghi chữ + vòng "CHẠM" (arc ngay trước chữ "CHẠM", nét màu = lần stroke cuối trước chữ) của mọi canvas
  // cửa sổ nổi (prototype của CHÍNH cửa sổ nổi) — vòng vẽ trên lớp `.mpad-cues` của bàn nút (vòng R7).
  await pip.evaluate(() => {
    type Arc = { x: number; y: number; r: number; lw: number; m: DOMMatrix; cls: string };
    const w = window as unknown as { __pip: { texts: string[]; rings: Arc[] } };
    w.__pip = { texts: [], rings: [] };
    const proto = CanvasRenderingContext2D.prototype;
    let last: Arc | null = null;
    const arc = proto.arc;
    proto.arc = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      const [x, y, r] = args as number[];
      last = { x, y, r, lw: 0, m: this.getTransform(), cls: this.canvas.className };
      return (arc as (...a: unknown[]) => void).apply(this, args);
    } as typeof proto.arc;
    const stroke = proto.stroke;
    proto.stroke = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      if (last) last.lw = this.lineWidth;
      return (stroke as (...a: unknown[]) => void).apply(this, args);
    } as typeof proto.stroke;
    const fillText = proto.fillText;
    proto.fillText = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      if (w.__pip.texts.length < 20_000) w.__pip.texts.push(String(args[0]));
      if (args[0] === 'CHẠM' && last) {
        w.__pip.rings.push(last);
        if (w.__pip.rings.length > 200) w.__pip.rings.shift();
      }
      return (fillText as (...a: unknown[]) => void).apply(this, args);
    } as typeof proto.fillText;
  });

  // Đổi sang Mobile ở màn chơi khi cửa sổ nổi đang mở → cửa sổ nổi theo ngay.
  await bar
    .getByRole('group', { name: 'Kiểu điều khiển' })
    .getByRole('button', { name: 'Mobile' })
    .click();
  await expect(stage).toHaveAttribute('data-scheme', 'mobile');
  const pad = stage.locator('.mpad');
  await expect(pad).toBeVisible();
  await expect(pad.locator('.mpad-mode-circle')).toHaveCount(4);
  await pip
    .getByRole('group', { name: 'Điều khiển cửa sổ nổi' })
    .getByRole('button', { name: 'Phát', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        pip.evaluate(
          () => (window as unknown as { __pip: { rings: unknown[] } }).__pip.rings.length,
        ),
      {
        timeout: 10_000,
      },
    )
    .toBeGreaterThan(0);
  await pip.keyboard.press('Space'); // tạm dừng

  const result = await pip.evaluate(() => {
    type Arc = { x: number; y: number; r: number; lw: number; m: DOMMatrix; cls: string };
    const w = window as unknown as { __pip: { texts: string[]; rings: Arc[] } };
    const rings = w.__pip.rings.slice(-8).map((a) => {
      const canvas = document.querySelector(`canvas.${a.cls.split(' ')[0]}`) as HTMLCanvasElement;
      const box = canvas.getBoundingClientRect();
      const k = box.width / canvas.width;
      const c = a.m.transformPoint(new DOMPoint(a.x, a.y));
      // Mép ngoài nét màu (bán kính arc + nửa nét), px CSS của trang.
      return {
        cls: a.cls,
        cx: box.left + c.x * k,
        cy: box.top + c.y * k,
        d: (2 * a.r + a.lw) * a.m.a * k,
      };
    });
    const circles = [...document.querySelectorAll('.mpad-mode-circle')].map((el) => {
      const c = el.getBoundingClientRect();
      return { cx: c.left + c.width / 2, cy: c.top + c.height / 2, d: c.width };
    });
    return { rings, circles, texts: w.__pip.texts };
  });
  expect(result.rings.length).toBeGreaterThan(0);
  for (const g of result.rings) {
    // Vòng vẽ trên lớp của bàn nút (nằm trên nút chế độ DOM), không trên canvas làn.
    expect(g.cls).toContain('mpad-cues');
    const target = result.circles.find((c) => Math.abs(c.cx - g.cx) < 1.5);
    expect(target, `vòng ở x=${g.cx.toFixed(1)} không thẳng tâm nút chế độ nào`).toBeTruthy();
    expect(Math.abs(target!.d - g.d), `Ø vòng ${g.d.toFixed(1)} ≠ Ø nút`).toBeLessThan(1.5);
    // Đang rơi xuống nút (hoặc đang đáp đồng tâm): tâm vòng không thấp hơn tâm nút.
    expect(g.cy).toBeLessThanOrEqual(target!.cy + 1);
  }
  expect(result.texts.filter((t) => t.startsWith('CHẠM:') || /Ngẩng|Cúi|Nửa/.test(t))).toEqual([]);

  const closed = pip.waitForEvent('close');
  await pip.close();
  await closed;
  expect(errors).toEqual([]);
  expect(pipErrors).toEqual([]);
});

test('cửa sổ nổi đang mở bài khác → "Chuyển sang bài này" ở màn chơi của bài kia', async ({
  page,
  context,
}) => {
  const errors = collectErrors(page);
  await page.goto('/#/play/seed-takediskrush');
  const bar = page.getByRole('complementary', { name: 'Công cụ màn chơi' });
  const pending = context.waitForEvent('page');
  await bar.getByRole('button', { name: 'Cửa sổ nổi', exact: true }).click();
  const pip = await pending;
  await expect(pip.locator('canvas.pip-canvas')).toHaveAttribute('aria-label', /TAKEDISKRUSH!/);
  await page.goto(`/#/play/${SEED}`);
  await bar.getByRole('button', { name: 'Chuyển sang bài này' }).click();
  await expect(pip.locator('canvas.pip-canvas')).toHaveAttribute('aria-label', /Quốc ca Việt Nam/);
  const closed = pip.waitForEvent('close');
  await bar.getByRole('button', { name: 'Cửa sổ nổi', exact: true }).click();
  await closed;
  expect(errors).toEqual([]);
});

test('trình duyệt không có Document PiP: nút vẫn bấm được, hiện một dòng giải thích', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    delete (window as Window & { documentPictureInPicture?: unknown }).documentPictureInPicture;
  });
  const errors = collectErrors(page);
  await page.goto(`/#/play/${SEED}`);
  await page
    .getByRole('complementary', { name: 'Công cụ màn chơi' })
    .getByRole('button', { name: 'Cửa sổ nổi', exact: true })
    .click();
  await expect(
    page.getByText('Trình duyệt này chưa hỗ trợ cửa sổ nổi — dùng Chrome hoặc Edge trên máy tính.'),
  ).toBeVisible();
  expect(context.pages()).toHaveLength(1);
  expect(errors).toEqual([]);
});
