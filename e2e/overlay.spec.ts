import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { collectErrors, readClipboard, stubClipboard } from './helpers';

/**
 * Overlay OBS (Phase 3, spec §7 + §9 "overlay route render nền trong suốt"; round 5 "overlay = màn hiển
 * thị của Player"): nền trong suốt / chroma, canvas có vẽ và ô rơi khi tự chạy (không thấy Player sau ~2 s),
 * link `data=` của bài người dùng mở được ở context mới (OBS có bộ nhớ riêng — không thấy thư viện của trình
 * duyệt người dùng), overlay cùng trình duyệt theo Player qua BroadcastChannel + bố cục cả canvas. R6: bỏ
 * Window Capture (không còn nút "Toàn màn hình"); nút "Xem trước" của hộp thoại OBS mở cửa sổ nền tối
 * `preview=1` (nhãn "không dùng để quay", bảng phím game minh họa); link cũ `bg=chroma` vẫn chạy. Chạy trên
 * bản build.
 */

const SEED = 'seed-quoc-ca-viet-nam';

test.beforeEach(async ({ context }) => {
  await stubClipboard(context);
});

/** Số điểm ảnh có alpha > 0 (mẫu thưa) + alpha / màu ở góc trên trái của canvas overlay. */
async function canvasStats(page: Page) {
  return page.locator('canvas.overlay-canvas').evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width === 0 || canvas.height === 0) {
      return { opaque: 0, total: 0, corner: [0, 0, 0, 0], signature: 0 };
    }
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let opaque = 0;
    let total = 0;
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i += 4 * 13) {
      total++;
      if (data[i + 3] > 0) opaque++;
      h ^= (data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return { opaque, total, corner: [data[0], data[1], data[2], data[3]], signature: h };
  });
}

async function pageBackgrounds(page: Page) {
  return page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
    overlayMode: document.documentElement.classList.contains('overlay-mode'),
  }));
}

