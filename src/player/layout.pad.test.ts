/**
 * Bố cục kiểu game Mobile (`lanePadding: 'pad'`, SPEC Phase 4m): tâm 8 lane của canvas trùng tâm 8 nút số
 * của bàn nút (cùng `padGeometry`), hit line ở đỉnh nút số, không gutter / lề nhãn; renderer vẽ tile viên
 * thuốc và cắt mọi thứ tại hit line. Vòng "CHẠM" (vòng R7) rơi nhanh gấp 1.75 lần tile và đồng tâm với nút
 * chế độ của nó đúng beat (`cueTargets` / `cueRingAxis`); overlay OBS chỉ có 4 vòng mờ làm đích (R7-4).
 * Mặc định (Player PC, overlay) không đổi.
 */
import { describe, expect, it } from 'vitest';
import { parseHarm } from '../core/parser';
import { buildTimeline } from '../core/timeline';
import type { Layout, LayoutOptions } from './layout';
import {
  CUE_LAYER_ATTR,
  CUE_RING_SPEED,
  CUE_TARGET_GAP,
  HIT_LINE_MAX_EDGE,
  LANE_COUNT,
  PAD_DIGIT_RATIO,
  PAD_LABEL_INSIDE_MIN,
  PAD_MODE_COLUMNS,
  PAD_MODE_RATIO,
  beatToAxis,
  computeLayout,
  cueRingAxis,
  cueTargets,
  hitLineMaxFor,
  padGeometry,
  padModeDiameter,
  tileLabelFloor,
  tileRect,
} from './layout';
import { MOBILE_BUTTONS } from './mobilePlan';
import type { MobileButton } from './mobilePlan';
import { CUE_RING_HOLD_BEATS, TilesRenderer, sanitizeRendererOptions } from './renderer';
import type { RendererOptions } from './renderer';

const PAD: LayoutOptions = {
  orientation: 'vertical',
  lookahead: 8,
  hitLinePos: 0.82,
  tileScale: 1,
  showRibbons: true,
  showSectionLabels: true,
  lanePadding: 'pad',
};

/** Khung canvas điển hình: điện thoại ngang / dọc, tablet, laptop, desktop 1080p, rất hẹp. */
const SIZES: readonly (readonly [number, number])[] = [
  [826, 305],
  [826, 261],
  [372, 420],
  [1024, 600],
  [1366, 520],
  [1886, 842],
  [240, 300],
];

describe('padGeometry', () => {
  it.each(SIZES)('%d×%d: 8 nút số đều cột, tâm = (i + 0.5) × cột', (w, h) => {
    const g = padGeometry(w, h);
    expect(g.colW).toBeCloseTo(w / LANE_COUNT, 9);
    expect(g.digitCx).toHaveLength(LANE_COUNT);
    g.digitCx.forEach((cx, i) => expect(cx).toBeCloseTo((i + 0.5) * g.colW, 9));
    // Nút không chồng nhau, không tràn cột.
    expect(g.digitD).toBeLessThanOrEqual(g.colW);
    expect(g.modeD).toBeLessThan(g.digitD + 1e-9);
    // Tỉ lệ game là trần (chỉ nhỏ hơn khi khung thấp / hẹp hoặc chạm trần tuyệt đối).
    expect(g.digitD).toBeLessThanOrEqual(Math.max(26, g.colW * PAD_DIGIT_RATIO) + 1e-9);
    expect(g.modeD).toBeLessThanOrEqual(Math.max(22, g.colW * PAD_MODE_RATIO) + 1e-9);
    // Hàng chế độ nằm trên hàng số; hit line = đỉnh nút số.
    expect(g.modeTop + g.modeD + g.modeLabelH).toBeLessThan(g.digitTop);
    expect(g.hitInset).toBeCloseTo(g.height - g.digitTop, 9);
    // Tile viên thuốc hẹp hơn nút số và lọt giữa hai nút chế độ cạnh nhau (tâm nút chế độ = mép cột);
    // cột quá hẹp thì giữ tối thiểu nửa cột.
    expect(g.tileW).toBeLessThan(g.digitD);
    if (g.modeD + 2 <= g.colW / 2) {
      expect(g.tileW / 2 + g.modeD / 2 + 1).toBeLessThanOrEqual(g.colW / 2 + 1e-9);
    } else {
      expect(g.tileW).toBeCloseTo(Math.min(g.digitD * 0.86, g.colW / 2), 9);
    }
  });

  it('4 nút chế độ ở mép cột 3|4 … 6|7 — nhóm căn giữa cột 3 và cột 7 như game', () => {
    const g = padGeometry(800, 300);
    expect(PAD_MODE_COLUMNS).toEqual([3, 4, 5, 6]);
    expect(g.modeCx).toEqual([300, 400, 500, 600]);
    const groupCenter = (g.modeCx[0] + g.modeCx[3]) / 2;
    expect(groupCenter).toBeCloseTo((g.digitCx[2] + g.digitCx[6]) / 2, 9);
  });

  it('khung thấp (điện thoại ngang) co nút theo chiều cao; desktop chạm trần tuyệt đối', () => {
    const short = padGeometry(826, 200);
    expect(short.digitD).toBeCloseTo(200 * 0.22, 9);
    const wide = padGeometry(1886, 842);
    expect(wide.digitD).toBe(112);
    expect(wide.modeD).toBe(72);
    expect(wide.height).toBeLessThan(842 * 0.4);
  });

  it('nhãn nút chế độ: trong hình tròn khi đủ lớn, dưới hình tròn khi nhỏ', () => {
    const big = padGeometry(826, 305);
    expect(big.modeD).toBeGreaterThanOrEqual(PAD_LABEL_INSIDE_MIN);
    expect(big.modeLabelInside).toBe(true);
    expect(big.modeLabelH).toBe(0);
    const small = padGeometry(372, 420);
    expect(small.modeLabelInside).toBe(false);
    expect(small.modeLabelH).toBeGreaterThan(0);
    expect(small.modeFontPx).toBeGreaterThanOrEqual(9);
  });

  it('giá trị không hợp lệ không ném', () => {
    const g = padGeometry(Number.NaN, -5);
    expect(Number.isFinite(g.height)).toBe(true);
    expect(g.digitCx.every(Number.isFinite)).toBe(true);
  });
});

