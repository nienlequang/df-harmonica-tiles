import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { collectErrors, stubClipboard } from './helpers';

/**
 * Góp ý vòng 7 (2026-10-16) + chuẩn bị deploy, chạy trên bản build, tiếng Việt:
 * - Thư viện chỉ còn 2 bài mẫu (Quốc ca Việt Nam, TAKEDISKRUSH!) — hai bài mẫu cũ đã bỏ (P1).
 * - Kiểu Mobile: vòng "CHẠM" trong suốt Ø đúng nút chế độ, rơi nhanh gấp ~1.75 lần ô, đồng tâm với nút
 *   đúng lúc phải chạm; không còn thanh "CHẠM" ngắn của vòng 6 (R7-1).
 * - Đếm ngược → đếm vào: suốt lúc đếm ngược ô đứng yên ở frame đầu của đếm vào, hết đếm ô chỉ việc rơi xuống
 *   — không nhảy lùi một ô nhịp, không ô nào biến mất (R7-3) — ở màn chơi và trang mini.
 * - Trang mini: Cài đặt → Đếm ngược = Tắt vẫn đếm 3 giây; Cài đặt có dòng giải thích (R7-5).
 * - "Dev notes" (#/dev): link nhỏ ở chân trang Hướng dẫn và Cài đặt → phiên bản + REFERENCE + CHANGELOG (R7-8).
 */

const QUOC_CA = { id: 'seed-quoc-ca-viet-nam', title: 'Quốc ca Việt Nam' } as const;
const TAKE = { id: 'seed-takediskrush', title: 'TAKEDISKRUSH!' } as const;
/**
 * Ms từ lúc hết đếm ngược tới lúc nốt đầu chạm vạch — đếm vào v1.0.1: nốt đầu đi 0,65 × (1 ô nhịp + khoảng lặng trước
 * nó), src/player/leadIn.ts. TAKEDISKRUSH (122 BPM, nốt đầu ở beat 0): 2,6 beat ≈ 1279 ms; Quốc ca (80 BPM, beat 2,75):
 * 4,3875 beat ≈ 3291 ms.
 */
const FIRST_HIT_MS: Record<string, number> = {
  [TAKE.id]: ((0.65 * 4 * 60) / 122) * 1000,
  [QUOC_CA.id]: ((0.65 * (4 + 2.75) * 60) / 80) * 1000,
};
/**
 * Đoạn kiểm "đếm vào chỉ rơi xuống" sau khi hết đếm ngược: tối đa 1,5 s và dừng trước lúc nốt đầu chạm vạch (lúc đó ô
 * sáng lên — ô đang chạm không vẽ viền trong / highlight, khác hình chứ không phải nhảy).
 */
const leadWindowMs = (id: string): number => Math.min(1500, FIRST_HIT_MS[id] - 150);
const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
  repository: { url: string };
};
const PKG_VERSION = PKG.version;
/** Kho mã nguồn công khai (D-444) = `repository` của package.json, bỏ `git+` / `.git`. */
const SOURCE_URL = PKG.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');

test.beforeEach(async ({ context }) => {
  await stubClipboard(context);
});

/** Cài đặt đặt trước khi app chạy (một lần mỗi tab — tải lại không ghi đè). */
async function presetSettings(page: Page, state: Record<string, unknown>): Promise<void> {
  await page.addInitScript((s) => {
    if (sessionStorage.getItem('r7-init')) return;
    sessionStorage.setItem('r7-init', '1');
    localStorage.setItem('dfht-settings', JSON.stringify({ state: s, version: 5 }));
  }, state);
}

// ---------------------------------------------------------------------------
// Ghi khung hình canvas
// ---------------------------------------------------------------------------

/** Một hình chữ nhật (ô / viên thuốc), px CSS của trang. */
type Rect = [x: number, y: number, w: number, h: number];

interface Arc {
  cls: string;
  /** Tâm + Ø ngoài của nét màu, px CSS của trang. */
  cx: number;
  cy: number;
  d: number;
  /**
   * true = vòng "CHẠM": arc trên lớp vòng (`.mpad-cues`), hoặc arc có chữ "CHẠM" ngay sau. Chữ mờ dần khi vòng tới
   * gần nút và không có lúc đáp (D-390) → vòng đã đáp chỉ nhận ra được nhờ lớp vẽ.
   */
  ring: boolean;
  /** Có chữ "CHẠM" ngay sau arc. */
  text: boolean;
  /** Tâm chữ "CHẠM" (vòng có chữ), px CSS của trang. */
  tx: number;
  ty: number;
}

interface Frame {
  /** performance.now() lúc bắt đầu khung. */
  t: number;
  /** Có tô / xóa nền cả canvas (= khung thật của renderer, không phải hình làm nóng glow). */
  bg: boolean;
  /** Kích thước CSS của canvas chính. */
  w: number;
  h: number;
  /** Hình chữ nhật (roundRect / rect) trên canvas chính. */
  r: Rect[];
  /** Vạch ngang (vạch nhịp / ô nhịp, hit line): y, px CSS của trang. */
  l: number[];
  arcs: Arc[];
}

interface Recording {
  frames: Frame[];
  /** [thời điểm, số đếm ngược đang hiện | null = hết] */
  marks: [number, string | null][];
  /** Hình chữ nhật vẽ trên lớp vòng "CHẠM" (.mpad-cues) — vòng 6 vẽ thanh ở đó; vòng 7 chỉ có arc + chữ. */
  layerRects: number;
  /** Chữ "CHẠM" không đi kèm arc (thanh "CHẠM" của vòng 6). */
  bareTap: number;
  /** setLineDash không rỗng (vạch đứt "CHẠM: …" cũ). */
  dashes: number;
}

