/**
 * Option renderer / layout thêm cho overlay OBS "khớp game" (lanePadding, tileOpacity, gridStyle):
 * mặc định giữ Player y như trước.
 */
import { describe, expect, it } from 'vitest';
import { parseHarm } from '../core/parser';
import { buildTimeline } from '../core/timeline';
import { CHROMA_GREEN, MOD_COLORS } from '../ui/palette';
import { CANVAS_THEMES, OVERLAY_CANVAS_THEMES, blendOver } from './canvasTheme';
import type { LayoutOptions } from './layout';
import { HIT_LINE_MAX, HIT_LINE_MAX_EDGE, computeLayout, hitLineMaxFor } from './layout';
import {
  DEFAULT_RENDERER_OPTIONS,
  SUBTLE_GRID_ALPHA,
  SUBTLE_LABEL_ALPHA,
  TilesRenderer,
  sanitizeRendererOptions,
} from './renderer';
import type { RendererOptions } from './renderer';

interface Call {
  name: string;
  args: unknown[];
  fillStyle: unknown;
  strokeStyle: unknown;
  globalAlpha: unknown;
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
        calls.push({
          name: prop,
          args,
          fillStyle: state.fillStyle,
          strokeStyle: state.strokeStyle,
          globalAlpha: state.globalAlpha,
        });
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

const SONG = '@bpm 100\n# A\nZ X C V B N M ,\n# B\nL:Z R:X S:C';

function draw(options: Partial<RendererOptions>, w = 576, h = 600) {
  const { ctx, calls } = fakeCtx();
  const r = new TilesRenderer(makeCanvas(w, h, ctx), options);
  r.setTimeline(buildTimeline(parseHarm(SONG).song));
  r.render({ beat: 0.5 });
  const layout = r.layout;
  r.dispose();
  return { calls, layout };
}

const V: LayoutOptions = {
  orientation: 'vertical',
  lookahead: 8,
  hitLinePos: 0.82,
  tileScale: 1,
  showRibbons: true,
  showSectionLabels: true,
};

describe('layout: lanePadding', () => {
  it('mặc định (bỏ trống) = normal: lề nhãn 16 px, hit line kẹp 0.95', () => {
    const a = computeLayout(576, 600, V);
    const b = computeLayout(576, 600, { ...V, lanePadding: 'normal' });
    expect(b).toEqual(a);
    expect(a.labelBand?.w).toBe(16);
    expect(computeLayout(576, 600, { ...V, hitLinePos: 0.97 }).hitPos).toBeCloseTo(0.95 * 600);
    expect(hitLineMaxFor(undefined)).toBe(HIT_LINE_MAX);
  });

  it("'none': 8 lane phủ từ mép trái tới gutter (576 = 8 × 65 + 56), hit line tới 0.99", () => {
    const L = computeLayout(576, 600, { ...V, lanePadding: 'none', hitLinePos: 0.97 });
    expect(L.labelBand).toBeNull();
    expect(L.laneArea.x).toBe(0);
    expect(L.laneCrossSize).toBe(65);
    expect(L.gutter).toEqual({ x: 520, y: 0, w: 56, h: 600 });
    expect(L.hitPos).toBeCloseTo(582);
    expect(
      computeLayout(576, 600, { ...V, lanePadding: 'none', hitLinePos: 2 }).hitPos,
    ).toBeCloseTo(HIT_LINE_MAX_EDGE * 600);
    // Ngang: không dải nhãn phía trên.
    const H = computeLayout(1140, 440, { ...V, orientation: 'horizontal', lanePadding: 'none' });
    expect(H.labelBand).toBeNull();
    expect(H.laneArea.y).toBe(0);
  });
});

describe('renderer: option overlay', () => {
  it('mặc định giữ nguyên Player', () => {
    expect(DEFAULT_RENDERER_OPTIONS).toMatchObject({
      lanePadding: 'normal',
      tileOpacity: 1,
      gridStyle: 'normal',
      hitLinePos: 0.82,
    });
    expect(sanitizeRendererOptions(null)).toEqual(DEFAULT_RENDERER_OPTIONS);
  });

  it('sanitize: kẹp tileOpacity 0.3..1, hit line theo kiểu đệm, enum lạ giữ base', () => {
    const o = sanitizeRendererOptions({
      tileOpacity: 0,
      lanePadding: 'none',
      hitLinePos: 0.97,
      gridStyle: 'subtle',
    });
    expect(o).toMatchObject({
      tileOpacity: 0.3,
      lanePadding: 'none',
      hitLinePos: 0.97,
      gridStyle: 'subtle',
    });
    expect(sanitizeRendererOptions({ tileOpacity: 5 }).tileOpacity).toBe(1);
    expect(sanitizeRendererOptions({ hitLinePos: 0.97 }).hitLinePos).toBe(0.95);
    // Đổi về 'normal' thì hit line của base cũng bị kẹp lại.
    expect(sanitizeRendererOptions({ lanePadding: 'normal' }, o).hitLinePos).toBe(0.95);
    const bad = sanitizeRendererOptions(
      { lanePadding: 'wide' as never, gridStyle: 'loud' as never, tileOpacity: Number.NaN },
      o,
    );
    expect(bad).toMatchObject({ lanePadding: 'none', gridStyle: 'subtle', tileOpacity: 0.3 });
  });

  it('tileOpacity: chỉ thân tile mờ; viền giữ alpha thường', () => {
    const fillAlpha = (calls: Call[], color: string) =>
      calls.filter((c) => c.name === 'fill' && c.fillStyle === color).map((c) => c.globalAlpha);
    const normal = draw({}).calls;
    const faded = draw({ tileOpacity: 0.5 }).calls;
    const fillN = fillAlpha(normal, MOD_COLORS.normal.fill);
    const fillF = fillAlpha(faded, MOD_COLORS.normal.fill);
    expect(fillN.length).toBeGreaterThan(0);
    expect(fillF).toHaveLength(fillN.length);
    fillF.forEach((a, i) => expect(a).toBeCloseTo(Number(fillN[i]) * 0.5));
    const strokes = (calls: Call[]) =>
      calls
        .filter(
          (c) => c.name === 'stroke' && c.strokeStyle === CANVAS_THEMES.dark.tileStroke.normal,
        )
        .map((c) => c.globalAlpha);
    expect(strokes(faded)).toEqual(strokes(normal));
  });

  it('gridStyle subtle trên nền chroma: vạch / nhãn section là màu đặc trộn sẵn, không globalAlpha < 1', () => {
    const ch = OVERLAY_CANVAS_THEMES.chroma;
    const { calls } = draw({ gridStyle: 'subtle', background: 'chroma' });
    const painted = calls.filter(
      (c) => c.name === 'stroke' || c.name === 'fill' || c.name === 'fillText',
    );
    // Mọi nét / mảng (trừ tile đã qua mờ dần — đã trộn sẵn LUT) vẽ với globalAlpha 1.
    expect(painted.every((c) => c.globalAlpha === 1)).toBe(true);
    const strokes = calls.filter((c) => c.name === 'stroke').map((c) => c.strokeStyle);
    expect(strokes).toContain(blendOver(ch.barLine, SUBTLE_GRID_ALPHA, ch.opaqueBase));
    expect(strokes).not.toContain(ch.barLine);
    const texts = calls.filter((c) => c.name === 'fillText').map((c) => c.fillStyle);
    expect(texts).toContain(blendOver(ch.sectionText, SUBTLE_LABEL_ALPHA, ch.opaqueBase));
    // Màu trộn sẵn không có kênh alpha (không phải rgba / #rrggbbaa).
    expect(blendOver(ch.barLine, SUBTLE_GRID_ALPHA, ch.opaqueBase)).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
  });

  it('gridStyle subtle: vạch nhịp / section mờ, nhãn section mờ; normal như cũ', () => {
    const th = CANVAS_THEMES.dark;
    const strokeAlphas = (calls: Call[], color: string) =>
      calls.filter((c) => c.name === 'stroke' && c.strokeStyle === color).map((c) => c.globalAlpha);
    const normal = draw({}).calls;
    const subtle = draw({ gridStyle: 'subtle' }).calls;
    expect(strokeAlphas(normal, th.barLine).every((a) => a === 1)).toBe(true);
    expect(strokeAlphas(subtle, th.barLine).length).toBeGreaterThan(0);
    expect(strokeAlphas(subtle, th.barLine).every((a) => a === SUBTLE_GRID_ALPHA)).toBe(true);
    expect(strokeAlphas(subtle, th.sectionLine).every((a) => a === SUBTLE_GRID_ALPHA)).toBe(true);
    const labelAlpha = (calls: Call[]) =>
      calls
        .filter((c) => c.name === 'fillText' && c.fillStyle === th.sectionText)
        .map((c) => c.globalAlpha);
    expect(labelAlpha(normal).length).toBeGreaterThan(0);
    expect(labelAlpha(normal).every((a) => a === 1)).toBe(true);
    expect(labelAlpha(subtle).every((a) => a === SUBTLE_LABEL_ALPHA)).toBe(true);
    // Hit line luôn đậm.
    const hit = (calls: Call[]) =>
      calls
        .filter((c) => c.name === 'stroke' && c.strokeStyle === th.hitLine)
        .map((c) => c.globalAlpha);
    expect(hit(subtle)).toEqual([1]);
  });

  it('preset khớp game: nền trong suốt (clearRect), lane phủ kín, hit line 0.97', () => {
    const { calls, layout } = draw({
      background: 'transparent',
      lanePadding: 'none',
      hitLinePos: 0.97,
      tileOpacity: 0.85,
      gridStyle: 'subtle',
    });
    expect(calls.some((c) => c.name === 'clearRect')).toBe(true);
    expect(calls.some((c) => c.name === 'fillRect' && c.fillStyle === CHROMA_GREEN)).toBe(false);
    expect(layout?.laneArea.x).toBe(0);
    expect(layout?.hitPos).toBeCloseTo(582);
  });

  it('nền chroma: tô #00FF00 cả canvas', () => {
    const { calls } = draw({ background: 'chroma' });
    expect(calls.some((c) => c.name === 'fillRect' && c.fillStyle === CHROMA_GREEN)).toBe(true);
  });

  it('setOptions(lanePadding) tính lại layout', () => {
    const { ctx } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(576, 600, ctx));
    r.setTimeline(buildTimeline(parseHarm(SONG).song));
    r.resize();
    expect(r.layout?.laneArea.x).toBe(16);
    r.setOptions({ lanePadding: 'none', hitLinePos: 0.97 });
    expect(r.layout?.laneArea.x).toBe(0);
    expect(r.layout?.hitPos).toBeCloseTo(582);
    r.dispose();
  });
});