describe("computeLayout: lanePadding 'pad'", () => {
  it.each(SIZES)('%d×%d: tâm lane = tâm nút số, hit line = đỉnh nút số', (w, h) => {
    const L = computeLayout(w, h, PAD);
    const g = padGeometry(w, h);
    expect(L.pad).not.toBeNull();
    expect(L.gutter).toBeNull();
    expect(L.labelBand).toBeNull();
    expect(L.laneArea.x).toBe(0);
    expect(L.laneArea.w).toBeCloseTo(w, 9);
    for (let i = 0; i < LANE_COUNT; i++) {
      expect(L.laneCrossStart[i] + L.laneCrossSize / 2).toBeCloseTo(g.digitCx[i], 9);
    }
    expect(L.hitPos).toBeCloseTo(h - g.hitInset, 9);
    // Tile nằm giữa lane, rộng tileW → tâm tile = tâm nút số.
    const r = tileRect({ key: 'V', startBeat: 0, endBeat: 1 }, null, 0, L);
    expect(r.x + r.w / 2).toBeCloseTo(g.digitCx[3], 9);
    expect(r.w).toBeCloseTo(g.tileW, 9);
    // Mép gần chạm hit line đúng lúc nốt bắt đầu.
    expect(r.y + r.h).toBeCloseTo(L.hitPos, 9);
  });

  it('bỏ qua hitLinePos; hướng ngang thì như "none" (không bàn nút)', () => {
    const a = computeLayout(800, 300, { ...PAD, hitLinePos: 0.3 });
    const b = computeLayout(800, 300, { ...PAD, hitLinePos: 0.9 });
    expect(a.hitPos).toBe(b.hitPos);
    const H = computeLayout(1140, 440, { ...PAD, orientation: 'horizontal' });
    expect(H.pad).toBeNull();
    expect(H.gutter).not.toBeNull();
    expect(H.labelBand).toBeNull();
    expect(hitLineMaxFor('pad')).toBe(HIT_LINE_MAX_EDGE);
  });

  it('bố cục khác không có bàn nút (Player PC / overlay giữ nguyên)', () => {
    expect(computeLayout(800, 300, { ...PAD, lanePadding: 'normal' }).pad).toBeNull();
    expect(computeLayout(800, 300, { ...PAD, lanePadding: 'none' }).pad).toBeNull();
    expect(computeLayout(800, 300, { ...PAD, lanePadding: undefined }).pad).toBeNull();
  });
});

// ── Renderer ──

interface Call {
  name: string;
  args: unknown[];
  /** Trạng thái lúc gọi (nét / độ đục / màu nét). */
  lineWidth?: unknown;
  globalAlpha?: unknown;
  strokeStyle?: unknown;
}

