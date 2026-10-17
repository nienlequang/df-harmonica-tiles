import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { collectErrors, readClipboard, stubClipboard } from './helpers';

/**
 * Góp ý 2026-10-16 (round 6): bài mẫu mới (Quốc ca Việt Nam = bài ở màn đầu, TAKEDISKRUSH!) đứng đầu Thư
 * viện; trang "Tạo bài với AI" (dán cảm âm → Lưu → bài trong Thư viện, phát được); ô "Dán kết quả của AI vào
 * đây" ngay trên ô soạn của Editor (dán = đổi sang phím ngay, Lưu là xong); kiểu Mobile: vòng "CHẠM" (vòng
 * R7) Ø đúng nút chế độ, rơi thẳng xuống nút đó (không còn vạch đứt ngang mọi làn), overlay OBS không vẽ bàn
 * nút — chỉ 4 vòng mờ (R7-4); đếm vào không vẽ số nào
 * (chỉ đếm ngược 3-2-1 lúc ô còn đứng yên). Chạy trên bản build, tiếng Việt.
 */

const QUOC_CA = { id: 'seed-quoc-ca-viet-nam', title: 'Quốc ca Việt Nam' } as const;
const TAKE = { id: 'seed-takediskrush', title: 'TAKEDISKRUSH!' } as const;

/** Câu trả lời kiểu AI: lời dẫn + khối code cảm âm (do1 / do2…), như prompt yêu cầu. */
const AI_ANSWER = [
  'Đây là cảm âm của bài (mình không chắc ô nhịp cuối):',
  '```text',
  '@title Bài thử AI',
  '@bpm 100',
  '',
  '# Đoạn 1',
  'do1 re1 mi1 fa1',
  'sol1*2 la1 si1 do2*2',
  '```',
  'Chúc bạn chơi vui!',
].join('\n');
const AI_NOTES = 8;

test.beforeEach(async ({ context }) => {
  await stubClipboard(context);
});

/** Cài đặt đặt trước khi app chạy (một lần mỗi tab — tải lại không ghi đè). */
async function presetSettings(page: Page, state: Record<string, unknown>): Promise<void> {
  await page.addInitScript((s) => {
    if (sessionStorage.getItem('r6-init')) return;
    sessionStorage.setItem('r6-init', '1');
    localStorage.setItem('dfht-settings', JSON.stringify({ state: s, version: 5 }));
  }, state);
}

function songCards(page: Page) {
  return page.getByRole('list', { name: 'Danh sách bài hát' }).locator(':scope > li');
}

/** Preview của Editor đã parse xong và không có lỗi (cảnh báo / ghi chú thì được). */
async function expectNoErrors(page: Page): Promise<void> {
  const preview = page.locator('.editor-preview');
  await expect(preview.getByRole('heading', { level: 3, name: 'Lỗi và cảnh báo' })).toBeVisible();
  await expect(preview.locator('.pv-diag.is-error')).toHaveCount(0);
  const summary = preview.locator('.pv-diag-summary');
  if ((await summary.count()) > 0) await expect(summary).toHaveText(/^0 lỗi · /);
  else await expect(preview.getByText('Không có lỗi hay cảnh báo.')).toBeVisible();
}

test('bài mẫu R6: màn đầu = Quốc ca Việt Nam; Thư viện: 2 bài mới đứng đầu, đều 0 lỗi', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: QUOC_CA.title })).toBeVisible();

  await page.goto('/#/library');
  const titles = await songCards(page).getByRole('heading', { level: 2 }).allTextContents();
  expect(titles.slice(0, 2)).toEqual([QUOC_CA.title, TAKE.title]);

  for (const seed of [QUOC_CA, TAKE]) {
    await page.goto(`/#/edit/${seed.id}`);
    await expect(page.getByRole('heading', { level: 1, name: `Sửa: ${seed.title}` })).toBeVisible();
    await expectNoErrors(page);
  }
  expect(errors).toEqual([]);
});

