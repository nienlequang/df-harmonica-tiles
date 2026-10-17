import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { collectErrors, stubClipboard } from './helpers';

/**
 * C. Cửa sổ nổi PC — cỡ chuẩn theo màn hình (bổ sung trước deploy, chủ dự án duyệt 2026-10-16; src/pip/pipPrefs.ts,
 * docs/GAME-UI-REFERENCE.md "Cửa sổ nổi PC — cỡ theo màn hình"): mở ở rộng = khung bảng phím PC (8 làn `520·k` + đệm
 * 0,26 bước mỗi bên — v1.0.1) + gutter (8 cột
 * khớp 8 phím game), cao NGOÀI = `750·k` (mép trên màn hình → mép trên bảng phím), `k / dpr = screen.height / 1080`,
 * trừ thanh tiêu đề (lần đầu đoán 34 px); cỡ đã kéo chỉ dùng lại trên ĐÚNG màn đã lưu (bản lưu cũ không ghi màn bị
 * bỏ qua); nút "Đặt lại cỡ chuẩn" trên thanh của cửa sổ nổi.
 *
 * Edge headless: màn hình = viewport của tab (1600 × 900 → k = 0,833); cửa sổ nổi là page mới mà Playwright giả
 * viewport nên không đo được cỡ thật sau `resizeTo` — chỉ kiểm cỡ app XIN (`requestWindow`) và đường "Đặt lại cỡ
 * chuẩn" chạy không lỗi (đổi được → khớp cỡ chuẩn; không → dòng nhắc đóng / mở lại).
 */

const SEED = 'seed-quoc-ca-viet-nam';

test.beforeEach(async ({ context }) => {
  await stubClipboard(context);
});

test.use({ viewport: { width: 1600, height: 900 } });

/** Cài đặt + localStorage đặt trước khi app chạy (một lần mỗi tab). */
async function presetStorage(page: Page, items: Record<string, unknown>): Promise<void> {
  await page.addInitScript((all) => {
    if (sessionStorage.getItem('pip-size-init')) return;
    sessionStorage.setItem('pip-size-init', '1');
    for (const [k, v] of Object.entries(all)) localStorage.setItem(k, JSON.stringify(v));
  }, items);
}

/** Ghi lại tham số mỗi lần app gọi `documentPictureInPicture.requestWindow`. */
async function spyRequestWindow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      documentPictureInPicture: { requestWindow: (o: unknown) => Promise<Window> };
      __pipRequests: unknown[];
    };
    const api = w.documentPictureInPicture;
    const orig = api.requestWindow.bind(api);
    w.__pipRequests = [];
    api.requestWindow = (o: unknown) => {
      w.__pipRequests.push(o);
      return orig(o);
    };
  });
}

const requests = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __pipRequests: { width: number; height: number }[] }).__pipRequests,
  );

/** Đệm khung bảng phím PC mỗi bên 8 làn (bước cột) — `GAME_FRAME_PAD` của src/player/layout.ts (v1.0.1). */
const FRAME_PAD = 0.26;

/**
 * Cỡ chuẩn (px CSS) cho màn cao `h` px CSS, thanh tiêu đề `chrome` (cùng công thức pipPrefs.presetSize): khung bảng
 * phím PC (8 làn 520·k + đệm hai bên) + gutter.
 */
function standardSize(h: number, chrome: number): { width: number; height: number } {
  const c = h / 1080;
  const tileScale = Math.min(3, Math.max(0.5, c));
  return {
    width: Math.round(520 * (1 + (2 * FRAME_PAD) / 8) * c) + Math.round(56 * tileScale),
    height: Math.round(750 * c - chrome),
  };
}

