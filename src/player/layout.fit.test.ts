/**
 * Bố cục "Khớp nút game" của trang mini Android (`lanePadding: 'fit'`, góp ý 2026-10-16): cửa sổ nổi đặt ngay
 * trên bảng nút kèn thật của game — tâm 8 lane = tâm 8 nút số đo trên ảnh chụp màn hình game của chủ dự án
 * (2026-10-16, màn 1371 × 633; cửa sổ = 8 làn căn giữa hàng nút 185 → 1185,6 px — v1.0.1: ô ngoài cùng không sát
 * mép; trước đó cửa sổ đúng mép ngoài hàng nút 205 → 1165 px), hit line sát mép dưới,
 * vòng "CHẠM" rơi trong cột nút chế độ thật và đáp sát trên mép dưới. Bố cục cũ không đổi.
 */
import { describe, expect, it } from 'vitest';
import { parseHarm } from '../core/parser';
import { buildTimeline } from '../core/timeline';
import type { Layout, LayoutOptions } from './layout';
import {
  CUE_TARGET_GAP,
  DEFAULT_LANE_FIT,
  FIT_HIT_INSET,
  FIT_MODE_DISC_RATIO,
  FIT_MODE_MAX_HEIGHT,
  FIT_NOTE_DISC_RATIO,
  FIT_WINDOW_STEPS,
  GAME_MODE_COLUMNS,
  HIT_LINE_MAX_EDGE,
  LANE_COUNT,
  beatToAxis,
  computeLayout,
  cueRingAxis,
  cueTargets,
  fitGeometry,
  hitLineMaxFor,
  isLaneFit,
  sameLaneFit,
  tileRect,
} from './layout';
import { MOBILE_BUTTONS } from './mobilePlan';
import { CUE_RING_HOLD_BEATS, DEFAULT_RENDERER_OPTIONS, TilesRenderer } from './renderer';
import { sanitizeRendererOptions } from './renderer';
import type { RendererOptions } from './renderer';

/** Số đo ảnh game (px của ảnh 1371 px): tâm 8 nút số, 4 nút chế độ; cửa sổ mặc định = 8 làn căn giữa hàng nút. */
const NOTE_X = [247.5, 372, 497, 622, 747.5, 872.5, 998, 1123];
const MODE_X = [491, 645.5, 760, 876]; // Nửa Cung · Ngẩng Lên · Ngẩng Tự Nhiên · Cúi Xuống
const NOTE_STEP = (NOTE_X[7] - NOTE_X[0]) / 7; // ≈ 125,07
const ROW_W = 8 * NOTE_STEP; // ≈ 1000,6 (FIT_WINDOW_STEPS bước)
const ROW_LEFT = (NOTE_X[0] + NOTE_X[7]) / 2 - ROW_W / 2; // ≈ 185
const MODE_DISC = 75;

/** Cỡ cửa sổ nổi thử (px CSS): cửa sổ thấp trải ngang hàng nút. */
const WINDOWS: readonly (readonly [number, number])[] = [
  [960, 300],
  [720, 240],
  [1200, 360],
];

const FIT: LayoutOptions = {
  orientation: 'vertical',
  lookahead: 6,
  hitLinePos: 0.82,
  tileScale: 1,
  showRibbons: true,
  showSectionLabels: false,
  lanePadding: 'fit',
};