function fakeCtx(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {
    globalAlpha: 1,
    font: '10px sans-serif',
    lineWidth: 1,
    strokeStyle: '#000000',
  };
  const proxy = new Proxy({} as Record<string, unknown>, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop in state) return state[prop];
      return (...args: unknown[]) => {
        calls.push({
          name: prop,
          args,
          lineWidth: state.lineWidth,
          globalAlpha: state.globalAlpha,
          strokeStyle: state.strokeStyle,
        });
        if (prop === 'measureText') return { width: String(args[0]).length * 7 };
        return undefined;
      };
    },
    set(_t, prop, value: unknown) {
      if (typeof prop === 'string') state[prop] = value;
      return true;
    },
  });
  return { ctx: proxy as unknown as CanvasRenderingContext2D, calls };
}

function makeCanvas(w: number, h: number, ctx: CanvasRenderingContext2D): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(canvas, 'clientHeight', { value: h, configurable: true });
  Object.defineProperty(canvas, 'getContext', { value: () => ctx, configurable: true });
  return canvas;
}

const SONG = '@bpm 100\n# A\nZ X C V B N M ,\n# B\nL:Z R:X S:C';

function draw(options: Partial<RendererOptions>, w = 800, h = 300) {
  const { ctx, calls } = fakeCtx();
  const r = new TilesRenderer(makeCanvas(w, h, ctx), { scheme: 'mobile', ...options });
  r.setTimeline(buildTimeline(parseHarm(SONG).song));
  r.render({ beat: 0.5 });
  const layout = r.layout;
  r.dispose();
  return { calls, layout };
}

describe("renderer: lanePadding 'pad'", () => {
  it('sanitize nhận "pad", trần hit line như "none"', () => {
    const o = sanitizeRendererOptions({ lanePadding: 'pad', hitLinePos: 0.97 });
    expect(o.lanePadding).toBe('pad');
    expect(o.hitLinePos).toBe(0.97);
  });

  it('cắt tile / vạch chạm tại hit line, tile viên thuốc (bán kính = nửa bề rộng)', () => {
    const { calls, layout } = draw({ lanePadding: 'pad' });
    expect(layout?.pad).not.toBeNull();
    const clipAt = calls.findIndex((c) => c.name === 'clip');
    expect(clipAt).toBeGreaterThan(-1);
    // Vùng cắt = từ đỉnh canvas tới hit line.
    const rect = calls
      .slice(0, clipAt)
      .reverse()
      .find((c) => c.name === 'rect');
    expect(rect?.args).toEqual([0, 0, 800, layout?.hitPos]);
    expect(calls.some((c, i) => c.name === 'restore' && i > clipAt)).toBe(true);
    // Toạ độ tile lưu Float32 → so với sai số nhỏ.
    const tileW = layout?.pad?.tileW ?? 0;
    const pills = calls.filter(
      (c) =>
        c.name === 'roundRect' &&
        Math.abs(Number(c.args[2]) - tileW) < 1e-3 &&
        Math.abs(Number(c.args[4]) - Math.min(Number(c.args[2]), Number(c.args[3])) / 2) < 1e-3,
    );
    expect(pills.length).toBeGreaterThan(0);
  });

  it('vòng "CHẠM" đáp vào nút chế độ rồi mờ dần; đáp xong thì không vẽ nữa', () => {
    const barTexts = (beat: number): number => {
      const { ctx, calls } = fakeCtx();
      const r = new TilesRenderer(makeCanvas(800, 300, ctx), {
        scheme: 'mobile',
        lanePadding: 'pad',
      });
      r.setTimeline(buildTimeline(parseHarm(SONG).song));
      r.render({ beat });
      const L = r.layout!;
      r.dispose();
      return cueRings(calls, L).length;
    };
    // Cue Cúi Xuống ở beat 8 (L:Z), Ngẩng Lên ở 9, Nửa Cung + Ngẩng Tự Nhiên ở 10.
    expect(barTexts(7.9)).toBe(4);
    // Vừa qua beat 8: vòng còn đứng trên nút (mờ dần) trong CUE_RING_HOLD_BEATS.
    expect(barTexts(8 + CUE_RING_HOLD_BEATS / 2)).toBe(4);
    expect(barTexts(8.8)).toBe(3);
  });

  it('không có bàn nút → không cắt, tile góc vuông nhỏ (Player PC / overlay giữ nguyên)', () => {
    const { calls, layout } = draw({ lanePadding: 'normal' });
    expect(layout?.pad).toBeNull();
    expect(calls.some((c) => c.name === 'clip')).toBe(false);
    const radii = calls.filter((c) => c.name === 'roundRect').map((c) => Number(c.args[4]));
    expect(radii.length).toBeGreaterThan(0);
    expect(Math.max(...radii)).toBeLessThanOrEqual(3);
  });
});