/**
 * Ghi mọi khung hình của canvas `classes[0]` (khung mới ở `setTransform(dpr, 0, 0, dpr, 0, 0)`; `bg` khi tô /
 * xóa nền cả canvas): hình chữ nhật của canvas đó (ô), arc lớn (r > 5 px) của mọi canvas trong `classes`
 * (vòng "CHẠM" = arc ngay trước `fillText('CHẠM')`), mốc đếm ngược ('.…-countdown-num'). Toạ độ đổi sang px CSS
 * của trang ngay lúc vẽ.
 */
async function recordFrames(page: Page, classes: string[]): Promise<void> {
  await page.addInitScript((list) => {
    type R = [number, number, number, number];
    type A = {
      cls: string;
      cx: number;
      cy: number;
      d: number;
      ring: boolean;
      text: boolean;
      tx: number;
      ty: number;
    };
    type F = { t: number; bg: boolean; w: number; h: number; r: R[]; l: number[]; arcs: A[] };
    const rec = {
      frames: [] as F[],
      marks: [] as [number, string | null][],
      layerRects: 0,
      bareTap: 0,
      dashes: 0,
    };
    (window as unknown as { __r7: typeof rec }).__r7 = rec;
    let cur: F | null = null;
    const clsOf = (c: CanvasRenderingContext2D): string | null => {
      const el = c.canvas;
      return el instanceof HTMLCanvasElement
        ? (list.find((k) => el.classList.contains(k)) ?? null)
        : null;
    };
    /** Điểm (x, y) của ctx → px CSS của trang. */
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
      // Toạ độ của TÀI LIỆU (cộng cuộn trang): chạm nút có thể cuộn trang giữa chừng.
      return [box.left + window.scrollX + p.x * k, box.top + window.scrollY + p.y * k, m.a * k];
    };
    const P = CanvasRenderingContext2D.prototype;
    const lastArc = new WeakMap<CanvasRenderingContext2D, A & { r: number; k: number }>();
    const oSet = P.setTransform;
    P.setTransform = function (this: CanvasRenderingContext2D, ...a: unknown[]) {
      lastArc.delete(this);
      const n = a as number[];
      if (
        a.length === 6 &&
        clsOf(this) === list[0] &&
        n[1] === 0 &&
        n[2] === 0 &&
        n[4] === 0 &&
        n[5] === 0 &&
        n[0] === n[3]
      ) {
        const el = this.canvas as HTMLCanvasElement;
        cur = {
          t: performance.now(),
          bg: false,
          w: el.clientWidth,
          h: el.clientHeight,
          r: [],
          l: [],
          arcs: [],
        };
        rec.frames.push(cur);
        if (rec.frames.length > 6000) rec.frames.shift();
      }
      return (oSet as (...x: unknown[]) => void).apply(this, a);
    } as typeof P.setTransform;
    const full = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
      const el = c.canvas as HTMLCanvasElement;
      return x === 0 && y === 0 && w >= el.clientWidth - 1 && h >= el.clientHeight - 1;
    };
    const oFill = P.fillRect;
    P.fillRect = function (
      this: CanvasRenderingContext2D,
      x: number,
      y: number,
      w: number,
      h: number,
    ) {
      const cls = clsOf(this);
      if (cur && cls === list[0] && full(this, x, y, w, h)) cur.bg = true;
      else if (cls && cls !== list[0]) rec.layerRects++;
      return oFill.call(this, x, y, w, h);
    };
    const oClear = P.clearRect;
    P.clearRect = function (
      this: CanvasRenderingContext2D,
      x: number,
      y: number,
      w: number,
      h: number,
    ) {
      if (cur && clsOf(this) === list[0] && full(this, x, y, w, h)) cur.bg = true;
      return oClear.call(this, x, y, w, h);
    };
    const shape = (orig: (...x: unknown[]) => void) =>
      function (this: CanvasRenderingContext2D, ...a: unknown[]) {
        const cls = clsOf(this);
        if (cls === list[0] && cur) {
          const [x, y, w, h] = a as number[];
          const [px, py, k] = toPage(this, x, y);
          cur.r.push([px, py, w * k, h * k]);
        } else if (cls) {
          rec.layerRects++;
        }
        return orig.apply(this, a);
      };
    if (P.roundRect) P.roundRect = shape(P.roundRect as never) as typeof P.roundRect;
    P.rect = shape(P.rect as never) as typeof P.rect;
    // Vạch ngang dài (> 40 px) của canvas chính: moveTo rồi lineTo cùng y.
    let move: [number, number] | null = null;
    const oMove = P.moveTo;
    P.moveTo = function (this: CanvasRenderingContext2D, x: number, y: number) {
      move = clsOf(this) === list[0] ? [x, y] : null;
      return oMove.call(this, x, y);
    };
    const oLine = P.lineTo;
    P.lineTo = function (this: CanvasRenderingContext2D, x: number, y: number) {
      if (cur && move && clsOf(this) === list[0]) {
        if (Math.abs(move[1] - y) < 0.01 && Math.abs(move[0] - x) > 40) {
          cur.l.push(toPage(this, x, y)[1]);
        }
        move = null;
      }
      return oLine.call(this, x, y);
    };
    const oArc = P.arc;
    P.arc = function (this: CanvasRenderingContext2D, ...a: unknown[]) {
      const cls = clsOf(this);
      const [x, y, r] = a as number[];
      if (cls && cur && r > 5) {
        const [cx, cy, k] = toPage(this, x, y);
        // Lớp vòng (canvas khác canvas chính) chỉ vẽ vòng "CHẠM".
        const ring = cls !== list[0];
        const arc = { cls, cx, cy, d: 2 * r * k, ring, text: false, tx: 0, ty: 0, r: r * k, k };
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
      // Ø ngoài = 2r + nét (nét cuối = nét màu).
      if (arc) arc.d = 2 * arc.r + this.lineWidth * arc.k;
      return (oStroke as (...x: unknown[]) => void).apply(this, a);
    } as typeof P.stroke;
    const oFillText = P.fillText;
    P.fillText = function (this: CanvasRenderingContext2D, ...a: unknown[]) {
      if (clsOf(this) && a[0] === 'CHẠM') {
        const arc = lastArc.get(this);
        if (arc) {
          const [tx, ty] = toPage(this, Number(a[1]), Number(a[2]));
          arc.ring = true;
          arc.text = true;
          arc.tx = tx;
          arc.ty = ty;
        } else {
          rec.bareTap++;
        }
      }
      lastArc.delete(this);
      return (oFillText as (...x: unknown[]) => void).apply(this, a);
    } as typeof P.fillText;
    const oDash = P.setLineDash;
    P.setLineDash = function (this: CanvasRenderingContext2D, seg: number[]) {
      if (clsOf(this) && seg.length > 0) rec.dashes++;
      return oDash.call(this, seg);
    };
    // Mốc đếm ngược (số to của màn chơi / trang mini).
    let had: string | null | undefined;
    const check = () => {
      const el = document.querySelector('.player-countdown-num, .mini-countdown-num');
      const txt = el ? el.textContent : null;
      if (txt !== had) {
        rec.marks.push([performance.now(), txt]);
        had = txt;
      }
    };
    new MutationObserver(check).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }, classes);
}

