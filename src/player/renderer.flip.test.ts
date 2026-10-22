/**
 * Khung lật dọc (`flipY`, D-448 — trang mini "Khớp nút game · dưới nút": cửa sổ đặt DƯỚI hàng nút số của game):
 * renderer vẽ y như bố cục 'fit' nhưng cả khung lật bằng transform của canvas — ô đi lên, hit line + vòng "CHẠM" ở
 * mép trên — còn chữ (nhãn phím, chấm giản phổ, "#", ↓/↑, "×n", "CHẠM") vẽ đứng thẳng ở ảnh gương, mọi thứ vẫn nằm
 * trong tile của nó. Bài thử là các dòng `.harm` tự viết (không phải bài hát thật).
 */
import { describe, expect, it } from 'vitest';
import { NOTE_KEYS } from '../core/keys';
import { parseHarm } from '../core/parser';
import { buildTimeline } from '../core/timeline';
import type { NoteKey, Timeline } from '../core/types';
import { translate } from '../i18n/strings';
import type { Layout } from './layout';
import { CUE_TARGET_GAP, cueTargets } from './layout';
import { MOBILE_BUTTONS } from './mobilePlan';
import { TilesRenderer, sanitizeRendererOptions } from './renderer';
import type { RendererOptions } from './renderer';

interface Call {
  name: string;
  args: unknown[];
  /** Transform đang có hiệu lực lúc gọi (setTransform: transform TRƯỚC lệnh). */
  tf: number[];
  font: string;
  lineWidth: unknown;
}

const IDENTITY = [1, 0, 0, 1, 0, 0];

/** Context giả: ghi mọi lệnh kèm transform / font / lineWidth lúc đó; save / restore giữ cả transform. */
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
  let tf = IDENTITY.slice();
  const stack: { state: Record<string, unknown>; tf: number[] }[] = [];
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
          tf: tf.slice(),
          font: String(state.font),
          lineWidth: state.lineWidth,
        });
        if (prop === 'measureText') return { width: String(args[0]).length * fontPx() * 0.6 };
        if (prop === 'setTransform') tf = args.map(Number);
        if (prop === 'save') stack.push({ state: { ...state }, tf: tf.slice() });
        if (prop === 'restore') {
          const top = stack.pop();
          if (top) {
            Object.assign(state, top.state);
            tf = top.tf;
          }
        }
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

function timelineOf(text: string): Timeline {
  const r = parseHarm(text);
  expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
  return buildTimeline(r.song);
}

const W = 960;
const H = 300;
/** Transform lật của khung W × H ở DPR 1. */
const flipOf = (h: number): number[] => [1, 0, 0, -1, 0, h];

/** Không chấm giản phổ, không "," — mọi nhãn là một dòng. */
const PLAIN = '@bpm 100\nZ X C V B N M';
/** Cue: X (Cúi Xuống) ở beat 1, C (Ngẩng Lên) ở beat 2, V (Ngẩng Tự Nhiên + Nửa Cung) ở beat 3. */
const CUE_SONG = '@bpm 100\nZ L:X R:C S:V Z';
/** Z [0,1) · nghỉ · N × 5 nốt 0,5 beat [2, 4.5) (thanh bấm lặp) · nghỉ 0,5 · X [5,6). */
const BAR_SONG = '@bpm 120\nZ _ N*0.5 N*0.5 N*0.5 N*0.5 N*0.5 _*0.5 X';

function draw(
  song: string,
  beat: number,
  opts: Partial<RendererOptions> = {},
  w = W,
  h = H,
): { calls: Call[]; L: Layout } {
  const { ctx, calls } = fakeCtx();
  const r = new TilesRenderer(makeCanvas(w, h, ctx), {
    scheme: 'mobile',
    lanePadding: 'fit',
    showSectionLabels: false,
    ...opts,
  });
  r.setTimeline(timelineOf(song));
  r.render({ beat, timeMs: 0 });
  const L = r.layout!;
  r.dispose();
  return { calls, L };
}

const num = (c: Call, i: number): number => Number(c.args[i]);
const fontPx = (c: Call): number => Number(/(\d+(?:\.\d+)?)px/.exec(c.font)?.[1] ?? NaN);
const texts = (calls: Call[], pred: (t: string) => boolean): Call[] =>
  calls.filter((c) => c.name === 'fillText' && pred(String(c.args[0])));
