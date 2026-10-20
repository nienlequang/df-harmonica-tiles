/**
 * Thanh bấm lặp (D-447): ≥ 4 nốt ngắn liên tiếp cùng một lần bấm vẽ thành MỘT tile dài có số lần bấm còn lại.
 * Bài thử là các dòng `.harm` tự viết (không phải bài hát thật).
 */
import { describe, expect, it, vi } from 'vitest';
import { NOTE_KEYS } from '../core/keys';
import { parseHarm } from '../core/parser';
import { buildTimeline } from '../core/timeline';
import type { NoteKey, Timeline } from '../core/types';
import { translate } from '../i18n/strings';
import { MOD_COLORS } from '../ui/palette';
import { CANVAS_THEMES } from './canvasTheme';
import type { Layout } from './layout';
import { GAME_FRAME_PAD, cueTargets, tileLength } from './layout';
import { NoteState, REPEAT_COUNT_MIN_PX, TilesRenderer } from './renderer';
import type { RendererOptions } from './renderer';

interface Call {
  name: string;
  args: unknown[];
  fillStyle: unknown;
  strokeStyle: unknown;
  globalAlpha: unknown;
  font: unknown;
  shadowBlur: unknown;
}

function fakeCtx(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    globalAlpha: 1,
    font: '10px sans-serif',
    lineWidth: 1,
    lineJoin: 'miter',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    shadowBlur: 0,
    shadowColor: 'transparent',
  };
  const stack: Record<string, unknown>[] = [];
  const fontPx = (): number => {
    const m = /(\d+(?:\.\d+)?)px/.exec(String(state.font));
    return m ? Number(m[1]) : 10;
  };
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
          font: state.font,
          shadowBlur: state.shadowBlur,
        });
        if (prop === 'measureText') return { width: String(args[0]).length * fontPx() * 0.6 };
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

function timelineOf(...lines: string[]): Timeline {
  const r = parseHarm(['@bpm 120', '# A', ...lines].join('\n'));
  expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
  return buildTimeline(r.song);
}

/** Z [0,1) · nghỉ · N × 5 nốt 0,5 beat [2, 4.5) · nghỉ 0,5 · X [5,6). Nốt N: index 1..5. */
const BAR_LINE = 'Z _ N*0.5 N*0.5 N*0.5 N*0.5 N*0.5 _*0.5 X';
const N_STARTS = [2, 2.5, 3, 3.5, 4];

function setup(
  opts: Partial<RendererOptions> = {},
  w = 980,
  h = 743,
  tl: Timeline = timelineOf(BAR_LINE),
) {
  const { ctx, calls } = fakeCtx();
  const r = new TilesRenderer(makeCanvas(w, h, ctx), opts);
  r.setTimeline(tl);
  r.render({ beat: 0 });
  const L = r.layout!;
  const frame = (beat: number, extra: Record<string, unknown> = {}): Call[] => {
    calls.length = 0;
    r.render({ beat, timeMs: 0, ...extra });
    return calls;
  };
  return { r, calls, L, frame };
}

const lane = (key: NoteKey): number => NOTE_KEYS.indexOf(key);
const vertical = (L: Layout): boolean => L.orientation === 'vertical';
/** Mép đầu bề ngang tile trong lane (trục cross). */
const tileCross0 = (L: Layout, key: NoteKey): number => L.laneCrossStart[lane(key)] + L.laneInset;
/** Thân tile (roundRect) trong lane `key` — thanh vẽ hai lần cùng hình (thân + viền ngoài): bỏ trùng. */
function bodies(calls: Call[], L: Layout, key: NoteKey): number[][] {
  const c0 = tileCross0(L, key);
  const out: number[][] = [];
  for (const c of calls) {
    if (c.name !== 'roundRect') continue;
    const a = c.args.map(Number);
    if (Math.abs(a[vertical(L) ? 0 : 1] - c0) > 1e-3) continue;
    if (!out.some((b) => b.every((v, i) => Math.abs(v - a[i]) < 1e-3))) out.push(a);
  }
  return out;
}
/** Lần tô thân thanh (lệnh `fill` ngay sau roundRect đầu tiên trong lane `key`). */
function barFill(calls: Call[], L: Layout, key: NoteKey): Call {
  const c0 = tileCross0(L, key);
  const at = calls.findIndex(
    (c) => c.name === 'roundRect' && Math.abs(Number(c.args[vertical(L) ? 0 : 1]) - c0) < 1e-3,
  );
  expect(at).toBeGreaterThanOrEqual(0);
  return calls.slice(at).find((c) => c.name === 'fill')!;
}
const fillTexts = (calls: Call[], text: string): Call[] =>
  calls.filter((c) => c.name === 'fillText' && c.args[0] === text);
const countTexts = (calls: Call[]): string[] =>
  calls
    .filter((c) => c.name === 'fillText' && String(c.args[0]).startsWith('×'))
    .map((c) => String(c.args[0]));
/** Toạ độ trục thời gian của beat `b` khi bài ở `cur`. */
const axisOf = (L: Layout, b: number, cur: number): number =>
  L.hitPos + L.timeDir * (b - cur) * L.pxPerBeat;
const fontPxOf = (c: Call): number => Number(/(\d+(?:\.\d+)?)px/.exec(String(c.font))![1]);

/** Một đoạn vạch đầu nốt trong thân thanh: beat của nốt, vị trí trục thời gian, đoạn [a, b] trên trục cross. */
interface TickSeg {
  beat: number;
  t: number;
  a: number;
  b: number;
}
/**
 * Vạch đầu nốt (moveTo → lineTo cắt ngang trục thời gian tại đầu một nốt trong `starts`, bài ở `cur`) nằm trong bề
 * ngang thanh ở lane `key` — vạch lưới cùng beat chạy hết các lane nên bị loại.
 */
