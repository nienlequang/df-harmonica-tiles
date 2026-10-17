import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { collectErrors, stubClipboard } from './helpers';

/**
 * Trang mini cho cửa sổ nổi Android (Phase 4m (c), thử nghiệm): khung 360×360 kiểu điện thoại (chạm),
 * ▶ → đếm ngược → ô rơi tự chạy, chạm = tạm dừng, bảng ⓘ theo hãng; cửa sổ video nổi: không hỗ trợ PiP →
 * một dòng giải thích; có WebCodecs → dựng sẵn ra Blob WebM khác rỗng cho một đoạn ngắn của bài mẫu. R6
 * (iPhone): video được chuẩn bị khi hộp thoại hiện (`data-ready` của nút mở), cú chạm chỉ còn xin PiP.
 */

const SEED = 'seed-quoc-ca-viet-nam';

test.use({ viewport: { width: 360, height: 360 }, hasTouch: true, isMobile: true });

test.beforeEach(async ({ context }) => {
  await stubClipboard(context);
});

/**
 * Kiểu điều khiển Mobile (bàn nút giống màn chơi kèn) + tiếng Việt, đặt trước khi app chạy. Trang mini ở bố
 * cục "Thu nhỏ" (bàn nút riêng — trang mini cũ); "Khớp nút game" (mặc định) có test riêng ở cuối file.
 */
async function mobileScheme(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('mini-e2e-init')) return;
    sessionStorage.setItem('mini-e2e-init', '1');
    localStorage.setItem(
      'dfht-settings',
      JSON.stringify({ state: { controlScheme: 'mobile', language: 'vi' }, version: 3 }),
    );
    localStorage.setItem('dfht-mini-layout', 'compact');
  });
}

async function miniCanvasSignature(page: Page): Promise<number> {
  return page.locator('canvas.mini-canvas').evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width === 0 || canvas.height === 0) return 0;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i += 4 * 13) {
      h ^= (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  });
}