const lane = (key: NoteKey): number => NOTE_KEYS.indexOf(key);
/** Mép trái thân tile trong lane (trục cross). */
const tileX = (L: Layout, key: NoteKey): number => L.laneCrossStart[lane(key)] + L.laneInset;

/** Thân tile (roundRect) trong lane `key` → [đỉnh, đáy] TRÊN MÀN của khung lật cao `h`. */
function screenTiles(calls: Call[], L: Layout, key: NoteKey, h: number): [number, number][] {
  const x0 = tileX(L, key);
  const out: [number, number][] = [];
  for (const c of calls) {
    if (c.name !== 'roundRect' || Math.abs(num(c, 0) - x0) > 1e-3) continue;
    const y = num(c, 1);
    const hh = num(c, 3);
    const r: [number, number] = [h - (y + hh), h - y];
    if (!out.some((o) => Math.abs(o[0] - r[0]) < 1e-3 && Math.abs(o[1] - r[1]) < 1e-3)) out.push(r);
  }
  return out;
}

/** Arc ở cột một nút chế độ; `ring` = vòng "CHẠM" (nét màu ≥ 2 px), còn lại = vòng đích mờ (1,5 px). */
function cueArcs(calls: Call[], L: Layout) {
  const T = cueTargets(L);
  return calls.flatMap((c, i) => {
    if (c.name !== 'arc') return [];
    const [x, y, r] = c.args.map(Number);
    const j = T.cross.findIndex((cx) => Math.abs(cx - x) < 1e-6);
    if (j < 0) return [];
    const strokes = calls.slice(i + 1, i + 6).filter((s) => s.name === 'stroke');
    const line = Number(strokes[1]?.lineWidth);
    return [{ button: MOBILE_BUTTONS[j], x, y, r, ring: line >= 2, tf: c.tf }];
  });
}

describe('renderer flipY (D-448): transform', () => {
  const bgTransform = (calls: Call[]): number[] => calls.find((c) => c.name === 'fillRect')!.tf;

  it("'fit' + flipY: cả khung vẽ dưới transform lật (nền, hit line); hết khung transform vẫn lật", () => {
    for (const scheme of ['mobile', 'pc'] as const) {
      const { calls, L } = draw(PLAIN, 1, { scheme, flipY: true });
      expect(bgTransform(calls)).toEqual(flipOf(H));
      const hit = calls.filter(
        (c) => c.name === 'moveTo' && num(c, 0) === 0 && Math.abs(num(c, 1) - L.hitPos) < 1e-9,
      );
      expect(hit.length).toBeGreaterThan(0);
      for (const c of hit) expect(c.tf).toEqual(flipOf(H));
      // Lệnh setTransform cuối của khung trả lại transform lật (nhãn vẽ thẳng xong thì lật lại).
      expect(calls.filter((c) => c.name === 'setTransform').at(-1)!.args).toEqual(flipOf(H));
    }
  });

  it("flipY tắt, hoặc bố cục không phải 'fit' dọc ('pad', 'none', 'fit' ngang): không lật", () => {
    const flat = [
      draw(PLAIN, 1, { flipY: false }),
      draw(PLAIN, 1, { flipY: true, lanePadding: 'pad' }),
      draw(PLAIN, 1, { flipY: true, lanePadding: 'none' }),
      draw(PLAIN, 1, { flipY: true, orientation: 'horizontal' }),
      draw(PLAIN, 1, { flipY: true, scheme: 'pc', lanePadding: 'normal' }),
    ];
    for (const { calls } of flat) {
      expect(bgTransform(calls)).toEqual(IDENTITY);
      expect(calls.every((c) => c.name !== 'setTransform' || num(c, 3) > 0)).toBe(true);
    }
  });

  it.each(['mobile', 'pc'] as const)(
    '%s: lật chỉ khác ở transform + chữ — mọi hình khác y hệt theo toạ độ logic',
    (scheme) => {
      const strip = (calls: Call[]) =>
        calls
          .filter((c) => !['setTransform', 'fillText', 'strokeText'].includes(c.name))
          .map((c) => ({ name: c.name, args: c.args }));
      for (const beat of [0, 1.3, 3.7, 7.2]) {
        const a = draw(PLAIN, beat, { scheme, subLabel: 'none' });
        const b = draw(PLAIN, beat, { scheme, subLabel: 'none', flipY: true });
        expect(strip(b.calls)).toEqual(strip(a.calls));
      }
    },
  );
});