test('Tạo bài với AI: sao chép prompt → dán câu trả lời cảm âm → Lưu → bài trong Thư viện, phát được', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/#/library');
  await page.getByRole('link', { name: 'Tạo bài với AI' }).click();
  await expect(page).toHaveURL(/#\/ai$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Tạo bài với AI' })).toBeVisible();

  // Bước 1: prompt tiếng Việt (theo ngôn ngữ giao diện), AI trả lời bằng cảm âm.
  await page.getByRole('button', { name: 'Sao chép prompt' }).click();
  await expect(page.getByRole('button', { name: /Đã sao chép prompt/ })).toBeVisible();
  const prompt = await readClipboard(page);
  expect(prompt).toContain('do1');
  expect(prompt).toContain('cảm âm');

  // Bước 3: dán câu trả lời (cả lời dẫn) → chuyển ngay, tông dễ nhất, 0 lỗi; người dùng không thấy do1.
  await page.getByLabel('Dán kết quả của AI vào đây').fill(AI_ANSWER);
  const status = page.locator('.paste-status');
  await expect(status).toContainText(`${AI_NOTES} nốt`);
  await expect(status).toContainText('tông dễ chơi nhất');
  await expect(page.getByLabel('Tên bài')).toHaveValue('Bài thử AI');

  // Bước 4: Lưu = xong.
  await page.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(page.locator('.ai-saved-text')).toHaveText(/Đã lưu "Bài thử AI" vào Thư viện\./);
  await expect(page.locator('.ai-saved-text')).toBeFocused();
  await page.locator('.ai-saved').getByRole('link', { name: /Phát/ }).click();
  await expect(page).toHaveURL(/#\/play\/(?!draft-|seed-)[^/?]+$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Bài thử AI' })).toBeVisible();
  const play = page.locator('button.transport-play');
  await play.click();
  await expect(play).toHaveAttribute('data-playing', 'true');
  await play.click();

  await page.goto('/#/library');
  await expect(songCards(page).filter({ hasText: 'Bài thử AI' })).toHaveCount(1);
  // Đã là phím .harm trong Editor (không còn cảm âm).
  await songCards(page)
    .filter({ hasText: 'Bài thử AI' })
    .getByRole('link', { name: 'Sửa "Bài thử AI"' })
    .click();
  const source = page.getByLabel('Nội dung bài (.harm)');
  await expect(source).toHaveValue(/@title Bài thử AI/);
  await expect(source).not.toHaveValue(/do1|re1|sol1/);
  await expectNoErrors(page);
  expect(errors).toEqual([]);
});

test('Editor: dán kết quả AI ở ô ngay trên ô .harm → đổi sang phím ngay (Hoàn tác được); Lưu là xong', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/#/ai');
  await page.getByRole('button', { name: 'hoặc tự gõ từ đầu' }).click();
  await expect(page).toHaveURL(/#\/edit\/draft-[^/]+$/);

  // Ô dán nằm NGAY TRÊN ô soạn .harm.
  const aiBox = page.getByLabel('Dán kết quả của AI vào đây');
  const source = page.getByLabel('Nội dung bài (.harm)');
  const boxRect = await aiBox.boundingBox();
  const srcRect = await source.boundingBox();
  expect(boxRect && srcRect && boxRect.y + boxRect.height <= srcRect.y).toBe(true);
  const before = await source.inputValue();

  // Dán: lần nhập `insertFromPaste` như trình duyệt chèn chữ đã dán (clipboard của test là giả nên không dùng
  // Ctrl+V). Gõ tay sau đó KHÔNG tự thay bài (không còn cờ "vừa dán" sống sang lần gõ sau).
  await pasteInto(aiBox, AI_ANSWER);
  await expect(source).toHaveValue(/^@title Bài thử AI/);
  await expect(source).not.toHaveValue(/do1/);
  await expect(page.getByText(`Đã đưa ${AI_NOTES} nốt vào bài — bấm Lưu để lưu.`)).toBeVisible();
  await expectNoErrors(page);

  // Hoàn tác về nội dung cũ: dòng "Đã đưa …" biến mất, "Áp dụng" hiện lại; làm lại → vẫn là kết quả dán.
  await page.getByRole('button', { name: /^Hoàn tác/ }).click();
  await expect(source).toHaveValue(before);
  await expect(page.getByText(`Đã đưa ${AI_NOTES} nốt vào bài — bấm Lưu để lưu.`)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Áp dụng', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Làm lại/ }).click();
  await expect(source).toHaveValue(/^@title Bài thử AI/);
  await expect(page.getByText(`Đã đưa ${AI_NOTES} nốt vào bài — bấm Lưu để lưu.`)).toBeVisible();

  // Gõ tay vào ô dán (xóa một ký tự): chỉ xem trước, bài giữ nguyên.
  const pasted = await source.inputValue();
  await aiBox.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Backspace');
  await expect(page.getByRole('button', { name: 'Áp dụng', exact: true })).toBeVisible();
  await expect(source).toHaveValue(pasted);
  await aiBox.fill('');
  await pasteInto(aiBox, AI_ANSWER);
  await expect(source).toHaveValue(pasted);

  // Công cụ không còn "Nhập cảm âm".
  await page.getByRole('button', { name: 'Công cụ' }).click();
  await expect(page.getByRole('button', { name: /Nhập cảm âm/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Lưu (bản nháp) → bài thật trong Thư viện.
  await page.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(page.getByText('Đã lưu mọi thay đổi')).toBeVisible();
  await expect(page).toHaveURL(/#\/edit\/(?!seed-|draft-)[^/]+$/);
  await page.goto('/#/library');
  await expect(songCards(page).filter({ hasText: 'Bài thử AI' })).toHaveCount(1);
  expect(errors).toEqual([]);
});

/**
 * Dán `text` vào ô `box` như trình duyệt: đặt giá trị bằng setter gốc rồi phát `input` với inputType
 * 'insertFromPaste' (React đọc `nativeEvent.inputType`).
 */
async function pasteInto(box: ReturnType<Page['getByLabel']>, text: string): Promise<void> {
  await box.evaluate((el, value) => {
    const ta = el as HTMLTextAreaElement;
    ta.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(ta, ta.value + value);
    ta.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: value }),
    );
  }, text);
}

interface CueArc {
  /** Canvas đã vẽ (class trong danh sách ghi). */
  cls: string;
  /** Tâm + Ø ngoài của nét màu (bán kính arc + nửa nét), px CSS của trang. */
  cx: number;
  cy: number;
  d: number;
  /**
   * true = vòng "CHẠM": có chữ "CHẠM" ngay sau arc, hoặc vẽ trên lớp vòng (`.mpad-cues`), hoặc nét màu ≥ 2 px (vòng
   * đích mờ chỉ 1.5 px) — chữ mờ dần khi vòng tới gần nút và không có lúc đáp (D-390); false = vòng khác (vòng
   * đích mờ của overlay).
   */
  ring: boolean;
  /** Có chữ "CHẠM" ngay sau arc. */
  text: boolean;
  /** Tâm chữ "CHẠM" (vòng có chữ), px CSS của trang. */
  tx: number;
  ty: number;
}

/**
 * Ghi lại arc lớn (r > 5 px — không phải chấm giản phổ) của các canvas có class trong `classes` theo từng
 * khung hình: khung mới bắt đầu ở `setTransform(dpr…)` đầu `render()` của canvas đầu danh sách; arc ngay
 * trước `fillText('CHẠM')` = vòng "CHẠM" (vòng R7 — màn chơi: vẽ trên lớp `.mpad-cues` của bàn nút, nằm trên
 * nút chế độ DOM), arc không kèm chữ = vòng khác (vòng đích mờ của overlay, badge "#"). Nét màu = lần
 * `stroke()` cuối trước chữ / arc kế. Đếm luôn `setLineDash` không rỗng (vạch đứt "CHẠM: …" cũ kéo ngang mọi
 * làn) và ghi mọi chữ đã vẽ (`texts`).
 */
async function recordCueRings(
  page: Page,
  classes: string[] = ['player-canvas', 'mpad-cues'],
): Promise<void> {
  await page.addInitScript((list) => {
    type Raw = {
      cls: string;
      x: number;
      y: number;
      r: number;
      lw: number;
      m: DOMMatrix;
      ring: boolean;
      tx: number;
      ty: number;
    };
    const w = window as unknown as {
      __r6: { frames: Raw[][]; dashes: number; texts: string[] };
    };
    w.__r6 = { frames: [], dashes: 0, texts: [] };
    const clsOf = (c: CanvasRenderingContext2D): string | null => {
      const el = c.canvas;
      return el instanceof HTMLCanvasElement
        ? (list.find((k) => el.classList.contains(k)) ?? null)
        : null;
    };
    const last = new WeakMap<CanvasRenderingContext2D, Raw>();
    const proto = CanvasRenderingContext2D.prototype;
    const setTransform = proto.setTransform;
    proto.setTransform = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      last.delete(this);
      if (clsOf(this) === list[0] && args.length === 6) w.__r6.frames.push([]);
      return (setTransform as (...a: unknown[]) => void).apply(this, args);
    } as typeof proto.setTransform;
    const arc = proto.arc;
    proto.arc = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      const cls = clsOf(this);
      const [x, y, r] = args as number[];
      if (cls && r > 5) {
        const raw: Raw = {
          cls,
          x,
          y,
          r,
          lw: this.lineWidth,
          m: this.getTransform(),
          ring: false,
          tx: 0,
          ty: 0,
        };
        last.set(this, raw);
        w.__r6.frames[w.__r6.frames.length - 1]?.push(raw);
      } else {
        last.delete(this);
      }
      return (arc as (...a: unknown[]) => void).apply(this, args);
    } as typeof proto.arc;
    const stroke = proto.stroke;
    proto.stroke = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      const raw = last.get(this);
      if (raw) raw.lw = this.lineWidth;
      return (stroke as (...a: unknown[]) => void).apply(this, args);
    } as typeof proto.stroke;
    const fillText = proto.fillText;
    proto.fillText = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      if (clsOf(this) && w.__r6.texts.length < 20_000) w.__r6.texts.push(String(args[0]));
      const raw = last.get(this);
      if (raw && args[0] === 'CHẠM') {
        raw.ring = true;
        raw.tx = Number(args[1]);
        raw.ty = Number(args[2]);
      }
      last.delete(this);
      return (fillText as (...a: unknown[]) => void).apply(this, args);
    } as typeof proto.fillText;
    const setLineDash = proto.setLineDash;
    proto.setLineDash = function (this: CanvasRenderingContext2D, segments: number[]) {
      if (clsOf(this) && segments.length > 0) w.__r6.dashes++;
      return setLineDash.call(this, segments);
    };
  }, classes);
}