async function recording(page: Page): Promise<Recording> {
  return page.evaluate(() => (window as unknown as { __r7: Recording }).__r7);
}

async function resetFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __r7: Recording }).__r7.frames.length = 0;
  });
}

/** Ô trong khung (lọc nền / dải lớn): cao ≥ 3, rộng 4…¼ canvas, còn thấy trong khung. */
function tilesOf(f: Frame, box: { top: number; left: number }): Rect[] {
  return f.r.filter(
    ([, y, w, h]) => h >= 3 && w >= 4 && w <= f.w / 4 && y + h > box.top && y < box.top + f.h,
  );
}

const sameTile = (a: Rect, b: Rect): boolean =>
  Math.abs(a[0] - b[0]) < 0.6 && Math.abs(a[2] - b[2]) < 0.6 && Math.abs(a[3] - b[3]) < 0.6;

/** Chữ ký vị trí các ô của một khung (làm tròn ½ px). */
function tileKey(f: Frame, box: { top: number; left: number }): string {
  return JSON.stringify(
    tilesOf(f, box)
      .map((r) => r.map((v) => Math.round(v * 2) / 2))
      .sort(),
  );
}

/** Quãng một ô được phép dời giữa hai khung cách nhau `gapMs` lúc trượt (đỉnh smoothstep ≈ 1.8 px/ms ở 1366 px). */
const glideStep = (gapMs: number): number => 60 + 2.5 * gapMs;

/**
 * Trượt về khung pre-roll lúc bấm Phát (D-389, R7-3 sau review): khung ĐẦU sau khi bấm = khung đứng yên (không
 * nhảy lên một ô nhịp); sau đó mỗi khung ô chỉ dời LÊN theo bước hợp lý, ô chỉ biến mất qua mép trên.
 */
function expectGlideFromIdle(
  frames: Frame[],
  box: { top: number; left: number },
  pressAt: number,
  until: number,
): void {
  const idle = [...frames].reverse().find((f) => f.t < pressAt);
  expect(idle, 'không có khung đứng yên trước khi bấm').toBeDefined();
  const glide = frames.filter((f) => f.t >= pressAt && f.t < until);
  expect(glide.length, 'không có khung nào sau khi bấm').toBeGreaterThan(0);
  expect(tileKey(glide[0], box), 'khung đầu sau khi bấm phải đúng khung đứng yên').toBe(
    tileKey(idle!, box),
  );
  const top = box.top + 1;
  const seq = [idle!, ...glide];
  for (let i = 1; i < seq.length; i++) {
    const a = tilesOf(seq[i - 1], box);
    const b = tilesOf(seq[i], box);
    const step = glideStep(seq[i].t - seq[i - 1].t);
    const at = Math.round(seq[i].t - pressAt);
    for (const q of a) {
      const m = b.find((r) => sameTile(q, r) && r[1] - q[1] <= 0.6 && q[1] - r[1] <= step);
      if (!m) {
        expect(
          q[1] + q[3] - step,
          `+${at} ms: ô ở y=${q[1].toFixed(1)} biến mất giữa khung lúc trượt`,
        ).toBeLessThanOrEqual(top);
      }
    }
  }
}

/**
 * Đếm ngược → đếm vào không nhảy (R7-3): bấm Phát → trượt mượt về khung pre-roll (expectGlideFromIdle), rồi ô
 * đứng yên tới hết đếm ngược (không khung nào khác khung pre-roll); từ khung cuối của đếm ngược tới `windowMs` sau
 * đó, mọi ô của khung trước còn ở khung sau và chỉ dời XUỐNG (0…80 px), ô mới chỉ vào từ mép trên; có chuyển
 * động. Trả số ô của khung pre-roll.
 */