describe('renderer flipY (D-448): chữ đứng thẳng ở ảnh gương', () => {
  it.each(['mobile', 'pc'] as const)(
    '%s: nhãn phím vẽ bằng transform thẳng, cùng x, y = H − y (khối nhãn một dòng)',
    (scheme) => {
      const keys =
        scheme === 'mobile' ? ['1', '2', '3', '4', '5', '6', '7'] : NOTE_KEYS.slice(0, 7);
      const pick = (calls: Call[]) => texts(calls, (t) => keys.includes(t));
      for (const beat of [0.4, 2.5]) {
        const a = pick(draw(PLAIN, beat, { scheme, subLabel: 'none' }).calls);
        const b = pick(draw(PLAIN, beat, { scheme, subLabel: 'none', flipY: true }).calls);
        expect(a.length).toBeGreaterThan(3);
        expect(b.map((c) => c.args[0])).toEqual(a.map((c) => c.args[0]));
        b.forEach((c, i) => {
          expect(c.tf).toEqual(IDENTITY);
          expect(num(c, 1)).toBeCloseTo(num(a[i], 1), 4);
          expect(num(c, 2)).toBeCloseTo(H - num(a[i], 2), 3);
        });
      }
    },
  );

  it('vòng "CHẠM" + vòng đích: cùng toạ độ logic dưới transform lật; vòng đáp ngay DƯỚI hit line ở mép trên', () => {
    const opts: Partial<RendererOptions> = { language: 'en', subLabel: 'none' };
    const a = draw(CUE_SONG, 0.9, opts);
    const b = draw(CUE_SONG, 0.9, { ...opts, flipY: true });
    const ra = cueArcs(a.calls, a.L);
    const rb = cueArcs(b.calls, b.L);
    expect(rb.filter((r) => r.ring).length).toBeGreaterThan(1);
    expect(rb.filter((r) => !r.ring)).toHaveLength(4);
    expect(rb.map(({ tf: _tf, ...r }) => r)).toEqual(ra.map(({ tf: _tf, ...r }) => r));
    for (const r of rb) expect(r.tf).toEqual(flipOf(H));
    // Đúng beat cue (X = Cúi Xuống ở beat 1): trên màn vòng nằm ngay dưới hit line ở mép trên.
    const T = cueTargets(b.L);
    const land = cueArcs(draw(CUE_SONG, 1, { ...opts, flipY: true }).calls, b.L).find(
      (r) => r.ring && r.button === 'left',
    );
    expect(land).toBeDefined();
    expect(land!.tf).toEqual(flipOf(H));
    expect(H - land!.y - T.size / 2).toBeCloseTo(H - b.L.hitPos + CUE_TARGET_GAP, 6);
    expect(H - b.L.hitPos).toBeLessThan(5);
  });

  it('chữ "TAP" của vòng: transform thẳng, cùng x, y lật (H + 1 − y), viền chữ cũng vậy', () => {
    const tap = translate('en', 'player.mobile.tapBar');
    const opts: Partial<RendererOptions> = { language: 'en', subLabel: 'none' };
    const a = draw(CUE_SONG, 0.9, opts).calls;
    const b = draw(CUE_SONG, 0.9, { ...opts, flipY: true }).calls;
    for (const name of ['fillText', 'strokeText']) {
      const ta = a.filter((c) => c.name === name && c.args[0] === tap);
      const tb = b.filter((c) => c.name === name && c.args[0] === tap);
      expect(ta.length).toBeGreaterThan(0);
      expect(tb).toHaveLength(ta.length);
      tb.forEach((c, i) => {
        expect(c.tf).toEqual(IDENTITY);
        expect(num(c, 1)).toBeCloseTo(num(ta[i], 1), 6);
        expect(num(c, 2)).toBeCloseTo(H + 1 - num(ta[i], 2), 6);
      });
    }
  });

  it('chấm giản phổ: vẽ thẳng, chấm trên vẫn TRÊN chữ số, chấm dưới vẫn DƯỚI, tất cả trong tile đã lật', () => {
    // R: = Ngẩng Lên (1 chấm trên), L: = Cúi Xuống (1 chấm dưới), R:, = 1̇ quãng cao (2 chấm trên).
    const song = '@bpm 100\nR:Z*2 L:X*2 R:,*2';
    const cases: [NoteKey, number, number][] = [
      ['Z', 1, 0],
      ['X', 0, 1],
      [',', 2, 0],
    ];
    for (const beat of [0, 0.5, 1.5]) {
      const { calls, L } = draw(song, beat, { subLabel: 'none', flipY: true });
      for (const [key, above, below] of cases) {
        const cx = L.laneCrossStart[lane(key)] + L.laneCrossSize / 2;
        const digit = texts(calls, (t) => /^[1-7]$/.test(t)).find(
          (c) => Math.abs(num(c, 1) - cx) < 1e-3,
        );
        if (!digit) continue;
        expect(digit.tf).toEqual(IDENTITY);
        const ky = num(digit, 2);
        const size = fontPx(digit);
        const dots = calls.filter(
          (c) => c.name === 'arc' && Math.abs(num(c, 0) - cx) < 1e-3 && num(c, 2) < 4,
        );
        expect(dots.filter((d) => num(d, 1) < ky)).toHaveLength(above);
        expect(dots.filter((d) => num(d, 1) > ky)).toHaveLength(below);
        // Trong tile đã lật (tile đang ra khỏi mép trên thì nhãn ra theo — như ở mép dưới của bố cục thường).
        const [top, bottom] = screenTiles(calls, L, key, H)[0];
        for (const d of dots) {
          expect(d.tf).toEqual(IDENTITY);
          expect(num(d, 1) - num(d, 2)).toBeGreaterThanOrEqual(top - 1e-3);
          expect(num(d, 1) + num(d, 2)).toBeLessThanOrEqual(bottom + 1e-3);
        }
        expect(ky - size * 0.36).toBeGreaterThanOrEqual(top - 1e-3);
        expect(ky + size * 0.36).toBeLessThanOrEqual(bottom + 1e-3);
      }
    }
  });
});