function tickSegs(
  calls: Call[],
  L: Layout,
  key: NoteKey,
  starts: number[],
  cur: number,
): TickSeg[] {
  const v = vertical(L);
  const c0 = tileCross0(L, key);
  const c1 = c0 + L.laneCrossSize - 2 * L.laneInset;
  const out: TickSeg[] = [];
  for (let k = 0; k + 1 < calls.length; k++) {
    const m = calls[k];
    const l = calls[k + 1];
    if (m.name !== 'moveTo' || l.name !== 'lineTo') continue;
    const [mx, my] = m.args.map(Number);
    const [lx, ly] = l.args.map(Number);
    const t = v ? my : mx;
    if (Math.abs((v ? ly : lx) - t) > 1e-6) continue;
    const beat = starts.find((s) => Math.abs(t - axisOf(L, s, cur)) < 1e-3);
    if (beat === undefined) continue;
    const a = Math.min(v ? mx : my, v ? lx : ly);
    const b = Math.max(v ? mx : my, v ? lx : ly);
    if (a < c0 - 1e-3 || b > c1 + 1e-3) continue;
    out.push({ beat, t, a, b });
  }
  return out;
}
/**
 * Chữ (fillText) trong bề ngang thanh ở lane `key` mà một vạch đi qua — hộp chữ theo measureText giả (0,6 em mỗi ký
 * tự) × cao 1 em. Trả "chữ@beat" của các lần cắt.
 */
function tickHits(calls: Call[], L: Layout, key: NoteKey, segs: TickSeg[]): string[] {
  const v = vertical(L);
  const c0 = tileCross0(L, key);
  const c1 = c0 + L.laneCrossSize - 2 * L.laneInset;
  const hits: string[] = [];
  for (const c of calls) {
    if (c.name !== 'fillText') continue;
    const text = String(c.args[0]);
    const tx = Number(c.args[1]);
    const ty = Number(c.args[2]);
    const cross = v ? tx : ty;
    if (cross < c0 || cross > c1) continue;
    const px = fontPxOf(c);
    const hw = (v ? text.length * px * 0.6 : px) / 2;
    const hh = (v ? px : text.length * px * 0.6) / 2;
    const time = v ? ty : tx;
    for (const g of segs) {
      if (Math.abs(g.t - time) < hh && g.a < cross + hw && g.b > cross - hw) {
        hits.push(`${text}@${g.beat}`);
      }
    }
  }
  return hits;
}