describe('renderer: chữ trên tile không bị chữ của bàn nút che', () => {
  /** Ghi cả font tại mỗi lần vẽ chữ (cỡ nhãn phím). */
  function fontCtx(): { ctx: CanvasRenderingContext2D; calls: (Call & { font: string })[] } {
    const calls: (Call & { font: string })[] = [];
    const state: Record<string, unknown> = { globalAlpha: 1, font: '10px sans-serif' };
    const proxy = new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop in state) return state[prop];
        return (...args: unknown[]) => {
          calls.push({ name: prop, args, font: String(state.font) });
          if (prop === 'measureText') return { width: String(args[0]).length * 7 };
          return undefined;
        };
      },
      set(_t, prop, value: unknown) {
        if (typeof prop === 'string') state[prop] = value;
        return true;
      },
    });
    return { ctx: proxy as unknown as CanvasRenderingContext2D, calls };
  }

  // Z giữ 4 beat: ở beat 2 tile vắt qua hit line, nhãn "1" bám đáy phần còn thấy.
  function heldLabel(w: number, h: number) {
    const { ctx, calls } = fontCtx();
    const r = new TilesRenderer(makeCanvas(w, h, ctx), {
      scheme: 'mobile',
      lanePadding: 'pad',
      showSectionLabels: false,
    });
    r.setTimeline(buildTimeline(parseHarm('@bpm 100\nZ*4 X').song));
    r.render({ beat: 2 });
    const L = r.layout;
    r.dispose();
    const one = calls.find((c) => c.name === 'fillText' && c.args[0] === '1');
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(one?.font ?? '')?.[1] ?? NaN);
    return { L, y: Number(one?.args[2]), size };
  }

  it('màn dọc hẹp (tên nút chế độ DƯỚI hình tròn): nhãn tile đang giữ dừng phía trên dải tên', () => {
    const { L, y, size } = heldLabel(390, 640);
    expect(L?.pad?.modeLabelInside).toBe(false);
    const pad = L!.pad!;
    const floor = tileLabelFloor(L!);
    // Dải tên: từ đáy hình tròn chế độ tới đỉnh nút số.
    expect(floor).toBeLessThanOrEqual(L!.hitPos - (pad.digitTop - pad.modeTop - pad.modeD));
    expect(size).toBeGreaterThan(0);
    expect(y + size / 2).toBeLessThanOrEqual(floor + 0.5);
  });

  it('tên trong hình tròn (khung rộng) / không bàn nút: như cũ (hit line / đáy canvas)', () => {
    const { L, y, size } = heldLabel(1366, 520);
    expect(L?.pad?.modeLabelInside).toBe(true);
    expect(tileLabelFloor(L!)).toBe(L!.hitPos);
    expect(y + size / 2).toBeLessThanOrEqual(L!.hitPos + 0.5);
    expect(y + size / 2).toBeGreaterThan(L!.hitPos - size);
    expect(tileLabelFloor({ height: 300, hitPos: 240, pad: null })).toBe(300);
  });

  it('vòng "CHẠM" (cột 3…6) không đè tag nhãn section dọc ở lane Z', () => {
    const { ctx, calls } = fontCtx();
    const r = new TilesRenderer(makeCanvas(800, 300, ctx), {
      scheme: 'mobile',
      lanePadding: 'pad',
      showSectionLabels: true,
    });
    r.setTimeline(buildTimeline(parseHarm('@bpm 100\n# A\nZ X C V\n# B\nL:, M').song));
    r.render({ beat: 3.5 });
    const L = r.layout!;
    r.dispose();
    const T = cueTargets(L);
    const word = calls.find((c) => c.name === 'fillText' && c.args[0] === 'CHẠM');
    expect(Number(word?.args[1])).toBeCloseTo(T.cross[3], 9);
    expect(T.cross[0] - T.size / 2).toBeGreaterThan(L.laneCrossSize);
  });
});

// ── Vòng "CHẠM" (vòng R7): rơi nhanh gấp 1.75 lần tile, đồng tâm với nút chế độ đúng beat ──