describe('renderer flipY (D-448): "#" / ↓↑ ở lane hẹp nằm trong tile đã lật', () => {
  // 640 px: bước cột 80, tile ≈ 55 px — lane hẹp: "#" / ↓↑ dồn lên góc TRÊN nhãn phím.
  const NW = 640;
  const NH = 240;

  it.each([1, 1.3, 2, 3.5])(
    'Mobile, tile Nửa Cung dài ở beat %d (cả lúc nhãn dính mép trên): vòng "#" trong tile, trên chữ số',
    (beat) => {
      const { calls, L } = draw('@bpm 100\nZ S:V*8', beat, { flipY: true }, NW, NH);
      const [top, bottom] = screenTiles(calls, L, 'V', NH)[0];
      const x0 = tileX(L, 'V');
      const w = L.laneCrossSize - 2 * L.laneInset;
      const badge = calls.find(
        (c) => c.name === 'arc' && num(c, 0) > x0 + w / 2 && num(c, 0) < x0 + w && num(c, 2) >= 5,
      );
      expect(badge).toBeDefined();
      expect(badge!.tf).toEqual(IDENTITY);
      const by = num(badge!, 1);
      const rr = num(badge!, 2);
      expect(by - rr).toBeGreaterThanOrEqual(Math.max(0, top) - 1e-3);
      expect(by + rr).toBeLessThanOrEqual(Math.min(NH, bottom) + 1e-3);
      const sharp = texts(calls, (t) => t === '#')[0];
      expect(sharp.tf).toEqual(IDENTITY);
      // Lane hẹp thật: "#" ở góc trên chữ số (thứ tự đọc giữ nguyên khi lật).
      const digit = texts(calls, (t) => t === '4')[0];
      expect(digit.tf).toEqual(IDENTITY);
      expect(by).toBeLessThan(num(digit, 2) - 1);
      expect(num(digit, 2) - fontPx(digit) * 0.36).toBeGreaterThanOrEqual(Math.max(0, top) - 1e-3);
    },
  );

  it.each([1, 2])('PC, tile ↓ dài ở beat %d: mũi tên trong tile đã lật, trên nhãn phím', (beat) => {
    const { calls, L } = draw('@bpm 100\nZ L:V*8', beat, { scheme: 'pc', flipY: true }, NW, NH);
    const [top, bottom] = screenTiles(calls, L, 'V', NH)[0];
    const arrow = texts(calls, (t) => t === '↓')[0];
    expect(arrow).toBeDefined();
    expect(arrow.tf).toEqual(IDENTITY);
    const half = fontPx(arrow) * 0.6;
    expect(num(arrow, 2) - half).toBeGreaterThanOrEqual(Math.max(0, top) - 1e-3);
    expect(num(arrow, 2) + half).toBeLessThanOrEqual(Math.min(NH, bottom) + 1e-3);
    const key = texts(calls, (t) => t === 'V')[0];
    expect(num(arrow, 2)).toBeLessThan(num(key, 2));
  });
});