describe('fitGeometry: mặc định theo số đo ảnh game', () => {
  it.each(WINDOWS)('%d×%d: 8 lane thẳng tâm 8 nút số, 4 cột thẳng tâm 4 nút chế độ', (w, h) => {
    const g = fitGeometry(w, h, null);
    const k = w / ROW_W;
    // Bước cột = 0,0912 × bề ngang màn ≈ 125 px của ảnh.
    expect(g.step / k).toBeCloseTo((NOTE_X[7] - NOTE_X[0]) / 7, 0);
    expect(g.laneCx).toHaveLength(LANE_COUNT);
    g.laneCx.forEach((x, i) => {
      expect(Math.abs(x - (NOTE_X[i] - ROW_LEFT) * k), `nút ${i + 1}`).toBeLessThan(1.5 * k);
      if (i > 0) expect(x - g.laneCx[i - 1]).toBeCloseTo(g.step, 9);
    });
    // Hàng căn giữa: tâm nhóm = giữa cửa sổ.
    expect((g.laneCx[0] + g.laneCx[7]) / 2).toBeCloseTo(w / 2, 0);
    g.modeCx.forEach((x, j) =>
      expect(Math.abs(x - (MODE_X[j] - ROW_LEFT) * k), MOBILE_BUTTONS[j]).toBeLessThan(1.5 * k),
    );
    // Ba nút quãng cách đều ≈ 0,922 bước; Nửa Cung là nhóm riêng (xa hơn).
    expect(Math.abs((g.modeCx[2] - g.modeCx[1]) / g.step - 0.922)).toBeLessThan(0.01);
    expect(Math.abs((g.modeCx[3] - g.modeCx[2]) / g.step - 0.922)).toBeLessThan(0.01);
    expect((g.modeCx[1] - g.modeCx[0]) / g.step).toBeCloseTo(1.235, 2);
    // Ø vòng = Ø nút chế độ của game; tile = Ø nút số.
    expect(Math.abs(g.modeD - MODE_DISC * k)).toBeLessThan(1.5 * k);
    expect(g.modeD).toBeCloseTo(g.step * FIT_MODE_DISC_RATIO, 9);
    expect(g.tileW).toBeCloseTo(g.step * FIT_NOTE_DISC_RATIO, 9);
    // Hit line sát mép dưới.
    expect(g.hitPos).toBe(h - FIT_HIT_INSET);
  });

  it('cột nút chế độ tính theo bước cột từ tâm nút 1 (thứ tự game = MOBILE_BUTTONS)', () => {
    expect(MOBILE_BUTTONS).toEqual(['scroll', 'right', 'natural', 'left']);
    const step = (NOTE_X[7] - NOTE_X[0]) / 7;
    GAME_MODE_COLUMNS.forEach((c, j) => expect(c).toBeCloseTo((MODE_X[j] - NOTE_X[0]) / step, 2));
    expect(DEFAULT_LANE_FIT.first).toBeCloseTo((NOTE_X[0] - ROW_LEFT) / ROW_W, 3);
    expect(DEFAULT_LANE_FIT.last).toBeCloseTo((NOTE_X[7] - ROW_LEFT) / ROW_W, 3);
    expect(DEFAULT_LANE_FIT.first).toBe(1 / 16);
    expect(DEFAULT_LANE_FIT.last).toBe(15 / 16);
  });

  it.each(WINDOWS)(
    '%d×%d (v1.0.1): 8 lane phủ đúng khung, ô ngoài cùng (rộng Ø nút) cách mép ≈ 0,155 bước — không sát viền',
    (w, h) => {
      expect(FIT_WINDOW_STEPS).toBe(LANE_COUNT);
      const g = fitGeometry(w, h, null);
      expect(g.step).toBeCloseTo(w / FIT_WINDOW_STEPS, 9);
      expect(g.laneCx[0] - g.step / 2).toBeCloseTo(0, 9);
      expect(g.laneCx[7] + g.step / 2).toBeCloseTo(w, 9);
      const gap = (1 - FIT_NOTE_DISC_RATIO) / 2;
      expect((g.laneCx[0] - g.tileW / 2) / g.step).toBeCloseTo(gap, 9);
      expect((w - g.laneCx[7] - g.tileW / 2) / g.step).toBeCloseTo(gap, 9);
      // Khe tới mép = nửa khe giữa hai ô liền nhau.
      expect(2 * (g.laneCx[0] - g.tileW / 2)).toBeCloseTo(g.laneCx[1] - g.laneCx[0] - g.tileW, 9);
      const L = computeLayout(w, h, FIT);
      const r = tileRect({ key: 'Z', startBeat: 0, endBeat: 1 }, null, 0, L);
      expect(r.x).toBeGreaterThan(0.15 * g.step);
      const r8 = tileRect({ key: ',', startBeat: 0, endBeat: 1 }, null, 0, L);
      expect(w - (r8.x + r8.w)).toBeGreaterThan(0.15 * g.step);
    },
  );

  it('cửa sổ thấp: Ø vòng có trần theo chiều cao; tâm vẫn như cũ', () => {
    const tall = fitGeometry(960, 300, null);
    const low = fitGeometry(960, 120, null);
    expect(low.modeD).toBeCloseTo(120 * FIT_MODE_MAX_HEIGHT, 9);
    expect(low.modeD).toBeLessThan(tall.modeD);
    expect(low.laneCx).toEqual(tall.laneCx);
    expect(low.modeCx).toEqual(tall.modeCx);
  });

  it('LaneFit tự chọn: lane nội suy đều giữa nút 1 và nút 1̇, được tràn mép; sai → mặc định', () => {
    const g = fitGeometry(1000, 300, { first: 0.1, last: 0.8, modes: [2, 3, 4, 5] });
    expect(g.step).toBeCloseTo(100, 9);
    expect(g.laneCx[0]).toBeCloseTo(100, 9);
    expect(g.laneCx[7]).toBeCloseTo(800, 9);
    expect(g.modeCx).toEqual([300, 400, 500, 600].map((x) => expect.closeTo(x, 9) as number));
    const out = fitGeometry(1000, 300, { first: -0.05, last: 1.1, modes: GAME_MODE_COLUMNS });
    expect(out.laneCx[0]).toBeLessThan(0);
    expect(out.laneCx[7]).toBeGreaterThan(1000);
    const def = fitGeometry(1000, 300, null);
    for (const bad of [
      { first: 0.5, last: 0.5, modes: GAME_MODE_COLUMNS },
      { first: 0.1, last: 0.9, modes: [1, 2, 3] },
      { first: Number.NaN, last: 0.9, modes: GAME_MODE_COLUMNS },
      'x',
    ]) {
      expect(isLaneFit(bad)).toBe(false);
      expect(fitGeometry(1000, 300, bad as never)).toEqual(def);
    }
    expect(sameLaneFit({ ...DEFAULT_LANE_FIT }, DEFAULT_LANE_FIT)).toBe(true);
    expect(sameLaneFit({ ...DEFAULT_LANE_FIT, first: 0.05 }, DEFAULT_LANE_FIT)).toBe(false);
    expect(sameLaneFit(null, DEFAULT_LANE_FIT)).toBe(false);
  });
});

