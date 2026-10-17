import { describe, expect, it } from 'vitest';
import type { LayoutOptions } from './layout';
import {
  BASE_GUTTER,
  LANE_COUNT,
  TILE_GAP,
  axisToBeat,
  beatToAxis,
  computeLayout,
  lowerBound,
  mapSpan,
  ribbonRect,
  tileLength,
  tileRect,
  visibleBeatRange,
} from './layout';

const V: LayoutOptions = {
  orientation: 'vertical',
  lookahead: 8,
  hitLinePos: 0.82,
  tileScale: 1,
  showRibbons: true,
  showSectionLabels: true,
};
const H: LayoutOptions = { ...V, orientation: 'horizontal' };

const note = (key: 'Z' | 'X' | 'C' | 'V' | 'B' | 'N' | 'M' | ',', start: number, end: number) => ({
  key,
  startBeat: start,
  endBeat: end,
});

describe('computeLayout — vertical', () => {
  const L = computeLayout(800, 600, V);

  it('hit line ở 82% chiều cao, pxPerBeat = hitY / lookahead', () => {
    expect(L.hitPos).toBeCloseTo(492);
    expect(L.pxPerBeat).toBeCloseTo(492 / 8);
    expect(L.timeDir).toBe(-1);
    expect(L.behindBeats).toBeCloseTo((600 - 492) / (492 / 8));
  });

  it('8 lane trái → phải theo thứ tự Z..",", gutter ribbon bên phải ~56px', () => {
    expect(L.lanes).toHaveLength(LANE_COUNT);
    for (let i = 1; i < LANE_COUNT; i++) {
      expect(L.lanes[i].x).toBeGreaterThan(L.lanes[i - 1].x);
      expect(L.lanes[i].x).toBeCloseTo(L.lanes[i - 1].x + L.lanes[i - 1].w);
      expect(L.lanes[i].h).toBe(600);
    }
    expect(L.gutter).not.toBeNull();
    expect(L.gutter!.w).toBe(BASE_GUTTER);
    expect(L.gutter!.x).toBe(800 - BASE_GUTTER);
    const last = L.lanes[LANE_COUNT - 1];
    expect(last.x + last.w).toBeCloseTo(L.gutter!.x);
    // lề trái nhỏ cho nhãn section
    expect(L.labelBand).not.toBeNull();
    expect(L.lanes[0].x).toBe(L.labelBand!.w);
    expect(L.lanes[0].x).toBeLessThan(30);
  });

  it('pxPerBeat suy từ lookahead', () => {
    const L4 = computeLayout(800, 600, { ...V, lookahead: 4 });
    const L12 = computeLayout(800, 600, { ...V, lookahead: 12 });
    expect(L4.pxPerBeat).toBeCloseTo(492 / 4);
    expect(L12.pxPerBeat).toBeCloseTo(492 / 12);
    // ngoài khoảng 4..12 bị kẹp
    expect(computeLayout(800, 600, { ...V, lookahead: 100 }).lookahead).toBe(12);
  });

  it('tắt ribbon + nhãn: lane phủ hết bề ngang', () => {
    const L2 = computeLayout(800, 600, { ...V, showRibbons: false, showSectionLabels: false });
    expect(L2.gutter).toBeNull();
    expect(L2.labelBand).toBeNull();
    expect(L2.lanes[0].x).toBe(0);
    expect(L2.lanes[7].x + L2.lanes[7].w).toBeCloseTo(800);
    expect(ribbonRect({ startBeat: 0, endBeat: 4 }, 0, L2)).toBeNull();
  });

  it('tileScale nhân gutter', () => {
    expect(computeLayout(800, 600, { ...V, tileScale: 1.5 }).gutter!.w).toBe(84);
  });

  it('kích thước 0 / NaN không sinh NaN', () => {
    const L0 = computeLayout(0, Number.NaN, V);
    expect(Number.isFinite(L0.pxPerBeat)).toBe(true);
    expect(Number.isFinite(L0.behindBeats)).toBe(true);
  });
});