test('#/overlay/<seed> (link cũ autoplay=1): nền trong suốt, không chrome, tự chạy khi không thấy Player', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 576, height: 600 });
  await page.goto(`/#/overlay/${SEED}?autoplay=1`);
  const canvas = page.locator('canvas.overlay-canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('aria-label', /Quốc ca Việt Nam/);

  const bg = await pageBackgrounds(page);
  expect(bg).toEqual({ html: 'rgba(0, 0, 0, 0)', body: 'rgba(0, 0, 0, 0)', overlayMode: true });
  // Không thanh điều hướng / nút nào (R6 bỏ "Toàn màn hình") — chỉ dòng "Đang chờ màn chơi…" trong ~2 s
  // đầu (trình duyệt thường, không phải OBS).
  await expect(page.locator('nav')).toHaveCount(0);
  await expect(page.getByRole('button')).toHaveCount(0);
  await expect(page.getByText('Đang chờ màn chơi…')).toBeVisible();

  const first = await canvasStats(page);
  // Nền canvas trong suốt (góc trái trên), nhưng có tile / hit line được vẽ.
  expect(first.corner[3]).toBe(0);
  expect(first.opaque).toBeGreaterThan(0);
  expect(first.opaque).toBeLessThan(first.total);
  // Không thấy Player sau ~2 s → tự chạy → khung hình đổi theo thời gian; dòng chờ biến mất.
  await expect
    .poll(async () => (await canvasStats(page)).signature, { timeout: 8_000 })
    .not.toBe(first.signature);
  await expect(page.getByText('Đang chờ màn chơi…')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('?overlay=1&song=…&bg=chroma: cả trang và canvas xanh #00FF00', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(`/?overlay=1&song=${SEED}&bg=chroma`);
  await expect(page.locator('canvas.overlay-canvas')).toBeVisible();
  const bg = await pageBackgrounds(page);
  expect(bg.html).toBe('rgb(0, 255, 0)');
  expect(bg.body).toBe('rgb(0, 255, 0)');
  const stats = await canvasStats(page);
  expect(stats.corner).toEqual([0, 255, 0, 255]);
  expect(errors).toEqual([]);
});

test('trước khi JS của app chạy: nền đã xanh chroma (class đặt sớm trong index.html)', async ({
  page,
}) => {
  const errors = collectErrors(page);
  // Giữ chunk JS chính lại: trang chỉ có HTML + CSS + script inline (như lúc OBS vừa refresh source).
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/assets\/index-[\w-]+\.js$/, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(`/#/overlay/${SEED}?bg=chroma`, { waitUntil: 'commit' });
  await expect
    .poll(() => pageBackgrounds(page).catch(() => null))
    .toEqual({ html: 'rgb(0, 255, 0)', body: 'rgb(0, 255, 0)', overlayMode: true });
  await expect(page.locator('canvas.overlay-canvas')).toHaveCount(0);
  release();
  await expect(page.locator('canvas.overlay-canvas')).toBeVisible();
  expect((await pageBackgrounds(page)).body).toBe('rgb(0, 255, 0)');
  expect(errors).toEqual([]);
});

test('layout=game: không game bar, banner nổi, lane phủ kín tới mép trái', async ({ page }) => {
  await page.setViewportSize({ width: 576, height: 600 });
  await page.goto(`/#/overlay/${SEED}?layout=game`);
  await expect(page.locator('canvas.overlay-canvas')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Gợi ý phím như trong game' })).toHaveCount(0);
  await expect(page.locator('.overlay-banner-float')).toHaveCount(1);
  const lane = await page
    .locator('.overlay')
    .evaluate((el) => (el as HTMLElement).style.getPropertyValue('--lane-left'));
  expect(lane).toBe('0px');
  await expect(page.getByText('Đang chờ màn chơi…')).toBeVisible();
});

/**
 * Độ lệch (beat) giữa vị trí overlay đang vẽ (`.overlay[data-beat]`, frame gần nhất) và vị trí của Player
 * tính từ tin `state` mới nhất trên cùng kênh BroadcastChannel (beat + Δt · bpm / 60000, đồng hồ chung
 * Date.now()).
 */
async function followDrift(page: Page): Promise<{ local: number; expected: number }> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __playerState?: { playing: boolean; beat: number; bpm: number; sentAt: number };
    };
    const s = w.__playerState;
    const el = document.querySelector<HTMLElement>('.overlay');
    const drawn = Number(el?.dataset.beat ?? Number.NaN);
    if (!s) return { local: drawn, expected: Number.NaN };
    const now = Date.now();
    const expected = s.playing ? s.beat + (Math.max(0, now - s.sentAt) * s.bpm) / 60000 : s.beat;
    // Khung cuối có thể cũ (máy bận, compositor đứng ~0,5 s): cộng phần đã trôi kể từ lúc khung đó được vẽ —
    // đo độ lệch của transport overlay, không phải độ trễ khung (`__beatAt`: init script của test dưới).
    const at = (window as unknown as { __beatAt?: number }).__beatAt;
    const local =
      s.playing && at !== undefined ? drawn + (Math.max(0, now - at) * s.bpm) / 60000 : drawn;
    return { local, expected };
  });
}

/** Tolerance theo dõi: 0,1 beat (≈ 75 ms ở 80 BPM của bài mẫu) — gồm cả frame trễ nhất 16 ms. */
const FOLLOW_TOLERANCE_BEATS = 0.1;