describe('TilesRenderer — thanh bấm lặp (D-447)', () => {
  it('chuỗi "×n" lấy từ strings.ts (vi + en, dấu nhân U+00D7)', () => {
    expect(translate('vi', 'player.repeatCount', { n: 5 })).toBe('×5');
    expect(translate('en', 'player.repeatCount', { n: 12 })).toBe('×12');
  });

  it('5 nốt N liền nhau: MỘT thân tile từ đầu nốt đầu tới hết nốt cuối, một nhãn "N" + "×5"', () => {
    const { L, frame } = setup();
    const calls = frame(0);
    const b = bodies(calls, L, 'N');
    expect(b).toHaveLength(1);
    const [x, y, w, h] = b[0];
    const len = tileLength(2, 4.5, null, L);
    expect(h).toBeCloseTo(len, 4);
    expect(y + h).toBeCloseTo(axisOf(L, 2, 0), 4);
    expect(x).toBeCloseTo(tileCross0(L, 'N'), 6);
    expect(w).toBeCloseTo(L.laneCrossSize - 2 * L.laneInset, 6);
    expect(fillTexts(calls, 'N')).toHaveLength(1);
    expect(countTexts(calls)).toEqual(['×5']);
    // Số nằm dưới nhãn phím (dòng cuối khối nhãn, gần hit line), cùng cột, trong thân thanh.
    const key = fillTexts(calls, 'N')[0];
    const cnt = fillTexts(calls, '×5')[0];
    expect(Number(cnt.args[1])).toBeCloseTo(Number(key.args[1]), 6);
    expect(Number(cnt.args[2])).toBeGreaterThan(Number(key.args[2]));
    expect(Number(cnt.args[2])).toBeLessThan(y + h);
    expect(Number(key.args[2])).toBeGreaterThan(y);
    // Màu chữ của tile thường.
    expect(cnt.fillStyle).toBe(MOD_COLORS.normal.text);
    // Hai tile thường còn nguyên.
    expect(bodies(calls, L, 'Z')).toHaveLength(1);
    expect(bodies(calls, L, 'X')).toHaveLength(1);
  });

  it('vạch mảnh ở đầu từng nốt bên trong thanh (4 vạch cho 5 nốt), trong bề ngang tile', () => {
    const { L, frame } = setup();
    const calls = frame(0.5);
    const c0 = tileCross0(L, 'N');
    const cs = L.laneCrossSize - 2 * L.laneInset;
    const ticks = calls.filter(
      (c) =>
        c.name === 'moveTo' &&
        Number(c.args[0]) > c0 &&
        Number(c.args[0]) < c0 + cs / 2 &&
        N_STARTS.slice(1).some((s) => Math.abs(Number(c.args[1]) - axisOf(L, s, 0.5)) < 1e-3),
    );
    expect(ticks).toHaveLength(4);
    // Không có vạch ở đầu thanh (mép gần là viền tile).
    expect(
      calls.some(
        (c) =>
          c.name === 'moveTo' &&
          Number(c.args[0]) > c0 &&
          Math.abs(Number(c.args[1]) - axisOf(L, 2, 0.5)) < 1e-3,
      ),
    ).toBe(false);
  });

  it('đếm lùi khi từng nốt đi qua hit line; sau lần bấm cuối ẩn số, thanh vẫn kết thúc đúng chỗ', () => {
    const { L, frame } = setup();
    expect(countTexts(frame(1.99))).toEqual(['×5']);
    // Đầu thanh đúng ở hit line (vd. dừng ở đầu dòng): nốt đầu chưa bấm.
    expect(countTexts(frame(2))).toEqual(['×5']);
    expect(countTexts(frame(2.01))).toEqual(['×4']);
    expect(countTexts(frame(2.3))).toEqual(['×4']);
    expect(countTexts(frame(2.6))).toEqual(['×3']);
    expect(countTexts(frame(3.2))).toEqual(['×2']);
    expect(countTexts(frame(3.9))).toEqual(['×1']);
    const after = frame(4.1);
    expect(countTexts(after)).toEqual([]);
    expect(fillTexts(after, 'N')).toHaveLength(1);
    const [, y, , h] = bodies(after, L, 'N')[0];
    expect(y).toBeCloseTo(axisOf(L, 2, 4.1) - tileLength(2, 4.5, null, L), 4);
    expect(y + h).toBeCloseTo(axisOf(L, 2, 4.1), 4);
  });

  it('thanh đã chạm hit line: nhãn + số đứng ngay trên hit line (phần chưa bấm), đuôi tới thì đi theo đuôi', () => {
    const { L, frame } = setup();
    for (const beat of [2.2, 2.9, 3.4]) {
      const calls = frame(beat);
      const key = fillTexts(calls, 'N')[0];
      const cnt = calls.find((c) => c.name === 'fillText' && /^×/.test(String(c.args[0])));
      expect(cnt, `beat ${beat}`).toBeTruthy();
      const top = bodies(calls, L, 'N')[0][1];
      expect(Number(key.args[2])).toBeLessThan(L.hitPos);
      expect(Number(key.args[2])).toBeGreaterThan(top);
      expect(Number(cnt!.args[2])).toBeLessThan(L.hitPos);
      // Sát hit line: dòng số cách hit line không quá một dòng chữ + đệm.
      expect(L.hitPos - Number(cnt!.args[2])).toBeLessThan(fontPxOf(cnt!) * 1.2);
    }
    // Đuôi thanh còn ngắn hơn khối nhãn phía trên hit line → nhãn xuống theo đuôi (vẫn trong thanh).
    const calls = frame(4.3);
    const [, y, , h] = bodies(calls, L, 'N')[0];
    const key = fillTexts(calls, 'N')[0];
    expect(Number(key.args[2])).toBeGreaterThan(y);
    expect(Number(key.args[2])).toBeLessThan(y + h);
  });

  it('đúng 3 nốt: ba tile thường, không số; 0,75 beat cắt chuỗi', () => {
    let { L, frame } = setup({}, 980, 743, timelineOf('N*0.5 N*0.5 N*0.5 X'));
    let calls = frame(-1);
    expect(bodies(calls, L, 'N')).toHaveLength(3);
    expect(countTexts(calls)).toEqual([]);
    ({ L, frame } = setup({}, 980, 743, timelineOf('N*0.5 N*0.5 N*0.75 N*0.5 N*0.5 X')));
    calls = frame(-1);
    expect(bodies(calls, L, 'N')).toHaveLength(5);
    expect(countTexts(calls)).toEqual([]);
  });

  it('hai thanh liền nhau ở hai phím: mỗi thanh một số riêng; vắt qua xuống dòng vẫn một thanh', () => {
    const { L, frame } = setup(
      {},
      980,
      743,
      timelineOf('B*0.5 B*0.5 B*0.5', 'B*0.5 V*0.25 V*0.25 V*0.25 V*0.25 V*0.25 V*0.25'),
    );
    const calls = frame(-0.5);
    expect(bodies(calls, L, 'B')).toHaveLength(1);
    expect(bodies(calls, L, 'V')).toHaveLength(1);
    expect(countTexts(calls).sort()).toEqual(['×4', '×6']);
  });

  it('nốt đang ở hit line: thanh glow + đoạn của nốt đó phủ sáng, mỗi lần bấm loé rồi tắt dần trước lần kế', () => {
    const { L, frame } = setup();
    const calls = frame(2.55);
    const glowFill = calls.find(
      (c) =>
        c.name === 'fill' && Number(c.shadowBlur) > 0 && c.fillStyle === MOD_COLORS.normal.fill,
    );
    expect(glowFill).toBeDefined();
    // Đoạn nốt thứ hai [2.5, 3): phủ ACTIVE_FILL đúng đoạn đó.
    const seg = calls.filter(
      (c) => c.name === 'fillRect' && c.fillStyle === 'rgba(255,255,255,0.22)',
    );
    expect(seg).toHaveLength(1);
    const [, sy, , sh] = seg[0].args.map(Number);
    expect(sy).toBeCloseTo(axisOf(L, 3, 2.55), 4);
    expect(sy + sh).toBeCloseTo(axisOf(L, 2.5, 2.55), 4);
    // Mỗi lần bấm loé như tile đơn: mạnh ở đầu nốt, tắt dần, hết trước lần bấm kế rồi loé lại.
    const pulse = (beat: number): number => {
      const f = frame(beat).filter((c) => c.name === 'fillRect' && c.fillStyle === '#ffffff');
      return f.length ? Number(f[0].globalAlpha) : 0;
    };
    const glow = (beat: number): number =>
      Math.max(
        0,
        ...frame(beat)
          .filter((c) => c.name === 'fill' && Number(c.shadowBlur) > 0)
          .map((c) => Number(c.shadowBlur)),
      );
    expect(pulse(2.51)).toBeGreaterThan(0.4);
    expect(pulse(2.8)).toBeGreaterThan(0);
    expect(pulse(2.8)).toBeLessThan(pulse(2.51));
    expect(pulse(2.97)).toBe(0);
    expect(pulse(3.01)).toBeGreaterThan(0.4);
    expect(glow(2.51)).toBeGreaterThan(glow(2.97) * 2);
    expect(glow(3.01)).toBeGreaterThan(glow(2.97) * 2);
    // Khoảng nghỉ sau thanh: không sáng.
    expect(frame(4.7).some((c) => c.name === 'fill' && Number(c.shadowBlur) > 0)).toBe(false);
  });

  it('giảm chuyển động: không loé lúc chạm (vẫn phủ sáng đoạn đang ở hit line)', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((q: string) => ({
        matches: q.includes('reduced-motion'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    try {
      const { frame } = setup();
      const calls = frame(2.55);
      expect(calls.some((c) => c.name === 'fillRect' && c.fillStyle === '#ffffff')).toBe(false);
      expect(
        calls.some((c) => c.name === 'fillRect' && c.fillStyle === 'rgba(255,255,255,0.22)'),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('luyện tập: trúng / trượt theo từng nốt (đoạn mờ + viền màu chấm), chờ bấm vẫn tính nốt đang chờ', () => {
    const { L, frame } = setup();
    const states = new Uint8Array(7);
    states[1] = NoteState.perfect;
    states[2] = NoteState.miss;
    let calls = frame(2.6, { noteStates: states });
    const theme = CANVAS_THEMES.dark;
    const perfect = calls.filter((c) => c.name === 'strokeRect' && c.strokeStyle === theme.perfect);
    const miss = calls.filter((c) => c.name === 'strokeRect' && c.strokeStyle === theme.miss);
    expect(perfect).toHaveLength(1);
    expect(miss).toHaveLength(1);
    // Thân thanh ở độ đục thấp nhất (trượt 0.4); đoạn chưa chấm tô thêm cho đủ độ đục.
    const body = barFill(calls, L, 'N');
    expect(body.fillStyle).toBe(MOD_COLORS.normal.fill);
    expect(Number(body.globalAlpha)).toBeCloseTo(0.4, 6);
    const lift = calls.filter(
      (c) => c.name === 'fillRect' && c.fillStyle === MOD_COLORS.normal.fill,
    );
    // Nốt trúng (0.45 > 0.4) + 3 nốt chưa chấm.
    expect(lift).toHaveLength(4);
    // Loé trắng của nốt trúng (lệch 0.6 beat → hết loé ở 2.6; ở 2.1 còn).
    calls = frame(2.1, { noteStates: states });
    expect(
      calls.some(
        (c) => c.name === 'fillRect' && c.fillStyle === '#ffffff' && Number(c.globalAlpha) > 0.3,
      ),
    ).toBe(true);
    // Chế độ chờ: transport đứng ở đầu nốt 3 (beat 3), nốt đó đang chờ → còn 3 lần bấm (3, 3.5, 4).
    const wait = new Uint8Array(7);
    wait[3] = NoteState.waiting;
    calls = frame(3, { noteStates: wait });
    expect(countTexts(calls)).toEqual(['×3']);
    expect(calls.some((c) => c.name === 'stroke' && c.strokeStyle === theme.waiting)).toBe(true);
    // Nốt đang chờ (đúng ở hit line) sáng như tile thường.
    const seg = calls.filter(
      (c) => c.name === 'fillRect' && c.fillStyle === 'rgba(255,255,255,0.22)',
    );
    expect(seg).toHaveLength(1);
    expect(Number(seg[0].args[1]) + Number(seg[0].args[3])).toBeCloseTo(axisOf(L, 3, 3), 3);
    // Bấm xong (transport chạy tiếp) → 2.
    expect(countTexts(frame(3.05))).toEqual(['×2']);
  });

  it('đếm vào cắt giữa thanh: nốt của ô tua lại mờ, không tính vào số, không sáng', () => {
    const { L, frame } = setup();
    // Bắt đầu phát ở beat 3: nốt [2,2.5) và [2.5,3) thuộc ô nhịp đếm vào.
    const calls = frame(2.2, { countIn: { start: 0, end: 3 } });
    expect(countTexts(calls)).toEqual(['×3']);
    const body = barFill(calls, L, 'N');
    expect(Number(body.globalAlpha)).toBeCloseTo(0.22, 6);
    expect(calls.some((c) => c.name === 'fill' && Number(c.shadowBlur) > 0)).toBe(false);
    // 3 đoạn không thuộc ô đếm vào tô đậm lại.
    expect(
      calls.filter((c) => c.name === 'fillRect' && c.fillStyle === MOD_COLORS.normal.fill),
    ).toHaveLength(3);
    // Cả thanh thuộc ô đếm vào (không bấm) → cả thanh mờ, không có số.
    const all = frame(1, { countIn: { start: 0, end: 5 } });
    expect(countTexts(all)).toEqual([]);
    expect(Number(barFill(all, L, 'N').globalAlpha)).toBeCloseTo(0.22, 6);
  });

  it('loop A-B: loop end cắt còn < 4 nốt → tile thường; cắt còn ≥ 4 → thanh dừng ở loop end; vòng kế có thanh riêng', () => {
    let { L, frame } = setup();
    let calls = frame(0, { loop: { start: 0, end: 3.25 } });
    expect(countTexts(calls)).toEqual([]);
    expect(bodies(calls, L, 'N').length).toBeGreaterThanOrEqual(3);
    calls = frame(0, { loop: { start: 0, end: 4.25 } });
    expect(countTexts(calls)).toEqual(['×5']);
    const [, y, , h] = bodies(calls, L, 'N')[0];
    expect(h).toBeCloseTo((4.25 - 2) * L.pxPerBeat - L.tileGap, 4);
    expect(y + h).toBeCloseTo(axisOf(L, 2, 0), 4);
    // Loop [2.5, 5): các vòng kế bắt đầu ở nốt thứ hai — thanh 4 nốt "×4"; vòng hiện tại đã bấm hết (không số).
    ({ L, frame } = setup());
    calls = frame(4.6, { loop: { start: 2.5, end: 5 } });
    const counts = countTexts(calls);
    expect(counts.length).toBeGreaterThan(0);
    for (const t of counts) expect(t).toBe('×4');
    expect(bodies(calls, L, 'N').length).toBe(counts.length + 1);
  });

  it('hướng ngang: thanh chạy phải → trái, số sau nhãn phím cùng hàng; chạm hit line thì đứng ngay sau hit line', () => {
    const { L, frame } = setup({ orientation: 'horizontal' }, 1280, 360);
    let calls = frame(0);
    const b = bodies(calls, L, 'N');
    expect(b).toHaveLength(1);
    const [x, , w] = b[0];
    expect(x).toBeCloseTo(axisOf(L, 2, 0), 4);
    expect(w).toBeCloseTo(tileLength(2, 4.5, null, L), 4);
    let key = fillTexts(calls, 'N')[0];
    let cnt = fillTexts(calls, '×5')[0];
    expect(Number(cnt.args[2])).toBeCloseTo(Number(key.args[2]), 6);
    expect(Number(cnt.args[1])).toBeGreaterThan(Number(key.args[1]));
    calls = frame(2.7);
    key = fillTexts(calls, 'N')[0];
    cnt = fillTexts(calls, '×3')[0];
    expect(Number(key.args[1])).toBeGreaterThan(L.hitPos);
    expect(Number(cnt.args[1])).toBeGreaterThan(Number(key.args[1]));
    // Vạch nốt bên trong: dọc theo trục cross (x = beat của nốt); vạch ở beat 3 đi qua hàng chữ (ngay sau hit line)
    // → bỏ (dải ngang thấp: phần ngoài chữ quá ngắn), 3 vạch còn lại đủ bề ngang.
    const segs = tickSegs(calls, L, 'N', N_STARTS.slice(1), 2.7);
    expect(segs.map((g) => g.beat).sort()).toEqual([2.5, 3.5, 4]);
    expect(tickHits(calls, L, 'N', segs)).toEqual([]);
  });

  it('mọi kiểu đệm lane: normal / none / none + khung game / pad (Mobile) / fit (trang mini) — một thân thanh đúng lane', () => {
    const cases: [Partial<RendererOptions>, number, number][] = [
      [{ lanePadding: 'normal' }, 980, 743],
      [{ lanePadding: 'none', tileOpacity: 0.6, background: 'transparent' }, 576, 600],
      [{ lanePadding: 'none', framePad: GAME_FRAME_PAD }, 610, 600],
      [{ lanePadding: 'pad', scheme: 'mobile' }, 390, 700],
      [{ lanePadding: 'fit', scheme: 'mobile', laneFit: null }, 960, 300],
      [{ lanePadding: 'none', orientation: 'horizontal' }, 1280, 200],
    ];
    for (const [opts, w, h] of cases) {
      const { L, frame } = setup({ lookahead: 8, ...opts }, w, h);
      const calls = frame(0.5);
      const label = JSON.stringify(opts);
      expect(bodies(calls, L, 'N'), label).toHaveLength(1);
      expect(countTexts(calls), label).toEqual(['×5']);
      const [bx, by, bw, bh] = bodies(calls, L, 'N')[0];
      const len = vertical(L) ? bh : bw;
      expect(len, label).toBeCloseTo(tileLength(2, 4.5, null, L), 4);
      const near = vertical(L) ? by + bh : bx;
      expect(near, label).toBeCloseTo(axisOf(L, 2, 0.5), 4);
      const cnt = calls.find((c) => c.name === 'fillText' && c.args[0] === '×5')!;
      // Số nằm trong thân thanh.
      expect(Number(cnt.args[1]), label).toBeGreaterThan(bx);
      expect(Number(cnt.args[1]), label).toBeLessThan(bx + bw);
      expect(Number(cnt.args[2]), label).toBeGreaterThan(by);
      expect(Number(cnt.args[2]), label).toBeLessThan(by + bh);
      // Độ đục thân theo tileOpacity như tile thường.
      const body = barFill(calls, L, 'N');
      expect(Number(body.globalAlpha), label).toBeCloseTo(opts.tileOpacity ?? 1, 6);
    }
  });

  it('Mobile: nhãn là số giản phổ (N → 6) + chấm quãng như tile thường, rồi số lần bấm', () => {
    const { L, frame } = setup(
      { scheme: 'mobile', lanePadding: 'pad', subLabel: 'none' },
      390,
      700,
      timelineOf('[giữ chuột phải] N*0.5 N*0.5 N*0.5 N*0.5 [thả chuột phải] Z'),
    );
    const calls = frame(-1);
    expect(fillTexts(calls, 'N')).toHaveLength(0);
    const digit = fillTexts(calls, '6');
    expect(digit).toHaveLength(1);
    expect(countTexts(calls)).toEqual(['×4']);
    // Màu chế độ Ngẩng Lên (cam) + chấm trên số (quãng cao).
    expect(digit[0].fillStyle).toBe(MOD_COLORS.right.text);
    const dx = Number(digit[0].args[1]);
    const dots = calls.filter(
      (c) =>
        c.name === 'arc' &&
        Math.abs(Number(c.args[0]) - dx) < 1e-6 &&
        Number(c.args[1]) < Number(digit[0].args[2]),
    );
    expect(dots).toHaveLength(1);
    expect(bodies(calls, L, 'N')).toHaveLength(1);
  });

  it('PC: ↓ / ↑ / badge "#" của modifier như tile thường (một lần cho cả thanh)', () => {
    const { frame } = setup(
      {},
      980,
      743,
      timelineOf(
        '[giữ chuột trái] [giữ scroll] C*0.5 C*0.5 C*0.5 C*0.5 [thả scroll] [thả chuột trái]',
      ),
    );
    const calls = frame(-1);
    expect(fillTexts(calls, '↓')).toHaveLength(1);
    expect(fillTexts(calls, '#')).toHaveLength(1);
    expect(fillTexts(calls, 'C')).toHaveLength(1);
    expect(countTexts(calls)).toEqual(['×4']);
    expect(fillTexts(calls, 'C')[0].fillStyle).toBe(MOD_COLORS.left.text);
  });

  it('lane hẹp: chữ số lọt bề ngang tile; thanh quá ngắn cho cả nhãn phím lẫn số → chỉ còn số', () => {
    const { L, frame } = setup(
      { scheme: 'mobile', lanePadding: 'pad', lookahead: 12 },
      320,
      600,
      timelineOf('N*0.125 N*0.125 N*0.125 N*0.125 _ Z'),
    );
    const calls = frame(-2);
    const cnt = fillTexts(calls, '×4');
    expect(cnt).toHaveLength(1);
    expect(fillTexts(calls, '6')).toHaveLength(0);
    const tileW = L.laneCrossSize - 2 * L.laneInset;
    const px = fontPxOf(cnt[0]);
    expect(px).toBeGreaterThanOrEqual(REPEAT_COUNT_MIN_PX);
    expect('×4'.length * px * 0.6).toBeLessThanOrEqual(tileW);
  });

  it('nền chroma: thân thanh + đoạn tô thêm bằng màu đặc (alpha 1), không glow', () => {
    const { L, frame } = setup({ background: 'chroma' });
    const states = new Uint8Array(7);
    states[1] = NoteState.miss;
    const calls = frame(2.6, { noteStates: states });
    expect(bodies(calls, L, 'N')).toHaveLength(1);
    const body = barFill(calls, L, 'N');
    expect(String(body.fillStyle)).toMatch(/^rgb\(/);
    expect(body.globalAlpha).toBe(1);
    const lifts = calls.filter((c) => c.name === 'fillRect' && /^rgb\(/.test(String(c.fillStyle)));
    // 4 đoạn chưa chấm đậm hơn đoạn trượt.
    expect(lifts).toHaveLength(4);
    for (const c of lifts) expect(c.globalAlpha).toBe(1);
    expect(calls.some((c) => Number(c.shadowBlur) > 0)).toBe(false);
  });

  it('frame ổn định: không measureText trong hot loop (chữ "×n" đo sẵn), đổi ngôn ngữ thì đo lại', () => {
    const { r, calls, frame } = setup();
    expect(calls.some((c) => c.name === 'measureText')).toBe(true);
    for (let f = 0; f < 150; f++) {
      const c = frame(f / 30);
      expect(c.some((x) => x.name === 'measureText')).toBe(false);
    }
    r.setOptions({ language: 'en' });
    expect(frame(1).some((c) => c.name === 'measureText')).toBe(true);
  });

  it('vạch đầu nốt không gạch ngang chữ: nhãn đứng yên trên hit line, thanh trôi qua (dọc PC, Mobile, ngang)', () => {
    // PC dọc: lane rộng → vạch đi qua khối chữ chỉ còn hai mẩu hai bên chữ.
    let { L, frame } = setup();
    let all = 0;
    for (const beat of [0.5, 1.9, 2.2, 2.6, 2.9, 3.2, 3.5, 3.8, 4.1]) {
      const calls = frame(beat);
      const segs = tickSegs(calls, L, 'N', N_STARTS.slice(1), beat);
      all += segs.length;
      expect(tickHits(calls, L, 'N', segs), `beat ${beat}`).toEqual([]);
    }
    expect(all).toBeGreaterThan(20);
    // beat 2.9: vạch ở beat 3 ngay trên hit line, ngang dòng số "×3" → hai mẩu, mỗi mẩu ngoài bề ngang chữ.
    const calls = frame(2.9);
    const at3 = tickSegs(calls, L, 'N', [3], 2.9);
    expect(at3).toHaveLength(2);
    const cnt = fillTexts(calls, '×3')[0];
    const half = ('×3'.length * fontPxOf(cnt) * 0.6) / 2;
    expect(at3[0].b).toBeLessThan(Number(cnt.args[1]) - half);
    expect(at3[1].a).toBeGreaterThan(Number(cnt.args[1]) + half);

    // Mobile (bàn nút 'pad', điện thoại), nốt móc kép ở lookahead 12: vạch dày, ô hẹp.
    const tight = timelineOf(
      'N*0.25 N*0.25 N*0.25 N*0.25 N*0.25 N*0.25 N*0.25 N*0.25 N*0.25 N*0.25 N*0.25 N*0.25 _ Z',
    );
    const starts = Array.from({ length: 11 }, (_, k) => 0.25 * (k + 1));
    ({ L, frame } = setup(
      { scheme: 'mobile', lanePadding: 'pad', lookahead: 12 },
      390,
      844,
      tight,
    ));
    for (const beat of [-1, 0.1, 0.6, 1.3, 2.1, 2.6]) {
      const c = frame(beat);
      expect(tickHits(c, L, 'N', tickSegs(c, L, 'N', starts, beat)), `mobile ${beat}`).toEqual([]);
    }

    // Dải ngang.
    ({ L, frame } = setup({ orientation: 'horizontal' }, 1280, 360));
    for (const beat of [0.5, 2.2, 2.7, 3.3, 3.9]) {
      const c = frame(beat);
      const segs = tickSegs(c, L, 'N', N_STARTS.slice(1), beat);
      expect(tickHits(c, L, 'N', segs), `ngang ${beat}`).toEqual([]);
    }
  });

  it('ngang, thanh bị luật gap cắt ngắn hơn ô tối thiểu: vẫn có số "×4" ở giữa thanh (chỉ số)', () => {
    const { L, frame } = setup(
      { orientation: 'horizontal', lookahead: 12 },
      640,
      200,
      timelineOf('N*0.125 N*0.125 N*0.125 N*0.125 R:N*0.5 _*2 Z'),
    );
    const calls = frame(-1);
    const bar = bodies(calls, L, 'N').sort((p, q) => p[0] - q[0])[0];
    const [x, y, w, h] = bar;
    expect(w).toBeLessThan(L.minTileLen);
    const cnt = fillTexts(calls, '×4');
    expect(cnt).toHaveLength(1);
    const cx = Number(cnt[0].args[1]);
    const cy = Number(cnt[0].args[2]);
    expect(Number.isFinite(cx) && Number.isFinite(cy)).toBe(true);
    expect(cx).toBeCloseTo(x + w / 2, 3);
    expect(cy).toBeCloseTo(y + h / 2, 3);
    // Nhãn phím của thanh bỏ (chỉ còn của ô R:N phía sau, nếu có): không chữ nào khác nằm trong thân thanh.
    const inBar = calls.filter(
      (c) =>
        c.name === 'fillText' &&
        Number(c.args[1]) > x &&
        Number(c.args[1]) < x + w &&
        Number(c.args[2]) > y &&
        Number(c.args[2]) < y + h,
    );
    expect(inBar.map((c) => c.args[0])).toEqual(['×4']);
  });

  it('đếm vào cắt giữa thanh: nhãn + số bám phần được đếm, không nằm trên đoạn mờ', () => {
    const { L, frame } = setup();
    const ci = { countIn: { start: 0, end: 3 } };
    for (const beat of [1.2, 2.2, 2.8]) {
      const calls = frame(beat, ci);
      // Mép gần của phần được đếm = đầu nốt beat 3.
      const edge = axisOf(L, 3, beat);
      const key = fillTexts(calls, 'N')[0];
      const cnt = fillTexts(calls, '×3')[0];
      expect(key, `beat ${beat}`).toBeTruthy();
      expect(cnt, `beat ${beat}`).toBeTruthy();
      expect(Number(key.args[2]) + fontPxOf(key) / 2).toBeLessThanOrEqual(edge + 1e-6);
      expect(Number(cnt.args[2]) + fontPxOf(cnt) / 2).toBeLessThanOrEqual(edge + 1e-6);
      // Chữ đậm (độ đục của thanh), không mờ như ô đếm vào.
      expect(Number(cnt.globalAlpha)).toBe(1);
    }
    // Nốt đầu được đếm đã qua hit line: nhãn về đứng ngay trên hit line như thường.
    const calls = frame(3.2, ci);
    const cnt = fillTexts(calls, '×2')[0];
    expect(Number(cnt.args[2])).toBeLessThan(L.hitPos);
    expect(L.hitPos - Number(cnt.args[2])).toBeLessThan(fontPxOf(cnt) * 1.2);
  });

  it('lần bấm cuối: phần chưa bấm không đủ cho nhãn phím + số → chỉ số, số không xuống quá hit line', () => {
    let { L, frame } = setup();
    // Còn 0,9 beat phía trên hit line: đủ cho cả hai.
    let calls = frame(3.6);
    expect(fillTexts(calls, 'N')).toHaveLength(1);
    // Còn 0,6 beat: không đủ cao cho hai dòng nhưng ô đủ rộng → nhãn phím + "×1" trên CÙNG một dòng (số sau phím),
    // trọn phía trên hit line, trong thân thanh.
    calls = frame(3.9);
    const key = fillTexts(calls, 'N');
    expect(key).toHaveLength(1);
    let cnt = fillTexts(calls, '×1')[0];
    expect(Math.abs(Number(key[0].args[2]) - Number(cnt.args[2]))).toBeLessThan(1);
    expect(Number(cnt.args[1])).toBeGreaterThan(Number(key[0].args[1]));
    const top = bodies(calls, L, 'N')[0][1];
    expect(Number(cnt.args[2]) + fontPxOf(cnt) / 2).toBeLessThanOrEqual(L.hitPos);
    expect(Number(cnt.args[2]) - fontPxOf(cnt) / 2).toBeGreaterThanOrEqual(top);
    // Bấm hết: nhãn phím quay lại, theo đuôi thanh như tile dài.
    calls = frame(4.2);
    expect(countTexts(calls)).toEqual([]);
    expect(fillTexts(calls, 'N')).toHaveLength(1);

    // Trang mini "Khớp nút game" (hit line sát đáy canvas) + điện thoại lookahead 12 (nốt cuối ngắn hơn dòng số):
    // số luôn trọn phía trên hit line tới lần bấm cuối.
    const tight = timelineOf('N*0.25 N*0.25 N*0.25 N*0.25 N*0.25 _ Z');
    const cases: [Partial<RendererOptions>, number, number, Timeline][] = [
      [{ lanePadding: 'fit', scheme: 'mobile', laneFit: null }, 360, 360, timelineOf(BAR_LINE)],
      [{ lanePadding: 'pad', scheme: 'mobile', lookahead: 12 }, 390, 844, tight],
    ];
    for (const [opts, w, h, tl] of cases) {
      ({ L, frame } = setup(opts, w, h, tl));
      const ns = tl.notes.filter((n) => n.key === 'N');
      const last = ns[ns.length - 1].startBeat;
      for (let beat = last - 1.2; beat < last; beat += 0.05) {
        calls = frame(beat);
        const texts = countTexts(calls);
        expect(texts.length, `${JSON.stringify(opts)} @${beat}`).toBe(1);
        cnt = calls.find((c) => c.name === 'fillText' && c.args[0] === texts[0])!;
        expect(
          Number(cnt.args[2]) + fontPxOf(cnt) / 2,
          `${opts.lanePadding} @${beat}`,
        ).toBeLessThanOrEqual(L.hitPos + 1e-6);
      }
    }
  });

  it('Mobile "Khớp nút game": thanh đi qua cột vòng chế độ vẫn trôi như cột khác — nhãn + số sát hit line, không dừng trên hàng vòng', () => {
    const opts: Partial<RendererOptions> = {
      lanePadding: 'fit',
      scheme: 'mobile',
      laneFit: null,
      subLabel: 'none',
    };
    let { L, frame } = setup(opts, 960, 300);
    const T = cueTargets(L, false);
    const nc = L.laneCrossStart[lane('N')] + L.laneCrossSize / 2;
    // Lane N (số 6) nằm dưới vòng Cúi Xuống của game.
    expect(T.cross.some((x) => Math.abs(x - nc) < T.size / 2)).toBe(true);
    const ringTop = T.axis - T.size / 2;
    // Góp ý 2026-10-20: không dừng nhãn trên hàng vòng (trông như bị chặn) — số trôi liên tục theo đầu thanh vào
    // trong hàng vòng rồi nằm sát hit line như cột không có vòng.
    const cntY = (beat: number): number => {
      const cnt = frame(beat).find((c) => c.name === 'fillText' && /^×/.test(String(c.args[0])));
      expect(cnt, `beat ${beat}`).toBeTruthy();
      return Number(cnt!.args[2]);
    };
    const ys = [0.5, 1.0, 1.4, 1.7, 1.9].map(cntY);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1] + 1);
    for (const beat of [1.7, 2.0, 2.3]) {
      expect(cntY(beat), `beat ${beat}`).toBeGreaterThan(ringTop);
      const cnt = frame(beat).find((c) => c.name === 'fillText' && /^×/.test(String(c.args[0])))!;
      expect(Number(cnt.args[2]) + fontPxOf(cnt) / 2, `beat ${beat}`).toBeLessThanOrEqual(L.hitPos);
    }
    // Đuôi thanh đã xuống: số theo đuôi nhưng không xuống quá hit line.
    for (const beat of [2.9, 3.4, 3.9]) {
      const calls = frame(beat);
      const cnt = calls.find((c) => c.name === 'fillText' && /^×/.test(String(c.args[0])))!;
      expect(cnt, `beat ${beat}`).toBeTruthy();
      expect(Number(cnt.args[2]) + fontPxOf(cnt) / 2, `beat ${beat}`).toBeLessThanOrEqual(L.hitPos);
    }
    // Lane Z (số 1): không vòng nào phía trên → số sát hit line như PC.
    ({ L, frame } = setup(opts, 960, 300, timelineOf('Z*0.5 Z*0.5 Z*0.5 Z*0.5 Z*0.5 _ X')));
    const calls = frame(1.3);
    const cnt = fillTexts(calls, '×2')[0];
    expect(Number(cnt.args[2])).toBeGreaterThan(ringTop);
    expect(L.hitPos - Number(cnt.args[2])).toBeLessThan(fontPxOf(cnt) * 1.2);
    // Bàn nút 'pad' (điện thoại 390 px): ô viên thuốc lọt khe giữa hai nút chế độ → không đẩy lên.
    ({ L, frame } = setup({ scheme: 'mobile', lanePadding: 'pad', subLabel: 'none' }, 390, 844));
    const P = cueTargets(L, true);
    const pc = frame(2.9);
    const pcnt = fillTexts(pc, '×3')[0];
    expect(Number(pcnt.args[2])).toBeGreaterThan(P.axis - P.size / 2);
  });

  it('cỡ chữ số theo từng đoạn: đoạn ≤ 9 nốt không bị thu nhỏ theo "×12" của đoạn dài nhất', () => {
    const tl = timelineOf(
      'B*0.25 B*0.25 B*0.25 B*0.25 _',
      'N*0.25 N*0.25 N*0.25 N*0.25 N*0.25 N*0.25 N*0.25 N*0.25 N*0.25 N*0.25 N*0.25 N*0.25 _ Z',
    );
    const { L, frame } = setup(
      { scheme: 'mobile', lanePadding: 'pad', lookahead: 12 },
      390,
      844,
      tl,
    );
    const calls = frame(-1);
    const four = fillTexts(calls, '×4');
    const twelve = fillTexts(calls, '×12');
    expect(four).toHaveLength(1);
    expect(twelve).toHaveLength(1);
    expect(fontPxOf(four[0])).toBeGreaterThan(fontPxOf(twelve[0]));
    const tileW = L.laneCrossSize - 2 * L.laneInset;
    expect('×4'.length * fontPxOf(four[0]) * 0.6).toBeLessThanOrEqual(tileW);
    expect('×12'.length * fontPxOf(twelve[0]) * 0.6).toBeLessThanOrEqual(tileW);
    // Cả thanh một cỡ: "×9" của đoạn 12 nốt giữ cỡ của "×12".
    const n0 = tl.notes.find((n) => n.key === 'N')!.startBeat;
    const later = frame(n0 + 0.6);
    expect(fontPxOf(fillTexts(later, '×9')[0])).toBe(fontPxOf(twelve[0]));
  });
});
