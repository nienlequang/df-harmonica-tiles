import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { collectErrors, stubClipboard } from './helpers';

/**
 * Bổ sung trước deploy (chủ dự án duyệt, 2026-10-16), chạy trên bản build, tiếng Việt.
 *
 * A. Nút loa trên thanh điều khiển màn chơi (cạnh Tempo; tên đọc cố định "Tiếng giai điệu" + aria-pressed, tooltip
 *    = việc sẽ làm — D-424): mặc định tắt tiếng; bấm → ĐÚNG hộp cảnh báo bản
 *    quyền của Cài đặt → Âm thanh; Hủy giữ tắt; "Tôi hiểu, bật" bật + huy hiệu đỏ "Đang phát giai điệu"; đang
 *    bật thì bấm = tắt ngay; cùng setting với Cài đặt; PC + Mobile (844×390, 390×844) không chồng control nào;
 *    bàn phím dùng được, bấm chuột rồi Space vẫn là phát / dừng.
 * B. Trang mini Android "Khớp nút game" 960×300 (kiểu Mobile + PC): Căn chỉnh khác mặc định → tải lại vẫn giữ →
 *    trên CANVAS mọi ô thẳng tâm vạch đã chỉnh, 4 vòng đích ở cột nút chế độ đã chỉnh sát trên mép dưới; chạy
 *    bài → vòng "CHẠM" rơi trong đúng cột đó và đáp sát mép dưới đúng beat phải chạm; "Thu nhỏ" vẫn chạy bài
 *    với bàn nút riêng. (Số đo mặc định + Căn chỉnh chi tiết: e2e/mini.spec.ts.)
 */

const QUOC_CA = { id: 'seed-quoc-ca-viet-nam', title: 'Quốc ca Việt Nam' } as const;
const DIALOG = 'Bật phát giai điệu mẫu?';
const BADGE = '🔊 Đang phát giai điệu';

test.beforeEach(async ({ context }) => {
  await stubClipboard(context);
});

/** Cài đặt đặt trước khi app chạy (một lần mỗi tab — tải lại / chuyển trang không ghi đè). */
async function presetSettings(page: Page, state: Record<string, unknown>): Promise<void> {
  await page.addInitScript((s) => {
    if (sessionStorage.getItem('predeploy-init')) return;
    sessionStorage.setItem('predeploy-init', '1');
    localStorage.setItem('dfht-settings', JSON.stringify({ state: s, version: 5 }));
  }, state);
}

const transport = (page: Page) => page.getByRole('group', { name: 'Điều khiển phát' });
/** Nút loa: tên đọc cố định (D-424); trạng thái ở aria-pressed, tooltip "Bật tiếng giai điệu" ↔ "Tắt tiếng". */
const soundButton = (page: Page) =>
  transport(page).getByRole('button', { name: 'Tiếng giai điệu' });

async function openPlayer(page: Page): Promise<void> {
  await page.goto(`/#/play/${QUOC_CA.id}`);
  await expect(page.getByRole('heading', { level: 1, name: QUOC_CA.title })).toBeVisible();
}

/** Control của thanh điều khiển đang hiện: không cái nào chồng lên cái nào, tất cả nằm trong bề ngang màn. */
async function expectTransportNoOverlap(page: Page): Promise<void> {
  const boxes = await transport(page)
    .locator('button, select, input')
    .evaluateAll((els) =>
      els
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { name: el.getAttribute('aria-label') ?? el.textContent ?? '', r };
        })
        .filter(({ r }) => r.width > 0 && r.height > 0)
        .map(({ name, r }) => ({ name, x: r.left, y: r.top, w: r.width, h: r.height })),
    );
  const vw = page.viewportSize()?.width ?? 0;
  for (const b of boxes) {
    expect(b.x, `${b.name} trong màn`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w, `${b.name} trong màn`).toBeLessThanOrEqual(vw + 0.5);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap =
        a.x < b.x + b.w - 0.5 &&
        b.x < a.x + a.w - 0.5 &&
        a.y < b.y + b.h - 0.5 &&
        b.y < a.y + a.h - 0.5;
      expect(overlap, `"${a.name}" chồng "${b.name}"`).toBe(false);
    }
  }
}