describe("computeLayout: lanePadding 'fit'", () => {
  it.each(WINDOWS)('%d×%d: lane = bước cột quanh tâm nút, không gutter / lề / bàn nút', (w, h) => {
    const L = computeLayout(w, h, FIT);
    const g = fitGeometry(w, h, null);
    expect(L.fit).toEqual(g);
    expect(L.pad).toBeNull();
    expect(L.gutter).toBeNull();
    expect(L.labelBand).toBeNull();
    expect(L.laneCrossSize).toBeCloseTo(g.step, 9);
    L.laneCrossStart.forEach((c, i) => expect(c + L.laneCrossSize / 2).toBeCloseTo(g.laneCx[i], 9));
    // Hit line sát mép dưới (hitLinePos bị bỏ qua); khung bao lane nằm trong khung.
    expect(L.hitPos).toBeCloseTo(h - FIT_HIT_INSET, 9);
    expect(L.laneArea.x).toBeGreaterThanOrEqual(0);
    expect(L.laneArea.x + L.laneArea.w).toBeLessThanOrEqual(w + 1e-9);
    // Tile rộng = Ø nút số, căn tâm lane; mép gần chạm hit line đúng beat của nốt.
    const tile = tileRect({ key: 'V', startBeat: 2, endBeat: 3 }, null, 2, L);
    expect(tile.w).toBeCloseTo(g.tileW, 9);
    expect(tile.x + tile.w / 2).toBeCloseTo(g.laneCx[3], 9);
    expect(tile.y + tile.h).toBeCloseTo(L.hitPos, 9);
  });

  it('LaneFit đổi → lane đổi theo; hướng ngang → như "none" (không fit)', () => {
    const L = computeLayout(1000, 300, {
      ...FIT,
      laneFit: { first: 0.1, last: 0.8, modes: GAME_MODE_COLUMNS },
    });
    expect(L.laneCrossStart[0]).toBeCloseTo(50, 9);
    expect(L.laneCrossSize).toBeCloseTo(100, 9);
    expect(L.laneArea.x).toBeCloseTo(50, 9);
    expect(L.laneArea.w).toBeCloseTo(800, 9);
    const H = computeLayout(1000, 300, { ...FIT, orientation: 'horizontal' });
    const none = computeLayout(1000, 300, {
      ...FIT,
      orientation: 'horizontal',
      lanePadding: 'none',
    });
    expect(H.fit).toBeNull();
    expect(H).toEqual(none);
    expect(hitLineMaxFor('fit')).toBe(HIT_LINE_MAX_EDGE);
  });

  it('bố cục cũ không có `fit`', () => {
    for (const lanePadding of ['normal', 'none', 'pad'] as const) {
      expect(computeLayout(844, 390, { ...FIT, lanePadding }).fit).toBeNull();
    }
    expect(computeLayout(844, 390, { ...FIT, lanePadding: undefined }).fit).toBeNull();
  });

  it.each(WINDOWS)(
    '%d×%d: vòng "CHẠM" ở cột nút chế độ thật, Ø nút, đáp sát TRÊN hit line đúng beat',
    (w, h) => {
      const L = computeLayout(w, h, FIT);
      const g = L.fit!;
      const T = cueTargets(L);
      expect(T.cross).toEqual(g.modeCx);
      expect(T.size).toBe(g.modeD);
      // Đáy vòng = hit line − khe (nút thật nằm ngay dưới mép dưới cửa sổ); renderer vẽ vòng đích mờ.
      expect(T.axis + T.size / 2).toBeCloseTo(L.hitPos - CUE_TARGET_GAP, 9);
      expect(T.axis - T.size / 2).toBeGreaterThan(0);
      expect(T.targets).toBe(true);
      expect(cueTargets(L, false)).toEqual(T);
      // Đúng beat cue: tâm vòng = axis; 1 beat trước: cao hơn 1.75 × pxPerBeat (nhanh hơn tile).
      expect(cueRingAxis(T, 4, 4, L)).toBeCloseTo(T.axis, 9);
      expect(T.axis - cueRingAxis(T, 4, 3, L)).toBeCloseTo(1.75 * L.pxPerBeat, 9);
      expect(beatToAxis(4, 4, L)).toBeCloseTo(L.hitPos, 9);
    },
  );
});

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