test('Cửa sổ nổi mở ở cỡ chuẩn của màn hình; bản lưu cũ bị bỏ qua; "Đặt lại cỡ chuẩn"; cỡ đã kéo theo màn', async ({
  page,
  context,
}) => {
  const errors = collectErrors(page);
  await presetStorage(page, {
    'dfht-settings': { state: { language: 'vi', startDelaySec: 0 }, version: 5 },
    // Bản lưu kiểu cũ (không ghi màn hình) → không dùng lại.
    'dfht-pip-size': { width: 640, height: 720 },
  });
  await page.goto(`/#/play/${SEED}`);
  const open = page
    .getByRole('complementary', { name: 'Công cụ màn chơi' })
    .getByRole('button', { name: 'Cửa sổ nổi', exact: true });
  await expect(open).toBeVisible();
  await spyRequestWindow(page);
  const scr = await page.evaluate(() => ({
    width: screen.width,
    height: screen.height,
    dpr: devicePixelRatio,
  }));
  const expected = standardSize(scr.height, 34);

  const pending = context.waitForEvent('page');
  await open.click();
  const pip = await pending;
  const pipErrors = collectErrors(pip);
  expect(await requests(page)).toEqual([expected]);
  // Như cửa sổ thật: viewport = cỡ đã xin (Playwright giả viewport cho page mới).
  await pip.setViewportSize(expected);

  const toolbar = pip.getByRole('group', { name: 'Điều khiển cửa sổ nổi' });
  const reset = toolbar.getByRole('button', { name: 'Đặt lại cỡ chuẩn' });
  await expect(reset).toBeVisible();
  await expect(reset).toHaveAttribute('title', /cao từ mép trên màn hình/);
  // Mọi nút của thanh vẫn nằm trong bề ngang cửa sổ.
  const right = await toolbar
    .getByRole('button')
    .evaluateAll((els) => Math.max(...els.map((e) => e.getBoundingClientRect().right)));
  expect(right).toBeLessThanOrEqual(expected.width);

  await reset.click();
  await pip.waitForTimeout(700);
  const size = await pip.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const note = pip.getByRole('alert');
  const matched =
    Math.abs(size.width - expected.width) <= 3 && Math.abs(size.height - expected.height) <= 3;
  // Trình duyệt không cho đổi cỡ → dòng nhắc, và lần mở sau bỏ cỡ / chỗ Chrome đã nhớ (D-419).
  const refused = (await note.count()) > 0;
  if (refused) {
    await expect(note).toHaveText(/đóng rồi mở lại cửa sổ nổi/);
  } else {
    expect(matched).toBe(true);
  }
  // "Đặt lại" quên cỡ đã nhớ (cả bản lưu cũ).
  expect(await page.evaluate(() => localStorage.getItem('dfht-pip-size'))).toBeNull();

  // Đóng từ tab gốc, nhớ một cỡ đã kéo trên ĐÚNG màn này → lần mở sau dùng cỡ đó.
  const closed = pip.waitForEvent('close');
  await open.click();
  await closed;
  await expect(open).toHaveAttribute('aria-pressed', 'false');
  // (v1.0.1) Bản lưu ghi cả khung `framePad` — bản của bố cục cũ (8 làn sát mép) bị bỏ qua.
  await page.evaluate(
    ({ s, framePad }) => {
      localStorage.setItem(
        'dfht-pip-size',
        JSON.stringify({ width: 500, height: 520, screen: s, framePad }),
      );
    },
    { s: scr, framePad: FRAME_PAD },
  );
  const pending2 = context.waitForEvent('page');
  await open.click();
  const pip2 = await pending2;
  expect((await requests(page)).at(-1)).toEqual({
    width: 500,
    height: 520,
    ...(refused ? { preferInitialWindowPlacement: true } : {}),
  });
  const closed2 = pip2.waitForEvent('close');
  await pip2.close();
  await closed2;

  // Cỡ lưu trên màn khác → cỡ chuẩn của màn này.
  await page.evaluate(
    ({ s, framePad }) => {
      localStorage.setItem(
        'dfht-pip-size',
        JSON.stringify({
          width: 500,
          height: 520,
          screen: { ...s, height: s.height + 360 },
          framePad,
        }),
      );
    },
    { s: scr, framePad: FRAME_PAD },
  );
  const pending3 = context.waitForEvent('page');
  await open.click();
  const pip3 = await pending3;
  const last = (await requests(page)).at(-1);
  expect(last?.width).toBe(expected.width);
  expect(last).not.toHaveProperty('preferInitialWindowPlacement'); // chỉ một lần
  // Thanh tiêu đề có thể đã đo được ở lần trước (headless) → chỉ chênh phần đó so với số đoán.
  expect(Math.abs((last?.height ?? 0) - expected.height)).toBeLessThanOrEqual(34);
  await pip3.close();
  expect(errors).toEqual([]);
  expect(pipErrors).toEqual([]);
});

/**
 * Màn giả lập (`screen` + `deviceScaleFactor` của Playwright): cỡ app xin = số cứng của bảng "Cửa sổ nổi PC — cỡ
 * theo màn hình" (docs/GAME-UI-REFERENCE.md; thanh tiêu đề đoán 34 px vì máy mới chưa đo), và trong cửa sổ nổi 8
 * cột Căn chỉnh rộng đúng bước phím game `65·k / dpr` px CSS (chỉ chiều rơi dài ra theo màn). Màn 5:4: cỡ chuẩn vượt
 * trần 25 % diện tích màn của Chrome → xin đúng bề ngang, chiều cao hạ (`target` = cỡ chuẩn đủ cao — D-418).
 */
