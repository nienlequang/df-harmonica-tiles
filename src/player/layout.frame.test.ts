/**
 * Khung bảng phím PC (v1.0.1, góp ý "ô ngoài cùng không được sát viền" — `framePad` của layout / renderer): Cửa sổ
 * nổi PC + overlay khớp game `fit=canvas` rộng bằng khung bảng phím của game, 8 làn ở giữa, đệm GAME_FRAME_PAD bước
 * mỗi bên, gutter ribbon sau đệm phải; vạch chỉ ngăn GIỮA các cột (như game) + một vạch ở mép phải khung.
 */
import { describe, expect, it } from 'vitest';
import { parseHarm } from '../core/parser';
import { buildTimeline } from '../core/timeline';
import { OVERLAY_CANVAS_THEMES } from './canvasTheme';
import type { Layout, LayoutOptions } from './layout';
import { FRAME_PAD_MAX, GAME_FRAME_PAD, LANE_COUNT, computeLayout, tileRect } from './layout';
import { DEFAULT_RENDERER_OPTIONS, TilesRenderer, sanitizeRendererOptions } from './renderer';
import type { RendererOptions } from './renderer';

const NONE: LayoutOptions = {
  orientation: 'vertical',
  lookahead: 6,
  hitLinePos: 0.97,
  tileScale: 1,
  showRibbons: true,
  showSectionLabels: true,
  lanePadding: 'none',
};

/** 1080p: khung bảng phím 553,8 (8 × 65 + 2 × 16,9) + gutter 56. */
const W_1080 = 610;

describe('layout: framePad (khung bảng phím PC)', () => {
  it('bỏ trống / 0 = như trước (8 làn phủ kín tới gutter), frameInset 0', () => {
    const a = computeLayout(576, 600, NONE);
    expect(computeLayout(576, 600, { ...NONE, framePad: 0 })).toEqual(a);
    expect(a.frameInset).toBe(0);
    expect(a.laneCrossStart[0]).toBe(0);
    expect(a.laneCrossSize).toBe(65);
    expect(a.gutter).toEqual({ x: 520, y: 0, w: 56, h: 600 });
  });

  it('GAME_FRAME_PAD ở 610 × 600: 8 làn 65 px giữa khung 554, đệm ≈ 16,9 mỗi bên, gutter sau đệm phải', () => {
    expect(GAME_FRAME_PAD).toBe(0.26);
    const L = computeLayout(W_1080, 600, { ...NONE, framePad: GAME_FRAME_PAD });
    const frame = W_1080 - 56;
    expect(L.laneCrossSize).toBeCloseTo(frame / (LANE_COUNT + 2 * GAME_FRAME_PAD), 9);
    expect(L.laneCrossSize).toBeCloseTo(65, 1);
    expect(L.frameInset).toBeCloseTo(GAME_FRAME_PAD * L.laneCrossSize, 9);
    expect(L.frameInset).toBeCloseTo(16.9, 1);
    expect(L.laneArea.x).toBeCloseTo(L.frameInset, 9);
    expect(L.laneArea.w).toBeCloseTo(8 * L.laneCrossSize, 9);
    // Tâm 8 làn = tâm khung (khung = [0, mép trái gutter]).
    expect(L.laneArea.x + L.laneArea.w / 2).toBeCloseTo(frame / 2, 9);
    expect(L.gutter).toEqual({ x: frame, y: 0, w: 56, h: 600 });
    expect(L.ribbonCrossStart).toBe(frame + 5);
    expect(L.ribbonCrossSize).toBe(46);
    // Ô ngoài cùng cách mép trái khung / vạch gutter ≈ 21,9 px (0,34 bước) — trước là 5 px.
    const z = tileRect({ key: 'Z', startBeat: 0, endBeat: 1 }, null, 0, L);
    const comma = tileRect({ key: ',', startBeat: 0, endBeat: 1 }, null, 0, L);
    expect(z.x).toBeCloseTo(L.frameInset + L.laneInset, 9);
    expect(z.x / L.laneCrossSize).toBeCloseTo(0.337, 2);
    expect(frame - (comma.x + comma.w)).toBeCloseTo(z.x, 9);
  });

  it('không ribbon: khung = cả bề ngang, 8 làn ở giữa', () => {
    const L = computeLayout(554, 600, { ...NONE, framePad: GAME_FRAME_PAD, showRibbons: false });
    expect(L.gutter).toBeNull();
    expect(L.laneArea.x + L.laneArea.w / 2).toBeCloseTo(277, 9);
    expect(L.laneArea.x + L.laneArea.w + L.frameInset).toBeCloseTo(554, 9);
  });

  it("chỉ áp cho 'none': 'normal' / 'pad' / 'fit' bỏ qua", () => {
    for (const lanePadding of ['normal', 'pad', 'fit'] as const) {
      const base = computeLayout(W_1080, 600, { ...NONE, lanePadding });
      const padded = computeLayout(W_1080, 600, { ...NONE, lanePadding, framePad: GAME_FRAME_PAD });
      expect(padded).toEqual(base);
      expect(padded.frameInset).toBe(0);
    }
  });

  it('số lạ: NaN / âm → 0; quá lớn → FRAME_PAD_MAX', () => {
    const plain = computeLayout(W_1080, 600, NONE);
    expect(computeLayout(W_1080, 600, { ...NONE, framePad: Number.NaN })).toEqual(plain);
    expect(computeLayout(W_1080, 600, { ...NONE, framePad: -1 })).toEqual(plain);
    const big = computeLayout(W_1080, 600, { ...NONE, framePad: 9 });
    expect(big.frameInset).toBeCloseTo(FRAME_PAD_MAX * big.laneCrossSize, 9);
  });

  it('dải ngang: đệm trên trục cross (trên / dưới 8 làn), gutter ở dưới', () => {
    const L = computeLayout(1140, 610, {
      ...NONE,
      orientation: 'horizontal',
      framePad: GAME_FRAME_PAD,
    });
    expect(L.laneArea.y).toBeCloseTo(L.frameInset, 9);
    expect(L.gutter?.y).toBeCloseTo(554, 9);
  });
});