interface Call {
  name: string;
  args: unknown[];
  lineWidth: unknown;
  globalAlpha: unknown;
}

function fakeCtx(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state: Record<string, unknown> = { globalAlpha: 1, font: '10px sans-serif', lineWidth: 1 };
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

/** Cue: X (Cúi Xuống) ở beat 1, C (Ngẩng Lên) ở beat 2, V (Ngẩng Tự Nhiên + Nửa Cung) ở beat 3. */
const CUE_SONG = '@bpm 100\nZ L:X R:C S:V Z';

function drawFit(beat: number, w: number, h: number, opts: Partial<RendererOptions> = {}) {
  const { ctx, calls } = fakeCtx();
  const r = new TilesRenderer(makeCanvas(w, h, ctx), {
    scheme: 'mobile',
    lanePadding: 'fit',
    ...opts,
  });
  r.setTimeline(buildTimeline(parseHarm(CUE_SONG).song));
  r.render({ beat });
  const L = r.layout!;
  r.dispose();
  return { calls, L };
}

/** Arc ở cột một nút chế độ; `ring` = vòng "CHẠM" (nét màu ≥ 2 px), còn lại = vòng đích mờ (1,5 px). */
function arcs(calls: Call[], L: Layout) {
  const T = cueTargets(L);
  return calls.flatMap((c, i) => {
    if (c.name !== 'arc') return [];
    const [x, y, r] = c.args.map(Number);
    const j = T.cross.findIndex((cx) => Math.abs(cx - x) < 1e-6);
    if (j < 0) return [];
    const strokes = calls.slice(i + 1, i + 6).filter((s) => s.name === 'stroke');
    const line = Number(strokes[1]?.lineWidth);
    return [{ button: MOBILE_BUTTONS[j], x, y, r, line, ring: line >= 2 }];
  });
}

describe("renderer: lanePadding 'fit'", () => {
  it.each(WINDOWS)(
    '%d×%d: 4 vòng đích mờ sát trên mép dưới; vòng "CHẠM" đồng tâm vòng đích đúng beat',
    (w, h) => {
      const idle = drawFit(0.5, w, h);
      const T = cueTargets(idle.L);
      const targets = arcs(idle.calls, idle.L).filter((a) => !a.ring);
      expect(targets.map((t) => t.x).sort((a, b) => a - b)).toEqual(T.cross);
      for (const t of targets) {
        expect(t.y).toBeCloseTo(T.axis, 9);
        expect(t.r + t.line / 2).toBeCloseTo(T.size / 2, 9);
      }
      // Cúi Xuống (X, beat 1): đúng beat → vòng "CHẠM" ở cột Cúi Xuống, đáy sát hit line.
      const hit = drawFit(1, w, h);
      const ring = arcs(hit.calls, hit.L).find((a) => a.ring && a.button === 'left');
      expect(ring).toBeDefined();
      expect(ring!.x).toBeCloseTo(T.cross[MOBILE_BUTTONS.indexOf('left')], 9);
      expect(ring!.y).toBeCloseTo(T.axis, 9);
      expect(ring!.r + ring!.line / 2).toBeCloseTo(T.size / 2, 9);
      expect(ring!.y + T.size / 2).toBeLessThanOrEqual(hit.L.hitPos);
      // Trước đó: còn ở trên, trong cột của nút.
      const early = drawFit(0.6, w, h);
      const up = arcs(early.calls, early.L).find((a) => a.ring && a.button === 'left');
      expect(up).toBeDefined();
      expect(up!.y).toBeLessThan(T.axis - 1);
      // Sau khi đáp: mờ rồi biến mất.
      const gone = drawFit(1 + CUE_RING_HOLD_BEATS + 0.01, w, h);
      expect(arcs(gone.calls, gone.L).some((a) => a.ring && a.button === 'left')).toBe(false);
    },
  );

  it('vòng vẽ lên canvas tiles (không có lớp của bàn nút), không cắt tại hit line', () => {
    const { calls } = drawFit(1, 960, 300);
    expect(calls.some((c) => c.name === 'clip')).toBe(false);
  });

  it('kiểu PC: không vòng, không gutter ribbon; lane vẫn theo nút thật', () => {
    const { calls, L } = drawFit(1, 960, 300, { scheme: 'pc' });
    expect(L.gutter).toBeNull();
    expect(L.fit).not.toBeNull();
    expect(arcs(calls, L)).toHaveLength(0);
  });

  it('sanitize: "fit" + laneFit hợp lệ; cùng giá trị giữ object cũ (không dựng lại layout)', () => {
    expect(DEFAULT_RENDERER_OPTIONS.laneFit).toBeNull();
    const fit = { first: 0.05, last: 0.95, modes: [2, 3, 4, 5] };
    const a = sanitizeRendererOptions({ lanePadding: 'fit', laneFit: fit });
    expect(a.lanePadding).toBe('fit');
    expect(a.laneFit).toEqual(fit);
    expect(a.laneFit).not.toBe(fit);
    const b = sanitizeRendererOptions({ laneFit: { ...fit, modes: [...fit.modes] } }, a);
    expect(b.laneFit).toBe(a.laneFit);
    expect(sanitizeRendererOptions({ laneFit: { first: 1, last: 0 } as never }, a).laneFit).toBe(
      a.laneFit,
    );
    expect(sanitizeRendererOptions({ laneFit: null }, a).laneFit).toBeNull();
    expect(sanitizeRendererOptions({ lanePadding: 'fit', hitLinePos: 0.99 }).hitLinePos).toBe(
      HIT_LINE_MAX_EDGE,
    );
  });

  it('setOptions(laneFit) dựng lại layout; cùng giá trị thì không', () => {
    const { ctx } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(1000, 300, ctx), {
      scheme: 'mobile',
      lanePadding: 'fit',
      laneFit: { first: 0.1, last: 0.8, modes: GAME_MODE_COLUMNS },
    });
    r.setTimeline(buildTimeline(parseHarm(CUE_SONG).song));
    r.render({ beat: 0 });
    const before = r.layout!;
    expect(before.fit!.laneCx[0]).toBeCloseTo(100, 9);
    r.setOptions({ laneFit: { first: 0.1, last: 0.8, modes: [...GAME_MODE_COLUMNS] } });
    expect(r.layout).toBe(before);
    r.setOptions({ laneFit: { first: 0.2, last: 0.9, modes: GAME_MODE_COLUMNS } });
    expect(r.layout).not.toBe(before);
    expect(r.layout!.fit!.laneCx[0]).toBeCloseTo(200, 9);
    r.dispose();
  });
});