describe('computeLayout — horizontal (xoay 90° chiều kim đồng hồ)', () => {
  const L = computeLayout(1000, 300, H);

  it('hit line ở 18% chiều rộng tính từ trái, tile chạy phải → trái', () => {
    expect(L.hitPos).toBeCloseTo(180);
    expect(L.pxPerBeat).toBeCloseTo(820 / 8);
    expect(L.timeDir).toBe(1);
    // beat tương lai ở bên phải
    expect(beatToAxis(2, 0, L)).toBeGreaterThan(L.hitPos);
    expect(beatToAxis(8, 0, L)).toBeCloseTo(1000);
  });

  it('lane thành 8 hàng trên → dưới, gutter ở dưới, nhãn section ở trên', () => {
    for (let i = 1; i < LANE_COUNT; i++) {
      expect(L.lanes[i].y).toBeGreaterThan(L.lanes[i - 1].y);
      expect(L.lanes[i].w).toBe(1000);
    }
    expect(L.gutter!.y).toBe(300 - BASE_GUTTER);
    expect(L.gutter!.h).toBe(BASE_GUTTER);
    expect(L.labelBand!.y).toBe(0);
    expect(L.lanes[0].y).toBe(L.labelBand!.h);
  });

  it('tile chạm hit line đúng startBeat (mép trái), kéo dài sang phải', () => {
    const r = tileRect(note('Z', 10, 11), null, 10, L);
    expect(r.x).toBeCloseTo(180);
    expect(r.w).toBeCloseTo(L.pxPerBeat);
    expect(r.y).toBeGreaterThanOrEqual(L.lanes[0].y);
    expect(r.y + r.h).toBeLessThanOrEqual(L.lanes[0].y + L.lanes[0].h);
    const rc = tileRect(note(',', 10, 11), null, 10, L);
    expect(rc.y).toBeGreaterThan(L.lanes[6].y);
  });

  it('ribbon nằm trong gutter dưới, trải đúng run', () => {
    const r = ribbonRect({ startBeat: 4, endBeat: 12 }, 4, L)!;
    expect(r.x).toBeCloseTo(180);
    expect(r.w).toBeCloseTo(8 * L.pxPerBeat);
    expect(r.y).toBeGreaterThanOrEqual(L.gutter!.y);
    expect(r.y + r.h).toBeLessThanOrEqual(300);
  });

  it('visibleBeatRange: từ mép trái (đã qua) tới mép phải (+lookahead)', () => {
    const range = visibleBeatRange(20, L);
    expect(range.end).toBeCloseTo(28);
    expect(range.start).toBeCloseTo(20 - 180 / L.pxPerBeat);
    expect(beatToAxis(range.start, 20, L)).toBeCloseTo(0);
  });
});