/** Mọi chữ canvas đã vẽ từ đầu (recordCueRings). */
async function canvasTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __r6: { texts: string[] } }).__r6.texts);
}

/** Arc lớn của khung hình cuối có vòng "CHẠM", đổi sang px CSS của trang. */
async function lastCueArcs(page: Page): Promise<{ arcs: CueArc[]; dashes: number }> {
  return page.evaluate(() => {
    type Raw = {
      cls: string;
      x: number;
      y: number;
      r: number;
      lw: number;
      m: DOMMatrix;
      ring: boolean;
      tx: number;
      ty: number;
    };
    const w = window as unknown as { __r6: { frames: Raw[][]; dashes: number } };
    // Khung cuối có vòng "CHẠM" (kèm chữ, trên lớp vòng, hoặc nét màu ≥ 2 px — vòng nhỏ không có chữ, D-390).
    const isRing = (a: Raw): boolean => a.ring || a.cls === 'mpad-cues' || a.lw >= 2;
    const frame = [...w.__r6.frames].reverse().find((f) => f.some(isRing)) ?? [];
    const arcs = frame.map((a) => {
      const canvas = document.querySelector(`canvas.${a.cls}`) as HTMLCanvasElement;
      const box = canvas.getBoundingClientRect();
      // backing store (device px) → px CSS
      const k = box.width / canvas.width;
      const c = a.m.transformPoint(new DOMPoint(a.x, a.y));
      const t = a.m.transformPoint(new DOMPoint(a.tx, a.ty));
      return {
        cls: a.cls,
        cx: box.left + c.x * k,
        cy: box.top + c.y * k,
        d: (2 * a.r + a.lw) * a.m.a * k,
        ring: isRing(a),
        text: a.ring,
        tx: box.left + t.x * k,
        ty: box.top + t.y * k,
      };
    });
    return { arcs, dashes: w.__r6.dashes };
  });
}