/** Khung kiểm: điện thoại ngang / dọc, desktop 1080p, trang mini vuông 360 / 300. */
const CUE_SIZES: readonly (readonly [number, number])[] = [
  [844, 390],
  [390, 844],
  [1920, 1080],
  [360, 360],
  [300, 300],
];

interface Ring {
  button: MobileButton;
  /** Tâm + bán kính của arc (tâm nét màu). */
  x: number;
  y: number;
  r: number;
  /** Bề dày nét màu (lần stroke thứ hai sau arc — lần đầu là viền halo). */
  line: number;
  /** Độ đục nét màu. */
  alpha: number;
  /** Có chữ `word` ở tâm (chữ mờ dần khi vòng tới gần nút, không có lúc đáp — D-390). */
  text: boolean;
  /** Toạ độ chữ "CHẠM" (NaN khi không chữ). */
  tx: number;
  ty: number;
  /** Index của arc trong `calls`. */
  index: number;
}

/**
 * Vòng "CHẠM" đã vẽ: arc ở cột một nút chế độ + hai nét (quầng, màu — nét màu ≥ 2 px; vòng đích mờ chỉ 1.5 px),
 * kèm chữ `word` nếu có (tới arc / beginPath kế).
 */
function cueRings(calls: Call[], L: Layout, word = 'CHẠM'): Ring[] {
  const T = cueTargets(L);
  const vertical = L.orientation === 'vertical';
  const out: Ring[] = [];
  calls.forEach((c, a) => {
    if (c.name !== 'arc') return;
    const [x, y, r] = c.args.map(Number);
    const j = T.cross.findIndex((cx) => Math.abs(cx - (vertical ? x : y)) < 1e-6);
    if (j < 0) return;
    let end = a + 1;
    while (end < calls.length && calls[end].name !== 'arc' && calls[end].name !== 'beginPath') {
      end++;
    }
    const seg = calls.slice(a + 1, end);
    const strokes = seg.filter((st) => st.name === 'stroke');
    if (strokes.length < 2 || Number(strokes[1].lineWidth) < 2) return;
    const text = seg.find((t) => t.name === 'fillText');
    if (text && text.args[0] !== word) return;
    out.push({
      button: MOBILE_BUTTONS[j],
      x,
      y,
      r,
      line: Number(strokes[1].lineWidth),
      alpha: Number(strokes[1].globalAlpha),
      text: text !== undefined,
      tx: text ? Number(text.args[1]) : Number.NaN,
      ty: text ? Number(text.args[2]) : Number.NaN,
      index: a,
    });
  });
  return out;
}

// Cúi Xuống @1 · Ngẩng Lên @2 · Ngẩng Tự Nhiên + Nửa Cung bật @3 · Nửa Cung tắt @4.
const CUE_SONG = '@bpm 100\nZ L:X R:C S:V Z';
const CUE_BEATS: readonly (readonly [MobileButton, number])[] = [
  ['left', 1],
  ['right', 2],
  ['natural', 3],
  ['scroll', 3],
  ['scroll', 4],
];

/** Vẽ CUE_SONG một frame ở `beat` (kiểu Mobile, bàn nút). */
function drawCue(beat: number, w = 844, h = 390, opts: Partial<RendererOptions> = {}) {
  const { ctx, calls } = fakeCtx();
  const r = new TilesRenderer(makeCanvas(w, h, ctx), {
    scheme: 'mobile',
    lanePadding: 'pad',
    ...opts,
  });
  r.setTimeline(buildTimeline(parseHarm(CUE_SONG).song));
  r.render({ beat });
  const L = r.layout!;
  r.dispose();
  return { calls, L, rings: cueRings(calls, L) };
}