function expectNoBackwardJump(
  rec: Recording,
  box: { top: number; left: number },
  pressAt: number,
  windowMs: number,
): { countdownTiles: number; firstMotionMs: number } {
  const start = rec.marks.find((m) => m[1] !== null)?.[0];
  const end = rec.marks.find((m) => m[1] === null && start !== undefined && m[0] > start)?.[0];
  expect(start, 'không thấy số đếm ngược').toBeDefined();
  expect(end, 'đếm ngược không kết thúc').toBeDefined();
  const frames = rec.frames.filter((f) => f.bg).sort((a, b) => a.t - b.t);
  // Khung sát lúc hết đếm (±100 ms) thuộc về đoạn chuyển sang đếm vào — kiểm ở dưới (chỉ rơi xuống).
  const cdEnd = end! - 100;
  expectGlideFromIdle(frames, box, pressAt, cdEnd);
  const cd = frames.filter((f) => f.t >= pressAt && f.t < cdEnd);
  const settled = cd[cd.length - 1];
  // Hết trượt (≤ 1 s kể cả máy chậm): đứng yên ở khung pre-roll tới hết đếm ngược.
  for (const f of cd.filter((x) => x.t >= cd[0].t + 1000)) {
    expect(tileKey(f, box), 'ô phải đứng yên suốt lúc đếm ngược').toBe(tileKey(settled, box));
  }
  const seq = [settled, ...frames.filter((f) => f.t > settled.t && f.t <= end! + windowMs)];
  expect(seq.length).toBeGreaterThan(10);
  const top = box.top + 1;
  let firstMotion = -1;
  for (let i = 1; i < seq.length; i++) {
    const a = tilesOf(seq[i - 1], box);
    const b = tilesOf(seq[i], box);
    const at = Math.round(seq[i].t - end!);
    const gap = Math.round(seq[i].t - seq[i - 1].t);
    // Bước xuống tối đa giữa hai khung: 80 px, hoặc hơn khi khung bị trễ (máy bận — ô ≤ ~0.4 px / ms).
    const down = Math.max(80, 0.6 * gap);
    for (const q of a) {
      if (q[1] <= top) continue; // đang vào ở mép trên (có thể bị cắt)
      const m = b.find((r) => sameTile(q, r) && r[1] - q[1] >= -0.6 && r[1] - q[1] <= down);
      expect(
        m,
        `+${at} ms (khung cách ${gap} ms): ô ở y=${q[1].toFixed(1)} biến mất / nhảy lùi (khung trước ${a.length} ô, khung sau ${b.length} ô)`,
      ).toBeTruthy();
    }
    for (const r of b) {
      const m = a.find((q) => sameTile(q, r) && r[1] - q[1] >= -0.6 && r[1] - q[1] <= down);
      if (!m) {
        // Ô mới chỉ vào từ mép trên (khung trễ: đã kịp rơi thêm tối đa `down - 80` px).
        expect(
          r[1],
          `+${at} ms (khung cách ${gap} ms): ô hiện giữa chừng ở y=${r[1].toFixed(1)}`,
        ).toBeLessThanOrEqual(top + down - 80);
      } else if (r[1] - m[1] > 0.05 && firstMotion < 0) {
        firstMotion = at;
      }
    }
    // Vạch nhịp cũng chỉ dời xuống (bài như Quốc ca: khung đếm vào chưa có ô nào, chỉ có vạch).
    const la = seq[i - 1].l;
    for (const y of seq[i].l) {
      if (firstMotion < 0 && la.some((q) => y - q > 0.05 && y - q <= 40)) {
        if (!la.some((q) => Math.abs(y - q) < 0.05)) firstMotion = at;
      }
    }
  }
  expect(firstMotion, 'ô không rơi sau khi hết đếm ngược').toBeGreaterThanOrEqual(0);
  return { countdownTiles: tilesOf(settled, box).length, firstMotionMs: firstMotion };
}

/**
 * Đếm ngược = Tắt mà đếm vào bật (R7C-1): khung đầu sau khi bấm = khung đứng yên; trong `windowMs` sau đó mỗi ô
 * chỉ dời theo bước hợp lý (lùi mượt rồi rơi), không ô nào biến mất / hiện ra giữa khung (chỉ qua mép trên);
 * cuối cửa sổ ô đang rơi xuống.
 */
function expectSmoothStart(
  rec: Recording,
  box: { top: number; left: number },
  pressAt: number,
  windowMs: number,
): void {
  const frames = rec.frames.filter((f) => f.bg).sort((a, b) => a.t - b.t);
  const idle = [...frames].reverse().find((f) => f.t < pressAt);
  expect(idle, 'không có khung đứng yên trước khi bấm').toBeDefined();
  const after = frames.filter((f) => f.t >= pressAt && f.t <= pressAt + windowMs);
  expect(after.length).toBeGreaterThan(10);
  expect(tileKey(after[0], box), 'khung đầu sau khi bấm phải đúng khung đứng yên').toBe(
    tileKey(idle!, box),
  );
  const top = box.top + 1;
  const seq = [idle!, ...after];
  let down = 0;
  for (let i = 1; i < seq.length; i++) {
    const a = tilesOf(seq[i - 1], box);
    const b = tilesOf(seq[i], box);
    const step = glideStep(seq[i].t - seq[i - 1].t);
    const at = Math.round(seq[i].t - pressAt);
    for (const q of a) {
      const m = b.find((r) => sameTile(q, r) && Math.abs(r[1] - q[1]) <= step);
      if (!m) {
        expect(
          q[1] + q[3] - step,
          `+${at} ms: ô ở y=${q[1].toFixed(1)} biến mất giữa khung`,
        ).toBeLessThanOrEqual(top);
      }
    }
    for (const r of b) {
      const m = a.find((q) => sameTile(q, r) && Math.abs(r[1] - q[1]) <= step);
      if (!m) {
        expect(
          r[1] - step,
          `+${at} ms: ô hiện giữa khung ở y=${r[1].toFixed(1)}`,
        ).toBeLessThanOrEqual(top);
      } else if (at > windowMs - 500 && r[1] - m[1] > 0.05) {
        down++;
      }
    }
  }
  expect(down, 'cuối cửa sổ ô không rơi xuống').toBeGreaterThan(0);
}