/** Nút chế độ (hình tròn) của bàn nút kiểu game đang hiện. */
async function modeCircles(page: Page): Promise<{ cx: number; cy: number; d: number }[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.mpad-mode-circle')].map((el) => {
      const r = el.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, d: r.width };
    }),
  );
}

/**
 * Mọi vòng "CHẠM" thẳng tâm + Ø đúng một nút chế độ (`targets`), chữ (nếu còn — D-390) ở tâm vòng, tâm vòng không
 * thấp hơn tâm nút (đang rơi xuống, hoặc đang đáp đồng tâm). Trả số vòng còn đang rơi (tâm phía trên tâm nút).
 */
function expectRingsOnTargets(
  rings: CueArc[],
  targets: { cx: number; cy: number; d: number }[],
): number {
  expect(rings.length).toBeGreaterThan(0);
  let falling = 0;
  for (const ring of rings) {
    const target = targets.find((c) => Math.abs(c.cx - ring.cx) < 1.5);
    expect(target, `vòng ở x=${ring.cx.toFixed(1)} không thẳng tâm nút chế độ nào`).toBeTruthy();
    expect(Math.abs(ring.d - target!.d), `Ø vòng ${ring.d.toFixed(1)} ≠ Ø nút`).toBeLessThan(1.5);
    if (ring.text) {
      expect(Math.abs(ring.tx - ring.cx)).toBeLessThan(1);
      expect(Math.abs(ring.ty - ring.cy)).toBeLessThan(1.5);
    } else {
      // Không chữ chỉ khi vòng đã tới gần nút (≤ 1 Ø — chữ mờ dần trước khi đáp).
      expect(target!.cy - ring.cy).toBeLessThanOrEqual(target!.d + 1);
    }
    expect(ring.cy).toBeLessThanOrEqual(target!.cy + 1);
    if (ring.cy < target!.cy - 1) falling++;
  }
  return falling;
}