describe('cueTargets: đích của vòng "CHẠM"', () => {
  it.each(CUE_SIZES)(
    '%d×%d bàn nút: tâm / Ø nút chế độ của padGeometry, axis = tâm hình tròn',
    (w, h) => {
      const L = computeLayout(w, h, PAD);
      const g = padGeometry(w, h);
      const T = cueTargets(L);
      expect(T.cross).toEqual(g.modeCx);
      expect(T.size).toBe(g.modeD);
      // Bàn nút sát đáy canvas (MobilePad bottom: 0, cao g.height) → tâm hình tròn nút chế độ.
      expect(T.axis).toBeCloseTo(h - g.height + g.modeTop + g.modeD / 2, 9);
      expect(T.axis + T.size / 2).toBeLessThan(L.hitPos);
      expect(T.targets).toBe(false);
      // Overlay OBS (R7-4, không bàn nút): cùng chỗ, renderer tự vẽ vòng mờ làm đích.
      expect(cueTargets(L, false)).toEqual({ ...T, targets: true });
      // Thứ tự đích = thứ tự nút trong game (Nửa Cung · Ngẩng Lên · Ngẩng Tự Nhiên · Cúi Xuống).
      expect(MOBILE_BUTTONS).toEqual(['scroll', 'right', 'natural', 'left']);
    },
  );

  it('không có bàn nút (lane ngang / không đệm): cột nút chế độ của game, tâm ngay sau hit line', () => {
    for (const opts of [
      { ...PAD, lanePadding: 'none' as const, hitLinePos: 0.97 },
      { ...PAD, lanePadding: 'normal' as const },
      { ...PAD, orientation: 'horizontal' as const },
    ]) {
      const L = computeLayout(1140, 600, opts);
      const T = cueTargets(L);
      expect(L.pad).toBeNull();
      PAD_MODE_COLUMNS.forEach((c, j) =>
        expect(T.cross[j]).toBeCloseTo(L.laneCrossStart[0] + c * L.laneCrossSize, 9),
      );
      expect(T.size).toBe(padModeDiameter(L.laneCrossSize));
      expect(T.axis).toBeCloseTo(L.hitPos - L.timeDir * (T.size / 2 + CUE_TARGET_GAP), 9);
      expect(T.targets).toBe(true);
    }
    // padGeometry dùng cùng công thức Ø (kèm trần theo chiều cao khung).
    expect(padGeometry(800, 300).modeD).toBe(padModeDiameter(100, 300));
  });

  it('cueRingAxis: trùng tâm nút đúng beat của cue, đi nhanh gấp CUE_RING_SPEED = 1.75 lần tile', () => {
    expect(CUE_RING_SPEED).toBe(1.75);
    for (const [w, h] of CUE_SIZES) {
      const L = computeLayout(w, h, PAD);
      const T = cueTargets(L);
      expect(cueRingAxis(T, 3, 3, L)).toBeCloseTo(T.axis, 9);
      // 1 beat trước: phía trên tâm nút đúng 1.75 × pxPerBeat (tile: 1 × pxPerBeat).
      expect(T.axis - cueRingAxis(T, 3, 2, L)).toBeCloseTo(1.75 * L.pxPerBeat, 9);
      const ringMove = cueRingAxis(T, 3, 2.5, L) - cueRingAxis(T, 3, 2, L);
      const tileMove = beatToAxis(3, 2.5, L) - beatToAxis(3, 2, L);
      expect(ringMove / tileMove).toBeCloseTo(1.75, 9);
    }
    // Lane ngang: tương lai ở bên phải.
    const H = computeLayout(1140, 600, { ...PAD, orientation: 'horizontal' });
    const TH = cueTargets(H);
    expect(cueRingAxis(TH, 2, 1, H) - TH.axis).toBeCloseTo(1.75 * H.pxPerBeat, 9);
  });
});