// ---------------------------------------------------------------------------
// Renderer: option + vạch ngăn làn
// ---------------------------------------------------------------------------

interface Call {
  name: string;
  args: unknown[];
  strokeStyle: unknown;
}

function fakeCtx(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    globalAlpha: 1,
    font: '10px sans-serif',
    lineWidth: 1,
    shadowBlur: 0,
  };
  const stack: Record<string, unknown>[] = [];
  const proxy = new Proxy({} as Record<string, unknown>, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop in state) return state[prop];
      return (...args: unknown[]) => {
        calls.push({ name: prop, args, strokeStyle: state.strokeStyle });
        if (prop === 'measureText') return { width: String(args[0]).length * 7 };
        if (prop === 'save') stack.push({ ...state });
        if (prop === 'restore') Object.assign(state, stack.pop() ?? {});
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

const SONG = '@bpm 100\n# A\nZ X C V B N M ,\nL:Z R:X';

/** Vẽ một khung, trả về toạ độ x các vạch dọc phủ cả chiều cao (vạch ngăn làn) + layout. */
function separators(options: Partial<RendererOptions>, w = W_1080, h = 600) {
  const { ctx, calls } = fakeCtx();
  const r = new TilesRenderer(makeCanvas(w, h, ctx), {
    background: 'transparent',
    lanePadding: 'none',
    hitLinePos: 0.97,
    ...options,
  });
  r.setTimeline(buildTimeline(parseHarm(SONG).song));
  r.render({ beat: 0.5 });
  const L = r.layout as Layout;
  r.dispose();
  const xs: number[] = [];
  for (let i = 0; i + 1 < calls.length; i++) {
    const a = calls[i];
    const b = calls[i + 1];
    if (
      a.name === 'moveTo' &&
      b.name === 'lineTo' &&
      a.args[1] === 0 &&
      b.args[1] === h &&
      a.args[0] === b.args[0] &&
      a.strokeStyle === OVERLAY_CANVAS_THEMES.transparent.laneSeparator
    ) {
      xs.push(a.args[0] as number);
    }
  }
  return { xs, L };
}

describe('renderer: framePad', () => {
  it('mặc định 0; sanitize kẹp 0..FRAME_PAD_MAX, số lạ giữ base', () => {
    expect(DEFAULT_RENDERER_OPTIONS.framePad).toBe(0);
    expect(sanitizeRendererOptions({ framePad: GAME_FRAME_PAD }).framePad).toBe(GAME_FRAME_PAD);
    expect(sanitizeRendererOptions({ framePad: -2 }).framePad).toBe(0);
    expect(sanitizeRendererOptions({ framePad: 7 }).framePad).toBe(FRAME_PAD_MAX);
    const base = sanitizeRendererOptions({ framePad: 0.2 });
    expect(sanitizeRendererOptions({ framePad: Number.NaN }, base).framePad).toBe(0.2);
  });

  it('đổi framePad lúc đang chạy → dựng lại layout (làn dời vào giữa)', () => {
    const { ctx } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(W_1080, 600, ctx), { lanePadding: 'none' });
    r.render({ beat: 0 });
    expect(r.layout?.laneCrossStart[0]).toBe(0);
    r.setOptions({ framePad: GAME_FRAME_PAD });
    r.render({ beat: 0 });
    expect(r.layout?.laneCrossStart[0]).toBeCloseTo(16.9, 1);
    r.dispose();
  });

  it('không đệm: 8 vạch (giữa các làn + mép làn / gutter) như trước', () => {
    const { xs, L } = separators({});
    expect(L.frameInset).toBe(0);
    expect(xs).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((i) => Math.round(i * L.laneCrossSize) + 0.5));
  });

  it('có đệm: chỉ 7 vạch GIỮA các cột (mép ngoài 8 làn để trống) + 1 vạch ở mép phải khung (gutter)', () => {
    const { xs, L } = separators({ framePad: GAME_FRAME_PAD });
    const inner = [1, 2, 3, 4, 5, 6, 7].map(
      (i) => Math.round(L.laneCrossStart[0] + i * L.laneCrossSize) + 0.5,
    );
    expect(xs).toEqual([...inner, Math.round(W_1080 - 56) + 0.5]);
    // Không có vạch ở mép ngoài làn 1 / làn 8 (ô ngoài cùng không bị vạch kẹp sát).
    expect(xs).not.toContain(Math.round(L.laneCrossStart[0]) + 0.5);
    expect(xs).not.toContain(Math.round(L.laneCrossStart[0] + 8 * L.laneCrossSize) + 0.5);
  });

  it('có đệm nhưng không ribbon: 7 vạch giữa các cột, không vạch mép', () => {
    const { xs } = separators({ framePad: GAME_FRAME_PAD, showRibbons: false }, 554);
    expect(xs).toHaveLength(7);
  });
});