test('360×360: ▶ → đếm ngược → ô rơi, chạm tạm dừng, ⓘ mở hướng dẫn theo hãng', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await mobileScheme(page);
  await page.goto(`/#/mini/${SEED}?delay=3`);
  const mini = page.locator('.mini');
  await expect(mini).toHaveAttribute('data-phase', 'ready');
  await expect(mini).toHaveAttribute('data-scheme', 'mobile');
  await expect(page.locator('canvas.mini-canvas')).toBeVisible();
  await expect(page.getByText('Thử nghiệm', { exact: true })).toBeVisible();
  // Không nav / chrome của app; không cuộn ngang; bàn nút nằm gọn trong khung.
  await expect(page.locator('nav')).toHaveCount(0);
  const layout = await page.evaluate(() => {
    const pad = document.querySelector('.mini-mpad')!.getBoundingClientRect();
    const canvas = document.querySelector('canvas.mini-canvas')!.getBoundingClientRect();
    return {
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
      padBottom: pad.bottom,
      padH: pad.height,
      canvasH: canvas.height,
      digits: document.querySelectorAll('.mini-mpad .gbm-key').length,
      modes: document.querySelectorAll('.mini-mpad .gbm-mode').length,
    };
  });
  expect(layout.scrollW).toBeLessThanOrEqual(360);
  expect(layout.scrollH).toBeLessThanOrEqual(360);
  expect(layout.padBottom).toBeLessThanOrEqual(360.5);
  expect(layout.canvasH).toBeGreaterThan(layout.padH);
  expect(layout).toMatchObject({ digits: 8, modes: 4 });

  await page.getByRole('button', { name: /Bắt đầu/ }).tap();
  await expect(mini).toHaveAttribute('data-phase', 'countdown');
  await expect(page.locator('.mini-countdown-num')).toHaveText('3');
  await expect(mini).toHaveAttribute('data-phase', 'playing', { timeout: 6000 });
  await expect(page.locator('.mini-panel')).toHaveCount(0);
  // Ô rơi: hai khung hình cách nhau khác nhau.
  const a = await miniCanvasSignature(page);
  await page.waitForTimeout(700);
  const b = await miniCanvasSignature(page);
  expect(a).not.toBe(b);

  // Chạm bất kỳ đâu = tạm dừng.
  await page.touchscreen.tap(180, 120);
  await expect(mini).toHaveAttribute('data-phase', 'paused');
  await expect(page.getByText('Tạm dừng', { exact: true })).toBeVisible();
  // Dừng giữa lúc đếm vào → ô trượt mượt về điểm bắt đầu (~0,36 s, D-389) rồi đứng yên.
  await page.waitForTimeout(600);
  const c = await miniCanvasSignature(page);
  await page.waitForTimeout(400);
  expect(await miniCanvasSignature(page)).toBe(c);

  await page.getByRole('button', { name: 'Hướng dẫn mở cửa sổ nổi' }).tap();
  const dialog = page.getByRole('dialog', { name: 'Mở trang này trong cửa sổ nổi' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Samsung', exact: true })).toBeVisible();
  await expect(dialog.getByText(/Good Lock → MultiStar → bật Multi Focus/)).toBeVisible();
  await expect(dialog.getByText(/Tắt con quay hồi chuyển/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('nút "◂" (chỉ khi đang dừng) về màn chơi của bài; khi ô rơi không có gì thêm', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await mobileScheme(page);
  await page.goto(`/#/mini/${SEED}?delay=0`);
  const mini = page.locator('.mini');
  await expect(mini).toHaveAttribute('data-phase', 'ready');
  const back = page.getByRole('link', { name: 'Về màn chơi' });
  await expect(back).toBeVisible();
  await expect(back).toHaveAttribute('href', `#/play/${SEED}`);
  // Nằm gọn trong khung 360×360 (góc trên trái).
  const box = await back.boundingBox();
  expect(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 360).toBe(true);
  // Đang chạy: không có nút.
  await page.getByRole('button', { name: /Bắt đầu/ }).tap();
  await expect(mini).toHaveAttribute('data-phase', 'playing');
  await expect(back).toHaveCount(0);
  // Tạm dừng: hiện lại → chạm = màn chơi chính của bài.
  await page.touchscreen.tap(180, 120);
  await expect(mini).toHaveAttribute('data-phase', 'paused');
  await back.tap();
  await expect(page).toHaveURL(new RegExp(`#/play/${SEED}$`));
  await expect(page.locator('.mini')).toHaveCount(0);
  await expect(page.locator('button.transport-play')).toBeVisible();
  expect(errors).toEqual([]);
});

test('không có Picture-in-Picture → hộp thoại video nổi chỉ hiện một dòng giải thích', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>)
      .requestPictureInPicture;
  });
  await page.goto(`/#/mini/${SEED}`);
  await page.getByRole('button', { name: 'Cửa sổ video nổi (thử nghiệm)' }).tap();
  const dialog = page.getByRole('dialog', { name: 'Cửa sổ video nổi (thử nghiệm)' });
  await expect(dialog.getByText(/không hỗ trợ cửa sổ video nổi/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Mở video trực tiếp' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Dựng video' })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('dựng sẵn (WebCodecs): một đoạn ngắn → Blob WebM khác rỗng; mở PiP, rời trang → đóng + thu hồi URL', async ({
  page,
}) => {
  const errors = collectErrors(page);
  // Ghi lại blob URL được tạo / thu hồi (phiên PiP dựng sẵn phải thu hồi khi rời trang).
  await page.addInitScript(() => {
    const w = window as unknown as { __blobs: { made: string[]; revoked: string[] } };
    w.__blobs = { made: [], revoked: [] };
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      const url = create(obj);
      w.__blobs.made.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      w.__blobs.revoked.push(url);
      revoke(url);
    };
  });
  // Bài ngắn (6 beat, có luyến giữ chuột phải), nằm sẵn trong thư viện (localStorage) trước khi app chạy.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('mini-e2e-lib')) return;
    sessionStorage.setItem('mini-e2e-lib', '1');
    const source = [
      '@title Đoạn ngắn',
      '@bpm 152',
      'N*.5 ,*.5 M*.5 N*.5 [giữ chuột phải] X-C [thả chuột phải] , M*2',
      '',
    ].join('\n');
    const now = Date.now();
    localStorage.setItem(
      'dfht-library',
      JSON.stringify({
        state: { songs: [{ id: 'mini-e2e', source, createdAt: now, updatedAt: now }] },
        version: 1,
      }),
    );
  });
  await page.goto('/#/mini/mini-e2e');
  await expect(page.locator('canvas.mini-canvas')).toBeVisible();
  const hasEncoder = await page.evaluate(() => typeof VideoEncoder === 'function');
  test.skip(!hasEncoder, 'Trình duyệt test không có WebCodecs VideoEncoder');
  await page.getByRole('button', { name: 'Cửa sổ video nổi (thử nghiệm)' }).tap();
  const dialog = page.getByRole('dialog', { name: 'Cửa sổ video nổi (thử nghiệm)' });
  await dialog.getByRole('button', { name: 'Dựng video' }).tap();
  const built = dialog.locator('.mini-video-built');
  await expect(built).toBeVisible({ timeout: 60_000 });
  const bytes = Number(await built.getAttribute('data-bytes'));
  expect(bytes).toBeGreaterThan(1000);
  await expect(built).toHaveAttribute('data-codec', /^V_VP[89]$/);
  const openBuilt = dialog.getByRole('button', { name: 'Mở video dựng sẵn' });
  await expect(openBuilt).toBeVisible();
  // Dựng xong → video dựng sẵn được nạp sẵn (trước cú chạm).
  await expect(openBuilt).toHaveAttribute('data-ready', 'true');

  const hasPip = await page.evaluate(
    () => typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function',
  );
  if (hasPip) {
    await openBuilt.tap();
    await expect(dialog.getByText('Đang mở cửa sổ video')).toBeVisible();
    const src = await page.evaluate(
      () =>
        (document.pictureInPictureElement as HTMLVideoElement | null)?.getAttribute('src') ?? '',
    );
    expect(src).toMatch(/^blob:/);
    // Rời trang mini (đổi route trong app) → đóng PiP, thu hồi blob URL, không còn <video>.
    await page.evaluate(() => {
      location.hash = '#/library';
    });
    await expect(page.locator('.mini')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.pictureInPictureElement)).toBeNull();
    const blobs = await page.evaluate(
      () => (window as unknown as { __blobs: { made: string[]; revoked: string[] } }).__blobs,
    );
    expect(blobs.made).toContain(src);
    expect(blobs.revoked).toContain(src);
    await expect(page.locator('video')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('màn chơi (kiểu Mobile) → Cửa sổ nổi → hỏi Apple / Android → Android → trang mini của bài đang mở', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await mobileScheme(page);
  await page.goto(`/#/play/${SEED}`);
  // Thanh công cụ của màn chơi (điện thoại: một hàng icon); kiểu Mobile → hỏi loại điện thoại (R7-6) lần đầu.
  await page
    .getByRole('complementary', { name: 'Công cụ màn chơi' })
    .getByRole('button', { name: 'Cửa sổ nổi' })
    .tap();
  const chooser = page.getByRole('dialog', { name: 'Cửa sổ nổi trên điện thoại' });
  await expect(
    chooser.getByText('Điện thoại của bạn: Apple (iPhone / iPad) hay Android?'),
  ).toBeVisible();
  await chooser.getByRole('button', { name: 'Android' }).tap();
  await expect(chooser).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('dfht-phone-kind'))).toBe('android');
  const dialog = page.getByRole('dialog', { name: 'Cửa sổ mini / video nổi (thử nghiệm)' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/làm treo game \(vivo\)/)).toBeVisible();
  // Bài cố định = bài đang mở (không ô chọn bài).
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  const open = dialog.getByRole('link', { name: 'Mở trang mini' });
  await expect(open).toHaveAttribute('href', `#/mini/${SEED}`);
  await open.tap();
  await expect(page).toHaveURL(new RegExp(`#/mini/${SEED}$`));
  await expect(page.locator('.mini')).toHaveAttribute('data-phase', 'ready');
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test.describe('khung 300×300, kiểu điều khiển PC', () => {
  test.use({ viewport: { width: 300, height: 300 } });

  test('8 keycap thẳng tâm 8 làn ngay lần mở đầu (gutter theo tileScale 0.6)', async ({ page }) => {
    const errors = collectErrors(page);
    await page.addInitScript(() => {
      if (sessionStorage.getItem('mini-e2e-pc')) return;
      sessionStorage.setItem('mini-e2e-pc', '1');
      localStorage.setItem(
        'dfht-settings',
        JSON.stringify({ state: { controlScheme: 'pc', language: 'vi' }, version: 3 }),
      );
      // Bố cục "Thu nhỏ" (game bar riêng).
      localStorage.setItem('dfht-mini-layout', 'compact');
    });
    await page.goto(`/#/mini/${SEED}`);
    await expect(page.locator('.mini')).toHaveAttribute('data-scheme', 'pc');
    await expect(page.locator('.mini')).toHaveAttribute('data-phase', 'ready');
    const caps = page.locator('.mini-pad kbd.gb-cap');
    await expect(caps).toHaveCount(8);
    const measure = () =>
      page.evaluate(() => {
        const canvas = document.querySelector('canvas.mini-canvas')!.getBoundingClientRect();
        const centers = [...document.querySelectorAll('.mini-pad kbd.gb-cap')].map((el) => {
          const r = el.getBoundingClientRect();
          return r.left + r.width / 2;
        });
        const right = getComputedStyle(document.querySelector('.mini-pad')!).getPropertyValue(
          '--lane-right',
        );
        return { left: canvas.left, width: canvas.width, centers, right: right.trim() };
      });
    // Đợi trang ổn định (useLaneScale → tileScale 0.6 sau lần đo đầu).
    await expect.poll(async () => (await measure()).right).toBe('34px');
    const first = await measure();
    // Làn 'none' phủ từ mép trái tới gutter ribbon = round(56 × 0.6) = 34 px (miniTileScale(300) = 0.6).
    const laneW = (first.width - 34) / 8;
    first.centers.forEach((c, i) => {
      expect(Math.abs(c - (first.left + (i + 0.5) * laneW))).toBeLessThan(2);
    });
    // Đổi khung qua lại (engine đo lại lane): keycap không xê dịch → lần đầu đã đúng.
    await page.setViewportSize({ width: 301, height: 300 });
    await page.setViewportSize({ width: 300, height: 300 });
    await expect.poll(async () => (await measure()).right).toBe('34px');
    const again = await measure();
    again.centers.forEach((c, i) => expect(Math.abs(c - first.centers[i])).toBeLessThan(0.75));
    expect(errors).toEqual([]);
  });
});

test('video trực tiếp: mở PiP (video câm, không track tiếng), đóng → gỡ sạch video + canvas nguồn', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await mobileScheme(page);
  // iPhone (R6): requestPictureInPicture phải được gọi ĐỒNG BỘ trong cú chạm — ghi lại sự kiện đang
  // được xử lý lúc gọi (`window.event`: có trong handler đồng bộ, mất sau một `await`).
  await page.addInitScript(() => {
    const proto = HTMLVideoElement.prototype;
    const original = proto.requestPictureInPicture;
    if (typeof original !== 'function') return;
    const calls: (string | null)[] = [];
    (window as unknown as { __pipCalls: (string | null)[] }).__pipCalls = calls;
    proto.requestPictureInPicture = function (this: HTMLVideoElement) {
      const ev = (window as unknown as { event?: Event }).event;
      calls.push(ev && ev.isTrusted ? ev.type : null);
      return original.call(this);
    };
  });
  await page.goto(`/#/mini/${SEED}`);
  await expect(page.locator('.mini')).toHaveAttribute('data-phase', 'ready');
  const supported = await page.evaluate(
    () =>
      typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function' &&
      document.pictureInPictureEnabled !== false,
  );
  test.skip(!supported, 'Trình duyệt test không có Picture-in-Picture');
  await page.getByRole('button', { name: 'Cửa sổ video nổi (thử nghiệm)' }).tap();
  const dialog = page.getByRole('dialog', { name: 'Cửa sổ video nổi (thử nghiệm)' });
  // Hộp thoại hiện = video trực tiếp đã chuẩn bị (câm, đang phát, chưa PiP) — cú chạm chỉ còn xin PiP.
  const openLive = dialog.getByRole('button', { name: 'Mở video trực tiếp' });
  await expect(openLive).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.mini-video-host video')).toHaveCount(1);
  expect(await page.evaluate(() => document.pictureInPictureElement)).toBeNull();
  await openLive.tap();
  await expect(dialog.getByText('Đang mở cửa sổ video')).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  // Gọi một lần, ngay trong sự kiện click của cú chạm (không sau await nào).
  expect(
    await page.evaluate(() => (window as unknown as { __pipCalls: unknown[] }).__pipCalls),
  ).toEqual(['click']);
  const pip = await page.evaluate(() => {
    const v = document.pictureInPictureElement as HTMLVideoElement | null;
    const stream = v?.srcObject as MediaStream | null;
    return {
      cls: v?.className ?? null,
      muted: v?.muted ?? null,
      audio: stream ? stream.getAudioTracks().length : -1,
      video: stream ? stream.getVideoTracks().length : -1,
    };
  });
  expect(pip).toEqual({ cls: 'guide-video', muted: true, audio: 0, video: 1 });
  await dialog.getByRole('button', { name: 'Đóng cửa sổ video' }).tap();
  await expect.poll(() => page.evaluate(() => document.pictureInPictureElement)).toBeNull();
  // Hộp thoại còn mở → đã có video chuẩn bị cho lần mở sau; đóng hộp thoại → gỡ sạch.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('video')).toHaveCount(0);
  await expect(page.locator('.guide-video-source')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('màn chơi (kiểu Mobile) → Cửa sổ nổi → Apple: dựng sẵn ngay, "Mở video nổi" xin PiP trong cú chạm; đóng hộp thoại không đóng PiP', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await mobileScheme(page);
  // Như trên: requestPictureInPicture phải được gọi ĐỒNG BỘ trong cú chạm (`window.event` của click).
  await page.addInitScript(() => {
    const proto = HTMLVideoElement.prototype;
    const original = proto.requestPictureInPicture;
    if (typeof original !== 'function') return;
    const calls: (string | null)[] = [];
    (window as unknown as { __pipCalls: (string | null)[] }).__pipCalls = calls;
    proto.requestPictureInPicture = function (this: HTMLVideoElement) {
      const ev = (window as unknown as { event?: Event }).event;
      calls.push(ev && ev.isTrusted ? ev.type : null);
      return original.call(this);
    };
  });
  // Thanh tiến độ dựng sẵn (<progress> của hộp thoại Apple) có hiện ra không — dựng bài ngắn có thể rất nhanh.
  await page.addInitScript(() => {
    const w = window as unknown as { __sawProgress: boolean };
    w.__sawProgress = false;
    new MutationObserver(() => {
      if (!w.__sawProgress && document.querySelector('.mini-apple-progress progress')) {
        w.__sawProgress = true;
      }
    }).observe(document, { subtree: true, childList: true });
  });
  // Bài ngắn trong thư viện (dựng nhanh).
  await page.addInitScript(() => {
    if (sessionStorage.getItem('mini-e2e-apple-lib')) return;
    sessionStorage.setItem('mini-e2e-apple-lib', '1');
    const source = ['@title Đoạn ngắn', '@bpm 152', 'N*.5 ,*.5 M*.5 N*.5 X-C , M*2', ''].join('\n');
    const now = Date.now();
    localStorage.setItem(
      'dfht-library',
      JSON.stringify({
        state: { songs: [{ id: 'mini-e2e', source, createdAt: now, updatedAt: now }] },
        version: 1,
      }),
    );
  });
  await page.goto('/#/play/mini-e2e');
  const hasEncoder = await page.evaluate(() => typeof VideoEncoder === 'function');
  test.skip(!hasEncoder, 'Trình duyệt test không có WebCodecs VideoEncoder');
  const floatButton = page
    .getByRole('complementary', { name: 'Công cụ màn chơi' })
    .getByRole('button', { name: 'Cửa sổ nổi' });
  await floatButton.tap();
  await page
    .getByRole('dialog', { name: 'Cửa sổ nổi trên điện thoại' })
    .getByRole('button', { name: 'Apple — iPhone / iPad' })
    .tap();
  const dialog = page.getByRole('dialog', { name: 'Cửa sổ video nổi (thử nghiệm)' });
  // Dựng ngay (không có nút "Dựng video" để bấm), không có "Trực tiếp".
  const open = dialog.getByRole('button', { name: 'Mở video nổi' });
  await expect(open).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Mở video trực tiếp' })).toHaveCount(0);
  await expect(dialog.locator('.mini-video-built')).toBeVisible({ timeout: 60_000 });
  // Đã hiện tiến độ dựng (Đang dựng video… %) trước khi xong; xong thì thanh tiến độ biến mất.
  expect(
    await page.evaluate(() => (window as unknown as { __sawProgress: boolean }).__sawProgress),
  ).toBe(true);
  await expect(dialog.locator('.mini-apple-progress')).toHaveCount(0);
  await expect(open).toBeEnabled();
  await expect(open).toHaveAttribute('data-ready', 'true');
  const hasPip = await page.evaluate(
    () =>
      typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function' &&
      document.pictureInPictureEnabled !== false,
  );
  if (hasPip) {
    await open.tap();
    await expect(dialog.getByText(/Video nổi đang mở/)).toBeVisible();
    expect(
      await page.evaluate(() => (window as unknown as { __pipCalls: unknown[] }).__pipCalls),
    ).toEqual(['click']);
    // Đóng hộp thoại: khung PiP vẫn mở; mở lại → thẳng video nổi (đã nhớ Apple), vẫn báo đang mở.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => document.pictureInPictureElement !== null)).toBe(true);
    await floatButton.tap();
    await expect(dialog.getByText(/Video nổi đang mở/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Đóng cửa sổ video' }).tap();
    await expect.poll(() => page.evaluate(() => document.pictureInPictureElement)).toBeNull();
  } else {
    await page.keyboard.press('Escape');
    await floatButton.tap();
  }
  // "Đổi loại điện thoại" → hỏi lại.
  await dialog.getByRole('button', { name: 'Đổi loại điện thoại' }).tap();
  await expect(page.getByRole('dialog', { name: 'Cửa sổ nổi trên điện thoại' })).toBeVisible();
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Bố cục "Khớp nút game" + Căn chỉnh (góp ý 2026-10-16): cửa sổ nổi đặt ngay trên bảng nút kèn thật
// ---------------------------------------------------------------------------

/**
 * Tâm 8 nút số / 4 nút chế độ của game theo phần bề ngang cửa sổ khi cửa sổ = 8 làn căn giữa hàng nút (v1.0.1 — ô
 * ngoài cùng không sát mép; ảnh chụp màn hình game của chủ dự án 2026-10-16: nút số 247,5 … 1123 → bước 125,07,
 * cửa sổ 185 → 1185,6 px; nút chế độ 491 / 645,5 / 760 / 876 — docs/GAME-UI-REFERENCE.md).
 */
const GAME_STEP = (1123 - 247.5) / 7;
const GAME_WIN_LEFT = (247.5 + 1123) / 2 - 4 * GAME_STEP;
const GAME_NOTES = [247.5, 372, 497, 622, 747.5, 872.5, 998, 1123].map(
  (x) => (x - GAME_WIN_LEFT) / (8 * GAME_STEP),
);
const GAME_MODES = [491, 645.5, 760, 876].map((x) => (x - GAME_WIN_LEFT) / (8 * GAME_STEP));

/** Cài đặt (+ bố cục nếu có) đặt trước khi app chạy, một lần mỗi tab. */
async function fitScheme(
  page: Page,
  scheme: 'mobile' | 'pc' = 'mobile',
  language: 'vi' | 'en' = 'vi',
  layout: 'game' | 'compact' | null = null,
): Promise<void> {
  await page.addInitScript(
    ([sc, lang, lay]) => {
      if (sessionStorage.getItem('mini-e2e-fit')) return;
      sessionStorage.setItem('mini-e2e-fit', '1');
      localStorage.setItem(
        'dfht-settings',
        JSON.stringify({ state: { controlScheme: sc, language: lang }, version: 5 }),
      );
      if (lay) localStorage.setItem('dfht-mini-layout', lay);
    },
    [scheme, language, layout] as const,
  );
}

/** Tâm ngang (px trang) của các phần tử khớp `selector`. */
function centersOf(page: Page, selector: string): Promise<number[]> {
  return page.evaluate(
    (sel) =>
      [...document.querySelectorAll(sel)].map((el) => {
        const r = el.getBoundingClientRect();
        return r.left + r.width / 2;
      }),
    selector,
  );
}

for (const [w, h] of [
  [960, 300],
  [720, 240],
] as const) {
  test.describe(`Khớp nút game ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('mặc định: không bàn nút riêng, hit line sát mép dưới; Căn chỉnh: vạch / vòng đúng tâm nút thật của game', async ({
      page,
    }) => {
      const errors = collectErrors(page);
      await fitScheme(page);
      await page.goto(`/#/mini/${SEED}`);
      const mini = page.locator('.mini');
      await expect(mini).toHaveAttribute('data-layout', 'game');
      await expect(mini).toHaveAttribute('data-phase', 'ready');
      await expect(page.locator('.mini-mpad, .game-bar')).toHaveCount(0);
      // Làn chiếm cả cửa sổ (không bàn nút / game bar), không cuộn.
      const box = await page.locator('canvas.mini-canvas').boundingBox();
      expect(box).toMatchObject({ x: 0, y: 0, width: w, height: h });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        w,
      );
      await expect(page.getByRole('button', { name: 'Khớp nút game' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      // 4 vòng đích mờ của renderer sát trên mép dưới, ở cột 4 nút chế độ thật: nét có màu ở đỉnh vòng.
      const ring = await page.locator('canvas.mini-canvas').evaluate((el, xs) => {
        const c = el as HTMLCanvasElement;
        const ctx = c.getContext('2d')!;
        const k = c.width / c.clientWidth;
        const step = c.clientWidth / 8; // mặc định: cửa sổ = 8 làn
        const d = Math.min(step * 0.6, c.clientHeight * 0.42);
        const top = c.clientHeight - 2 - 1 - d;
        const px = (x: number, y: number) => [
          ...ctx.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data,
        ];
        return xs.map((f) => {
          const x = f * c.clientWidth;
          const on = px(x, top + 0.75);
          const off = px(x, top - 6);
          return Math.abs(on[0] - off[0]) + Math.abs(on[1] - off[1]) + Math.abs(on[2] - off[2]);
        });
      }, GAME_MODES);
      for (const diff of ring) expect(diff).toBeGreaterThan(30);

      await page.getByRole('button', { name: 'Căn chỉnh' }).click();
      await expect(mini).toHaveAttribute('data-aligning', 'true');
      const panel = page.getByRole('group', { name: 'Căn chỉnh với nút game' });
      await expect(panel).toBeVisible();
      // Chỉnh một số mỗi lúc (D-399): 4 nút chọn, một thanh trượt của số đang chọn; focus vào nút chọn đầu.
      const picks = page.getByRole('group', { name: 'Chọn số cần chỉnh' }).getByRole('button');
      await expect(picks).toHaveText(['Vạch Nút 1', 'Vạch Nút 1̇', 'Vòng Dời', 'Vòng Giãn']);
      await expect(picks.first()).toBeFocused();
      await expect(panel.getByRole('slider')).toHaveCount(1);
      await expect(page.getByRole('slider', { name: 'Vạch nút 1 (trái)' })).toBeVisible();
      const lanes = await centersOf(page, '.mini-guide');
      expect(lanes).toHaveLength(8);
      lanes.forEach((x, i) => expect(Math.abs(x - GAME_NOTES[i] * w)).toBeLessThan(1.5));
      const modes = await centersOf(page, '.mini-guide-mode');
      modes.forEach((x, j) => expect(Math.abs(x - GAME_MODES[j] * w)).toBeLessThan(1.5));
      // Vòng nút chế độ sát trên mép dưới; bảng Căn chỉnh không che hàng vòng; mọi nút nằm trong cửa sổ.
      const modeBox = await page.locator('.mini-guide-mode').first().boundingBox();
      expect(Math.abs(modeBox!.y + modeBox!.height - (h - 3))).toBeLessThan(1);
      const panelBox = await panel.boundingBox();
      expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(modeBox!.y);
      for (const b of await panel.getByRole('button').all()) {
        const r = await b.boundingBox();
        expect(r!.x >= 0 && r!.x + r!.width <= w && r!.y + r!.height <= h).toBe(true);
      }
      // Chạm nhầm khi đang căn chỉnh không chạy bài.
      await page.mouse.click(w / 2, h - 20);
      await expect(mini).toHaveAttribute('data-phase', 'ready');
      expect(errors).toEqual([]);
    });
  });
}

test.describe('Căn chỉnh: chỉnh + lưu + Đặt lại mặc định; Thu nhỏ nhớ theo máy', () => {
  test.use({ viewport: { width: 960, height: 300 } });

  test('nút + của "Nút 1" dời vạch 1; tải lại vẫn giữ; Đặt lại mặc định; Thu nhỏ → bàn nút, tải lại vẫn Thu nhỏ', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await fitScheme(page);
    await page.goto(`/#/mini/${SEED}`);
    await page.getByRole('button', { name: 'Căn chỉnh' }).click();
    const before = await centersOf(page, '.mini-guide');
    const plus = page.getByRole('button', { name: 'Tăng: Vạch nút 1 (trái)' });
    for (let i = 0; i < 10; i++) await plus.click();
    await expect(page.locator('[data-field="first"] output')).toHaveText('7,2 %');
    const after = await centersOf(page, '.mini-guide');
    // Mỗi chạm ~1 px (D-400; 960 px → bước lưu 0,001 = 0,96 px); nút 1̇ đứng yên; giữa nội suy đều.
    expect(after[0] - before[0]).toBeCloseTo(9.6, 0);
    expect(after[7]).toBeCloseTo(before[7], 1);
    expect(after[1] - after[0]).toBeCloseTo((after[7] - after[0]) / 7, 1);
    // Giữ nút + : lặp, nhanh dần (≥ 6 lần 1 px rồi 5 px mỗi lần) — nhả thì dừng.
    const plusBox = (await plus.boundingBox())!;
    await page.mouse.move(plusBox.x + plusBox.width / 2, plusBox.y + plusBox.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1500);
    await page.mouse.up();
    const held = await centersOf(page, '.mini-guide');
    expect(held[0] - after[0]).toBeGreaterThan(15);
    await page.waitForTimeout(400);
    expect((await centersOf(page, '.mini-guide'))[0]).toBeCloseTo(held[0], 1);
    // Hàng chế độ: chọn "Dời" rồi dời bằng bàn phím (thanh trượt nhận phím mũi tên).
    await page
      .getByRole('group', { name: 'Chọn số cần chỉnh' })
      .getByRole('button', { name: 'Dời' })
      .click();
    const shift = page.getByRole('slider', { name: 'Vòng nút chế độ: dời ngang' });
    const modes0 = await centersOf(page, '.mini-guide-mode');
    await shift.focus();
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
    const modes1 = await centersOf(page, '.mini-guide-mode');
    // Bước cột hiện tại = sau lần giữ nút (số lần lặp tùy tốc độ máy) — không phải `after`.
    const stepPx = (held[7] - held[0]) / 7;
    modes1.forEach((x, j) => expect(x - modes0[j]).toBeCloseTo(0.1 * stepPx, 0));
    // Esc trên thanh trượt = Xong (focus về nút Căn chỉnh).
    await page.keyboard.press('Escape');
    await expect(page.locator('.mini')).not.toHaveAttribute('data-aligning', 'true');
    await expect(page.getByRole('button', { name: 'Căn chỉnh' })).toBeFocused();

    await page.reload();
    await page.getByRole('button', { name: 'Căn chỉnh' }).click();
    const reloaded = await centersOf(page, '.mini-guide');
    reloaded.forEach((x, i) => expect(x).toBeCloseTo(held[i], 1));
    await page.getByRole('button', { name: 'Đặt lại mặc định' }).click();
    const reset = await centersOf(page, '.mini-guide');
    reset.forEach((x, i) => expect(x).toBeCloseTo(before[i], 1));
    expect(await page.evaluate(() => localStorage.getItem('dfht-mini-calibration'))).toBeNull();
    await page.getByRole('button', { name: 'Xong' }).click();

    // "Thu nhỏ": trang mini cũ có bàn nút riêng; nhớ khi tải lại.
    await page.getByRole('button', { name: 'Thu nhỏ' }).click();
    await expect(page.locator('.mini')).toHaveAttribute('data-layout', 'compact');
    await expect(page.locator('.mini-mpad .gbm-key')).toHaveCount(8);
    await expect(page.getByRole('button', { name: 'Căn chỉnh' })).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.mini')).toHaveAttribute('data-layout', 'compact');
    await expect(page.locator('.mini-mpad')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('đang chạy: không panel / Căn chỉnh / "◂"; đếm ngược tối thiểu 3 s; ô rơi', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await fitScheme(page);
    // Cài đặt mặc định (đếm ngược 3 s; `?delay=` của link sẽ đè).
    await page.goto(`/#/mini/${SEED}`);
    const mini = page.locator('.mini');
    await page.getByRole('button', { name: /Bắt đầu/ }).click();
    await expect(page.locator('.mini-countdown-num')).toHaveText('3');
    await expect(page.getByRole('button', { name: 'Căn chỉnh' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Về màn chơi' })).toHaveCount(0);
    await expect(mini).toHaveAttribute('data-phase', 'playing', { timeout: 6000 });
    const a = await miniCanvasSignature(page);
    await page.waitForTimeout(600);
    expect(await miniCanvasSignature(page)).not.toBe(a);
    await expect(page.locator('.mini-guides')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cửa sổ nổi THẬT đặt ngay trên bảng nút kèn (D-399, D-401): bảng nút của game bắt đầu ở 0,33 H và rộng 0,70 W
// → màn ngang 780×360 (Galaxy S) / 915×412 (Pixel) chỉ để lại cửa sổ ~546–640 × 80–130 px. Ở các cỡ đó: mọi
// control nằm trọn trong cửa sổ, không chồng nhau, không bị phần tử khác che; bảng Căn chỉnh không che hàng vòng
// / mép dưới, nhãn số của vạch không nằm sau bảng; hộp thoại ⓘ còn đủ chỗ để đọc.
// ---------------------------------------------------------------------------

/** Control đang thấy của panel ▶ / bảng Căn chỉnh: ngoài cửa sổ, bị che (điểm giữa không trúng nó), chồng nhau. */
function controlIssues(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = innerWidth;
    const vh = innerHeight;
    const els = [
      ...document.querySelectorAll<HTMLElement>(
        '.mini-panel button, .mini-panel a, .mini-align button, .mini-align input, .mini-align output',
      ),
    ].filter((el) => {
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    });
    const name = (el: HTMLElement) =>
      (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30);
    const out: string[] = [];
    const boxes = els.map((el) => el.getBoundingClientRect());
    els.forEach((el, i) => {
      const b = boxes[i];
      if (b.left < -0.5 || b.top < -0.5 || b.right > vw + 0.5 || b.bottom > vh + 0.5)
        out.push(`${name(el)} ngoài cửa sổ [${Math.round(b.top)}..${Math.round(b.bottom)}]`);
      const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      if (t !== el && !el.contains(t)) out.push(`${name(el)} bị che bởi ${t?.className ?? '-'}`);
      for (let j = i + 1; j < els.length; j++) {
        const c = boxes[j];
        const ox = Math.min(b.right, c.right) - Math.max(b.left, c.left);
        const oy = Math.min(b.bottom, c.bottom) - Math.max(b.top, c.top);
        // −1 px giữa hai nút ghép (nhóm bật / tắt) là cố ý.
        if (ox > 1.5 && oy > 1.5) out.push(`${name(el)} chồng ${name(els[j])}`);
      }
    });
    return out;
  });
}

/** Đáy bảng Căn chỉnh so với đỉnh hàng vòng / mép dưới / nhãn số của vạch. */
function alignCover(page: Page) {
  return page.evaluate(() => {
    const tops = (sel: string) =>
      [...document.querySelectorAll(sel)]
        .map((el) => el.getBoundingClientRect())
        .filter((b) => b.width > 0)
        .map((b) => b.top);
    return {
      panel: document.querySelector('.mini-align')!.getBoundingClientRect().bottom,
      rings: tops('.mini-guide-mode'),
      edge: tops('.mini-guide-edge'),
      keys: tops('.mini-guide-key'),
    };
  });
}

const NAMES = {
  vi: {
    start: 'Bắt đầu',
    align: 'Căn chỉnh',
    picks: 'Chọn số cần chỉnh',
    help: 'Cách kéo / đổi cỡ cửa sổ nổi',
    notice: 'Bản mới: kéo rộng thêm ¼ nút mỗi bên',
  },
  en: {
    start: 'Start',
    align: 'Calibrate',
    picks: 'Choose what to adjust',
    help: 'How to move / resize the floating window',
    notice: 'New: widen ¼ button on each side',
  },
} as const;

for (const [w, h] of [
  [546, 90],
  [546, 119],
  [624, 100],
  [640, 80],
] as const) {
  for (const lang of ['vi', 'en'] as const) {
    test.describe(`cửa sổ thật ${w}×${h} ${lang}`, () => {
      test.use({ viewport: { width: w, height: h } });

      test('panel ▶ / tạm dừng / Căn chỉnh (mọi số): không control nào ra ngoài, chồng hay bị che; bảng không che vòng / mép dưới', async ({
        page,
      }) => {
        const errors = collectErrors(page);
        const n = NAMES[lang];
        await fitScheme(page, 'mobile', lang);
        await page.goto(`/#/mini/${SEED}?delay=0`);
        const mini = page.locator('.mini');
        await expect(mini).toHaveAttribute('data-layout', 'game');
        await expect(mini).toHaveAttribute('data-phase', 'ready');
        expect(await controlIssues(page)).toEqual([]);
        // Tạm dừng: thêm ↺ — vẫn không chồng / tràn.
        await page.getByRole('button', { name: n.start }).tap();
        await expect(mini).toHaveAttribute('data-phase', 'playing');
        await page.waitForTimeout(300);
        await page.locator('.mini-tap').tap();
        await expect(mini).toHaveAttribute('data-phase', 'paused');
        expect(await controlIssues(page)).toEqual([]);

        await page.getByRole('button', { name: n.align, exact: true }).tap();
        await expect(mini).toHaveAttribute('data-aligning', 'true');
        const picks = page.getByRole('group', { name: n.picks }).getByRole('button');
        await expect(picks).toHaveCount(4);
        for (let i = 0; i < 4; i++) {
          await picks.nth(i).tap();
          await expect(picks.nth(i)).toHaveAttribute('aria-pressed', 'true');
          expect(await controlIssues(page), `số ${i}`).toEqual([]);
          const c = await alignCover(page);
          expect(c.rings).toHaveLength(4);
          for (const r of c.rings) expect(r).toBeGreaterThanOrEqual(c.panel - 0.5);
          expect(c.edge[0]).toBeGreaterThan(c.panel);
          // Nhãn số: ẩn khi hết chỗ, còn hiện thì ở dưới bảng.
          for (const k of c.keys) expect(k).toBeGreaterThanOrEqual(c.panel - 0.5);
        }
        // − / + đủ to cho ngón tay ở cửa sổ thấp (≥ 34 × 30).
        const lb = (await page.locator('.mini-align-nudge').first().boundingBox())!;
        expect(lb.width).toBeGreaterThanOrEqual(33.5);
        expect(lb.height).toBeGreaterThanOrEqual(29.5);
        // ⓘ: hộp thoại phủ cả cửa sổ, phần thân cuộn được còn đủ cao để đọc.
        await page.getByRole('button', { name: n.help }).tap();
        const body = page.locator('.modal-body');
        await expect(body).toBeVisible();
        expect(await body.evaluate((el) => el.clientHeight)).toBeGreaterThan(h * 0.5);
        expect(errors).toEqual([]);
      });

      test('máy dùng trang mini trước v1.0.1 (D-441): nhắc "kéo rộng" ở hàng đầu không ra ngoài / chồng / bị che; chạm → hướng dẫn, hết nhắc', async ({
        page,
      }) => {
        const errors = collectErrors(page);
        const n = NAMES[lang];
        await fitScheme(page, 'mobile', lang);
        // Bản 1.0.0 ghi bài mở trang mini mỗi lần mở; số căn chỉnh mặc định không lưu.
        await page.addInitScript(() => {
          if (sessionStorage.getItem('mini-e2e-legacy')) return;
          sessionStorage.setItem('mini-e2e-legacy', '1');
          localStorage.setItem('dfht-mini-song', 'seed-quoc-ca-viet-nam');
        });
        await page.goto(`/#/mini/${SEED}?delay=0`);
        const mini = page.locator('.mini');
        await expect(mini).toHaveAttribute('data-layout', 'game');
        await expect(mini).toHaveAttribute('data-phase', 'ready');
        const notice = page.getByRole('button', { name: n.notice });
        await expect(notice).toBeVisible();
        expect(await controlIssues(page)).toEqual([]);
        await notice.tap();
        await expect(page.locator('.modal-body')).toBeVisible();
        await expect(notice).toHaveCount(0);
        expect(await page.evaluate(() => localStorage.getItem('dfht-mini-fit8'))).toBe('1');
        expect(errors).toEqual([]);
      });
    });
  }
}

test.describe('cửa sổ thật 546×90, kiểu PC (mặc định của Cài đặt)', () => {
  test.use({ viewport: { width: 546, height: 90 } });

  test('chưa chọn bố cục → "Thu nhỏ" + "Đổi sang Mobile" ở hàng đầu, không chồng; chạm → kiểu Mobile, khớp nút game', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await fitScheme(page, 'pc', 'vi');
    await page.goto(`/#/mini/${SEED}?delay=0`);
    const mini = page.locator('.mini');
    await expect(mini).toHaveAttribute('data-scheme', 'pc');
    await expect(mini).toHaveAttribute('data-layout', 'compact');
    await expect(page.locator('.game-bar')).toBeVisible();
    const toMobile = page.getByRole('button', { name: 'Đổi sang Mobile' });
    await expect(toMobile).toBeVisible();
    expect(await controlIssues(page)).toEqual([]);
    // Khớp nút game ở kiểu PC: vẫn có nút đổi kiểu, panel vẫn không chồng.
    await page.getByRole('button', { name: 'Khớp nút game' }).tap();
    await expect(mini).toHaveAttribute('data-layout', 'game');
    expect(await controlIssues(page)).toEqual([]);
    // Bỏ lựa chọn đã lưu → đổi sang Mobile thì bố cục theo kiểu mới (khớp nút game).
    await page.evaluate(() => localStorage.removeItem('dfht-mini-layout'));
    await toMobile.tap();
    await expect(mini).toHaveAttribute('data-scheme', 'mobile');
    await expect(mini).toHaveAttribute('data-layout', 'game');
    await expect(page.getByRole('button', { name: 'Đổi sang Mobile' })).toHaveCount(0);
    const saved = await page.evaluate(() => localStorage.getItem('dfht-settings') ?? '');
    expect(saved).toContain('"controlScheme":"mobile"');
    expect(await controlIssues(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});

// Cửa sổ thấp mà hẹp (góc màn hình, cả hai bố cục): các hàng của panel không chồng lên nhau.
for (const [w, h] of [
  [300, 150],
  [300, 200],
  [360, 200],
  [480, 100],
] as const) {
  test.describe(`panel ▶ ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    for (const layout of ['game', 'compact'] as const) {
      test(`${layout}: lúc dừng + tạm dừng — không control nào ra ngoài / chồng / bị che`, async ({
        page,
      }) => {
        const errors = collectErrors(page);
        await fitScheme(page, 'mobile', 'vi', layout);
        await page.goto(`/#/mini/${SEED}?delay=0`);
        const mini = page.locator('.mini');
        await expect(mini).toHaveAttribute('data-layout', layout);
        await expect(mini).toHaveAttribute('data-phase', 'ready');
        expect(await controlIssues(page)).toEqual([]);
        await page.getByRole('button', { name: 'Bắt đầu' }).tap();
        await expect(mini).toHaveAttribute('data-phase', 'playing');
        await page.waitForTimeout(300);
        await page.locator('.mini-tap').tap();
        await expect(mini).toHaveAttribute('data-phase', 'paused');
        expect(await controlIssues(page)).toEqual([]);
        expect(errors).toEqual([]);
      });
    }
  });
}

// ---------------------------------------------------------------------------
// ĐÚNG TỈ LỆ THẬT (D-405, D-412 … D-416): máy Android cảm ứng (UA Android + chạm) đọc cỡ màn hình (`screen` của
// Playwright = màn điện thoại ngang, viewport = cửa sổ nổi) → bước cột theo chiều cao màn (0,0912 × 1371 / 633 × cao —
// D-413) dù cửa sổ rộng / hẹp, hàng nút căn giữa cửa sổ; chỉ báo "Rộng" / "Cao" ở panel ▶ và bảng Căn chỉnh; chỉnh
// tinh "Vạch · Dời / Giãn", "Vòng · Dời / Giãn". Không có `screen` (= viewport) hoặc không phải Android → kiểu "cửa sổ
// = hàng nút".

/** UA Chrome Android (đúng tỉ lệ thật chỉ bật trên máy Android cảm ứng — D-412). */
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
/** Bước cột theo chiều cao màn (màn ≥ 19,5:9 — D-413). */
const stepOfScreen = (sh: number) => ((0.0912 * 1371) / 633) * sh;
/** Vị trí trên màn (px CSS) của một điểm x của ảnh game 1371 × 633: UI phóng theo chiều cao, căn giữa màn. */
const screenXOf = (sw: number, sh: number, refX: number) => sw / 2 + (refX - 1371 / 2) * (sh / 633);
// ---------------------------------------------------------------------------

/** Tâm 8 nút số / 4 nút chế độ trên ảnh game 1371 px (docs/GAME-UI-REFERENCE.md). */
const REF_NOTES = [247.5, 372, 497, 622, 747.5, 872.5, 998, 1123];
const REF_MODES = [491, 645.5, 760, 876];

/** Chỉ báo cỡ cửa sổ: trạng thái + nằm trọn trong cửa sổ, không chồng control nào của panel / bảng. */
function fitStatusInfo(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.mini-fit-status');
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        '.mini-panel button, .mini-panel a, .mini-align button, .mini-align input, .mini-align output',
      ),
    ].filter((c) => c.getBoundingClientRect().width > 0);
    const overlaps = controls
      .filter((c) => {
        const r = c.getBoundingClientRect();
        const ox = Math.min(b.right, r.right) - Math.max(b.left, r.left);
        const oy = Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top);
        return ox > 1 && oy > 1;
      })
      .map((c) => (c.getAttribute('aria-label') ?? c.textContent ?? '').trim().slice(0, 20));
    const chips = [...el.querySelectorAll<HTMLElement>('.mini-fit-chip')].map((c) =>
      [...c.children]
        .filter((s) => getComputedStyle(s).display !== 'none' && !s.classList.contains('sr-only'))
        .map((s) => s.textContent)
        .join(''),
    );
    return {
      width: el.dataset.width,
      height: el.dataset.height,
      chips,
      inside:
        b.left >= -0.5 &&
        b.top >= -0.5 &&
        b.right <= innerWidth + 0.5 &&
        b.bottom <= innerHeight + 0.5,
      overlaps,
      bottom: b.bottom,
    };
  });
}

for (const [sw, sh, w, h, ws, hs] of [
  [915, 412, 640, 105, 'ok', 'ok'],
  [780, 360, 569, 90, 'ok', 'ok'], // 8 làn ≈ 569 px (v1.0.1)
  [800, 360, 560, 180, 'ok', 'tall'],
  [915, 412, 720, 120, 'wide', 'ok'],
  [915, 412, 600, 80, 'narrow', 'short'],
] as const) {
  test.describe(`đúng tỉ lệ thật: màn ${sw}×${sh}, cửa sổ ${w}×${h}`, () => {
    test.use({
      viewport: { width: w, height: h },
      screen: { width: sw, height: sh },
      userAgent: ANDROID_UA,
    });

    test(`bước cột theo chiều cao màn, căn giữa; chỉ báo Rộng ${ws} / Cao ${hs}; panel + Căn chỉnh không chồng / không che vòng`, async ({
      page,
    }) => {
      const errors = collectErrors(page);
      await fitScheme(page);
      await page.goto(`/#/mini/${SEED}?delay=0`);
      const mini = page.locator('.mini');
      await expect(mini).toHaveAttribute('data-layout', 'game');
      await expect(mini).toHaveAttribute('data-scale', 'true');
      const st = await fitStatusInfo(page);
      expect(st).toMatchObject({ width: ws, height: hs, inside: true, overlaps: [] });
      // Panel ▶, cửa sổ < 760 px: chữ ngắn (giữ ý của chữ dài — D-416).
      expect(st!.chips[0]).toBe(
        { ok: 'Rộng: vừa', narrow: 'Hẹp quá — giãn thêm', wide: 'Rộng hơn cần' }[ws],
      );
      expect(st!.chips[1]).toBe(
        { ok: 'Cao: vừa', short: 'Thấp quá — kéo mép trên lên', tall: 'Cao quá — che khung kèn' }[
          hs
        ],
      );
      expect(await controlIssues(page)).toEqual([]);

      await page.getByRole('button', { name: 'Căn chỉnh', exact: true }).tap();
      const picks = page.getByRole('group', { name: 'Chọn số cần chỉnh' }).getByRole('button');
      await expect(picks).toHaveText(['Vạch Dời', 'Vạch Giãn', 'Vòng Dời', 'Vòng Giãn']);
      const step = stepOfScreen(sh);
      const lanes = await centersOf(page, '.mini-guide');
      lanes.forEach((x, i) => expect(Math.abs(x - (w / 2 + (i - 3.5) * step))).toBeLessThan(0.6));
      const modes = await centersOf(page, '.mini-guide-mode');
      const cols = [1.947, 3.182, 4.098, 5.025];
      modes.forEach((x, j) => expect(Math.abs(x - (lanes[0] + cols[j] * step))).toBeLessThan(0.6));
      for (let i = 0; i < 4; i++) {
        await picks.nth(i).tap();
        expect(await controlIssues(page), `số ${i}`).toEqual([]);
        const s = await fitStatusInfo(page);
        expect(s).toMatchObject({ width: ws, height: hs, inside: true, overlaps: [] });
        const c = await alignCover(page);
        expect(c.panel).toBeGreaterThanOrEqual(s!.bottom - 0.5); // chỉ báo nằm trong bảng
        for (const r of c.rings) expect(r).toBeGreaterThanOrEqual(c.panel - 0.5);
        expect(c.edge[0]).toBeGreaterThan(c.panel);
      }
      expect(errors).toEqual([]);
    });
  });
}

test.describe('đúng tỉ lệ thật: vạch / vòng / canvas trùng nút thật của ảnh game; kéo giãn cửa sổ; Vạch · Dời lưu + Đặt lại', () => {
  test.use({
    viewport: { width: 640, height: 105 },
    screen: { width: 915, height: 412 },
    userAgent: ANDROID_UA,
  });

  test('màn 915 × 412: cửa sổ căn giữa màn → vạch + vòng thẳng tâm nút trên ảnh game; vòng đích trên canvas', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await fitScheme(page);
    await page.goto(`/#/mini/${SEED}?delay=0`);
    const mini = page.locator('.mini');
    await expect(mini).toHaveAttribute('data-scale', 'true');
    const u = 412 / 633; // UI game phóng theo chiều cao màn (D-413)
    const at = (refX: number) => screenXOf(915, 412, refX);
    const left = (915 - 640) / 2; // mép trái cửa sổ khi đặt giữa màn
    // Vòng đích của renderer ở đúng cột nút chế độ thật, sát trên mép dưới.
    const step = stepOfScreen(412);
    const ring = await page.locator('canvas.mini-canvas').evaluate(
      (el, { xs, d }) => {
        const c = el as HTMLCanvasElement;
        const ctx = c.getContext('2d')!;
        const s = c.width / c.clientWidth;
        const top = c.clientHeight - 2 - 1 - d;
        const px = (x: number, y: number) => [
          ...ctx.getImageData(Math.round(x * s), Math.round(y * s), 1, 1).data,
        ];
        return xs.map((x) => {
          const on = px(x, top + 0.75);
          const off = px(x, top - 6);
          return Math.abs(on[0] - off[0]) + Math.abs(on[1] - off[1]) + Math.abs(on[2] - off[2]);
        });
      },
      { xs: REF_MODES.map((x) => at(x) - left), d: Math.min(step * 0.6, 105 * 0.42) },
    );
    for (const diff of ring) expect(diff).toBeGreaterThan(30);
    await page.getByRole('button', { name: 'Căn chỉnh', exact: true }).tap();
    const lanes = await centersOf(page, '.mini-guide');
    lanes.forEach((x, i) => expect(Math.abs(x + left - at(REF_NOTES[i]))).toBeLessThan(1.5 * u));
    const modes = await centersOf(page, '.mini-guide-mode');
    modes.forEach((x, j) => expect(Math.abs(x + left - at(REF_MODES[j]))).toBeLessThan(1.5 * u));

    // Kéo giãn / thu hẹp cửa sổ (CDP đổi cỡ trang mà giữ cỡ màn — setViewportSize đặt màn = viewport): khoảng
    // cách vạch giữ nguyên, chỉ báo đổi ngay.
    const cdp = await page.context().newCDPSession(page);
    const resize = (width: number, height: number) =>
      cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
        screenWidth: 915,
        screenHeight: 412,
      });
    await resize(600, 105);
    await expect(page.locator('.mini-fit-status')).toHaveAttribute('data-width', 'narrow');
    const narrow = await centersOf(page, '.mini-guide');
    narrow.forEach((x, i) => expect(Math.abs(x - (300 + (i - 3.5) * step))).toBeLessThan(0.6));
    await resize(660, 150);
    await expect(page.locator('.mini-fit-status')).toHaveAttribute('data-width', 'ok');
    await expect(page.locator('.mini-fit-status')).toHaveAttribute('data-height', 'tall');
    expect(errors).toEqual([]);
  });

  test('"Vạch · Dời" + 3 lần → vạch dời 3 px; "Vạch · Giãn" +; tải lại vẫn giữ; Đặt lại mặc định', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await fitScheme(page);
    await page.goto(`/#/mini/${SEED}?delay=0`);
    await page.getByRole('button', { name: 'Căn chỉnh', exact: true }).tap();
    const x0 = await centersOf(page, '.mini-guide');
    const plus = page.getByRole('button', { name: 'Tăng: Vạch nút số: dời ngang' });
    for (let i = 0; i < 3; i++) await plus.tap();
    await expect(page.locator('.mini-align-value')).toHaveText('+3 px');
    const x1 = await centersOf(page, '.mini-guide');
    x1.forEach((x, i) => expect(x - x0[i]).toBeCloseTo(3, 1));
    await page
      .getByRole('group', { name: 'Chọn số cần chỉnh' })
      .getByRole('button', { name: 'Vạch Giãn' })
      .tap();
    await page.getByRole('button', { name: 'Tăng: Vạch nút số: giãn khoảng cách' }).tap();
    const x2 = await centersOf(page, '.mini-guide');
    expect(x2[7] - x1[7]).toBeCloseTo(1, 0);
    expect(x1[0] - x2[0]).toBeCloseTo(1, 0);
    const saved = await page.evaluate(() => localStorage.getItem('dfht-mini-calibration') ?? '');
    expect(saved).toContain('"shift":3');
    await page.reload();
    await page.getByRole('button', { name: 'Căn chỉnh', exact: true }).tap();
    const x3 = await centersOf(page, '.mini-guide');
    x3.forEach((x, i) => expect(x).toBeCloseTo(x2[i], 1));
    await page.getByRole('button', { name: 'Đặt lại mặc định' }).tap();
    const x4 = await centersOf(page, '.mini-guide');
    x4.forEach((x, i) => expect(x).toBeCloseTo(x0[i], 1));
    expect(await page.evaluate(() => localStorage.getItem('dfht-mini-calibration'))).toBeNull();
    expect(errors).toEqual([]);
  });
});

test.describe('không phải Android (D-412): cửa sổ trình duyệt máy tính 1280 × 720 trên màn 1920 × 1080', () => {
  test.use({
    viewport: { width: 1280, height: 720 },
    screen: { width: 1920, height: 1080 },
    hasTouch: false,
    isMobile: false,
  });

  test('không đúng tỉ lệ thật: lane trải theo cửa sổ, không chỉ báo Rộng / Cao', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await fitScheme(page);
    await page.goto(`/#/mini/${SEED}?delay=0`);
    const mini = page.locator('.mini');
    await expect(mini).toHaveAttribute('data-layout', 'game');
    await expect(mini).not.toHaveAttribute('data-scale', 'true');
    await expect(page.locator('.mini-fit-status')).toHaveCount(0);
    await page.getByRole('button', { name: 'Căn chỉnh', exact: true }).click();
    await expect(
      page.getByRole('group', { name: 'Chọn số cần chỉnh' }).getByRole('button'),
    ).toHaveText(['Vạch Nút 1', 'Vạch Nút 1̇', 'Vòng Dời', 'Vòng Giãn']);
    const lanes = await centersOf(page, '.mini-guide');
    // Kiểu "cửa sổ = 8 làn" (v1.0.1): nút 1 ở 1/16 bề ngang, nút 1̇ ở 15/16.
    expect(lanes[0]).toBeCloseTo(0.0625 * 1280, 0);
    expect(lanes[7]).toBeCloseTo(0.9375 * 1280, 0);
    expect(errors).toEqual([]);
  });
});