describe('renderer flipY (D-448): thanh bấm lặp', () => {
  const count = (t: string): boolean => /^×\d+$/.test(t);

  it.each([2.1, 2.6, 3.2])(
    'beat %d: khối chữ ngay DƯỚI hit line ở mép trên, nhãn phím trên "×n"; vạch đầu nốt không gạch chữ',
    (beat) => {
      const a = draw(BAR_SONG, beat, { subLabel: 'none' });
      const b = draw(BAR_SONG, beat, { subLabel: 'none', flipY: true });
      const L = b.L;
      // Bố cục thường: "×n" sát trên hit line — dưới nhãn phím, hoặc cùng dòng bên phải ("6 ×3") khi thấp.
      const keyA = texts(a.calls, (t) => t === '6')[0];
      const cntA = texts(a.calls, count)[0];
      expect(cntA).toBeDefined();
      const inline = Math.abs(num(keyA, 2) - num(cntA, 2)) < 1e-6;
      if (inline) expect(num(keyA, 1)).toBeLessThan(num(cntA, 1));
      else expect(num(keyA, 2)).toBeLessThan(num(cntA, 2));
      const cl = (c: Call): number => Math.round(fontPx(c) * 1.15);
      expect(num(cntA, 2) + cl(cntA) / 2).toBeLessThanOrEqual(L.hitPos - 1 + 1e-3);
      // Lật: cùng thứ tự (nhãn phím trên / trái, "×n" dưới / phải) — cả khối dưới hit line ở mép trên.
      const key = texts(b.calls, (t) => t === '6')[0];
      const cnt = texts(b.calls, count)[0];
      expect(cnt.args[0]).toBe(cntA.args[0]);
      expect(key.tf).toEqual(IDENTITY);
      expect(cnt.tf).toEqual(IDENTITY);
      expect(num(key, 1)).toBeCloseTo(num(keyA, 1), 4);
      expect(num(cnt, 1)).toBeCloseTo(num(cntA, 1), 4);
      if (inline) expect(num(key, 2)).toBeCloseTo(num(cnt, 2), 6);
      else expect(num(key, 2)).toBeLessThan(num(cnt, 2));
      expect(num(key, 2) - fontPx(key) / 2).toBeGreaterThanOrEqual(H - L.hitPos + 1 - 1e-3);
      expect(num(cnt, 2) - cl(cnt) / 2).toBeGreaterThanOrEqual(H - L.hitPos + 1 - 1e-3);
      // Dời NGUYÊN KHỐI (cùng một độ dời) tới ảnh gương của hộp bao chữ [t0, t1] của bố cục thường.
      const t0 = Math.min(num(keyA, 2) - fontPx(keyA) / 2, num(cntA, 2) - cl(cntA) / 2);
      const t1 = Math.max(num(keyA, 2) + fontPx(keyA) / 2, num(cntA, 2) + cl(cntA) / 2);
      expect(num(key, 2) - num(keyA, 2)).toBeCloseTo(H - (t0 + t1), 3);
      expect(num(cnt, 2) - num(cntA, 2)).toBeCloseTo(H - (t0 + t1), 3);
      // Vạch đầu nốt (vẽ dưới transform lật, toạ độ logic) không đi ngang qua chữ trên màn.
      const x0 = tileX(L, 'N');
      const cs = L.laneCrossSize - 2 * L.laneInset;
      const ti = Math.max(2, Math.round(cs * 0.16));
      const c0 = x0 + ti;
      const c1 = x0 + cs - ti;
      const bands = [key, cnt].map((c): [number, number] => [
        num(c, 2) - fontPx(c) * 0.36,
        num(c, 2) + fontPx(c) * 0.36,
      ]);
      let full = 0;
      let split = 0;
      b.calls.forEach((c, i) => {
        if (c.name !== 'moveTo' || Math.abs(num(c, 0) - c0) > 1e-3) return;
        const next = b.calls[i + 1];
        if (next?.name !== 'lineTo' || Math.abs(num(next, 1) - num(c, 1)) > 1e-9) return;
        expect(c.tf).toEqual(flipOf(H));
        const sy = H - num(c, 1);
        if (Math.abs(num(next, 0) - c1) < 1e-3) {
          full++;
          for (const [t0, t1] of bands) expect(sy > t0 && sy < t1).toBe(false);
        } else {
          split++;
        }
      });
      expect(full + split).toBeGreaterThan(0);
      // Thanh đang trôi qua khối chữ đứng yên: có vạch bị chừa khe (cùng khe với bố cục thường — hộp bao chưa lật).
      if (beat === 2.6) expect(split).toBeGreaterThan(0);
    },
  );

  it.each([2.1, 2.6, 3.2])(
    'beat %d: thanh 1̇ quãng cao (2 chấm trên) — chấm vẽ thẳng, trên chữ số, cả khối trong thanh và dưới hit line',
    (beat) => {
      const song = '@bpm 120\nZ _ R:,*0.5 R:,*0.5 R:,*0.5 R:,*0.5 R:,*0.5 _*0.5 X';
      const { calls, L } = draw(song, beat, { subLabel: 'none', flipY: true });
      const cx = L.laneCrossStart[lane(',')] + L.laneCrossSize / 2;
      const digitOf = (cs: Call[]) =>
        texts(cs, (t) => t === '1').find((c) => Math.abs(num(c, 1) - cx) < 1e-3);
      const digit = digitOf(calls);
      // Phần chưa bấm quá thấp cho cả nhãn phím lẫn số → chỉ số — như bố cục thường (lật không đổi quyết định).
      const plain = digitOf(draw(song, beat, { subLabel: 'none' }).calls);
      expect(digit === undefined).toBe(plain === undefined);
      if (beat === 3.2 && !digit) return;
      if (!digit) throw new Error('thiếu nhãn phím');
      expect(digit.tf).toEqual(IDENTITY);
      const dots = calls.filter(
        (c) => c.name === 'arc' && Math.abs(num(c, 0) - cx) < 1e-3 && num(c, 2) < 4,
      );
      expect(dots).toHaveLength(2);
      const [top, bottom] = screenTiles(calls, L, ',', H)[0];
      const floor = Math.max(top, H - L.hitPos + 1);
      for (const d of dots) {
        expect(d.tf).toEqual(IDENTITY);
        expect(num(d, 1)).toBeLessThan(num(digit, 2));
        expect(num(d, 1) - num(d, 2)).toBeGreaterThanOrEqual(floor - 1e-3);
        expect(num(d, 1) + num(d, 2)).toBeLessThanOrEqual(bottom + 1e-3);
      }
      const cnt = texts(calls, count)[0];
      expect(cnt.tf).toEqual(IDENTITY);
      expect(num(cnt, 2) + Math.round(fontPx(cnt) * 1.15) / 2).toBeLessThanOrEqual(bottom + 1);
    },
  );
});