test('cửa sổ "Xem trước" (preview=1) theo Player chính: Space ở Player → overlay chạy cùng nhịp; bố cục cả canvas khớp bảng phím game', async ({
  context,
}) => {
  const player = await context.newPage();
  const errors = collectErrors(player);
  await player.goto(`/#/play/${SEED}`);
  await expect(player.locator('canvas').first()).toBeVisible();

  const overlay = await context.newPage();
  const overlayErrors = collectErrors(overlay);
  // Lúc khung cuối được vẽ (data-beat đổi) — followDrift bù khung cũ khi máy bận.
  await overlay.addInitScript(() => {
    new MutationObserver(() => {
      (window as unknown as { __beatAt?: number }).__beatAt = Date.now();
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-beat'] });
  });
  // Nghe cùng kênh với overlay: tin `state` mới nhất của Player = vị trí "đúng" để so.
  await overlay.addInitScript(() => {
    const ch = new BroadcastChannel('dfht-follow');
    ch.onmessage = (e: MessageEvent) => {
      const d = e.data as { kind?: string } | null;
      if (d && d.kind === 'state')
        (window as unknown as { __playerState?: unknown }).__playerState = d;
    };
  });
  // Canvas 2D của overlay chạy bằng CPU từ đầu: test đọc điểm ảnh nhiều lần (Chrome tự chuyển canvas GPU → CPU
  // sau vài lần getImageData, khung kế tiếp khác vài điểm ảnh khử răng cưa → so chữ ký chập chờn).
  await overlay.addInitScript(() => {
    const proto = HTMLCanvasElement.prototype;
    const getContext = proto.getContext;
    proto.getContext = function (this: HTMLCanvasElement, type: string, opts?: unknown) {
      const o =
        type === '2d'
          ? { ...((opts as object | undefined) ?? {}), willReadFrequently: true }
          : opts;
      return (getContext as (t: string, o?: unknown) => RenderingContext | null).call(
        this,
        type,
        o,
      );
    } as typeof proto.getContext;
  });
  await overlay.setViewportSize({ width: 1920, height: 1080 });
  await overlay.goto(`/#/overlay/${SEED}?layout=game&fit=canvas&preview=1`);
  const region = overlay.locator('.overlay');
  // hello → Player trả lời ngay qua BroadcastChannel.
  await expect(region).toHaveAttribute('data-mode', 'follow');
  await expect(overlay.getByText('Đang chờ màn chơi…')).toHaveCount(0);
  // Xem trước: nền tối thường (không trong suốt / chroma), nhãn + tiêu đề "không dùng để quay", không nút.
  await expect(overlay.getByText('Xem trước · không dùng để quay')).toBeVisible();
  await expect(overlay).toHaveTitle(/^Xem trước overlay \(không dùng để quay\)/);
  expect(await pageBackgrounds(overlay)).toEqual({
    html: 'rgb(5, 6, 7)',
    body: 'rgb(5, 6, 7)',
    overlayMode: true,
  });
  await expect(overlay.getByRole('button')).toHaveCount(0);
  // 1920×1080: khung bảng phím PC (8 làn 700–1220 + đệm 16,9 mỗi bên — v1.0.1) + gutter = 610 × 600 tại
  // (683, 150) — đúng trên bảng phím game, mép trái / phải khung trùng mép khung bảng phím minh họa.
  expect(await region.boundingBox()).toEqual({ x: 683, y: 150, width: 610, height: 600 });
  const panel = await overlay.locator('.overlay-preview-keyboard').boundingBox();
  expect(panel).toMatchObject({ x: 683, width: 554 });
  // 8 làn bắt đầu sau đệm khung (ô ngoài cùng không sát mép), gutter ribbon sau đệm phải (610 − 554 = 56).
  await expect
    .poll(() =>
      region.evaluate((el) => [
        (el as HTMLElement).style.getPropertyValue('--lane-left'),
        (el as HTMLElement).style.getPropertyValue('--lane-right'),
      ]),
    )
    .toEqual(['17px', '73px']);
  // Bảng phím game minh họa: 8 keycap 22 px thẳng tâm 8 làn (bước 65 px), hàng y ≈ 840.
  const keys = overlay.locator('.overlay-preview-key');
  await expect(keys).toHaveCount(8);
  const firstKey = await keys.first().boundingBox();
  const lastKey = await keys.last().boundingBox();
  expect(firstKey).toMatchObject({ width: 22, height: 22, y: 829 });
  expect(Math.abs((firstKey?.x ?? 0) + 11 - 732.5)).toBeLessThanOrEqual(1);
  expect(Math.abs((lastKey?.x ?? 0) + 11 - 1187.5)).toBeLessThanOrEqual(1);

  // Đang theo: Space ở overlay không điều khiển gì (chỉnh ở Player). Chờ khung hình ổn định trước: vài khung
  // đầu sau khi mở còn vẽ lại khi nhận tin của Player, và sau vài lần getImageData Chrome chuyển canvas sang vẽ
  // bằng CPU — lần vẽ lại kế tiếp (nhịp tin `state` mỗi giây của Player) cùng lệnh vẽ nhưng khác vài điểm ảnh
  // khử răng cưa. Hai mẫu cách nhau hơn một nhịp tin (1,2 s) bằng nhau = đã qua lần chuyển đó. Vòng R7: lần chuyển
  // đó có khi tới SAU hai mẫu bằng nhau (test chập chờn) → canvas của trang này dùng CPU ngay từ đầu
  // (`willReadFrequently`, init script ở trên); vài khung đứng yên đầu tiên còn vẽ kèm hình làm nóng glow gần như
  // trong suốt (player/glowWarmup.ts, ~3 s đầu) → chờ qua rồi mới lấy mẫu.
  await overlay.waitForTimeout(4_000);
  let before = await canvasStats(overlay);
  await expect
    .poll(
      async () => {
        const prev = before.signature;
        await overlay.waitForTimeout(1200);
        before = await canvasStats(overlay);
        return before.signature === prev;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await overlay.keyboard.press('Space');
  await overlay.waitForTimeout(600);
  expect((await canvasStats(overlay)).signature).toBe(before.signature);

  // Space ở Player → overlay đếm ngược cùng Player (3 s mặc định) rồi chạy cùng nhịp.
  await player.keyboard.press('Space');
  await expect(player.locator('.player-countdown-num')).toHaveText('3');
  await expect(overlay.locator('.overlay-countdown-num')).toBeVisible();
  await expect
    .poll(async () => (await followDrift(overlay)).local, { timeout: 12_000 })
    .toBeGreaterThan(1);
  for (let i = 0; i < 6; i++) {
    const { local, expected } = await followDrift(overlay);
    expect(
      Math.abs(local - expected),
      `mẫu ${i}: overlay ${local} / Player ${expected}`,
    ).toBeLessThan(FOLLOW_TOLERANCE_BEATS);
    await overlay.waitForTimeout(250);
  }

  // Tạm dừng ở Player → overlay đứng đúng chỗ Player dừng.
  await player.keyboard.press('Space');
  await expect.poll(async () => (await followDrift(overlay)).expected).toBeGreaterThan(1);
  await overlay.waitForTimeout(300);
  const paused = await followDrift(overlay);
  expect(Math.abs(paused.local - paused.expected)).toBeLessThan(FOLLOW_TOLERANCE_BEATS);
  await overlay.waitForTimeout(500);
  expect((await followDrift(overlay)).local).toBe(paused.local);

  // Player đóng (pagehide → `bye`) → overlay dừng, chờ Player.
  await player.close();
  await expect(overlay.getByText('Đang chờ màn chơi…')).toBeVisible({ timeout: 8_000 });
  await expect(region).toHaveAttribute('data-mode', 'lost');
  expect(errors).toEqual([]);
  expect(overlayErrors).toEqual([]);
});

test('R5: mở thêm một tab app (màn đầu = màn chơi) không giành overlay của tab đang chơi; thao tác ở tab mới thì chuyển', async ({
  context,
}) => {
  const OTHER = 'seed-takediskrush';
  const a = await context.newPage();
  const errors = collectErrors(a);
  await a.goto(`/#/play/${OTHER}`);
  await expect(a.locator('canvas').first()).toBeVisible();
  const overlay = await context.newPage();
  const overlayErrors = collectErrors(overlay);
  await overlay.setViewportSize({ width: 960, height: 540 });
  await overlay.goto(`/#/overlay/${OTHER}?layout=game&fit=canvas&bg=chroma`);
  const region = overlay.locator('.overlay');
  await expect(region).toHaveAttribute('data-mode', 'follow');
  await expect(overlay).toHaveTitle(/^TAKEDISKRUSH!/);
  // Tab A phát (đếm ngược 3 s) → overlay chạy theo.
  await a.keyboard.press('Space');
  const beat = async () => Number((await region.getAttribute('data-beat')) ?? Number.NaN);
  await expect.poll(beat, { timeout: 12_000 }).toBeGreaterThan(1);

  // Tab B mở `#/` (bài mẫu) và KHÔNG thao tác gì.
  const b = await context.newPage();
  const bErrors = collectErrors(b);
  await b.goto('/#/');
  await expect(b.locator('canvas').first()).toBeVisible();
  const before = await beat();
  await overlay.waitForTimeout(1500);
  await expect(overlay).toHaveTitle(/^TAKEDISKRUSH!/);
  expect(await beat()).toBeGreaterThan(before);

  // Người dùng bấm Phát ở tab B → overlay chuyển sang bài của B (bài mẫu của màn đầu) ngay.
  await b.keyboard.press('Space');
  await expect(overlay).toHaveTitle(/^Quốc ca Việt Nam/, { timeout: 5_000 });
  await b.keyboard.press('Escape');
  expect(errors).toEqual([]);
  expect(bErrors).toEqual([]);
  expect(overlayErrors).toEqual([]);
});

test('link data= của bài người dùng (nút OBS trong Player) mở được ở context mới, storage trống', async ({
  page,
  browser,
}) => {
  const errors = collectErrors(page);
  // Bài người dùng trong localStorage của trình duyệt "người dùng" (shape persist của library store).
  await page.addInitScript(() => {
    if (localStorage.getItem('dfht-library')) return;
    localStorage.setItem(
      'dfht-library',
      JSON.stringify({
        state: {
          songs: [
            {
              id: 'user-obs-1',
              source: '@title Bài OBS của tôi\n@bpm 120\nmột hai ba bốn: Z X C V\nB N M ,',
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        },
        version: 1,
      }),
    );
  });
  await page.goto('/#/play/user-obs-1');
  await expect(page.getByRole('heading', { level: 1, name: 'Bài OBS của tôi' })).toBeVisible();
  await page.getByRole('button', { name: /^OBS/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Tạo link OBS' });
  await expect(dialog).toBeVisible();
  // Hộp thoại chỉ còn chỉnh hiển thị: không chọn nền / tự chạy / kiểu điều khiển; không còn Window Capture.
  await expect(dialog.getByRole('radio', { name: /Xanh chroma/ })).toHaveCount(0);
  await expect(dialog.getByRole('switch')).toHaveCount(0);
  await expect(dialog.getByText(/Window Capture|Chroma Key|Toàn màn hình/)).toHaveCount(0);
  // "Xem trước": cửa sổ nhỏ = đúng link của Browser Source + preview=1, nền tối, chạy theo màn chơi này.
  const [preview] = await Promise.all([
    page.waitForEvent('popup'),
    dialog.getByRole('button', { name: 'Xem trước' }).click(),
  ]);
  await expect(preview.locator('.overlay')).toHaveAttribute('data-mode', 'follow');
  expect(preview.url()).toContain('preview=1');
  await expect(preview.getByText('Xem trước · không dùng để quay')).toBeVisible();
  await expect(preview.locator('canvas.overlay-canvas')).toHaveAttribute(
    'aria-label',
    /Bài OBS của tôi/,
  );
  await preview.close();
  await dialog.getByRole('button', { name: 'Sao chép link' }).click();
  await expect(dialog.getByText(/Đã sao chép link OBS/)).toBeVisible();
  const url = await readClipboard(page);
  // Browser Source: bố cục cả canvas, nền trong suốt (mặc định, không ghi), ảnh chụp Cài đặt, bài nhúng.
  expect(url).toMatch(/^http:\/\/localhost:\d+\/#\/overlay\?layout=game&fit=canvas&.*&data=/);
  expect(url).not.toMatch(/autoplay|bg=|loop=|preview=/);
  expect(url).not.toContain('user-obs-1');
  expect(errors).toEqual([]);

  // "OBS": context mới (localStorage trống), Browser Source cỡ canvas 1920×1080, mở thẳng link.
  const obs = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  try {
    const obsPage = await obs.newPage();
    const obsErrors = collectErrors(obsPage);
    await obsPage.goto(url);
    const canvas = obsPage.locator('canvas.overlay-canvas');
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute('aria-label', /Bài OBS của tôi/);
    await expect(obsPage.getByRole('alert')).toHaveCount(0);
    expect(await obsPage.evaluate(() => localStorage.getItem('dfht-library'))).toBeNull();
    const bg = await obsPage.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgba(0, 0, 0, 0)');
    // Tự đặt đúng trên bảng phím game (không kéo tay): khung bảng phím PC + gutter (v1.0.1).
    expect(await obsPage.locator('.overlay').boundingBox()).toEqual({
      x: 683,
      y: 150,
      width: 610,
      height: 600,
    });
    expect(obsErrors).toEqual([]);

    // Id của bài người dùng không có trong storage của OBS → thẻ lỗi dễ đọc (không màn trắng) khi tự chạy.
    await obsPage.goto(new URL('/#/overlay/user-obs-1', url).href);
    await expect(obsPage.getByRole('alert')).toContainText('Overlay không mở được bài');
  } finally {
    await obs.close();
  }
});