/** Hộp của phần tử, toạ độ của TÀI LIỆU (như recordFrames). */
async function docBox(
  page: Page,
  selector: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const loc = page.locator(selector);
  await expect(loc).toHaveCount(1);
  return loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      x: r.left + window.scrollX,
      y: r.top + window.scrollY,
      width: r.width,
      height: r.height,
    };
  });
}

async function canvasBox(page: Page, selector: string): Promise<{ top: number; left: number }> {
  const b = await docBox(page, selector);
  return { top: b.y, left: b.x };
}

/** Tâm + Ø của nút chế độ `mode` ('right' = Ngẩng Lên, 'natural' = Ngẩng Tự Nhiên…) của bàn nút. */
async function modeCircle(
  page: Page,
  mode: string,
): Promise<{ cx: number; cy: number; d: number }> {
  const b = await docBox(page, `.mpad-mode[data-mode="${mode}"] .mpad-mode-circle`);
  return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, d: b.width };
}

// ---------------------------------------------------------------------------
// P1: chỉ còn 2 bài mẫu
// ---------------------------------------------------------------------------

test('Thư viện: đúng 2 bài mẫu (Quốc ca Việt Nam, TAKEDISKRUSH!)', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/#/library');
  const cards = page.getByRole('list', { name: 'Danh sách bài hát' }).locator(':scope > li');
  await expect(cards).toHaveCount(2);
  await expect(page.locator('.library-badge-seed')).toHaveCount(2);
  expect(await cards.getByRole('heading', { level: 2 }).allTextContents()).toEqual([
    QUOC_CA.title,
    TAKE.title,
  ]);
  // Link cũ tới một bài mẫu không còn (id seed lạ) → "Không tìm thấy bài hát" (không lỗi).
  await page.goto('/#/play/seed-bai-mau-cu');
  await expect(page.getByText('Không tìm thấy bài hát')).toBeVisible();
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// R7-1: vòng "CHẠM"
// ---------------------------------------------------------------------------

test.describe('kiểu Mobile trên điện thoại ngang 844×390 — vòng "CHẠM"', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  test.beforeEach(async ({ page }) => {
    await presetSettings(page, {
      controlScheme: 'mobile',
      language: 'vi',
      countIn: false,
      startDelaySec: 0,
    });
    await recordFrames(page, ['player-canvas', 'mpad-cues']);
  });

  test('vào lại đầu "Phần 2" (cả dòng Ngẩng Lên): vòng Ngẩng Lên đồng tâm, đúng Ø nút ngay ở beat phải chạm', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.goto(`/#/play/${QUOC_CA.id}?line=4`);
    await expect(page.getByRole('group', { name: 'Gợi ý phím như trong game' })).toHaveAttribute(
      'data-scheme',
      'mobile',
    );
    const up = await modeCircle(page, 'right');
    await expect
      .poll(async () => {
        const rec = await recording(page);
        const f = [...rec.frames].reverse().find((x) => x.bg && x.arcs.some((a) => a.ring));
        return f ? f.arcs.filter((a) => a.ring && Math.abs(a.cx - up.cx) < 1.5).length : 0;
      })
      .toBeGreaterThan(0);
    const rec = await recording(page);
    const frame = [...rec.frames].reverse().find((x) => x.bg && x.arcs.some((a) => a.ring))!;
    const ring = frame.arcs.find((a) => a.ring && Math.abs(a.cx - up.cx) < 1.5)!;
    // Đứng đúng beat của cue → tâm vòng = tâm nút, Ø vòng = Ø nút; KHÔNG chữ "CHẠM" lúc đồng tâm — tên chế độ in
    // trong nút ("NGẨNG LÊN") đọc được đúng lúc phải chạm (D-390).
    expect(Math.abs(ring.cy - up.cy)).toBeLessThan(1);
    expect(Math.abs(ring.d - up.d)).toBeLessThan(1.5);
    expect(ring.cls).toBe('mpad-cues');
    expect(ring.text).toBe(false);
    await expect(page.locator('.mpad-mode[data-mode="right"] .mpad-mode-name')).toBeVisible();
    // Không còn thanh "CHẠM" (vòng 6) hay vạch đứt "CHẠM: …".
    expect(rec.layerRects).toBe(0);
    expect(rec.bareTap).toBe(0);
    expect(rec.dashes).toBe(0);
    expect(errors).toEqual([]);
  });

  test('vòng đang rơi: thẳng cột nút, rơi nhanh ~1.75× ô, tới tâm nút đúng lúc phải chạm rồi mờ đi; không thanh CHẠM vòng 6', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    // Dòng 4 (index 3): đang Ngẩng Lên → nhả sau 3 beat (80 BPM = 2.25 s) = chạm Ngẩng Tự Nhiên.
    await page.goto(`/#/play/${QUOC_CA.id}?line=3`);
    const pad = page.getByRole('group', { name: 'Gợi ý phím như trong game' });
    await expect(pad).toHaveAttribute('data-scheme', 'mobile');
    const nat = await modeCircle(page, 'natural');
    await expect
      .poll(async () =>
        (await recording(page)).frames.some((f) =>
          f.arcs.some((a) => a.ring && Math.abs(a.cx - nat.cx) < 1.5),
        ),
      )
      .toBe(true);
    await resetFrames(page);
    const play = page.locator('button.transport-play');
    await play.tap();
    await expect(play).toHaveAttribute('data-playing', 'true');
    // Chờ vòng đáp vào nút (≈ 2.25 s; máy bận thì lâu hơn), rồi thêm một chút để thấy vòng mờ đi.
    await expect
      .poll(
        async () =>
          (await recording(page)).frames.some(
            (f) =>
              f.bg &&
              f.arcs.some(
                (a) => a.ring && Math.abs(a.cx - nat.cx) < 1.5 && Math.abs(a.cy - nat.cy) < 1,
              ),
          ),
        { timeout: 8_000 },
      )
      .toBe(true);
    await page.waitForTimeout(600);
    await play.tap();
    const rec = await recording(page);
    const box = await canvasBox(page, 'canvas.player-canvas');
    const frames = rec.frames.filter((f) => f.bg).sort((a, b) => a.t - b.t);
    // Vòng của cột Ngẩng Tự Nhiên theo từng khung (lấy vòng thấp nhất — vòng đang tới gần nút).
    const series = frames
      .map((f) => {
        const rs = f.arcs.filter((a) => a.ring && Math.abs(a.cx - nat.cx) < 1.5);
        return rs.length ? { f, ring: rs.reduce((p, q) => (q.cy > p.cy ? q : p)) } : null;
      })
      .filter((x): x is { f: Frame; ring: Arc } => x !== null);
    const landed = series.findIndex((s) => Math.abs(s.ring.cy - nat.cy) < 1);
    const trace = () =>
      JSON.stringify({
        nat,
        frames: frames.length,
        last: Math.round(frames[frames.length - 1].t - frames[0].t),
        gaps: frames
          .map((f, i) => (i > 0 ? Math.round(f.t - frames[i - 1].t) : 0))
          .filter((g) => g > 60),
        series: series
          .map((x) => [Math.round(x.f.t - frames[0].t), +x.ring.cy.toFixed(1)])
          .slice(-25),
      });
    expect(landed, `vòng không tới đúng tâm nút Ngẩng Tự Nhiên: ${trace()}`).toBeGreaterThan(5);
    const falling = series.slice(0, landed);
    for (let i = 1; i < falling.length; i++) {
      expect(falling[i].ring.cy).toBeGreaterThanOrEqual(falling[i - 1].ring.cy - 0.5);
    }
    for (const s of series) {
      expect(Math.abs(s.ring.d - nat.d), 'Ø vòng ≠ Ø nút').toBeLessThan(1.5);
      expect(s.ring.cy).toBeLessThanOrEqual(nat.cy + 1);
    }
    // Lúc đáp: ≈ 2.25 s (3 beat ở 80 BPM) sau khung đầu tiên vòng dời đi (= lúc bắt đầu chạy), ± vài khung.
    const startIdx = series.findIndex((x, i) => i > 0 && x.ring.cy - series[i - 1].ring.cy > 0.05);
    expect(startIdx).toBeGreaterThan(0);
    const landMs = series[landed].f.t - series[startIdx - 1].f.t;
    expect(landMs, trace()).toBeGreaterThan(2000);
    expect(landMs, trace()).toBeLessThan(2500);
    // Tốc độ: quãng vòng đi / quãng ô đi giữa hai khung lúc vòng còn đang rơi.
    const fallingFar = falling.filter((s) => s.ring.cy < nat.cy - 10);
    const a = fallingFar[0];
    const b = fallingFar[fallingFar.length - 1];
    expect(b.f.t - a.f.t).toBeGreaterThan(300);
    let tileTravel = 0;
    const ia = frames.indexOf(a.f);
    const ib = frames.indexOf(b.f);
    for (let i = ia + 1; i <= ib; i++) {
      const prev = tilesOf(frames[i - 1], box);
      const next = tilesOf(frames[i], box);
      const dys: number[] = [];
      for (const q of prev) {
        let best: number | null = null;
        for (const r of next) {
          const dy = r[1] - q[1];
          if (sameTile(q, r) && dy >= -0.6 && dy <= 40 && (best === null || dy < best)) best = dy;
        }
        if (best !== null) dys.push(best);
      }
      dys.sort((x, y) => x - y);
      tileTravel += dys.length ? dys[Math.floor(dys.length / 2)] : 0;
    }
    expect(tileTravel).toBeGreaterThan(5);
    const ratio = (b.ring.cy - a.ring.cy) / tileTravel;
    expect(ratio, `vòng / ô = ${ratio.toFixed(2)}`).toBeGreaterThan(1.6);
    expect(ratio).toBeLessThan(1.9);
    // Sau khi đáp: vòng đứng yên đồng tâm rồi mờ hẳn (không tụt xuống dưới nút).
    const after = series.slice(landed).filter((s) => s.f.t - series[landed].f.t < 400);
    for (const s of after) expect(Math.abs(s.ring.cy - nat.cy)).toBeLessThan(1);
    // Chữ "CHẠM": ở tâm vòng lúc còn xa nút (≥ 1 Ø), tắt khi vòng tới gần (≤ ½ Ø) và suốt lúc đứng trên nút.
    const farRings = series.filter((s) => s.ring.cy < nat.cy - nat.d - 2);
    expect(farRings.length).toBeGreaterThan(3);
    for (const s of farRings) {
      expect(s.ring.text, `vòng ở y=${s.ring.cy.toFixed(1)} thiếu chữ CHẠM`).toBe(true);
      expect(Math.abs(s.ring.tx - s.ring.cx)).toBeLessThan(1);
      expect(Math.abs(s.ring.ty - s.ring.cy)).toBeLessThan(1.5);
    }
    for (const s of series.filter((x) => x.ring.cy > nat.cy - nat.d / 2 + 2)) {
      expect(s.ring.text, `vòng ở y=${s.ring.cy.toFixed(1)} (gần nút) còn chữ CHẠM`).toBe(false);
    }
    expect(rec.layerRects).toBe(0);
    expect(rec.bareTap).toBe(0);
    expect(rec.dashes).toBe(0);
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R7-3: đếm ngược → đếm vào không nhảy
// ---------------------------------------------------------------------------

for (const song of [TAKE, QUOC_CA]) {
  test(`màn chơi ${song.title}: bấm Phát → ô trượt mượt về frame đầu đếm vào (khung đầu = khung đứng yên), 3-2-1 lúc ô đứng yên → đếm vào chỉ rơi xuống (không nhảy, không biến mất)`, async ({
    page,
  }) => {
    const errors = collectErrors(page);
    // Mặc định: đếm ngược 3 s + đếm vào (0,65 quãng cũ — v1.0.1), kiểu PC.
    await presetSettings(page, { language: 'vi' });
    await recordFrames(page, ['player-canvas']);
    await page.goto(`/#/play/${song.id}`);
    await expect(page.getByRole('heading', { level: 1, name: song.title })).toBeVisible();
    // Qua hẳn lượt làm nóng keycap / banner (700 ms sau khi gắn — glowWarmup.ts).
    await page.waitForTimeout(1200);
    const play = page.locator('button.transport-play');
    const pressAt = await page.evaluate(() => performance.now());
    await play.click();
    await expect(page.locator('.player-countdown-num')).toHaveText('3');
    await expect(page.locator('.player-countdown')).toHaveCount(0, { timeout: 6_000 });
    await page.waitForTimeout(1700);
    await play.click();
    const res = expectNoBackwardJump(
      await recording(page),
      await canvasBox(page, 'canvas.player-canvas'),
      pressAt,
      leadWindowMs(song.id),
    );
    // TAKEDISKRUSH: ô đã thấy trong frame đếm ngược (chúng chỉ việc rơi tiếp).
    if (song.id === TAKE.id) expect(res.countdownTiles).toBeGreaterThan(0);
    // Hết đếm ngược → ô rơi ngay (âm thanh tắt, không chờ độ trễ loa).
    expect(res.firstMotionMs).toBeLessThan(400);
    expect(errors).toEqual([]);
  });
}

test('màn chơi, Đếm ngược = Tắt mà Đếm vào bật (R7C-1): bấm Phát → khung đầu = khung đứng yên, ô lùi mượt rồi rơi — không nhảy, không ô nào biến mất giữa khung', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await presetSettings(page, { language: 'vi', startDelaySec: 0, countIn: true });
  await recordFrames(page, ['player-canvas']);
  await page.goto(`/#/play/${TAKE.id}`);
  await expect(page.getByRole('heading', { level: 1, name: TAKE.title })).toBeVisible();
  await page.waitForTimeout(1200);
  const play = page.locator('button.transport-play');
  const pressAt = await page.evaluate(() => performance.now());
  await play.click();
  await expect(play).toHaveAttribute('data-playing', 'true');
  await expect(page.locator('.player-countdown')).toHaveCount(0);
  await page.waitForTimeout(1800);
  await play.click();
  expectSmoothStart(
    await recording(page),
    await canvasBox(page, 'canvas.player-canvas'),
    pressAt,
    1500,
  );
  expect(errors).toEqual([]);
});

test('overlay "Xem trước" theo màn chơi: bấm Phát ở màn chơi → overlay trượt mượt về khung đầu đếm vào (data-beat không nhảy cả đoạn đếm vào)', async ({
  context,
}) => {
  const player = await context.newPage();
  const errors = collectErrors(player);
  await player.goto(`/#/play/${TAKE.id}`);
  await expect(player.locator('canvas').first()).toBeVisible();
  const overlay = await context.newPage();
  const overlayErrors = collectErrors(overlay);
  await overlay.setViewportSize({ width: 960, height: 540 });
  // Ghi mọi lần data-beat (beat đang vẽ) đổi, kèm thời điểm.
  await overlay.addInitScript(() => {
    const log: [number, number][] = [];
    (window as unknown as { __beats: [number, number][] }).__beats = log;
    new MutationObserver((list) => {
      for (const m of list) {
        const v = Number((m.target as HTMLElement).dataset.beat);
        if (Number.isFinite(v)) log.push([performance.now(), v]);
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-beat'] });
  });
  await overlay.goto(`/#/overlay/${TAKE.id}?layout=game&fit=canvas&preview=1`);
  const region = overlay.locator('.overlay');
  await expect(region).toHaveAttribute('data-mode', 'follow');
  await expect(region).toHaveAttribute('data-beat', '0.000');
  await overlay.waitForTimeout(500);
  await overlay.evaluate(() => {
    (window as unknown as { __beats: [number, number][] }).__beats.length = 0;
  });
  await player.keyboard.press('Space');
  await expect(player.locator('.player-countdown-num')).toHaveText('3');
  // TAKEDISKRUSH vào ngay beat 0: đếm vào 0,65 ô nhịp = 2,6 beat (src/player/leadIn.ts, v1.0.1).
  await expect.poll(async () => Number(await region.getAttribute('data-beat'))).toBe(-2.6);
  await player.keyboard.press('Escape');
  const beats = await overlay.evaluate(
    () => (window as unknown as { __beats: [number, number][] }).__beats,
  );
  const toPre = beats.slice(0, beats.findIndex((b) => b[1] === -2.6) + 1);
  // Đi qua các khung trung gian (không nhảy thẳng 0 → -2.6) và chỉ lùi dần.
  expect(
    toPre.filter((b) => b[1] < -0.2 && b[1] > -2.4).length,
    JSON.stringify(toPre.slice(-40).map((b) => [Math.round(b[0]), b[1]])),
  ).toBeGreaterThan(1);
  for (let i = 1; i < toPre.length; i++) {
    expect(toPre[i][1]).toBeLessThanOrEqual(toPre[i - 1][1] + 1e-3);
    // Bước lớn chỉ khi khung bị trễ (máy bận) — không bao giờ cả đoạn đếm vào trong một khung thường.
    if (toPre[i][0] - toPre[i - 1][0] < 100) {
      expect(toPre[i - 1][1] - toPre[i][1]).toBeLessThan(1.3);
    }
  }
  expect(errors).toEqual([]);
  expect(overlayErrors).toEqual([]);
});

// ---------------------------------------------------------------------------
// R7-5 + R7-3: trang mini
// ---------------------------------------------------------------------------

test.describe('trang mini 360×360', () => {
  test.use({ viewport: { width: 360, height: 360 }, hasTouch: true, isMobile: true });

  test('Cài đặt Đếm ngược = Tắt → trang mini vẫn đếm 3 giây (ô đứng yên), rồi ô chỉ rơi xuống', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await presetSettings(page, { language: 'vi', startDelaySec: 0, countIn: true });
    await recordFrames(page, ['mini-canvas']);
    await page.goto(`/#/mini/${TAKE.id}`);
    const playBtn = page.locator('.mini-play');
    await expect(playBtn).toBeVisible();
    await page.waitForTimeout(1000);
    const pressAt = await page.evaluate(() => performance.now());
    await playBtn.tap();
    const num = page.locator('.mini-countdown-num');
    await expect(num).toHaveText('3');
    await expect(num).toHaveText('2', { timeout: 2_000 });
    await expect(num).toHaveText('1', { timeout: 2_000 });
    await expect(page.locator('.mini-countdown')).toHaveCount(0, { timeout: 2_000 });
    await page.waitForTimeout(1700);
    const rec = await recording(page);
    const shown = rec.marks.filter((m) => m[1] !== null);
    const gone = rec.marks.find((m) => m[1] === null && m[0] > shown[0][0]);
    expect(gone![0] - shown[0][0]).toBeGreaterThan(2700);
    const res = expectNoBackwardJump(
      rec,
      await canvasBox(page, 'canvas.mini-canvas'),
      pressAt,
      leadWindowMs(TAKE.id),
    );
    expect(res.countdownTiles).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});

test('Cài đặt → Phát bài: dòng giải thích "Cửa sổ nổi, trang mini và video nổi luôn đếm ít nhất 3 giây"', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/#/settings');
  const hint = page.getByText(
    'Cửa sổ nổi, trang mini và video nổi luôn đếm ít nhất 3 giây (kể cả khi Tắt) để bạn kịp chuyển vào game sau khi bấm ▶.',
  );
  await expect(hint).toBeVisible();
  const hintId = await hint.getAttribute('id');
  expect(hintId).toBeTruthy();
  const slider = page.getByLabel('Đếm ngược trước khi phát');
  expect((await slider.getAttribute('aria-describedby'))?.split(/\s+/)).toContain(hintId);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// R7-8: Dev notes
// ---------------------------------------------------------------------------

/** Link "Mã nguồn (GitHub)" (D-444): tới kho công khai, mở tab mới, nhìn thấy được. */
async function expectSourceLink(link: Locator): Promise<void> {
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute('href', SOURCE_URL);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener');
  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeVisible();
}

async function expectDevNotes(page: Page): Promise<void> {
  await expect(page).toHaveURL(/#\/dev$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dev notes' })).toBeVisible();
  await expectSourceLink(page.locator('.dev-header a', { hasText: 'Mã nguồn (GitHub)' }));
  const build = page.getByRole('region', { name: 'Bản đang chạy' });
  await expect(build).toContainText('Phiên bản');
  await expect(build.locator('code').first()).toHaveText(PKG_VERSION);
  // Bản build từ git: có commit (có thể kèm -dirty) và ngày build.
  await expect(build).toContainText(/Commit\s*[0-9a-f]{7,}/);
  await expect(build).not.toContainText('không rõ');
  const reference = page.getByRole('region', { name: 'Tài liệu tham khảo' });
  for (const h of ['Định dạng .harm đầy đủ', 'Tham số URL của overlay', 'Giới hạn đã biết']) {
    await expect(reference.getByRole('heading', { name: h, exact: true })).toBeVisible();
  }
  const changelog = page.getByRole('region', { name: 'Lịch sử thay đổi' });
  await expect(changelog.getByRole('heading', { name: 'Changelog', exact: true })).toBeVisible();
  await expect(
    changelog.getByRole('heading', { name: /Unreleased|^\[?\d+\.\d+\.\d+/ }).first(),
  ).toBeVisible();
  // Không có trên thanh điều hướng chính.
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Dev notes' })).toHaveCount(
    0,
  );
}

test('Dev notes: link nhỏ ở chân trang Hướng dẫn và Cài đặt (Tab tới được) → #/dev có phiên bản, REFERENCE, CHANGELOG', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/#/guide');
  // Chân trang Hướng dẫn: "Dev notes" rồi "Mã nguồn (GitHub)" (D-444).
  await expect(page.locator('.dev-notes-link a')).toHaveCount(2);
  const guideLink = page.locator('.dev-notes-link a[href="#/dev"]');
  await expect(guideLink).toHaveCount(1);
  await expect(guideLink).toHaveText('Dev notes');
  await expectSourceLink(page.locator('.dev-notes-link a', { hasText: 'Mã nguồn (GitHub)' }));
  await guideLink.scrollIntoViewIfNeeded();
  await expect(guideLink).toBeVisible();
  // Link là phần tử cuối của bài Hướng dẫn.
  expect(
    await guideLink.evaluate((a) => {
      const article = a.closest('article');
      return article !== null && article.lastElementChild === a.parentElement;
    }),
  ).toBe(true);
  await guideLink.focus();
  await expect(guideLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expectDevNotes(page);

  await page.goto('/#/settings');
  // Cài đặt: chỉ "Dev notes" (không có link mã nguồn).
  const settingsLink = page.locator('.dev-notes-link a');
  await expect(settingsLink).toHaveCount(1);
  await expect(settingsLink).toHaveText('Dev notes');
  await settingsLink.scrollIntoViewIfNeeded();
  await expect(settingsLink).toBeVisible();
  await settingsLink.click();
  await expectDevNotes(page);
  expect(errors).toEqual([]);
});