describe('renderer flipY (D-448): option', () => {
  it('sanitize: chỉ nhận boolean, mặc định false', () => {
    expect(sanitizeRendererOptions(null).flipY).toBe(false);
    expect(sanitizeRendererOptions({ flipY: true }).flipY).toBe(true);
    expect(sanitizeRendererOptions({ flipY: 'x' as never }).flipY).toBe(false);
    const on = sanitizeRendererOptions({ flipY: true });
    expect(sanitizeRendererOptions({ flipY: 1 as never }, on).flipY).toBe(true);
    expect(sanitizeRendererOptions({ flipY: false }, on).flipY).toBe(false);
  });

  it('setOptions(flipY) không dựng lại layout; khung kế lật / thôi lật', () => {
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(W, H, ctx), { scheme: 'mobile', lanePadding: 'fit' });
    r.setTimeline(timelineOf(PLAIN));
    r.render({ beat: 1 });
    const before = r.layout!;
    r.setOptions({ flipY: true });
    expect(r.options.flipY).toBe(true);
    expect(r.layout).toBe(before);
    calls.length = 0;
    r.render({ beat: 1 });
    expect(calls.find((c) => c.name === 'fillRect')!.tf).toEqual(flipOf(H));
    r.setOptions({ flipY: false });
    calls.length = 0;
    r.render({ beat: 1 });
    expect(calls.find((c) => c.name === 'fillRect')!.tf).toEqual(IDENTITY);
    expect(r.layout).toBe(before);
    r.dispose();
  });
});