describe('tile geometry', () => {
  const L = computeLayout(800, 600, V);
  const ppb = L.pxPerBeat;

  it('mép dưới chạm hit line đúng lúc currentBeat = startBeat; mép trên = endBeat', () => {
    const r = tileRect(note('C', 10, 12), null, 10, L);
    expect(r.y + r.h).toBeCloseTo(L.hitPos);
    expect(r.h).toBeCloseTo(2 * ppb);
    expect(r.y).toBeCloseTo(beatToAxis(12, 10, L));
    // trước đó 1 beat: còn cách hit line đúng 1 beat
    const r2 = tileRect(note('C', 10, 12), null, 9, L);
    expect(L.hitPos - (r2.y + r2.h)).toBeCloseTo(ppb);
  });

  it('lane theo keyIndex, tile nằm gọn trong lane', () => {
    const keys = ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ','] as const;
    keys.forEach((k, i) => {
      const r = tileRect(note(k, 0, 1), null, 0, L);
      expect(r.x).toBeGreaterThanOrEqual(L.lanes[i].x);
      expect(r.x + r.w).toBeLessThanOrEqual(L.lanes[i].x + L.lanes[i].w + 1e-9);
    });
  });

  it('min height 28 × tileScale, kéo dài lên trên (mép dưới giữ nguyên)', () => {
    const r = tileRect(note('Z', 5, 5.1), null, 5, L);
    expect(r.h).toBeCloseTo(28);
    expect(r.y + r.h).toBeCloseTo(L.hitPos);
    const Ls = computeLayout(800, 600, { ...V, tileScale: 1.5 });
    expect(tileRect(note('Z', 5, 5.1), null, 5, Ls).h).toBeCloseTo(42);
    expect(tileLength(5, 5.1, null, Ls)).toBeCloseTo(42);
  });

  it('luật gap: chừa ≥ 2px trước tile kế cùng lane; min height nhường', () => {
    // 0.1 beat, nốt kế cùng lane ở 0.2 beat → không đủ chỗ cho 28px
    const len = tileLength(0, 0.1, 0.2, L);
    expect(len).toBeCloseTo(0.2 * ppb - TILE_GAP);
    expect(len).toBeLessThan(28);
    const a = tileRect(note('Z', 0, 0.1), 0.2, 0, L);
    const b = tileRect(note('Z', 0.2, 1), null, 0, L);
    expect(a.y - (b.y + b.h)).toBeCloseTo(TILE_GAP);
  });

  it('hai nốt liền nhau cùng phím: tile trước ngắn đi đúng 2px', () => {
    expect(tileLength(0, 1, 1, L)).toBeCloseTo(ppb - TILE_GAP);
    // nốt kế ở xa thì giữ độ dài thật
    expect(tileLength(0, 1, 5, L)).toBeCloseTo(ppb);
    expect(tileLength(0, 1, Infinity, L)).toBeCloseTo(ppb);
  });

  it('beatToAxis / axisToBeat là nghịch đảo', () => {
    for (const b of [-2, 0, 3.25, 17]) {
      expect(axisToBeat(beatToAxis(b, 4, L), 4, L)).toBeCloseTo(b);
    }
  });
});

describe('ribbon + visible range (vertical)', () => {
  const L = computeLayout(800, 600, V);

  it('ribbon trải từ run.startBeat (đáy) tới run.endBeat (đỉnh) trong gutter phải', () => {
    const r = ribbonRect({ startBeat: 4, endBeat: 12 }, 4, L)!;
    expect(r.y + r.h).toBeCloseTo(L.hitPos);
    expect(r.h).toBeCloseTo(8 * L.pxPerBeat);
    expect(r.x).toBeGreaterThanOrEqual(L.gutter!.x);
    expect(r.x + r.w).toBeLessThanOrEqual(800);
    // ribbon chạy cùng tiles
    const t = tileRect(note('Z', 4, 12), null, 6, L);
    const r2 = ribbonRect({ startBeat: 4, endBeat: 12 }, 6, L)!;
    expect(r2.y).toBeCloseTo(t.y);
    expect(r2.y + r2.h).toBeCloseTo(t.y + t.h);
  });

  it('visibleBeatRange khớp mép màn hình', () => {
    const range = visibleBeatRange(10, L);
    expect(range.end).toBe(18);
    expect(beatToAxis(range.end, 10, L)).toBeCloseTo(0);
    expect(beatToAxis(range.start, 10, L)).toBeCloseTo(600);
  });
});

describe('helpers', () => {
  it('lowerBound', () => {
    const a = [0, 1, 1, 2, 5, 8];
    expect(lowerBound(a, -1)).toBe(0);
    expect(lowerBound(a, 1)).toBe(1);
    expect(lowerBound(a, 1.5)).toBe(3);
    expect(lowerBound(a, 8)).toBe(5);
    expect(lowerBound(a, 9)).toBe(6);
    expect(lowerBound(new Float64Array(0), 3)).toBe(0);
  });

  it('mapSpan đổi trục theo hướng', () => {
    const Lv = computeLayout(800, 600, V);
    const Lh = computeLayout(800, 600, H);
    expect(mapSpan(Lv, 10, 20, 100, 50)).toEqual({ x: 10, y: 50, w: 20, h: 50 });
    expect(mapSpan(Lh, 10, 20, 100, 50)).toEqual({ x: 50, y: 10, w: 50, h: 20 });
  });
});