describe('renderer: vòng "CHẠM" đồng tâm với nút chế độ đúng beat (bàn nút kiểu game)', () => {
  it.each(CUE_SIZES)(
    '%d×%d: Ø vòng = Ø nút, tâm vòng = tâm nút đúng beat phải chạm; chữ "CHẠM" ở tâm lúc còn xa, tắt lúc đáp',
    (w, h) => {
      const g = padGeometry(w, h);
      const cy = h - g.height + g.modeTop + g.modeD / 2;
      for (const [button, beat] of CUE_BEATS) {
        const { rings } = drawCue(beat, w, h);
        const j = MOBILE_BUTTONS.indexOf(button);
        const ring = rings.find((r) => r.button === button && Math.abs(r.y - cy) < 1e-6);
        expect(ring, `${button} @${beat}`).toBeDefined();
        expect(ring!.x).toBeCloseTo(g.modeCx[j], 9);
        // Mép ngoài nét màu = mép hình tròn của nút; nét 2–3 px; lòng trong suốt.
        expect(ring!.r + ring!.line / 2).toBeCloseTo(g.modeD / 2, 9);
        expect(ring!.line).toBeGreaterThanOrEqual(2);
        expect(ring!.line).toBeLessThanOrEqual(3);
        expect(ring!.alpha).toBe(1);
        // Đồng tâm với nút: không chữ — tên chế độ in trong nút đọc được đúng lúc chạm (D-390).
        expect(ring!.text).toBe(false);
        // Còn xa nút (> 1 Ø): chữ ở tâm vòng (mọi cỡ, kể cả nút 22 px).
        const far = drawCue(beat - 1.2, w, h).rings.find(
          (r) => r.button === button && r.y < cy - g.modeD,
        );
        expect(far, `${button} @${beat} - 1.2`).toBeDefined();
        expect(far!.text).toBe(true);
        expect(far!.tx).toBeCloseTo(far!.x, 9);
        expect(far!.ty).toBeCloseTo(far!.y + 0.5, 9);
      }
    },
  );

  it('vòng chỉ có nét (không tô) và vẽ sau mọi thứ của canvas', () => {
    const { calls, rings } = drawCue(0.8);
    expect(rings.length).toBeGreaterThan(0);
    for (const ring of rings) {
      let end = ring.index + 1;
      while (end < calls.length && !['arc', 'beginPath', 'fillText'].includes(calls[end].name))
        end++;
      const between = calls.slice(ring.index + 1, end);
      expect(between.some((c) => c.name === 'fill')).toBe(false);
      expect(between.filter((c) => c.name === 'stroke')).toHaveLength(2);
    }
    // Sau khi cắt vùng bàn nút (restore) và sau tile: vòng không bị clip tại hit line.
    const lastRestore = calls.map((c) => c.name).lastIndexOf('restore');
    expect(Math.min(...rings.map((r) => r.index))).toBeGreaterThan(lastRestore);
  });

  it('nhanh gấp 1.75 lần tile: xuất hiện muộn hơn tile của nốt tại cue, gặp nút đúng beat', () => {
    const at = (beat: number) => {
      const { L, rings } = drawCue(beat);
      // Tile của nốt X (Cúi Xuống, beat 1): mép gần = beatToAxis(1).
      const tile = tileRect({ key: 'X', startBeat: 1, endBeat: 2 }, null, beat, L);
      return { L, ring: rings.find((r) => r.button === 'left'), tileNear: tile.y + tile.h };
    };
    const a = at(0.5);
    const b = at(0.75);
    expect(a.ring && b.ring).toBeTruthy();
    expect((b.ring!.y - a.ring!.y) / (b.tileNear - a.tileNear)).toBeCloseTo(1.75, 6);
    // Tile của nốt đã vào khung (mép gần ở nửa trên) mà vòng còn ngoài mép trên → chưa vẽ.
    const c = at(1 - 0.6 * a.L.lookahead);
    expect(c.tileNear).toBeGreaterThan(0);
    expect(c.tileNear).toBeLessThan(a.L.hitPos / 2);
    expect(c.ring).toBeUndefined();
  });

  it('tới nút: đứng yên đồng tâm ("đáp" vào nút), mờ dần, rồi biến mất', () => {
    const g = padGeometry(844, 390);
    const cy = 390 - g.height + g.modeTop + g.modeD / 2;
    const left = (beat: number) => drawCue(beat).rings.find((r) => r.button === 'left');
    const now = left(1);
    const hold = left(1 + CUE_RING_HOLD_BEATS / 2);
    expect(now?.y).toBeCloseTo(cy, 9);
    expect(hold?.y).toBeCloseTo(cy, 9);
    expect(hold!.alpha).toBeLessThan(now!.alpha);
    expect(hold!.alpha).toBeGreaterThan(0);
    expect(left(1 + CUE_RING_HOLD_BEATS + 0.01)).toBeUndefined();
  });
});