const CASES: {
  name: string;
  screen: { width: number; height: number };
  dpr: number;
  expected: { width: number; height: number };
  target?: { width: number; height: number };
  outer: number;
}[] = [
  {
    name: '768p @100 % (1366 × 768)',
    screen: { width: 1366, height: 768 },
    dpr: 1,
    expected: { width: 434, height: 499 },
    outer: 533,
  },
  {
    name: '1080p @100 % (1920 × 1080)',
    screen: { width: 1920, height: 1080 },
    dpr: 1,
    expected: { width: 610, height: 716 },
    outer: 750,
  },
  {
    name: '1440p @100 % (2560 × 1440)',
    screen: { width: 2560, height: 1440 },
    dpr: 1,
    expected: { width: 813, height: 966 },
    outer: 1000,
  },
  {
    name: '900p @100 % (1600 × 900)',
    screen: { width: 1600, height: 900 },
    dpr: 1,
    expected: { width: 509, height: 591 },
    outer: 625,
  },
  {
    name: '2160p @150 % (3840 × 2160 → 2560 × 1440 px CSS)',
    screen: { width: 2560, height: 1440 },
    dpr: 1.5,
    expected: { width: 813, height: 966 },
    outer: 1000,
  },
  {
    name: '2160p @100 % (3840 × 2160)',
    screen: { width: 3840, height: 2160 },
    dpr: 1,
    expected: { width: 1220, height: 1466 },
    outer: 1500,
  },
  {
    name: '5:4 @100 % (1280 × 1024)',
    screen: { width: 1280, height: 1024 },
    dpr: 1,
    expected: { width: 578, height: 566 },
    target: { width: 578, height: 677 },
    outer: 711,
  },
];

for (const s of CASES) {
  test.describe(`màn ${s.name}`, () => {
    test.use({
      viewport: { width: 1280, height: 720 },
      screen: s.screen,
      deviceScaleFactor: s.dpr,
    });

    test('mở ở cỡ chuẩn của màn: 8 cột = 8 phím game, cao ngoài = mép trên màn → mép trên bảng phím', async ({
      page,
      context,
    }) => {
      const errors = collectErrors(page);
      await presetStorage(page, {
        'dfht-settings': { state: { language: 'vi', startDelaySec: 0 }, version: 5 },
      });
      await page.goto(`/#/play/${SEED}`);
      const open = page
        .getByRole('complementary', { name: 'Công cụ màn chơi' })
        .getByRole('button', { name: 'Cửa sổ nổi', exact: true });
      await expect(open).toBeVisible();
      expect(
        await page.evaluate(() => ({
          width: screen.width,
          height: screen.height,
          dpr: devicePixelRatio,
        })),
      ).toEqual({ ...s.screen, dpr: s.dpr });
      await spyRequestWindow(page);

      const pending = context.waitForEvent('page');
      await open.click();
      const pip = await pending;
      const pipErrors = collectErrors(pip);
      expect(await requests(page)).toEqual([s.expected]);
      // Cao ngoài (cỡ chuẩn + thanh tiêu đề đoán) = 750 · k px thật: chạm mép trên màn khi mép dưới ở y = 750 · k.
      const target = s.target ?? s.expected;
      expect(target.height + 34).toBe(s.outer);
      // Cỡ xin luôn đúng bề ngang và không vượt trần 25 % diện tích màn của Chrome (không bị thu nhỏ — D-418).
      expect(s.expected.width).toBe(target.width);
      expect(s.expected.width * s.expected.height).toBeLessThanOrEqual(
        0.25 * s.screen.width * s.screen.height,
      );
      // = 750·k px thật (làm tròn px CSS).
      expect(Math.abs(s.outer * s.dpr - (750 * s.screen.height * s.dpr) / 1080)).toBeLessThan(0.5);

      await pip.setViewportSize(s.expected);
      const toolbar = pip.getByRole('group', { name: 'Điều khiển cửa sổ nổi' });
      await toolbar.getByRole('button', { name: 'Căn chỉnh' }).click();
      const cols = pip
        .getByRole('group', { name: 'Vạch căn chỉnh với bảng phím game' })
        .locator('.pip-align-col');
      await expect(cols).toHaveCount(8);
      const lane = (65 * s.screen.height) / 1080; // bước phím game, px CSS
      await expect
        .poll(async () =>
          cols.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width)),
        )
        .toEqual(Array.from({ length: 8 }, () => expect.closeTo(lane, 0)));
      const first = await cols.first().boundingBox();
      // v1.0.1: mép trái cửa sổ = mép trái khung bảng phím → làn 1 bắt đầu sau đệm khung (0,26 bước), không sát mép.
      expect(Math.abs((first?.x ?? 0) - FRAME_PAD * lane)).toBeLessThanOrEqual(1);
      const last = await cols.last().boundingBox();
      // Gutter ribbon bắt đầu sau đệm phải: mép phải làn 8 + 0,26 bước = cỡ trong − gutter.
      const gutter = Math.round(56 * Math.min(3, Math.max(0.5, s.screen.height / 1080)));
      expect(
        Math.abs(
          (last?.x ?? 0) + (last?.width ?? 0) + FRAME_PAD * lane - (s.expected.width - gutter),
        ),
      ).toBeLessThanOrEqual(1.5);
      await pip.close();
      expect(errors).toEqual([]);
      expect(pipErrors).toEqual([]);
    });
  });
}