async function confirmMelody(page: Page, via: (l: Locator) => Promise<void>): Promise<void> {
  const dialog = page.getByRole('dialog', { name: DIALOG });
  await expect(dialog).toBeVisible();
  await via(dialog.getByRole('button', { name: 'Tôi hiểu, bật' }));
  await expect(dialog).toBeHidden();
}

test.describe('A. nút loa trên thanh điều khiển', () => {
  test('PC: mặc định tắt → hộp cảnh báo của Cài đặt → Hủy / bật → huy hiệu; tắt ngay; khớp Cài đặt', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await presetSettings(page, { startDelaySec: 0 });
    await openPlayer(page);
    const btn = soundButton(page);
    await expect(btn).toHaveAccessibleName('Tiếng giai điệu');
    await expect(btn).toHaveAttribute('title', 'Bật tiếng giai điệu');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText(BADGE)).toHaveCount(0);
    // Ngay cạnh Tempo, cùng hàng.
    const tempo = transport(page).getByRole('slider', { name: /Tempo/ });
    const [b, s] = [await btn.boundingBox(), await tempo.boundingBox()];
    expect(b && s && Math.abs(b.y + b.height / 2 - (s.y + s.height / 2)) < 12).toBe(true);
    expect(b && s && s.x > b.x && s.x - (b.x + b.width) < 120).toBe(true);
    await expectTransportNoOverlap(page);

    // Hủy → vẫn tắt, focus về nút.
    await btn.click();
    const dialog = page.getByRole('dialog', { name: DIALOG });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('YouTube / Facebook / TikTok');
    await expect(dialog.getByRole('button', { name: 'Hủy' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Hủy' }).click();
    await expect(dialog).toBeHidden();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(btn).toBeFocused();

    // "Tôi hiểu, bật" → bật + huy hiệu đỏ.
    await btn.click();
    await confirmMelody(page, (l) => l.click());
    await expect(btn).toHaveAccessibleName('Tiếng giai điệu');
    await expect(btn).toHaveAttribute('title', 'Tắt tiếng');
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(BADGE)).toBeVisible();

    // Bấm chuột rồi Space: vẫn là phát / dừng, không đổi tiếng.
    await page.keyboard.press('Space');
    await expect(page.locator('button.transport-play')).toHaveAttribute('data-playing', 'true');
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space');
    await expect(page.locator('button.transport-play')).toHaveAttribute('data-playing', 'false');

    // Cài đặt → Âm thanh thấy đang bật; tắt ở đó → màn chơi tắt tiếng.
    await page.goto('/#/settings');
    const sw = page.getByRole('switch', { name: 'Phát giai điệu mẫu' });
    await expect(sw).toBeChecked();
    await sw.click();
    await expect(sw).not.toBeChecked();
    await openPlayer(page);
    await expect(soundButton(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText(BADGE)).toHaveCount(0);

    // Bật lại rồi tắt từ màn chơi: không hỏi.
    await soundButton(page).click();
    await confirmMelody(page, (l) => l.click());
    await soundButton(page).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(soundButton(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText(BADGE)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('bàn phím: Tab tới nút + Space mở hộp cảnh báo, Esc giữ tắt, focus về nút', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await openPlayer(page);
    const btn = soundButton(page);
    // Tab tới đúng nút loa.
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      if (await btn.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(btn).toBeFocused();
    await page.keyboard.press('Space');
    const dialog = page.getByRole('dialog', { name: DIALOG });
    await expect(dialog).toBeVisible();
    await expect(page.locator('.player-countdown')).toHaveCount(0); // Space không phát bài
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(btn).toBeFocused();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    // Enter cũng bấm được; xác nhận bằng bàn phím.
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Tab'); // Hủy → Tôi hiểu, bật
    await expect(dialog.getByRole('button', { name: 'Tôi hiểu, bật' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
  });

  for (const vp of [
    { name: '844×390', width: 844, height: 390 },
    { name: '390×844', width: 390, height: 844 },
  ]) {
    test(`kiểu Mobile ${vp.name}: nút loa gọn, không chồng control; chạm → cảnh báo → bật`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        hasTouch: true,
        isMobile: true,
        serviceWorkers: 'block',
      });
      await stubClipboard(context);
      const page = await context.newPage();
      const errors = collectErrors(page);
      await presetSettings(page, { controlScheme: 'mobile' });
      await openPlayer(page);
      const btn = soundButton(page);
      await btn.scrollIntoViewIfNeeded();
      await expect(btn).toBeVisible();
      const box = await btn.boundingBox();
      expect(box && box.width <= 40 && box.height <= 40).toBe(true); // ô icon gọn
      await expectTransportNoOverlap(page);
      // Vị trí trên trang (không theo cuộn) của nút loa + chiều cao trang: bật giai điệu không làm trang nhảy (D-417).
      const where = () =>
        btn.evaluate((el) => ({
          top: Math.round(el.getBoundingClientRect().top + window.scrollY),
          page: document.documentElement.scrollHeight,
        }));
      const before = await where();
      await btn.tap();
      await confirmMelody(page, (l) => l.tap());
      await expect(btn).toHaveAttribute('aria-pressed', 'true');
      // Điện thoại: huy hiệu gọn "[🔊]" ở header, chữ đầy đủ vẫn là tên đọc + tooltip.
      const badge = page.locator('.player-header .player-chip-melody');
      await expect(badge).toBeVisible();
      await expect(badge).toContainText(BADGE);
      await expect(badge.locator('.melody-badge-icon')).toBeVisible();
      expect(await where()).toEqual(before);
      await expectTransportNoOverlap(page);
      await btn.tap();
      await expect(btn).toHaveAttribute('aria-pressed', 'false');
      expect(await where()).toEqual(before);
      expect(errors).toEqual([]);
      await context.close();
    });
  }
});

// ---------------------------------------------------------------------------
// B. Trang mini "Khớp nút game": canvas khớp Căn chỉnh, vòng "CHẠM" đáp sát mép dưới ở cột nút chế độ
// ---------------------------------------------------------------------------

const MINI_SONG = QUOC_CA.id;

/** Một khung của canvas trang mini: hình chữ nhật (ô) + arc lớn (vòng đích / vòng "CHẠM"), px CSS của trang. */
interface MiniFrame {
  t: number;
  /** Tô / xóa nền cả canvas = khung thật của renderer. */
  bg: boolean;
  rects: [x: number, y: number, w: number, h: number][];
  /** Tâm + Ø ngoài (nét cuối) theo thứ tự vẽ; `text` = có chữ "CHẠM" ngay sau. */
  arcs: { cx: number; cy: number; d: number; text: boolean }[];
}

/**
 * Ghi khung hình của `canvas.mini-canvas` (khung mới ở `setTransform(dpr, 0, 0, dpr, 0, 0)`): roundRect / rect
 * và arc r > 5 px kèm Ø ngoài của nét cuối. Bố cục 'fit' vẽ 4 vòng đích trước rồi mới tới vòng "CHẠM" (cùng
 * canvas) → arc thứ 5 trở đi của một khung là vòng "CHẠM".
 */
async function recordMiniFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type F = {
      t: number;
      bg: boolean;
      rects: [number, number, number, number][];
      arcs: { cx: number; cy: number; d: number; text: boolean; r: number; k: number }[];
    };
    const rec = { frames: [] as F[] };
    (window as unknown as { __mini: typeof rec }).__mini = rec;
    let cur: F | null = null;
    const mine = (c: CanvasRenderingContext2D): boolean =>
      c.canvas instanceof HTMLCanvasElement && c.canvas.classList.contains('mini-canvas');
    const toPage = (
      c: CanvasRenderingContext2D,
      x: number,
      y: number,
    ): [number, number, number] => {
      const el = c.canvas as HTMLCanvasElement;
      const box = el.getBoundingClientRect();
      const k = el.width > 0 ? box.width / el.width : 1;
      const m = c.getTransform();
      const p = m.transformPoint(new DOMPoint(x, y));
      return [box.left + p.x * k, box.top + p.y * k, m.a * k];
    };
    const P = CanvasRenderingContext2D.prototype;
    const lastArc = new WeakMap<CanvasRenderingContext2D, F['arcs'][number]>();
    const oSet = P.setTransform;
    P.setTransform = function (this: CanvasRenderingContext2D, ...a: unknown[]) {
      lastArc.delete(this);
      const n = a as number[];
      if (mine(this) && a.length === 6 && n[0] === n[3] && !n[1] && !n[2] && !n[4] && !n[5]) {
        cur = { t: performance.now(), bg: false, rects: [], arcs: [] };
        rec.frames.push(cur);
        if (rec.frames.length > 4000) rec.frames.shift();
      }
      return (oSet as (...x: unknown[]) => void).apply(this, a);
    } as typeof P.setTransform;
    const full = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
      const el = c.canvas as HTMLCanvasElement;
      return x === 0 && y === 0 && w >= el.clientWidth - 1 && h >= el.clientHeight - 1;
    };
    for (const name of ['fillRect', 'clearRect'] as const) {
      const orig = P[name];
      P[name] = function (
        this: CanvasRenderingContext2D,
        x: number,
        y: number,
        w: number,
        h: number,
      ) {
        if (cur && mine(this) && full(this, x, y, w, h)) cur.bg = true;
        return orig.call(this, x, y, w, h);
      };
    }
    const shape = (orig: (...x: unknown[]) => void) =>
      function (this: CanvasRenderingContext2D, ...a: unknown[]) {
        if (cur && mine(this)) {
          const [x, y, w, h] = a as number[];
          const [px, py, k] = toPage(this, x, y);
          cur.rects.push([px, py, w * k, h * k]);
        }
        return orig.apply(this, a);
      };
    if (P.roundRect) P.roundRect = shape(P.roundRect as never) as typeof P.roundRect;
    P.rect = shape(P.rect as never) as typeof P.rect;
    const oArc = P.arc;
    P.arc = function (this: CanvasRenderingContext2D, ...a: unknown[]) {
      const [x, y, r] = a as number[];
      if (cur && mine(this) && r > 5) {
        const [cx, cy, k] = toPage(this, x, y);
        const arc = { cx, cy, d: 2 * r * k, text: false, r: r * k, k };
        lastArc.set(this, arc);
        cur.arcs.push(arc);
      } else {
        lastArc.delete(this);
      }
      return (oArc as (...x: unknown[]) => void).apply(this, a);
    } as typeof P.arc;
    const oStroke = P.stroke;
    P.stroke = function (this: CanvasRenderingContext2D, ...a: unknown[]) {
      const arc = lastArc.get(this);
      if (arc) arc.d = 2 * arc.r + this.lineWidth * arc.k;
      return (oStroke as (...x: unknown[]) => void).apply(this, a);
    } as typeof P.stroke;
    const oText = P.fillText;
    P.fillText = function (this: CanvasRenderingContext2D, ...a: unknown[]) {
      const arc = lastArc.get(this);
      if (arc && a[0] === 'CHẠM') arc.text = true;
      lastArc.delete(this);
      return (oText as (...x: unknown[]) => void).apply(this, a);
    } as typeof P.fillText;
  });
}

async function miniFrames(page: Page): Promise<MiniFrame[]> {
  const frames = await page.evaluate(
    () => (window as unknown as { __mini: { frames: MiniFrame[] } }).__mini.frames,
  );
  return frames.filter((f) => f.bg).sort((a, b) => a.t - b.t);
}

/** Tâm ngang (px trang) của các phần tử khớp `selector`. */
function centersX(page: Page, selector: string): Promise<number[]> {
  return page.evaluate(
    (sel) =>
      [...document.querySelectorAll(sel)].map((el) => {
        const r = el.getBoundingClientRect();
        return r.left + r.width / 2;
      }),
    selector,
  );
}

/** Mọi ô (hình chữ nhật rộng ≈ Ø nút số = 0,69 bước) của khung thẳng tâm một trong `lanes`. */
function expectTilesOnLanes(f: MiniFrame, lanes: number[]): void {
  const step = (lanes[7] - lanes[0]) / 7;
  const tileW = 0.69 * step;
  const tiles = f.rects.filter(([, , w, h]) => w > tileW - 6 && w < tileW + 1 && h > 4);
  expect(tiles.length, 'khung không có ô nào').toBeGreaterThan(2);
  const used = new Set<number>();
  for (const [x, , w] of tiles) {
    const cx = x + w / 2;
    const lane = lanes.findIndex((l) => Math.abs(l - cx) < 1);
    expect(
      lane,
      `ô tâm ${cx.toFixed(1)} không thẳng vạch nào (${lanes.map((l) => l.toFixed(1)).join(' ')})`,
    ).toBeGreaterThanOrEqual(0);
    used.add(lane);
  }
  expect(used.size).toBeGreaterThan(1);
}

test.describe('B. trang mini "Khớp nút game" 960×300', () => {
  test.use({ viewport: { width: 960, height: 300 }, hasTouch: true, isMobile: true });

  test('kiểu Mobile: Căn chỉnh → tải lại vẫn giữ → ô thẳng vạch, vòng "CHẠM" rơi trong cột chế độ đã chỉnh và đáp sát mép dưới đúng beat', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await presetSettings(page, { controlScheme: 'mobile', language: 'vi', countIn: false });
    await recordMiniFrames(page);
    // `?delay=0` (link) = không đếm ngược: beat 0 ngay lúc bấm Bắt đầu.
    await page.goto(`/#/mini/${MINI_SONG}?delay=0`);
    const mini = page.locator('.mini');
    await expect(mini).toHaveAttribute('data-layout', 'game');
    await expect(mini).toHaveAttribute('data-phase', 'ready');

    // Căn chỉnh khác mặc định, mỗi chạm − / + = 1 px của khung (D-400; 960 px → bước lưu 0,001 bề ngang): nút 1
    // +8 px (+0,8 %), nút 1̇ −6 px, hàng chế độ dời +5 px (+0,04 cột), giãn +5 px ở Nửa Cung (102 %). Chọn số rồi
    // mới chỉnh (bảng chỉnh một số mỗi lúc — D-399).
    await page.getByRole('button', { name: 'Căn chỉnh' }).tap();
    const pick = (name: string) =>
      page.getByRole('group', { name: 'Chọn số cần chỉnh' }).getByRole('button', { name }).tap();
    const tapN = async (name: string, n: number) => {
      const b = page.getByRole('button', { name });
      for (let i = 0; i < n; i++) await b.tap();
    };
    const value = page.locator('.mini-align-value');
    await tapN('Tăng: Vạch nút 1 (trái)', 8);
    await expect(value).toHaveText('7,0 %'); // mặc định 6,25 % (cửa sổ = 8 làn — v1.0.1) + 0,8 %
    await pick('Nút 1̇');
    await tapN('Giảm: Vạch nút 1̇ (phải)', 6);
    await expect(value).toHaveText('93,2 %');
    await pick('Dời');
    await tapN('Tăng: Vòng nút chế độ: dời ngang', 5);
    await expect(value).toHaveText('+0,04 cột');
    await pick('Giãn');
    await tapN('Tăng: Vòng nút chế độ: giãn khoảng cách', 5);
    await expect(value).toHaveText('102,0 %');
    const lanes = await centersX(page, '.mini-guide');
    const modes = await centersX(page, '.mini-guide-mode');
    expect(lanes).toHaveLength(8);
    expect(modes).toHaveLength(4);
    // Số đã chỉnh: vạch 1 / vạch 1̇ ở đúng phần trăm, giữa nội suy đều; hàng chế độ theo số đo + dời / giãn.
    expect(lanes[0]).toBeCloseTo(0.0705 * 960, 0);
    expect(lanes[7]).toBeCloseTo(0.9315 * 960, 0);
    const step = (lanes[7] - lanes[0]) / 7;
    lanes.forEach((x, i) => expect(x).toBeCloseTo(lanes[0] + i * step, 0));
    [1.947, 3.182, 4.098, 5.025].forEach((m, j) =>
      expect(modes[j]).toBeCloseTo(lanes[0] + (4.098 + (m - 4.098) * 1.02 + 0.04) * step, 0),
    );
    // Hàng chế độ dời đúng ~5 px; Nửa Cung (xa tâm giãn nhất) thêm ~5 px nữa ra ngoài.
    expect(modes[2] - (lanes[0] + 4.098 * step)).toBeCloseTo(5, 0);
    await page.getByRole('button', { name: 'Xong' }).tap();

    // Tải lại: vẫn đúng số đã chỉnh (localStorage theo máy).
    await page.reload();
    await expect(mini).toHaveAttribute('data-phase', 'ready');
    await page.getByRole('button', { name: 'Căn chỉnh' }).tap();
    (await centersX(page, '.mini-guide')).forEach((x, i) => expect(x).toBeCloseTo(lanes[i], 1));
    (await centersX(page, '.mini-guide-mode')).forEach((x, j) =>
      expect(x).toBeCloseTo(modes[j], 1),
    );
    await page.getByRole('button', { name: 'Xong' }).tap();

    // Khung đứng yên trên canvas: ô thẳng vạch; đúng 4 arc = 4 vòng đích ở cột nút chế độ, sát trên mép dưới.
    const d = Math.min(0.6 * step, 0.42 * 300);
    const landY = 300 - 2 - 1 - d / 2;
    await expect.poll(async () => (await miniFrames(page)).length).toBeGreaterThan(0);
    const still = (await miniFrames(page)).at(-1)!;
    expectTilesOnLanes(still, lanes);
    expect(still.arcs).toHaveLength(4);
    // Renderer vẽ theo thứ tự màu (Cúi Xuống trước) → so theo vị trí trái → phải.
    [...still.arcs]
      .sort((a, b) => a.cx - b.cx)
      .forEach((a, j) => {
        expect(Math.abs(a.cx - modes[j]), `vòng đích ${j}`).toBeLessThan(1);
        expect(Math.abs(a.cy - landY)).toBeLessThan(1);
        expect(Math.abs(a.d - d)).toBeLessThan(1.5);
      });

    // Chạy: dòng 1 giữ chuột phải ở beat 7 (80 BPM = 5,25 s) → vòng Ngẩng Lên (nút chế độ thứ 2) rơi rồi đáp.
    const t0 = await page.evaluate(() => performance.now());
    await page.getByRole('button', { name: 'Bắt đầu' }).tap();
    await expect(mini).toHaveAttribute('data-phase', 'playing');
    const up = modes[1];
    const landedIn = (fs: MiniFrame[]) =>
      fs.find((f) =>
        f.arcs.slice(4).some((a) => Math.abs(a.cx - up) < 1 && Math.abs(a.cy - landY) < 1),
      );
    await expect
      .poll(async () => landedIn(await miniFrames(page)) !== undefined, { timeout: 12_000 })
      .toBe(true);
    await page.waitForTimeout(300);
    const frames = (await miniFrames(page)).filter((f) => f.t > t0);
    const landed = landedIn(frames)!;
    const landMs = landed.t - t0;
    expect(landMs, `vòng đáp sau ${Math.round(landMs)} ms`).toBeGreaterThan(5000);
    expect(landMs).toBeLessThan(5900);
    // Mọi vòng "CHẠM" ở một trong 4 cột chế độ đã chỉnh, đúng Ø, không bao giờ xuống dưới vị trí đáp (mép dưới
    // cửa sổ — nút thật nằm ngay dưới); vòng Ngẩng Lên đi xuống dần rồi đáp.
    const rings = frames.flatMap((f) => f.arcs.slice(4).map((a) => ({ ...a, t: f.t })));
    expect(rings.length).toBeGreaterThan(10);
    for (const r of rings) {
      expect(
        modes.some((m) => Math.abs(m - r.cx) < 1),
        `vòng ở x=${r.cx.toFixed(1)} ngoài cột chế độ`,
      ).toBe(true);
      expect(Math.abs(r.d - d)).toBeLessThan(1.5);
      expect(r.cy).toBeLessThanOrEqual(landY + 0.5);
    }
    const upRings = rings.filter((r) => Math.abs(r.cx - up) < 1 && r.t <= landed.t);
    expect(upRings.length).toBeGreaterThan(5);
    for (let i = 1; i < upRings.length; i++) {
      expect(upRings[i].cy).toBeGreaterThanOrEqual(upRings[i - 1].cy - 0.5);
    }
    expect(upRings.some((r) => r.cy < landY - d && r.text)).toBe(true); // còn xa: có chữ "CHẠM"
    // Ô lúc đang chạy cũng thẳng vạch đã chỉnh.
    expectTilesOnLanes(landed, lanes);
    expect(errors).toEqual([]);
  });

  test('kiểu PC: ô thẳng vạch Căn chỉnh (chỉ 2 thanh trượt, không vòng); "Thu nhỏ" vẫn chạy bài với game bar riêng', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await presetSettings(page, { controlScheme: 'pc', language: 'vi', countIn: false });
    await recordMiniFrames(page);
    await page.goto(`/#/mini/${MINI_SONG}?delay=0`);
    const mini = page.locator('.mini');
    // Kiểu PC chưa chọn bố cục → "Thu nhỏ" có game bar (D-402) + nút "Đổi sang Mobile"; chọn "Khớp nút game".
    await expect(mini).toHaveAttribute('data-layout', 'compact');
    await expect(page.getByRole('button', { name: 'Đổi sang Mobile' })).toBeVisible();
    await page.getByRole('button', { name: 'Khớp nút game' }).tap();
    await expect(mini).toHaveAttribute('data-layout', 'game');
    await page.getByRole('button', { name: 'Căn chỉnh' }).tap();
    await expect(
      page.getByRole('group', { name: 'Chọn số cần chỉnh' }).getByRole('button'),
    ).toHaveText(['Vạch Nút 1', 'Vạch Nút 1̇']);
    const less = page.getByRole('button', { name: 'Giảm: Vạch nút 1 (trái)' });
    for (let i = 0; i < 10; i++) await less.tap();
    const lanes = await centersX(page, '.mini-guide');
    expect(lanes[0]).toBeCloseTo(0.0525 * 960, 0);
    await expect(page.locator('.mini-guide-mode')).toHaveCount(0);
    await page.getByRole('button', { name: 'Xong' }).tap();
    await expect.poll(async () => (await miniFrames(page)).length).toBeGreaterThan(0);
    const still = (await miniFrames(page)).at(-1)!;
    expectTilesOnLanes(still, lanes);
    expect(still.arcs).toHaveLength(0);

    // "Thu nhỏ": trang mini cũ (game bar riêng), chạy / tạm dừng như trước.
    await page.getByRole('button', { name: 'Thu nhỏ' }).tap();
    await expect(mini).toHaveAttribute('data-layout', 'compact');
    await expect(page.locator('.game-bar')).toBeVisible();
    await page.getByRole('button', { name: 'Bắt đầu' }).tap();
    await expect(mini).toHaveAttribute('data-phase', 'playing');
    await page.waitForTimeout(400);
    await page.locator('.mini-tap').tap();
    await expect(mini).toHaveAttribute('data-phase', 'paused');
    await expect(page.getByRole('button', { name: 'Chạy tiếp' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Căn chỉnh' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  /**
   * Đúng tỉ lệ thật (D-405, D-406): màn = đúng cỡ ảnh game của chủ dự án (1371 × 633, ngang), cửa sổ 1001 × 300 (= 8
   * làn — v1.0.1) đặt giữa màn (mép trái ở x = 185, nửa bước ngoài tâm nút 1) → vạch / vòng trùng tâm nút thật của
   * ảnh (±1,5 px), canvas
   * vẽ ô thẳng vạch, vòng "CHẠM" đáp sát mép dưới ở cột Ngẩng Lên thật; chỉ báo "Rộng: vừa", "Cao quá" (300 + thanh
   * ~24 px của cửa sổ nổi > đỉnh nút chế độ 0,361 × 633 ≈ 228,5 — D-414) → kéo thấp còn 200 → "Cao: vừa".
   */
  test.describe('đúng tỉ lệ thật — màn 1371 × 633', () => {
    // Máy Android cảm ứng (D-412): UA Chrome Android.
    test.use({
      viewport: { width: 1001, height: 300 },
      screen: { width: 1371, height: 633 },
      userAgent:
        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    });

    test('vạch + vòng trùng nút thật, vòng "CHẠM" đáp sát mép dưới ở cột Ngẩng Lên; chỉ báo Rộng / Cao', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      const errors = collectErrors(page);
      await presetSettings(page, { controlScheme: 'mobile', language: 'vi', countIn: false });
      await recordMiniFrames(page);
      await page.goto(`/#/mini/${MINI_SONG}?delay=0`);
      const mini = page.locator('.mini');
      await expect(mini).toHaveAttribute('data-layout', 'game');
      await expect(mini).toHaveAttribute('data-scale', 'true');
      const status = page.locator('.mini-fit-status');
      await expect(status).toHaveAttribute('data-width', 'ok');
      await expect(status).toHaveAttribute('data-height', 'tall');
      await expect(status).toContainText('Rộng: vừa');
      await expect(status).toContainText('Cao quá — đang che khung kèn');

      // Tâm 8 nút số / 4 nút chế độ trên ảnh game (docs/GAME-UI-REFERENCE.md), cửa sổ đặt giữa màn.
      const left = (1371 - 1001) / 2;
      const refNotes = [247.5, 372, 497, 622, 747.5, 872.5, 998, 1123];
      const refModes = [491, 645.5, 760, 876];
      await page.getByRole('button', { name: 'Căn chỉnh', exact: true }).tap();
      const lanes = await centersX(page, '.mini-guide');
      const modes = await centersX(page, '.mini-guide-mode');
      lanes.forEach((x, i) =>
        expect(Math.abs(x + left - refNotes[i]), `nút ${i + 1}`).toBeLessThan(1.5),
      );
      modes.forEach((x, j) =>
        expect(Math.abs(x + left - refModes[j]), `chế độ ${j}`).toBeLessThan(1.5),
      );
      const step = 0.0912 * 1371;
      lanes.forEach((x, i) => expect(Math.abs(x - (500.5 + (i - 3.5) * step))).toBeLessThan(0.6));
      await page.getByRole('button', { name: 'Xong' }).tap();

      // Khung đứng yên: ô thẳng vạch, 4 vòng đích ở cột chế độ thật, sát trên mép dưới.
      const d = Math.min(0.6 * step, 0.42 * 300);
      const landY = 300 - 2 - 1 - d / 2;
      await expect.poll(async () => (await miniFrames(page)).length).toBeGreaterThan(0);
      const still = (await miniFrames(page)).at(-1)!;
      expectTilesOnLanes(still, lanes);
      expect(still.arcs).toHaveLength(4);
      [...still.arcs]
        .sort((a, b) => a.cx - b.cx)
        .forEach((a, j) => {
          expect(Math.abs(a.cx - modes[j]), `vòng đích ${j}`).toBeLessThan(1);
          expect(Math.abs(a.cy - landY)).toBeLessThan(1);
        });

      // Chạy: vòng Ngẩng Lên đáp sát mép dưới ở beat 7 (80 BPM = 5,25 s).
      const t0 = await page.evaluate(() => performance.now());
      await page.getByRole('button', { name: 'Bắt đầu' }).tap();
      await expect(mini).toHaveAttribute('data-phase', 'playing');
      const up = modes[1];
      const landedIn = (fs: MiniFrame[]) =>
        fs.find((f) =>
          f.arcs.slice(4).some((a) => Math.abs(a.cx - up) < 1 && Math.abs(a.cy - landY) < 1),
        );
      await expect
        .poll(async () => landedIn(await miniFrames(page)) !== undefined, { timeout: 12_000 })
        .toBe(true);
      const frames = (await miniFrames(page)).filter((f) => f.t > t0);
      const landed = landedIn(frames)!;
      const landMs = landed.t - t0;
      expect(landMs, `vòng đáp sau ${Math.round(landMs)} ms`).toBeGreaterThan(5000);
      expect(landMs).toBeLessThan(5900);
      for (const r of frames.flatMap((f) => f.arcs.slice(4))) {
        expect(modes.some((m) => Math.abs(m - r.cx) < 1)).toBe(true);
        expect(r.cy).toBeLessThanOrEqual(landY + 0.5);
      }
      expectTilesOnLanes(landed, lanes);
      await page.locator('.mini-tap').tap();
      await expect(mini).toHaveAttribute('data-phase', 'paused');

      // Kéo thấp cửa sổ còn 200 px (giữ cỡ màn): "Cao: vừa"; lane giữ khoảng cách thật.
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1001,
        height: 200,
        deviceScaleFactor: 1,
        mobile: true,
        screenWidth: 1371,
        screenHeight: 633,
      });
      await expect(status).toHaveAttribute('data-height', 'ok');
      await expect(status).toHaveAttribute('data-width', 'ok');
      await expect(status).toContainText('Cao: vừa');
      expect(errors).toEqual([]);
    });
  });
});