describe('overlay OBS kiểu Mobile (R7-4): không bàn nút, chỉ 4 vòng mờ ở hàng nút chế độ', () => {
  /** Vòng mờ đích: arc đúng tâm nút chế độ không kèm chữ (vòng "CHẠM" có chữ). */
  function targets(calls: Call[], L: Layout) {
    const T = cueTargets(L, false);
    const ringArcs = new Set(cueRings(calls, L).map((r) => r.index));
    return calls
      .map((c, i) => ({ c, i }))
      .filter(
        ({ c, i }) =>
          c.name === 'arc' &&
          !ringArcs.has(i) &&
          Math.abs(Number(c.args[1]) - T.axis) < 1e-6 &&
          T.cross.some((x) => Math.abs(Number(c.args[0]) - x) < 1e-6),
      )
      .map(({ c, i }) => {
        const strokes = calls.slice(i + 1, i + 6).filter((s) => s.name === 'stroke');
        return { x: Number(c.args[0]), r: Number(c.args[2]), color: strokes[1], index: i };
      });
  }

  it.each(CUE_SIZES)(
    '%d×%d: 4 vòng mờ (chỉ nét) đúng tâm / Ø nút chế độ, vòng "CHẠM" đáp vào đó',
    (w, h) => {
      const g = padGeometry(w, h);
      const { calls, L } = drawCue(0.5, w, h, { modeTargets: 'outline' });
      const ts = targets(calls, L);
      expect(ts.map((t) => t.x).sort((a, b) => a - b)).toEqual(g.modeCx);
      for (const t of ts) {
        expect(t.r + Number(t.color?.lineWidth) / 2).toBeCloseTo(g.modeD / 2, 9);
        expect(Number(t.color?.globalAlpha)).toBeLessThanOrEqual(0.5);
        const next = calls.slice(t.index + 1, t.index + 6);
        expect(next.some((c) => c.name === 'fill' || c.name === 'fillText')).toBe(false);
      }
      // Không bàn nút → không có nút số / nhãn tên chế độ nào trên canvas.
      const texts = calls.filter((c) => c.name === 'fillText').map((c) => String(c.args[0]));
      for (const word of ['Ngẩng', 'Cúi', 'Nửa', 'Ngẩng Lên']) expect(texts).not.toContain(word);
      // Đúng beat: vòng "CHẠM" đồng tâm với vòng mờ của nút đó.
      const hit = drawCue(1, w, h, { modeTargets: 'outline' });
      const ring = hit.rings.find((r) => r.button === 'left');
      const target = targets(hit.calls, hit.L).find(
        (t) => t.x === g.modeCx[MOBILE_BUTTONS.indexOf('left')],
      );
      expect(ring?.x).toBeCloseTo(target!.x, 9);
      expect(ring?.y).toBeCloseTo(cueTargets(hit.L, false).axis, 9);
    },
  );

  it('màn chơi / Cửa sổ nổi / trang mini (mặc định "pad"): renderer không tự vẽ vòng đích', () => {
    const { calls, L } = drawCue(0.5);
    expect(targets(calls, L)).toHaveLength(0);
  });
});

describe('renderer: lớp vòng "CHẠM" của bàn nút DOM (`CUE_LAYER_ATTR`)', () => {
  it('vẽ vòng lên lớp cùng hộp (nằm trên nút chế độ DOM), xóa mỗi frame; gỡ lớp → vẽ lên canvas tiles', () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    const main = fakeCtx();
    const layer = fakeCtx();
    const canvas = makeCanvas(844, 390, main.ctx);
    const cues = makeCanvas(844, 390, layer.ctx);
    cues.setAttribute(CUE_LAYER_ATTR, '');
    box.append(canvas, cues);
    const r = new TilesRenderer(canvas, { scheme: 'mobile', lanePadding: 'pad' });
    r.setTimeline(buildTimeline(parseHarm(CUE_SONG).song));
    r.render({ beat: 1 });
    const L = r.layout!;
    expect(cueRings(main.calls, L)).toHaveLength(0);
    expect(cueRings(layer.calls, L).length).toBeGreaterThan(0);
    // Backing store của lớp = canvas tiles (cùng khung, cùng DPR).
    expect(cues.width).toBe(canvas.width);
    expect(cues.height).toBe(canvas.height);
    // Frame kế: xóa hình cũ trước khi vẽ.
    layer.calls.length = 0;
    r.render({ beat: 1.05 });
    const clear = layer.calls.findIndex((c) => c.name === 'clearRect');
    expect(clear).toBeGreaterThan(-1);
    expect(layer.calls[clear].args).toEqual([0, 0, canvas.width, canvas.height]);
    expect(clear).toBeLessThan(layer.calls.findIndex((c) => c.name === 'arc'));
    // Đổi kiểu điều khiển (bàn nút gỡ khỏi DOM) → vòng vẽ thẳng lên canvas tiles.
    cues.remove();
    main.calls.length = 0;
    r.render({ beat: 1 });
    expect(cueRings(main.calls, L).length).toBeGreaterThan(0);
    // Overlay (vòng đích tự vẽ): không dùng lớp dù có.
    box.append(cues);
    r.setOptions({ modeTargets: 'outline' });
    layer.calls.length = 0;
    main.calls.length = 0;
    r.render({ beat: 1 });
    expect(cueRings(layer.calls, L)).toHaveLength(0);
    expect(cueRings(main.calls, L).length).toBeGreaterThan(0);
    r.dispose();
    box.remove();
  });
});