// ---------------------------------------------------------------------------
// Đúng tỉ lệ thật (`laneFit.stepPx`, D-405): bước cột theo px của màn, hàng nút căn giữa khung
// ---------------------------------------------------------------------------

describe("'fit' đúng tỉ lệ thật (stepPx / shiftPx)", () => {
  const SCALED = { ...DEFAULT_LANE_FIT, stepPx: 83.448, shiftPx: 0 };

  it.each([
    [640, 200],
    [700, 220],
    [500, 120],
  ])(
    '%d×%d: bước = stepPx (không theo bề ngang khung), tâm hàng = giữa khung + shiftPx',
    (w, h) => {
      const g = fitGeometry(w, h, SCALED);
      expect(g.step).toBe(83.448);
      g.laneCx.forEach((x, i) => expect(x).toBeCloseTo(w / 2 + (i - 3.5) * 83.448, 9));
      g.modeCx.forEach((x, j) =>
        expect(x).toBeCloseTo(g.laneCx[0] + GAME_MODE_COLUMNS[j] * 83.448, 9),
      );
      expect(g.tileW).toBeCloseTo(83.448 * FIT_NOTE_DISC_RATIO, 9);
      expect(g.modeD).toBeCloseTo(
        Math.min(83.448 * FIT_MODE_DISC_RATIO, h * FIT_MODE_MAX_HEIGHT),
        9,
      );
      expect(g.hitPos).toBe(h - FIT_HIT_INSET);
      const moved = fitGeometry(w, h, { ...SCALED, shiftPx: -15 });
      moved.laneCx.forEach((x, i) => expect(x).toBeCloseTo(g.laneCx[i] - 15, 9));
      // computeLayout: lane rộng đúng một bước quanh tâm nút, được tràn mép (khung 500 hẹp hơn hàng nút).
      const L = computeLayout(w, h, { ...FIT, laneFit: SCALED });
      expect(L.fit).toEqual(g);
      expect(L.laneCrossSize).toBeCloseTo(83.448, 9);
      L.laneCrossStart.forEach((c, i) =>
        expect(c + L.laneCrossSize / 2).toBeCloseTo(g.laneCx[i], 9),
      );
      expect(L.laneArea.x).toBeGreaterThanOrEqual(0);
      expect(L.laneArea.x + L.laneArea.w).toBeLessThanOrEqual(w + 1e-9);
      const T = cueTargets(L);
      expect(T.cross).toEqual(g.modeCx);
      expect(T.axis + T.size / 2).toBeCloseTo(L.hitPos - CUE_TARGET_GAP, 9);
    },
  );

  it('isLaneFit / sameLaneFit xét stepPx / shiftPx; LaneFit không stepPx giữ như cũ', () => {
    expect(isLaneFit(SCALED)).toBe(true);
    expect(isLaneFit({ ...SCALED, stepPx: 0 })).toBe(false);
    expect(isLaneFit({ ...SCALED, stepPx: Number.NaN })).toBe(false);
    expect(isLaneFit({ ...SCALED, shiftPx: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isLaneFit({ ...DEFAULT_LANE_FIT, shiftPx: 5 })).toBe(true);
    expect(sameLaneFit({ ...SCALED }, SCALED)).toBe(true);
    expect(sameLaneFit({ ...SCALED, stepPx: 83.5 }, SCALED)).toBe(false);
    expect(sameLaneFit({ ...SCALED, shiftPx: 1 }, SCALED)).toBe(false);
    expect(sameLaneFit({ ...DEFAULT_LANE_FIT }, SCALED)).toBe(false);
    // Không stepPx: shiftPx bị bỏ qua (kiểu "cửa sổ = hàng nút" như trước).
    expect(fitGeometry(960, 300, { ...DEFAULT_LANE_FIT, shiftPx: 40 })).toEqual(
      fitGeometry(960, 300, null),
    );
  });

  it('renderer: sanitize giữ stepPx / shiftPx; đổi stepPx dựng lại layout, cùng giá trị thì không', () => {
    const a = sanitizeRendererOptions({ lanePadding: 'fit', laneFit: SCALED });
    expect(a.laneFit).toEqual(SCALED);
    expect(sanitizeRendererOptions({ laneFit: { ...SCALED } }, a).laneFit).toBe(a.laneFit);
    const plain = sanitizeRendererOptions({ laneFit: { ...DEFAULT_LANE_FIT } }, a).laneFit;
    expect(plain).toEqual({ ...DEFAULT_LANE_FIT, modes: [...GAME_MODE_COLUMNS] });
    expect(plain && 'stepPx' in plain).toBe(false);
    const { ctx } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(640, 105, ctx), {
      scheme: 'mobile',
      lanePadding: 'fit',
      laneFit: SCALED,
    });
    r.setTimeline(buildTimeline(parseHarm(CUE_SONG).song));
    r.render({ beat: 0 });
    const before = r.layout!;
    expect(before.fit!.laneCx[0]).toBeCloseTo(320 - 3.5 * 83.448, 9);
    r.setOptions({ laneFit: { ...SCALED, modes: [...GAME_MODE_COLUMNS] } });
    expect(r.layout).toBe(before);
    r.setOptions({ laneFit: { ...SCALED, shiftPx: 10 } });
    expect(r.layout).not.toBe(before);
    expect(r.layout!.fit!.laneCx[0]).toBeCloseTo(330 - 3.5 * 83.448, 9);
    r.dispose();
  });
});