test.describe('overlay OBS kiểu Mobile (Xem trước 1280×720)', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  for (const { name, query } of [
    {
      name: 'khớp bảng phím game, cả canvas (link Xem trước)',
      query: 'layout=game&fit=canvas&scheme=mobile&preview=1',
    },
    { name: 'cả cột có game bar', query: 'layout=full&scheme=mobile' },
  ]) {
    test(`${name}: không bàn nút (R7-4) — chỉ 4 vòng mờ ở hàng nút chế độ, vòng "CHẠM" rơi vào đúng vòng đó; không nhãn "CHẠM: <chế độ>"`, async ({
      page,
    }) => {
      const errors = collectErrors(page);
      await recordCueRings(page, ['overlay-canvas']);
      // Không có màn chơi nào mở → ~2 s sau overlay tự chạy bài trong link (không đếm ngược / đếm vào).
      await page.goto(`/#/overlay/${QUOC_CA.id}?${query}`);
      await expect(page.locator('.overlay')).toHaveAttribute('data-scheme', 'mobile');
      // Không bàn nút DOM nào (không nút số, không nút chế độ), không game bar.
      await expect(page.locator('.overlay .mpad, .mpad-digit, .mpad-mode')).toHaveCount(0);
      await expect(page.locator('.overlay .game-bar')).toHaveCount(0);
      // Kiểu Mobile: Xem trước không phác keycap PC Z X C….
      await expect(page.locator('.overlay-preview-key')).toHaveCount(0);
      await expect
        .poll(async () => (await lastCueArcs(page)).arcs.some((a) => a.ring), { timeout: 15_000 })
        .toBe(true);
      const { arcs, dashes } = await lastCueArcs(page);
      expect(dashes).toBe(0);
      const rings = arcs.filter((a) => a.ring);
      // Vòng đích mờ: arc không chữ cùng Ø với vòng "CHẠM" — đúng 4 vòng (4 nút chế độ), cùng một hàng.
      const targets = arcs.filter((a) => !a.ring && Math.abs(a.d - rings[0].d) < 1.5);
      const xs = [...new Set(targets.map((a) => Math.round(a.cx)))];
      expect(xs).toHaveLength(4);
      expect(
        Math.max(...targets.map((a) => a.cy)) - Math.min(...targets.map((a) => a.cy)),
      ).toBeLessThan(1);
      expectRingsOnTargets(rings, targets);
      const texts = await canvasTexts(page);
      expect(texts).toContain('CHẠM');
      expect(texts.filter((t) => t.startsWith('CHẠM:') || /Ngẩng|Cúi|Nửa/.test(t))).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('kiểu Mobile trên điện thoại ngang 844×390', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  test('vòng "CHẠM" trong suốt, Ø đúng nút chế độ, rơi thẳng xuống tâm nút (trên lớp của bàn nút); không vạch đứt ngang các làn', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await presetSettings(page, {
      controlScheme: 'mobile',
      language: 'vi',
      countIn: false,
      startDelaySec: 0,
    });
    await recordCueRings(page);
    // Dòng 4 (index 3) của Quốc ca: đang Ngẩng Lên (giữ từ dòng trước) → nhả sau 3 beat = chạm Ngẩng Tự
    // Nhiên — vòng (nhanh gấp 1.75 lần tile) đã vào khung ở frame đang dừng.
    await page.goto(`/#/play/${QUOC_CA.id}?line=3`);
    const pad = page.getByRole('group', { name: 'Gợi ý phím như trong game' });
    await expect(pad).toHaveAttribute('data-scheme', 'mobile');
    await expect.poll(async () => (await lastCueArcs(page)).arcs.some((a) => a.ring)).toBe(true);

    const circles = await modeCircles(page);
    expect(circles).toHaveLength(4);
    const { arcs, dashes } = await lastCueArcs(page);
    expect(dashes).toBe(0);
    const rings = arcs.filter((a) => a.ring);
    // Vòng vẽ trên lớp `.mpad-cues` (trên nút chế độ DOM), không trên canvas làn.
    for (const ring of rings) expect(ring.cls).toBe('mpad-cues');
    // Có vòng chưa tới nút (đang rơi), tâm phía trên tâm nút.
    expect(expectRingsOnTargets(rings, circles)).toBeGreaterThan(0);
    // Renderer không tự vẽ vòng đích (bàn nút DOM vẽ nút chế độ).
    expect(
      arcs.filter(
        (a) =>
          !a.ring &&
          circles.some((c) => Math.abs(c.cx - a.cx) < 1.5 && Math.abs(c.cy - a.cy) < 1.5),
      ),
    ).toEqual([]);

    // Phát một đoạn: vòng vẫn thẳng nút, vẫn không vạch đứt nào.
    const play = page.locator('button.transport-play');
    await play.tap();
    await expect(play).toHaveAttribute('data-playing', 'true');
    await page.waitForTimeout(1500);
    await play.tap();
    const after = await lastCueArcs(page);
    expect(after.dashes).toBe(0);
    expectRingsOnTargets(
      after.arcs.filter((a) => a.ring),
      circles,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      844,
    );
    expect(errors).toEqual([]);
  });
});

test('Phát: đếm ngược 3-2-1 lúc ô đứng yên; đếm vào (ô rơi dẫn vào) không vẽ số nào trên canvas', async ({
  page,
}) => {
  const errors = collectErrors(page);
  // Mặc định: đếm ngược 3 s + đếm vào, kiểu PC (nhãn ô là chữ phím, không số).
  await page.addInitScript(() => {
    const w = window as unknown as { __r6texts: string[] | null };
    w.__r6texts = null;
    const proto = CanvasRenderingContext2D.prototype;
    const fillText = proto.fillText;
    proto.fillText = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      if (w.__r6texts && this.canvas instanceof HTMLCanvasElement) {
        if (this.canvas.classList.contains('player-canvas')) w.__r6texts.push(String(args[0]));
      }
      return (fillText as (...a: unknown[]) => void).apply(this, args);
    } as typeof proto.fillText;
  });
  await page.goto(`/#/play/${QUOC_CA.id}`);
  const play = page.locator('button.transport-play');
  await play.click();
  const num = page.locator('.player-countdown-num');
  await expect(num).toHaveText('3');
  await expect(num).toHaveText('1', { timeout: 3_000 });
  await expect(num).toHaveCount(0, { timeout: 2_000 });
  // 80 BPM: đếm vào 1,64 beat (~1,2 s, src/player/leadIn.ts) + khoảng lặng 2,75 beat trước nốt đầu — ghi chữ canvas
  // vẽ trong 1.5 s đầu.
  await page.evaluate(() => {
    (window as unknown as { __r6texts: string[] }).__r6texts = [];
  });
  await page.waitForTimeout(1500);
  const texts = await page.evaluate(() => (window as unknown as { __r6texts: string[] }).__r6texts);
  await play.click();
  expect(texts.length).toBeGreaterThan(0);
  expect(texts.filter((s) => /^\s*\d+\s*$/.test(s))).toEqual([]);
  await expect(page.locator('.player-countdown')).toHaveCount(0);
  expect(errors).toEqual([]);
});
