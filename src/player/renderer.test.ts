import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTE_KEYS, modifiersOf } from '../core/keys';
import { buildTimeline as buildSongTimeline } from '../core/timeline';
import { parseHarm } from '../core/parser';
import FIXTURE_SONG from '../test/fixtures/bai-thu-nhip-dieu.harm?raw';
import type {
  HoldRun,
  NoteKey,
  Octave,
  Timeline,
  TimelineLine,
  TimelineNote,
  TimelineSection,
} from '../core/types';
import { CHROMA_GREEN, MOD_COLORS } from '../ui/palette';
import { CANVAS_THEMES, OVERLAY_CANVAS_THEMES } from './canvasTheme';
import type { Layout } from './layout';
import {
  CUE_RING_SPEED,
  CUE_TARGET_GAP,
  computeLayout,
  cueTargets,
  tileLength,
  tileRect,
} from './layout';
import { MOBILE_BUTTONS } from './mobilePlan';
import type { MobileButton } from './mobilePlan';
import {
  CUE_RING_HOLD_BEATS,
  CUE_TEXT_FADE_FAR,
  CUE_TEXT_FADE_NEAR,
  DEFAULT_RENDERER_OPTIONS,
  NoteState,
  TilesRenderer,
  sanitizeRendererOptions,
  splitRibbonWords,
} from './renderer';
import type { RendererOptions } from './renderer';

// ---------------------------------------------------------------------------
// Fake 2D context: Proxy ghi lại mọi lời gọi kèm state lúc gọi.
// ---------------------------------------------------------------------------

interface Call {
  name: string;
  args: unknown[];
  fillStyle: unknown;
  strokeStyle: unknown;
  globalAlpha: unknown;
  font: unknown;
  shadowBlur: unknown;
  lineWidth: unknown;
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
          lineWidth: state.lineWidth,
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

function makeCanvas(w: number, h: number, ctx: CanvasRenderingContext2D | null): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(canvas, 'clientHeight', { value: h, configurable: true });
  Object.defineProperty(canvas, 'getContext', { value: () => ctx, configurable: true });
  return canvas;
}

// ---------------------------------------------------------------------------
// Timeline dựng tay (600 nốt, có rest, hold run, 6 section).
// ---------------------------------------------------------------------------

function buildTimeline(n = 600): Timeline {
  const notes: TimelineNote[] = [];
  for (let i = 0; i < n; i++) {
    const group = Math.floor(i / 8) % 4;
    const octave: Octave = group === 1 ? -1 : group === 2 ? 1 : 0;
    const sharp = group === 3 || (group === 1 && i % 8 >= 6);
    const key: NoteKey = NOTE_KEYS[i % 7 === 0 ? 7 : (i * 3) % 8];
    notes.push({
      index: i,
      key,
      octave,
      sharp,
      startBeat: i,
      // vài nốt 0.5 beat theo sau là rest 0.5 beat
      endBeat: i + (i % 5 === 4 ? 0.5 : 1),
      midi: 60,
      modifiers: modifiersOf(octave, sharp),
      lineIndex: Math.floor(i / 8),
      sectionIndex: Math.floor(i / 100),
      unitIndex: i % 8,
      slur: null,
      runIndex: null,
    });
  }
  // Hold run: dải liên tiếp cùng (octave, sharp) ≠ (0, false); rest phá run (D-020).
  const holdRuns: HoldRun[] = [];
  for (let i = 0; i < n; i++) {
    const a = notes[i];
    if (a.octave === 0 && !a.sharp) continue;
    const prev = holdRuns[holdRuns.length - 1];
    const prevNote = notes[i - 1];
    if (
      prev &&
      prevNote &&
      prevNote.octave === a.octave &&
      prevNote.sharp === a.sharp &&
      prevNote.endBeat === a.startBeat &&
      prev.firstNote + prev.noteCount === i
    ) {
      prev.endBeat = a.endBeat;
      prev.noteCount++;
    } else {
      holdRuns.push({
        index: holdRuns.length,
        octave: a.octave,
        sharp: a.sharp,
        modifiers: a.modifiers,
        startBeat: a.startBeat,
        endBeat: a.endBeat,
        firstNote: i,
        noteCount: 1,
      });
    }
    a.runIndex = holdRuns.length - 1;
  }
  const lines: TimelineLine[] = [];
  for (let l = 0; l * 8 < n; l++) {
    lines.push({
      index: l,
      sectionIndex: Math.floor((l * 8) / 100),
      startBeat: l * 8,
      endBeat: Math.min(n, l * 8 + 8),
      firstNote: l * 8,
      noteCount: Math.min(8, n - l * 8),
    });
  }
  const sections: TimelineSection[] = [];
  for (let s = 0; s * 100 < n; s++) {
    sections.push({
      index: s,
      name: `Phần ${s + 1}`,
      startBeat: s * 100,
      endBeat: Math.min(n, (s + 1) * 100),
      firstLine: Math.floor((s * 100) / 8),
      lineCount: 13,
    });
  }
  return {
    bpm: 90,
    timeSig: { num: 4, den: 4 },
    beatsPerBar: 4,
    scrollDir: 1,
    baseOctave: 4,
    notes,
    lines,
    sections,
    holdRuns,
    totalBeats: n,
  };
}

function nextSameLane(tl: Timeline, i: number): number | null {
  for (let j = i + 1; j < tl.notes.length; j++) {
    if (tl.notes[j].key === tl.notes[i].key) return tl.notes[j].startBeat;
  }
  return null;
}

/** Số nốt có tile giao với màn hình, tính độc lập bằng layout.ts. */
function expectedVisible(tl: Timeline, L: Layout, cur: number): number {
  let count = 0;
  for (let i = 0; i < tl.notes.length; i++) {
    const r = tileRect(tl.notes[i], nextSameLane(tl, i), cur, L);
    const visible =
      L.orientation === 'vertical'
        ? r.y < L.height && r.y + r.h > 0
        : r.x < L.width && r.x + r.w > 0;
    if (visible) count++;
  }
  return count;
}

const KEY_SET = new Set<string>(NOTE_KEYS);
const keyLabelCalls = (calls: Call[]): Call[] =>
  calls.filter((c) => c.name === 'fillText' && KEY_SET.has(String(c.args[0])));
const texts = (calls: Call[]): string[] =>
  calls.filter((c) => c.name === 'fillText').map((c) => String(c.args[0]));

let dprDescriptor: PropertyDescriptor | undefined;
function setDpr(value: number): void {
  dprDescriptor ??= Object.getOwnPropertyDescriptor(window, 'devicePixelRatio') ?? {
    value: 1,
    configurable: true,
    writable: true,
  };
  Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true });
}

afterEach(() => {
  if (dprDescriptor) {
    Object.defineProperty(window, 'devicePixelRatio', dprDescriptor);
    dprDescriptor = undefined;
  }
});

// ---------------------------------------------------------------------------

describe('TilesRenderer', () => {
  const tl = buildTimeline(600);

  it('getContext trả null (jsdom): mọi API là no-op, không throw', () => {
    const r = new TilesRenderer(makeCanvas(800, 600, null));
    expect(() => {
      r.setTimeline(tl);
      r.resize();
      r.setOptions({ orientation: 'horizontal', background: 'chroma' });
      r.render({ beat: 10, countInRemaining: 2 });
      r.dispose();
      r.render({ beat: 11 });
    }).not.toThrow();
  });

  it('getContext throw cũng được chịu', () => {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getContext', {
      value: () => {
        throw new Error('no canvas');
      },
    });
    const r = new TilesRenderer(canvas);
    expect(() => r.render({ beat: 0 })).not.toThrow();
  });

  it('600 nốt + hold runs: chỉ vẽ nhãn phím của nốt đang thấy (cull nhị phân)', () => {
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(800, 600, ctx));
    r.setTimeline(tl);
    expect(tl.holdRuns.length).toBeGreaterThan(50);
    for (const beat of [-3.3, 0.37, 100.37, 333.61, 595.5, 650.2]) {
      calls.length = 0;
      expect(() => r.render({ beat })).not.toThrow();
      const L = r.layout!;
      const drawn = keyLabelCalls(calls).length;
      expect(drawn).toBe(expectedVisible(tl, L, beat));
      expect(drawn).toBeLessThan(30);
    }
    // giữa bài chắc chắn có tile
    calls.length = 0;
    r.render({ beat: 200.25 });
    expect(keyLabelCalls(calls).length).toBeGreaterThan(5);
  });

  it('lane ngang (overlay): cùng luật cull theo trục x', () => {
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(1280, 320, ctx), { orientation: 'horizontal' });
    r.setTimeline(tl);
    for (const beat of [0.5, 250.75, 599.1]) {
      calls.length = 0;
      r.render({ beat });
      const L = r.layout!;
      expect(L.orientation).toBe('horizontal');
      expect(L.hitPos).toBeCloseTo(1280 * 0.18);
      expect(keyLabelCalls(calls).length).toBe(expectedVisible(tl, L, beat));
    }
  });

  it('nhãn phím "," được vẽ (font to riêng)', () => {
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(800, 600, ctx));
    r.setTimeline(tl);
    r.render({ beat: 6.5 }); // nốt 7 là ","
    const comma = calls.filter((c) => c.name === 'fillText' && c.args[0] === ',');
    expect(comma.length).toBeGreaterThan(0);
    const keyFont = calls.find((c) => c.name === 'fillText' && c.args[0] === 'Z')?.font;
    expect(comma[0].font).not.toBe(keyFont);
  });

  it('tile bị luật gap làm ngắn hơn nhãn: nhãn phím dùng font gọn, không chồng nhau', () => {
    const { ctx, calls } = fakeCtx();
    const mk = (i: number, start: number, end: number): TimelineNote => ({
      ...tl.notes[0],
      index: i,
      key: 'C',
      octave: 0,
      sharp: false,
      modifiers: modifiersOf(0, false),
      startBeat: start,
      endBeat: end,
      runIndex: null,
    });
    const notes = [mk(0, 2, 2.25), mk(1, 2.25, 2.5), mk(2, 4, 5)];
    const r = new TilesRenderer(makeCanvas(800, 600, ctx));
    r.setTimeline({ ...tl, notes, holdRuns: [], totalBeats: 6 });
    r.render({ beat: 1.5 });
    const cs = calls.filter((c) => c.name === 'fillText' && c.args[0] === 'C');
    expect(cs).toHaveLength(3);
    const fontPx = (c: Call): number => Number(/(\d+)px/.exec(String(c.font))![1]);
    // Nốt 0.25 beat đầu bị luật gap cắt còn ≈13px → font gọn (≤ pitch − 1, không đè nhãn kế);
    // nốt 0.25 beat thứ hai được kéo lên tối thiểu 28px → vẫn nhãn ≥ 28px (spec); nốt 1 beat ≥ 28.
    const sizes = cs.map(fontPx).sort((a, b) => a - b);
    expect(sizes[0]).toBeLessThan(28);
    expect(sizes[0]).toBeLessThanOrEqual(0.25 * r.layout!.pxPerBeat - 1);
    expect(sizes[1]).toBeGreaterThanOrEqual(28);
    expect(sizes[2]).toBeGreaterThanOrEqual(28);
  });

  it('nhãn phụ: solfège theo ngôn ngữ, số, hoặc tắt', () => {
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(800, 600, ctx), { subLabel: 'solfege' });
    r.setTimeline(tl);
    r.render({ beat: 200.25 });
    expect(
      texts(calls).some((t) => ['Đồ', 'Rê', 'Mi', 'Fa', 'Sol', 'La', 'Si', 'Đố'].includes(t)),
    ).toBe(true);
    calls.length = 0;
    r.setOptions({ language: 'en' });
    r.render({ beat: 200.25 });
    expect(texts(calls).some((t) => ['Ti', "Do'", 'Re'].includes(t))).toBe(true);
    calls.length = 0;
    r.setOptions({ subLabel: 'number' });
    r.render({ beat: 200.25 });
    expect(texts(calls).some((t) => ['1', '2', '3', '4', '5', '6', '7', '1̇'].includes(t))).toBe(
      true,
    );
    calls.length = 0;
    r.setOptions({ subLabel: 'none', showRibbons: false });
    r.render({ beat: 200.25 });
    expect(
      texts(calls).every((t) => KEY_SET.has(t) || ['↓', '↑', '#'].includes(t) || /Phần/.test(t)),
    ).toBe(true);
  });

  it('modifier không chỉ bằng màu: ↓ cho chuột trái, ↑ cho chuột phải, badge # cho scroll', () => {
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(800, 600, ctx));
    r.setTimeline(tl);
    r.render({ beat: 8.2 }); // nhóm 1 (beat 8..15) = chuột trái
    expect(texts(calls)).toContain('↓');
    calls.length = 0;
    r.render({ beat: 16.2 }); // nhóm 2 = chuột phải
    expect(texts(calls)).toContain('↑');
    calls.length = 0;
    r.render({ beat: 24.2 }); // nhóm 3 = scroll
    expect(texts(calls)).toContain('#');
    expect(calls.some((c) => c.name === 'arc')).toBe(true);
  });

  it('hold ribbon: nhãn GIỮ … xếp chồng ở đầu dải, THẢ ở cuối; theo ngôn ngữ', () => {
    const { ctx, calls } = fakeCtx();
    const run: HoldRun = {
      index: 0,
      octave: 1,
      sharp: false,
      modifiers: modifiersOf(1, false),
      startBeat: 2,
      endBeat: 6,
      firstNote: 0,
      noteCount: 4,
    };
    const notes: TimelineNote[] = [2, 3, 4, 5].map((b, i) => ({
      ...tl.notes[0],
      index: i,
      key: 'B',
      octave: 1,
      sharp: false,
      modifiers: modifiersOf(1, false),
      startBeat: b,
      endBeat: b + 1,
      runIndex: 0,
    }));
    const small: Timeline = { ...tl, notes, holdRuns: [run], totalBeats: 8 };
    const r = new TilesRenderer(makeCanvas(800, 600, ctx));
    r.setTimeline(small);
    r.render({ beat: 1 });
    const t = texts(calls);
    expect(t).toEqual(expect.arrayContaining(['GIỮ', 'CHUỘT', 'PHẢI', 'THẢ']));
    // "GIỮ" ở trên "PHẢI" (đọc từ trên xuống), cả hai gần đáy dải (đầu chạm hit line trước)
    const y = (s: string): number =>
      Number(calls.find((c) => c.name === 'fillText' && c.args[0] === s)!.args[2]);
    expect(y('GIỮ')).toBeLessThan(y('PHẢI'));
    expect(y('THẢ')).toBeLessThan(y('GIỮ'));
    calls.length = 0;
    r.setOptions({ language: 'en' });
    r.render({ beat: 1 });
    expect(texts(calls)).toEqual(expect.arrayContaining(['HOLD', 'RIGHT', 'MOUSE', 'RELEASE']));
    // tắt ribbon → không còn nhãn
    calls.length = 0;
    r.setOptions({ showRibbons: false });
    r.render({ beat: 1 });
    expect(texts(calls)).not.toContain('HOLD');
  });

  it('run rất ngắn: nhãn gọn thay vì chữ tràn, THẢ vẫn có (ngay sau cuối dải)', () => {
    const { ctx, calls } = fakeCtx();
    const run: HoldRun = {
      index: 0,
      octave: -1,
      sharp: true,
      modifiers: modifiersOf(-1, true),
      startBeat: 2,
      endBeat: 2.5,
      firstNote: 0,
      noteCount: 1,
    };
    const note: TimelineNote = {
      ...tl.notes[0],
      key: 'X',
      octave: -1,
      sharp: true,
      modifiers: modifiersOf(-1, true),
      startBeat: 2,
      endBeat: 2.5,
      runIndex: 0,
    };
    const r = new TilesRenderer(makeCanvas(800, 600, ctx));
    r.setTimeline({ ...tl, notes: [note], holdRuns: [run], totalBeats: 4 });
    r.render({ beat: 1 });
    const t = texts(calls);
    expect(t).not.toContain('GIỮ');
    expect(t).toContain('↓#');
    // Spec §5 / D-023: THẢ ở cuối mọi ribbon — run ngắn: ô THẢ nằm ngay sau mép xa của dải.
    expect(t).toContain('THẢ');
    const L = r.layout!;
    const farEdge = L.hitPos - (2.5 - 1) * L.pxPerBeat;
    const tha = calls.find((c) => c.name === 'fillText' && c.args[0] === 'THẢ')!;
    expect(Number(tha.args[2])).toBeLessThan(farEdge);
  });

  it('nền trong suốt: clearRect, không fillRect nền', () => {
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(800, 600, ctx), { background: 'transparent' });
    r.setTimeline(tl);
    r.render({ beat: 50.5 });
    expect(calls.some((c) => c.name === 'clearRect' && c.args.join() === '0,0,800,600')).toBe(true);
    const fullFills = calls.filter((c) => c.name === 'fillRect' && c.args.join() === '0,0,800,600');
    expect(fullFills).toHaveLength(0);
    expect(calls.some((c) => c.name === 'fillRect' && c.fillStyle === CANVAS_THEMES.dark.bg)).toBe(
      false,
    );
  });

  it('nền chroma: tô #00ff00 toàn canvas, không glow', () => {
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(800, 600, ctx), { background: 'chroma' });
    r.setTimeline(tl);
    r.render({ beat: 50.5, countInRemaining: 1.4 });
    const bg = calls.find((c) => c.name === 'fillRect' && c.args.join() === '0,0,800,600');
    expect(bg?.fillStyle).toBe(CHROMA_GREEN);
    expect(String(bg?.fillStyle).toLowerCase()).toBe('#00ff00');
    // không shadowBlur (loang xanh); số đếm vào không vẽ trên canvas (round 6)
    expect(calls.some((c) => Number(c.shadowBlur) > 0)).toBe(false);
    expect(texts(calls)).not.toContain('2');
  });

  it('nền theme có glow ở hit line: vạch accent chồng dưới lõi trắng, không shadowBlur', () => {
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(800, 600, ctx));
    r.render({ beat: 0 });
    const pal = CANVAS_THEMES.dark;
    const strokes = calls.filter((c) => c.name === 'stroke');
    const glow = strokes.findIndex((c) => c.strokeStyle === pal.hitGlow);
    const outer = strokes.findIndex((c) => c.strokeStyle === pal.hitGlowOuter);
    const core = strokes.findIndex((c) => c.strokeStyle === pal.hitLine);
    expect(glow).toBeGreaterThanOrEqual(0);
    expect(outer).toBeGreaterThanOrEqual(0);
    // Lõi vẽ sau cùng (nằm trên glow), đúng một lần (kèm ngoặc hai đầu cùng path).
    expect(core).toBeGreaterThan(Math.max(glow, outer));
    expect(strokes.filter((c) => c.strokeStyle === pal.hitLine)).toHaveLength(1);
    // Glow cache rẻ: không shadowBlur (hit line vẽ mỗi frame).
    expect(calls.some((c) => Number(c.shadowBlur) > 0)).toBe(false);
  });

  it('nền chroma: không màu accent xanh (bị key mất); thân tile / ribbon mờ dần vẽ màu đặc', () => {
    const modFills: unknown[] = Object.values(MOD_COLORS).map((c) => c.fill);
    const translucentBody = (calls: Call[]): Call[] =>
      calls.filter(
        (c) =>
          (c.name === 'fill' || c.name === 'fillRect') &&
          Number(c.globalAlpha) < 1 &&
          (modFills.includes(c.fillStyle) || String(c.fillStyle).startsWith('rgb(')),
      );
    const translucentEdge = (calls: Call[], strokes: unknown[]): Call[] =>
      calls.filter(
        (c) =>
          (c.name === 'stroke' || c.name === 'strokeRect') &&
          Number(c.globalAlpha) < 1 &&
          (strokes.includes(c.strokeStyle) || String(c.strokeStyle).startsWith('rgb(')),
      );
    // Beat giữa bài: có tile đã qua hit line (mờ dần) và ribbon bán trong suốt.
    const theme = fakeCtx();
    const rt = new TilesRenderer(makeCanvas(800, 600, theme.ctx));
    rt.setTimeline(tl);
    rt.render({ beat: 50.5 });
    expect(translucentBody(theme.calls).length).toBeGreaterThan(0);

    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(800, 600, ctx), { background: 'chroma' });
    r.setTimeline(tl);
    r.render({ beat: 50.5 });
    const styles = calls.flatMap((c) => [String(c.fillStyle), String(c.strokeStyle)]);
    expect(styles.some((s) => s.replace(/\s/g, '').includes('15,247,150'))).toBe(false);
    expect(translucentBody(calls)).toHaveLength(0);
    const chromaStrokes: unknown[] = Object.values(OVERLAY_CANVAS_THEMES.chroma.tileStroke);
    expect(translucentEdge(calls, chromaStrokes)).toHaveLength(0);
    // Màu trộn sẵn (rgb(…)) được dùng cho phần mờ.
    expect(calls.some((c) => c.name === 'fill' && String(c.fillStyle).startsWith('rgb('))).toBe(
      true,
    );
    // Hit line: lõi + viền tối đặc, không glow accent.
    const chroma = OVERLAY_CANVAS_THEMES.chroma;
    expect(calls.some((c) => c.name === 'stroke' && c.strokeStyle === chroma.hitLine)).toBe(true);
    expect(calls.some((c) => c.name === 'stroke' && c.strokeStyle === chroma.hitGlow)).toBe(true);
  });

  it('nền theme: tô màu nền theme trước tiên', () => {
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(800, 600, ctx), { theme: 'light' });
    r.render({ beat: 0 });
    const first = calls.find((c) => c.name === 'fillRect');
    expect(first?.fillStyle).toBe(CANVAS_THEMES.light.bg);
    expect(first?.args.join()).toBe('0,0,800,600');
  });

  it('resize: backing store theo devicePixelRatio, setTransform(dpr), bỏ qua khi không đổi', () => {
    setDpr(2);
    const { ctx, calls } = fakeCtx();
    const canvas = makeCanvas(400, 300, ctx);
    const r = new TilesRenderer(canvas);
    r.resize();
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    const st = calls.filter((c) => c.name === 'setTransform');
    expect(st[st.length - 1].args).toEqual([2, 0, 0, 2, 0, 0]);
    const before = calls.length;
    r.resize();
    expect(calls.length).toBe(before);
    expect(r.layout!.width).toBe(400);
  });

  it('canvas kích thước 0: render no-op', () => {
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(0, 0, ctx));
    r.setTimeline(tl);
    r.render({ beat: 3 });
    expect(r.layout).toBeNull();
    expect(calls.filter((c) => c.name === 'fillText')).toHaveLength(0);
  });

  it('đếm vào: KHÔNG vẽ số trên canvas (round 6) — chỉ còn tile dẫn vào, ở mọi kiểu / nền', () => {
    for (const opts of [
      {},
      { scheme: 'mobile' as const, subLabel: 'none' as const },
      { scheme: 'mobile' as const, lanePadding: 'pad' as const, subLabel: 'none' as const },
      { background: 'chroma' as const, orientation: 'horizontal' as const },
    ]) {
      const { ctx, calls } = fakeCtx();
      const r = new TilesRenderer(makeCanvas(800, 600, ctx), { subLabel: 'none', ...opts });
      r.setTimeline(tl);
      r.render({ beat: -2.5, countInRemaining: 2.5, countIn: { start: -4, end: 0 } });
      // Số đếm cũ = chữ số rất to; nhãn tile mobile ("1" … "7") cỡ ≤ 36 px.
      const big = calls.filter(
        (c) =>
          (c.name === 'fillText' || c.name === 'strokeText') &&
          /^\d+$/.test(String(c.args[0])) &&
          Number(/(\d+(?:\.\d+)?)px/.exec(String(c.font))?.[1] ?? 0) > 40,
      );
      expect(big).toHaveLength(0);
      expect(calls.some((c) => c.name === 'strokeText' && c.args[0] === '3')).toBe(false);
      // Tile vẫn vẽ (phần dẫn vào).
      expect(calls.some((c) => c.name === 'roundRect')).toBe(true);
    }
  });

  it('noteStates: miss viền đỏ + mờ, waiting nhấp nháy, perfect mờ đi', () => {
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(800, 600, ctx));
    r.setTimeline(tl);
    const states = new Uint8Array(tl.notes.length);
    for (let i = 98; i < 104; i++) states[i] = NoteState.miss;
    states[104] = NoteState.waiting;
    states[105] = NoteState.perfect;
    expect(() => r.render({ beat: 100.3, noteStates: states, timeMs: 1234 })).not.toThrow();
    expect(
      calls.some((c) => c.name === 'stroke' && c.strokeStyle === CANVAS_THEMES.dark.miss),
    ).toBe(true);
    expect(
      calls.some((c) => c.name === 'stroke' && c.strokeStyle === CANVAS_THEMES.dark.waiting),
    ).toBe(true);
    // mảng ngắn hơn số nốt không làm hỏng
    expect(() => r.render({ beat: 100.3, noteStates: new Uint8Array(3) })).not.toThrow();
  });

  it('prefers-reduced-motion: tile chờ bấm có viền tĩnh (không phụ thuộc thời gian), đổi thì vẽ lại', () => {
    const listeners: (() => void)[] = [];
    const mql = {
      matches: true,
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal(
      'matchMedia',
      vi.fn((q: string) =>
        q.includes('reduced-motion')
          ? mql
          : { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      ),
    );
    try {
      const { ctx, calls } = fakeCtx();
      const r = new TilesRenderer(makeCanvas(800, 600, ctx));
      r.setTimeline(tl);
      const states = new Uint8Array(tl.notes.length);
      states[104] = NoteState.waiting;
      const waitingStrokes = (timeMs: number) => {
        calls.length = 0;
        r.render({ beat: 100.3, noteStates: states, timeMs });
        return calls
          .filter((c) => c.name === 'stroke' && c.strokeStyle === CANVAS_THEMES.dark.waiting)
          .map((c) => [c.globalAlpha, c.shadowBlur]);
      };
      const a = waitingStrokes(0);
      expect(a.length).toBeGreaterThan(0);
      expect(waitingStrokes(157)).toEqual(a);
      // Tắt giảm chuyển động → nhấp nháy lại theo thời gian.
      mql.matches = false;
      for (const fn of listeners) fn();
      expect(waitingStrokes(157)).not.toEqual(waitingStrokes(0));
      r.dispose();
      expect(mql.removeEventListener).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('frame ổn định: không measureText trong hot loop', () => {
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(800, 600, ctx));
    r.setTimeline(tl);
    r.render({ beat: 10 });
    expect(calls.some((c) => c.name === 'measureText')).toBe(true);
    calls.length = 0;
    for (let f = 0; f < 120; f++) r.render({ beat: 10 + f / 30 });
    expect(calls.some((c) => c.name === 'measureText')).toBe(false);
    // setOptions giống hệt không làm bẩn cache
    r.setOptions({ ...r.options });
    r.render({ beat: 20 });
    expect(calls.some((c) => c.name === 'measureText')).toBe(false);
  });

  it('dispose: render sau đó không vẽ gì', () => {
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(800, 600, ctx));
    r.setTimeline(tl);
    r.dispose();
    calls.length = 0;
    r.render({ beat: 5 });
    expect(calls).toHaveLength(0);
  });

  it('setTimeline(null) vẫn vẽ nền + hit line', () => {
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(800, 600, ctx));
    r.setTimeline(tl);
    r.setTimeline(null);
    r.render({ beat: 5 });
    expect(keyLabelCalls(calls)).toHaveLength(0);
    expect(calls.some((c) => c.name === 'stroke')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Hồi quy các lỗi review (player-ui)
// ---------------------------------------------------------------------------

const fontPxOf = (c: Call): number => Number(/(\d+(?:\.\d+)?)px/.exec(String(c.font))![1]);

/** Fixture "Bài thử nhịp điệu" (tự soạn cho test): 128 beat, nốt 0.5 lặp, luyến, giữ chuột phải dài. */
function fixtureTimeline(): Timeline {
  return buildSongTimeline(parseHarm(FIXTURE_SONG).song);
}

/** Nốt dựng tay: key, [start, end), modifier theo (octave, sharp). */
function mkNote(
  index: number,
  key: NoteKey,
  start: number,
  end: number,
  octave: Octave = 0,
  sharp = false,
): TimelineNote {
  return {
    index,
    key,
    octave,
    sharp,
    startBeat: start,
    endBeat: end,
    midi: 60,
    modifiers: modifiersOf(octave, sharp),
    lineIndex: 0,
    sectionIndex: 0,
    unitIndex: index,
    slur: null,
    runIndex: null,
  };
}

function mkRun(index: number, start: number, end: number, octave: Octave, sharp = false): HoldRun {
  return {
    index,
    octave,
    sharp,
    modifiers: modifiersOf(octave, sharp),
    startBeat: start,
    endBeat: end,
    firstNote: 0,
    noteCount: 1,
  };
}

function mkTimeline(
  notes: TimelineNote[],
  holdRuns: HoldRun[] = [],
  sections: TimelineSection[] = [],
): Timeline {
  const total = notes.reduce((m, n) => Math.max(m, n.endBeat), 0);
  return {
    bpm: 90,
    timeSig: { num: 4, den: 4 },
    beatsPerBar: 4,
    scrollDir: 1,
    baseOctave: 4,
    notes,
    lines: [],
    sections,
    holdRuns,
    totalBeats: total,
  };
}

/** Index nốt kế cùng lane → startBeat (null nếu không có). */
const nextSame = (tl: Timeline, i: number): number | null => nextSameLane(tl, i);

describe('TilesRenderer — nhãn phím (ui-3, ui-4, renderer-perf-3/4)', () => {
  it('lookahead 12 ở 1080p: tile không bị luật gap luôn có nhãn ≥ 28px; chỉ tile bị gap cắt mới nhỏ hơn', () => {
    const tl = fixtureTimeline();
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(980, 743, ctx), { lookahead: 12 });
    r.setTimeline(tl);
    let checked = 0;
    for (const beat of [3.2, 20.7, 41.1, 77.4, 120.3]) {
      calls.length = 0;
      r.render({ beat });
      const L = r.layout!;
      let truncated = 0;
      for (let i = 0; i < tl.notes.length; i++) {
        const n = tl.notes[i];
        if (n.key === ',') continue;
        const rect = tileRect(n, nextSame(tl, i), beat, L);
        if (!(rect.y < L.height && rect.y + rect.h > 0)) continue;
        const len = tileLength(n.startBeat, n.endBeat, nextSame(tl, i), L);
        if (len < L.minTileLen - 0.5) truncated++;
      }
      const labels = keyLabelCalls(calls).filter((c) => c.args[0] !== ',');
      checked += labels.length;
      expect(labels.filter((c) => fontPxOf(c) < 28)).toHaveLength(truncated);
      // tile bị gap cắt (nốt lặp 0.5 beat) vẫn đủ lớn để đọc
      for (const c of labels) expect(fontPxOf(c)).toBeGreaterThanOrEqual(16);
    }
    expect(checked).toBeGreaterThan(40);
  });

  it('tileScale < 1 không kéo nhãn phím xuống dưới 28px', () => {
    const tl = fixtureTimeline();
    for (const [w, h] of [
      [980, 743],
      [318, 523],
    ]) {
      const { ctx, calls } = fakeCtx();
      const r = new TilesRenderer(makeCanvas(w, h, ctx), { tileScale: 0.75 });
      r.setTimeline(tl);
      r.render({ beat: 30.2 });
      const labels = keyLabelCalls(calls).filter((c) => c.args[0] !== ',');
      expect(labels.length).toBeGreaterThan(3);
      for (const c of labels) expect(fontPxOf(c)).toBeGreaterThanOrEqual(28);
    }
  });

  it('nốt 0.25 beat lặp ở lookahead 12: nhãn, badge # và mũi tên không chồng lên nhau', () => {
    const notes: TimelineNote[] = [];
    let idx = 0;
    for (let k = 0; k < 4; k++) notes.push(mkNote(idx++, 'X', 1 + k * 0.25, 1.25 + k * 0.25));
    for (let k = 0; k < 4; k++) {
      notes.push(mkNote(idx++, 'B', 2.5 + k * 0.25, 2.75 + k * 0.25, 0, true));
    }
    for (let k = 0; k < 4; k++) {
      notes.push(mkNote(idx++, 'N', 4 + k * 0.25, 4.25 + k * 0.25, -1));
    }
    const tl = mkTimeline(notes);
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(980, 743, ctx), { lookahead: 12 });
    r.setTimeline(tl);
    r.render({ beat: 0.5 });
    const L = r.layout!;
    expect(0.25 * L.pxPerBeat).toBeLessThan(13);
    for (const key of ['X', 'B', 'N']) {
      const labels = keyLabelCalls(calls)
        .filter((c) => c.args[0] === key)
        .sort((a, b) => Number(a.args[2]) - Number(b.args[2]));
      expect(labels.length).toBeGreaterThanOrEqual(2);
      for (let k = 1; k < labels.length; k++) {
        const dy = Number(labels[k].args[2]) - Number(labels[k - 1].args[2]);
        // hộp em của hai nhãn liên tiếp cùng lane không giao nhau
        expect(dy).toBeGreaterThanOrEqual(
          (fontPxOf(labels[k]) + fontPxOf(labels[k - 1])) / 2 - 0.5,
        );
      }
    }
    const arcs = calls
      .filter((c) => c.name === 'arc')
      .map((c) => ({ y: Number(c.args[1]), r: Number(c.args[2]) }))
      .sort((a, b) => a.y - b.y);
    expect(arcs).toHaveLength(4);
    for (let k = 1; k < arcs.length; k++) {
      expect(arcs[k].y - arcs[k - 1].y).toBeGreaterThanOrEqual(arcs[k].r + arcs[k - 1].r - 0.01);
    }
    // mũi tên 14px không lọt pitch 12.7px → chỉ còn ở tile cuối (dài 28px)
    expect(texts(calls).filter((t) => t === '↓')).toHaveLength(1);
  });

  it('nhãn phụ: tile thấp (0.5 beat) vẫn có solfège cùng hàng, bên phải nhãn phím', () => {
    const tl = fixtureTimeline();
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(980, 743, ctx), { subLabel: 'solfege' });
    r.setTimeline(tl);
    let keys = 0;
    let subs = 0;
    const SOLFEGE = new Set(['Đồ', 'Rê', 'Mi', 'Fa', 'Sol', 'La', 'Si', 'Đố']);
    for (const beat of [3.2, 20.7, 41.1, 77.4]) {
      calls.length = 0;
      r.render({ beat });
      keys += keyLabelCalls(calls).length;
      subs += texts(calls).filter((t) => SOLFEGE.has(t)).length;
    }
    expect(keys).toBeGreaterThan(30);
    expect(subs / keys).toBeGreaterThan(0.9);

    // Một nốt 0.5 beat đứng riêng: nhãn phụ ngang hàng, bên phải chữ phím.
    const { ctx: ctx2, calls: calls2 } = fakeCtx();
    const r2 = new TilesRenderer(makeCanvas(980, 743, ctx2), { subLabel: 'solfege' });
    r2.setTimeline(mkTimeline([mkNote(0, 'X', 2, 2.5)]));
    r2.render({ beat: 0 });
    const key = calls2.find((c) => c.name === 'fillText' && c.args[0] === 'X')!;
    const sub = calls2.find((c) => c.name === 'fillText' && c.args[0] === 'Rê')!;
    expect(sub).toBeDefined();
    expect(Number(sub.args[2])).toBeCloseTo(Number(key.args[2]), 5);
    expect(Number(sub.args[1])).toBeGreaterThan(Number(key.args[1]));
  });

  it('nhãn phụ số: "1̇" vẽ là "1" + chấm tròn ngay trên (không dùng dấu kết hợp U+0307)', () => {
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(980, 743, ctx), { subLabel: 'number' });
    r.setTimeline(mkTimeline([mkNote(0, ',', 2, 4)]));
    r.render({ beat: 0 });
    expect(texts(calls)).not.toContain('1̇');
    const one = calls.find((c) => c.name === 'fillText' && c.args[0] === '1')!;
    expect(one).toBeDefined();
    const dot = calls.find((c) => c.name === 'arc')!;
    expect(Number(dot.args[0])).toBeCloseTo(Number(one.args[1]), 5);
    expect(Number(dot.args[1])).toBeLessThan(Number(one.args[2]));
  });

  it('nốt dài đang giữ: nhãn phím dính phần còn thấy của tile (không trôi khỏi canvas)', () => {
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(980, 743, ctx), { lookahead: 4 });
    r.setTimeline(mkTimeline([mkNote(0, 'C', 0, 1), mkNote(1, 'Z', 1, 9), mkNote(2, 'X', 9, 10)]));
    for (const beat of [2, 4, 6, 8.5]) {
      calls.length = 0;
      r.render({ beat });
      const z = calls.find((c) => c.name === 'fillText' && c.args[0] === 'Z');
      expect(z, `beat ${beat}`).toBeDefined();
      expect(Number(z!.args[2])).toBeGreaterThan(0);
      expect(Number(z!.args[2])).toBeLessThan(743);
    }
  });
});

describe('TilesRenderer — đếm vào, loop, ribbon (ui-1, ui-2, ui-5)', () => {
  const ACTIVE_FILL = 'rgba(255,255,255,0.22)';

  it('đếm vào giữa bài: ô nhịp tua lại vẽ mờ và không nốt nào "sáng" ở hit line', () => {
    const notes = [0, 1, 2, 3, 4, 5, 6, 7].map((b, i) =>
      mkNote(i, NOTE_KEYS[i], b, b + 1, i === 2 || i === 3 ? -1 : 0),
    );
    const run = mkRun(0, 2, 4, -1);
    const tl = mkTimeline(notes, [run]);
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(800, 600, ctx));
    r.setTimeline(tl);

    // Không đếm vào: nốt C (beat 2) đang ở hit line → sáng.
    r.render({ beat: 2.5 });
    expect(calls.some((c) => c.name === 'fill' && c.fillStyle === ACTIVE_FILL)).toBe(true);

    // Đang đếm vào tới beat 4 (D-025): nốt 0..3 + run [2,4) mờ, không sáng; từ beat 4 bình thường.
    calls.length = 0;
    r.render({ beat: 2.5, countInRemaining: 1.5, countIn: { start: 0, end: 4 } });
    expect(calls.some((c) => c.name === 'fill' && c.fillStyle === ACTIVE_FILL)).toBe(false);
    const alphaOf = (key: string): number =>
      Number(calls.find((c) => c.name === 'fillText' && c.args[0] === key)!.globalAlpha);
    for (const k of ['C', 'V']) expect(alphaOf(k)).toBeLessThanOrEqual(0.22 + 1e-9);
    expect(alphaOf('B')).toBe(1);
    expect(alphaOf('N')).toBe(1);
    const ribbonBody = calls.find(
      (c) => c.name === 'fillRect' && c.fillStyle === '#2563eb' && Number(c.args[0]) > 700,
    )!;
    expect(Number(ribbonBody.globalAlpha)).toBeLessThanOrEqual(0.22);

    // Hết đếm vào (countIn không còn áp vì beat ≥ end) → bình thường.
    calls.length = 0;
    r.render({ beat: 4.2, countIn: { start: 0, end: 4 } });
    expect(calls.some((c) => c.name === 'fill' && c.fillStyle === ACTIVE_FILL)).toBe(true);
  });

  it('loop A-B: không vẽ nốt sau loop end, vẽ tiếp đầu loop (vòng kế) có lead-in', () => {
    const notes = Array.from({ length: 16 }, (_, i) => mkNote(i, NOTE_KEYS[i % 8], i, i + 1));
    const tl = mkTimeline(notes);
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(800, 600, ctx), { lookahead: 8 });
    r.setTimeline(tl);
    const cur = 7.5;
    r.render({ beat: cur, loop: { start: 4, end: 8 } });
    const L = r.layout!;
    // (lane, mép gần) của mọi tile đã vẽ
    const drawn = calls
      .filter((c) => c.name === 'roundRect')
      .map((c) => ({
        x: Math.round(Number(c.args[0])),
        near: Math.round(Number(c.args[1]) + Number(c.args[3])),
      }));
    // Kỳ vọng: nốt 5..7 thật + nốt 4..7 ở vòng 1 (dời +4) và vòng 2 (dời +8).
    const expected: { x: number; near: number }[] = [];
    const push = (i: number, shift: number): void => {
      const n = tl.notes[i];
      const rect = tileRect(
        { ...n, startBeat: n.startBeat + shift, endBeat: n.endBeat + shift },
        null,
        cur,
        L,
      );
      if (rect.y < L.height && rect.y + rect.h > 0) {
        expected.push({ x: Math.round(rect.x), near: Math.round(rect.y + rect.h) });
      }
    };
    for (const i of [4, 5, 6, 7]) push(i, 0);
    for (const shift of [4, 8]) for (const i of [4, 5, 6, 7]) push(i, shift);
    const key = (d: { x: number; near: number }): string => `${d.x}:${d.near}`;
    expect(drawn.map(key).sort()).toEqual(expected.map(key).sort());
    // nốt đầu loop (B, lane 4) xuất hiện ở vòng kế, cách hit line 0.5 beat
    const bLabels = calls.filter((c) => c.name === 'fillText' && c.args[0] === 'B');
    expect(bLabels.length).toBeGreaterThanOrEqual(2);
    // vạch đứt nét đánh dấu chỗ quay về đầu loop
    expect(calls.some((c) => c.name === 'setLineDash' && (c.args[0] as number[]).length > 0)).toBe(
      true,
    );

    // Playhead đã qua loop end (transport không wrap) → vẽ như không loop.
    calls.length = 0;
    r.render({ beat: 9.5, loop: { start: 4, end: 8 } });
    expect(calls.some((c) => c.name === 'setLineDash' && (c.args[0] as number[]).length > 0)).toBe(
      false,
    );
    expect(keyLabelCalls(calls).length).toBe(expectedVisible(tl, r.layout!, 9.5));
  });

  it('loop: tile cắt tại loop end, run kéo qua đầu loop có lại nhãn GIỮ ở vòng kế', () => {
    const notes = [mkNote(0, 'C', 0, 1), mkNote(1, 'N', 3, 5, 1), mkNote(2, 'V', 5, 7.5)];
    const run = mkRun(0, 3, 5, 1);
    const tl = mkTimeline(notes, [run]);
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(800, 600, ctx), { lookahead: 8 });
    r.setTimeline(tl);
    r.render({ beat: 5.5, loop: { start: 4, end: 7 } });
    const L = r.layout!;
    // V [5, 7.5) bị cắt ở loop end 7: không tile nào vượt quá mép loop end
    const loopEndY = L.hitPos - (7 - 5.5) * L.pxPerBeat;
    const vRect = calls.find(
      (c) =>
        c.name === 'roundRect' &&
        Math.abs(Number(c.args[1]) + Number(c.args[3]) - (L.hitPos + 0.5 * L.pxPerBeat)) < 1,
    )!;
    expect(Number(vRect.args[1])).toBeGreaterThanOrEqual(loopEndY);
    // Run [3,5) cắt qua đầu loop 4 → ở vòng kế vẽ lại từ 4 (dời +3) với nhãn GIỮ
    expect(texts(calls).filter((t) => t === 'GIỮ').length).toBeGreaterThanOrEqual(1);
  });

  it('loop + practice: tile vòng kế không mang trạng thái chấm của vòng hiện tại', () => {
    const notes = Array.from({ length: 16 }, (_, i) => mkNote(i, NOTE_KEYS[i % 8], i, i + 1));
    const tl = mkTimeline(notes);
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(800, 600, ctx), { lookahead: 8 });
    r.setTimeline(tl);
    const pal = CANVAS_THEMES.dark;
    const states = new Uint8Array(tl.notes.length);
    states[4] = NoteState.waiting;
    states[5] = NoteState.perfect;
    states[6] = NoteState.good;
    states[7] = NoteState.miss;
    const cur = 7.5;
    r.render({ beat: cur, loop: { start: 4, end: 8 }, noteStates: states, timeMs: 1234 });
    const L = r.layout!;
    const loopEndNear = L.hitPos - (8 - cur) * L.pxPerBeat;
    // Mỗi tile: roundRect → fill thân (alpha của tile) → … → stroke viền.
    const tiles = calls.flatMap((c, k) => {
      if (c.name !== 'roundRect') return [];
      const rest = calls.slice(k + 1);
      return [
        {
          near: Number(c.args[1]) + Number(c.args[3]),
          alpha: rest.find((d) => d.name === 'fill')?.globalAlpha,
          stroke: rest.find((d) => d.name === 'stroke')?.strokeStyle,
        },
      ];
    });
    const graded: unknown[] = [pal.perfect, pal.good, pal.miss, pal.waiting];
    const copies = tiles.filter((t) => t.near <= loopEndNear + 0.5);
    const real = tiles.filter((t) => t.near > loopEndNear + 0.5);
    // Vòng 1 và 2 (dời +4, +8) của nốt 4..7 phía trên vạch loop end.
    expect(copies.length).toBeGreaterThanOrEqual(4);
    for (const t of copies) {
      expect(graded).not.toContain(t.stroke);
      expect(t.alpha).toBe(1);
    }
    // Nốt thật của vòng hiện tại vẫn có viền chấm điểm (V ở hit line: miss → mờ 0.4).
    const v = real.find((t) => t.stroke === pal.miss);
    expect(v).toBeDefined();
    expect(Number(v!.alpha)).toBeCloseTo(0.4);
  });

  it('run ngắn ngay trước run khác (không có chỗ ngoài): GIỮ gọn + THẢ trong dải', () => {
    // Run trái [2, 3) và run phải [3, 6) liền nhau: không chỗ đặt THẢ bên ngoài run trái.
    const notes = [mkNote(0, 'N', 2, 3, -1), mkNote(1, 'M', 3, 6, 1)];
    const runs = [mkRun(0, 2, 3, -1), mkRun(1, 3, 6, 1)];
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(390, 523, ctx));
    r.setTimeline(mkTimeline(notes, runs));
    r.render({ beat: 1 });
    const L = r.layout!;
    const t = texts(calls);
    expect(t).toContain('↓');
    // hai THẢ: một trong dải run trái (dưới mép 3), một ở cuối run phải
    const thas = calls.filter((c) => c.name === 'fillText' && c.args[0] === 'THẢ');
    expect(thas).toHaveLength(2);
    const leftRunTop = L.hitPos - (3 - 1) * L.pxPerBeat;
    expect(thas.some((c) => Number(c.args[2]) > leftRunTop)).toBe(true);
  });

  it('mobile: run 1 beat vẫn có cả GIỮ CHUỘT PHẢI và THẢ', () => {
    const notes = [mkNote(0, 'N', 2, 3, 1), mkNote(1, 'C', 4, 5)];
    const { ctx, calls } = fakeCtx();
    // lookahead 8 (mặc định cũ): ô 1 beat thấp nhất mà chữ vẫn phải đủ.
    const r = new TilesRenderer(makeCanvas(374, 523, ctx), { lookahead: 8 });
    r.setTimeline(mkTimeline(notes, [mkRun(0, 2, 3, 1)]));
    r.render({ beat: 1 });
    expect(r.layout!.pxPerBeat).toBeLessThan(60);
    expect(texts(calls)).toEqual(expect.arrayContaining(['GIỮ', 'CHUỘT', 'PHẢI', 'THẢ']));
  });
});

describe('TilesRenderer — section, độ nét, DPR (renderer-perf-1/2/5)', () => {
  it('nhãn section vẽ sau tile, xoay dọc trong lề trái (không bị tile lane Z che)', () => {
    const notes = [mkNote(0, 'C', 0, 4), mkNote(1, 'Z', 4, 5), mkNote(2, 'X', 5, 6)];
    const sections: TimelineSection[] = [
      { index: 0, name: 'MỞ ĐẦU', startBeat: 0, endBeat: 4, firstLine: 0, lineCount: 1 },
      { index: 1, name: 'ĐIỆP KHÚC', startBeat: 4, endBeat: 6, firstLine: 1, lineCount: 1 },
    ];
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(980, 743, ctx));
    r.setTimeline(mkTimeline(notes, [], sections));
    r.render({ beat: 1 });
    const L = r.layout!;
    const label = calls.findIndex((c) => c.name === 'fillText' && c.args[0] === 'ĐIỆP KHÚC');
    const zLabel = calls.findIndex((c) => c.name === 'fillText' && c.args[0] === 'Z');
    expect(label).toBeGreaterThan(zLabel);
    expect(calls.some((c) => c.name === 'rotate' && Number(c.args[0]) === -Math.PI / 2)).toBe(true);
    // Bề dày viên nhãn không lấn tới tile lane Z (lề nhãn + đệm lane)
    const tr = calls.filter((c) => c.name === 'translate');
    expect(tr.length).toBeGreaterThan(0);
    const zTileX = L.laneCrossStart[0] + L.laneInset;
    for (const c of tr) expect(Number(c.args[0]) * 2).toBeLessThanOrEqual(zTileX);
    expect(calls.filter((c) => c.name === 'save')).toHaveLength(
      calls.filter((c) => c.name === 'restore').length,
    );
  });

  it('kích thước lẻ: backing store = đúng ô device pixel (snap mép), layout theo đó', () => {
    setDpr(1);
    const { ctx } = fakeCtx();
    const canvas = makeCanvas(980, 609, ctx);
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 470,
        top: 136.59375,
        width: 980,
        height: 608.859375,
        right: 1450,
        bottom: 745.453125,
        x: 470,
        y: 136.59375,
      }),
    });
    const r = new TilesRenderer(canvas);
    expect(r.resize()).toBe(true);
    expect(canvas.width).toBe(980);
    expect(canvas.height).toBe(608); // hàng 137..744, không phải round(608.86) = 609
    expect(r.layout!.height).toBe(608);
    expect(r.resize()).toBe(false);

    setDpr(1.25);
    expect(r.resize()).toBe(true);
    expect(canvas.width).toBe(Math.round(1450 * 1.25) - Math.round(470 * 1.25));
    expect(canvas.height).toBe(Math.round(745.453125 * 1.25) - Math.round(136.59375 * 1.25));
    expect(r.layout!.height).toBeCloseTo(canvas.height / 1.25, 6);
  });

  it('ResizeObserver device-pixel-content-box: dùng đúng kích thước device, đổi DPR thì vẽ lại ngay', () => {
    setDpr(1);
    let cb: ResizeObserverCallback | null = null;
    const observe = vi.fn();
    const disconnect = vi.fn();
    class FakeRO {
      constructor(fn: ResizeObserverCallback) {
        cb = fn;
      }
      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;
    }
    vi.stubGlobal('ResizeObserver', FakeRO);
    try {
      const { ctx, calls } = fakeCtx();
      const canvas = makeCanvas(980, 609, ctx);
      Object.defineProperty(canvas, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ left: 470, top: 136.59375, width: 980, height: 608.859375 }),
      });
      const r = new TilesRenderer(canvas);
      expect(observe).toHaveBeenCalledWith(canvas, { box: 'device-pixel-content-box' });
      r.setTimeline(buildTimeline(40));
      r.render({ beat: 3 });
      const entry = (w: number, h: number) =>
        [
          {
            contentRect: { width: 980, height: 608.859375 },
            devicePixelContentBoxSize: [{ inlineSize: w, blockSize: h }],
          },
        ] as unknown as ResizeObserverEntry[];
      calls.length = 0;
      cb!(entry(980, 609), {} as ResizeObserver);
      expect(canvas.height).toBe(609); // số liệu của trình duyệt thắng ước lượng
      expect(calls.some((c) => c.name === 'fillRect')).toBe(true); // đã vẽ lại

      // Chỉ đổi DPR (kéo sang màn 200%) lúc đang pause → resize + vẽ lại, không để canvas trống.
      setDpr(2);
      calls.length = 0;
      cb!(entry(1960, 1218), {} as ResizeObserver);
      expect(canvas.width).toBe(1960);
      expect(canvas.height).toBe(1218);
      expect(keyLabelCalls(calls).length).toBeGreaterThan(0);

      // Giả lập DPR (DevTools/Playwright) báo ô "device" bằng px CSS dù dpr = 1.25 → bỏ qua,
      // dùng ước lượng snap mép (không để bitmap 980px bị phóng 1.25×).
      setDpr(1.25);
      cb!(entry(980, 609), {} as ResizeObserver);
      expect(canvas.width).toBe(Math.round(1450 * 1.25) - Math.round(470 * 1.25));
      r.dispose();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('không có ResizeObserver: matchMedia(resolution) đổi → resize + vẽ lại frame cuối', () => {
    setDpr(1);
    const listeners: (() => void)[] = [];
    // Chỉ theo dõi truy vấn resolution (prefers-reduced-motion có listener riêng).
    const mm = vi.fn((q: string) =>
      q.includes('resolution')
        ? {
            addEventListener: (_t: string, fn: () => void) => listeners.push(fn),
            removeEventListener: (_t: string, fn: () => void) => {
              const k = listeners.indexOf(fn);
              if (k >= 0) listeners.splice(k, 1);
            },
          }
        : { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    );
    vi.stubGlobal('matchMedia', mm);
    try {
      const { ctx, calls } = fakeCtx();
      const canvas = makeCanvas(400, 300, ctx);
      const r = new TilesRenderer(canvas);
      r.setTimeline(buildTimeline(40));
      r.render({ beat: 3 });
      expect(canvas.width).toBe(400);
      expect(listeners).toHaveLength(1);
      setDpr(2);
      calls.length = 0;
      listeners[0]();
      expect(canvas.width).toBe(800);
      expect(keyLabelCalls(calls).length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('canvas trong document khác (cửa sổ nổi): DPR / matchMedia / ResizeObserver lấy từ cửa sổ đó', () => {
    setDpr(1);
    const mainMm = vi.fn();
    const MainRO = vi.fn();
    vi.stubGlobal('matchMedia', mainMm);
    vi.stubGlobal('ResizeObserver', MainRO);
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    try {
      const win = frame.contentWindow!;
      const observe = vi.fn();
      const disconnect = vi.fn();
      class HostRO {
        observe = observe;
        unobserve = vi.fn();
        disconnect = disconnect;
      }
      const hostMm = vi.fn(() => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() }));
      Object.defineProperty(win, 'devicePixelRatio', { value: 2, configurable: true });
      Object.defineProperty(win, 'matchMedia', { value: hostMm, configurable: true });
      Object.defineProperty(win, 'ResizeObserver', { value: HostRO, configurable: true });
      const { ctx } = fakeCtx();
      const canvas = win.document.createElement('canvas');
      Object.defineProperty(canvas, 'clientWidth', { value: 300, configurable: true });
      Object.defineProperty(canvas, 'clientHeight', { value: 200, configurable: true });
      Object.defineProperty(canvas, 'getContext', { value: () => ctx, configurable: true });
      const r = new TilesRenderer(canvas);
      expect(observe).toHaveBeenCalledWith(canvas, { box: 'device-pixel-content-box' });
      r.setTimeline(buildTimeline(40));
      r.render({ beat: 3 });
      expect(canvas.width).toBe(600); // DPR 2 của cửa sổ nổi, không phải DPR 1 của tab gốc
      expect(hostMm).toHaveBeenCalledWith('(resolution: 2dppx)');
      expect(mainMm).not.toHaveBeenCalled();
      expect(MainRO).not.toHaveBeenCalled();
      r.dispose();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      frame.remove();
      vi.unstubAllGlobals();
    }
  });
});

describe('options + helpers', () => {
  it('sanitizeRendererOptions kẹp giá trị và giữ base khi sai', () => {
    const o = sanitizeRendererOptions({
      lookahead: 99,
      tileScale: -1,
      hitLinePos: 2,
      theme: 'neon' as never,
      background: 'chroma',
    });
    expect(o.lookahead).toBe(12);
    expect(o.tileScale).toBe(0.5);
    expect(o.hitLinePos).toBe(0.95);
    expect(o.theme).toBe(DEFAULT_RENDERER_OPTIONS.theme);
    expect(o.background).toBe('chroma');
    expect(sanitizeRendererOptions(null)).toEqual(DEFAULT_RENDERER_OPTIONS);
  });

  it('splitRibbonWords: tách theo khoảng trắng, "+" dính từ trước', () => {
    expect(splitRibbonWords('GIỮ CHUỘT PHẢI')).toEqual(['GIỮ', 'CHUỘT', 'PHẢI']);
    expect(splitRibbonWords('GIỮ TRÁI + SCROLL')).toEqual(['GIỮ', 'TRÁI +', 'SCROLL']);
    expect(splitRibbonWords('  HOLD   SCROLL ')).toEqual(['HOLD', 'SCROLL']);
  });
});

// ---------------------------------------------------------------------------
// Kiểu điều khiển Mobile (SPEC 2026-10-14)
// ---------------------------------------------------------------------------

describe('TilesRenderer — kiểu điều khiển Mobile', () => {
  // Z [0,1) thường · N [1,2) Cúi Xuống · rest · M# [3,4) Cúi Xuống + Nửa Cung · , [4,5) Ngẩng Lên ·
  // X [5,6) thường. Kế hoạch (toggle): Cúi Xuống @1, Nửa Cung bật @3, Ngẩng Lên + Nửa Cung tắt @4,
  // Ngẩng Tự Nhiên @5.
  const mobileTl = (): Timeline =>
    mkTimeline([
      mkNote(0, 'Z', 0, 1),
      mkNote(1, 'N', 1, 2, -1),
      mkNote(2, 'M', 3, 4, -1, true),
      mkNote(3, ',', 4, 5, 1),
      mkNote(4, 'X', 5, 6),
    ]);
  const laneX = (L: Layout, key: NoteKey): number =>
    L.laneCrossStart[NOTE_KEYS.indexOf(key)] + L.laneCrossSize / 2;
  const fillTexts = (calls: Call[], text: string): Call[] =>
    calls.filter((c) => c.name === 'fillText' && c.args[0] === text);
  /** Chấm (arc) đúng cột của nhãn tại x. */
  const dotsAt = (calls: Call[], x: number): Call[] =>
    calls.filter((c) => c.name === 'arc' && Math.abs(Number(c.args[0]) - x) < 1e-6);

  function setup(opts: Partial<RendererOptions> = {}) {
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(980, 743, ctx), { scheme: 'mobile', ...opts });
    r.setTimeline(mobileTl());
    r.render({ beat: 0 });
    return { r, calls, L: r.layout! };
  }

  it('tile hiện số giản phổ có chấm (arc) theo quãng, không Z X C…, không mũi tên ↓/↑', () => {
    const { calls, L } = setup({ subLabel: 'none' });
    expect(keyLabelCalls(calls)).toHaveLength(0);
    // Chữ trên tile (4 vòng chế độ mờ tự vẽ sau hit line không có chữ / ký hiệu nào).
    const t = texts(calls);
    expect(t).toEqual(expect.arrayContaining(['1', '2', '6', '7']));
    expect(t).not.toContain('↓');
    expect(t).not.toContain('↑');
    expect(t).toContain('#'); // Nửa Cung vẫn có badge (không chỉ bằng màu)

    // N (Cúi Xuống) → 1 chấm DƯỚI số 6.
    const six = fillTexts(calls, '6')[0];
    const sixDots = dotsAt(calls, Number(six.args[1]));
    expect(sixDots).toHaveLength(1);
    expect(Number(sixDots[0].args[1])).toBeGreaterThan(Number(six.args[2]));
    // "," ở Ngẩng Lên → "1" với 2 chấm TRÊN, xếp dọc.
    const commaX = laneX(L, ',');
    const one = fillTexts(calls, '1').find((c) => Math.abs(Number(c.args[1]) - commaX) < 1e-6);
    expect(one).toBeDefined();
    const above = dotsAt(calls, commaX);
    expect(above).toHaveLength(2);
    for (const d of above) expect(Number(d.args[1])).toBeLessThan(Number(one!.args[2]));
    expect(Math.abs(Number(above[0].args[1]) - Number(above[1].args[1]))).toBeGreaterThan(2);
    // Z / X ở quãng thường: không chấm.
    expect(dotsAt(calls, laneX(L, 'Z'))).toHaveLength(0);
    expect(dotsAt(calls, laneX(L, 'X'))).toHaveLength(0);
  });

  it('nhãn phụ: solfège giữ nguyên; "số" không lặp lại số trên tile', () => {
    const sol = setup({ subLabel: 'solfege' });
    expect(texts(sol.calls)).toEqual(expect.arrayContaining(['Đồ', 'La', 'Si', 'Đố']));
    const num = setup({ subLabel: 'number' });
    expect(fillTexts(num.calls, '6')).toHaveLength(1);
    expect(texts(num.calls)).not.toContain('Rê');
  });

  it('không có gutter ribbon / nhãn "CHẠM: <tên chế độ>" (vòng R6): 8 làn lấy cả chỗ gutter', () => {
    const { calls, L } = setup();
    expect(L.gutter).toBeNull();
    const pc = computeLayout(980, 743, { ...DEFAULT_RENDERER_OPTIONS });
    expect(pc.gutter).not.toBeNull();
    expect(L.laneCrossSize).toBeGreaterThan(pc.laneCrossSize);
    const t = texts(calls);
    expect(t.some((s) => s.startsWith('CHẠM:'))).toBe(false);
    for (const word of ['Cúi', 'Xuống', 'Ngẩng', 'Lên', 'Nửa', 'Cung', 'THẢ', 'GIỮ']) {
      expect(t).not.toContain(word);
    }
  });

  /** Vòng đích mờ tự vẽ (arc đúng tâm nút chế độ ở `T.axis`, không kèm chữ "CHẠM"). */
  function targetArcs(calls: Call[], L: Layout): Call[] {
    const T = cueTargets(L);
    const vertical = L.orientation === 'vertical';
    const ringArcs = new Set(rings(calls, L).map((r) => r.index));
    return calls.filter(
      (c, i) =>
        c.name === 'arc' &&
        !ringArcs.has(i) &&
        Math.abs(Number(c.args[vertical ? 1 : 0]) - T.axis) < 1e-6 &&
        T.cross.some((x) => Math.abs(Number(c.args[vertical ? 0 : 1]) - x) < 1e-6),
    );
  }

  it('bố cục không có bàn nút: 4 vòng chế độ mờ (chỉ nét, không tô, không chữ) ngay sau hit line', () => {
    const { calls, L } = setup();
    const T = cueTargets(L);
    expect(T.targets).toBe(true);
    // Dọc: tâm dưới hit line nửa Ø (+ khe).
    expect(T.axis).toBeCloseTo(L.hitPos + T.size / 2 + CUE_TARGET_GAP, 6);
    const arcs = targetArcs(calls, L);
    expect(arcs).toHaveLength(4);
    for (const a of arcs) {
      const i = calls.indexOf(a);
      const after = calls.slice(i + 1, i + 5);
      expect(after.filter((c) => c.name === 'stroke')).toHaveLength(2);
      expect(after.some((c) => c.name === 'fill' || c.name === 'fillText')).toBe(false);
      // Mờ: nét màu chế độ ở độ đục ≤ 0.5.
      expect(Number(after.filter((c) => c.name === 'stroke')[1].globalAlpha)).toBeLessThanOrEqual(
        0.5,
      );
    }
    // Không còn ký hiệu ↓ ↑ • # trong vòng / vòng tô đặc theo chế độ đang bật.
    expect(texts(calls)).not.toContain('•');
  });

  it('lane ngang (overlay dải ngang): vòng chế độ mờ bên trái hit line, ở hàng nút chế độ', () => {
    const { calls, L } = setup({ orientation: 'horizontal' });
    const T = cueTargets(L);
    expect(T.axis).toBeCloseTo(L.hitPos - T.size / 2 - CUE_TARGET_GAP, 6);
    const arcs = targetArcs(calls, L);
    expect(arcs).toHaveLength(4);
    expect(arcs.map((c) => Number(c.args[1])).sort((x, y) => x - y)).toEqual(
      [...T.cross].sort((x, y) => x - y),
    );
  });

  it('bàn nút (pad): không tự vẽ vòng chế độ (MobilePad vẽ nút)', () => {
    const { calls, L } = setup({ lanePadding: 'pad' });
    const T = cueTargets(L);
    expect(T.targets).toBe(false);
    expect(targetArcs(calls, L)).toHaveLength(0);
  });

  /**
   * Vòng "CHẠM" đã vẽ: arc ở cột một nút chế độ + hai nét (quầng, màu — nét màu ≥ 2 px; vòng đích mờ chỉ 1.5 px)
   * và chữ `word` ('CHẠM' | 'TAP') nếu có — chữ mờ dần khi vòng tới gần nút, không có lúc đáp (D-390). Nút, tâm
   * trục thời gian, màu nét, lời gọi fillText của chữ (undefined = vòng không chữ).
   */
  function rings(calls: Call[], L: Layout, word = 'CHẠM') {
    const T = cueTargets(L);
    const vertical = L.orientation === 'vertical';
    const out: {
      button: MobileButton;
      axis: number;
      r: number;
      line: number;
      stroke: unknown;
      alpha: number;
      text: Call | undefined;
      index: number;
    }[] = [];
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
      const strokes = seg.filter((s) => s.name === 'stroke');
      if (strokes.length < 2 || Number(strokes[1].lineWidth) < 2) return;
      const text = seg.find((s) => s.name === 'fillText');
      if (text && text.args[0] !== word) return;
      out.push({
        button: MOBILE_BUTTONS[j],
        axis: vertical ? y : x,
        r,
        line: Number(strokes[1].lineWidth),
        stroke: strokes[1].strokeStyle,
        alpha: Number(strokes[1].globalAlpha),
        text,
        index: a,
      });
    });
    return out;
  }
  /** Beat của cue theo tâm vòng (đúng beat: tâm vòng = tâm nút `T.axis`; vòng đi 1.75 × tile). */
  const ringBeat = (L: Layout, cur: number, axis: number): number =>
    cur + (axis - cueTargets(L).axis) / (L.timeDir * L.pxPerBeat * CUE_RING_SPEED);

  it('mỗi lần chạm: một vòng "CHẠM" màu chế độ ở cột nút đó (kể cả về Ngẩng Tự Nhiên), không vạch ngang lane', () => {
    const { r, calls, L } = setup();
    // Không còn vạch đứt nét ngang lane / viên "CHẠM: <tên>".
    expect(calls.some((c) => c.name === 'setLineDash' && (c.args[0] as number[]).length > 0)).toBe(
      false,
    );
    expect(texts(calls).some((s) => /^CHẠM: /.test(s))).toBe(false);
    const at = (beat: number) => {
      calls.length = 0;
      r.render({ beat });
      return rings(calls, L).map((g) => ({
        button: g.button,
        beat: Math.round(ringBeat(L, beat, g.axis) * 1e6) / 1e6,
        stroke: g.stroke,
      }));
    };
    // Kế hoạch (toggle): Cúi Xuống @1, Nửa Cung bật @3, Ngẩng Lên + Nửa Cung tắt @4, Ngẩng Tự Nhiên @5.
    const p = CANVAS_THEMES.dark.cueRing;
    const got = [...at(0.9), ...at(2)];
    expect(got).toEqual(
      expect.arrayContaining([
        { button: 'left', beat: 1, stroke: p.left },
        { button: 'scroll', beat: 3, stroke: p.scroll },
        { button: 'right', beat: 4, stroke: p.right },
        { button: 'scroll', beat: 4, stroke: p.scroll },
        { button: 'natural', beat: 5, stroke: p.normal },
      ]),
    );
    // Chữ "CHẠM" (không tên nút) ở tâm vòng, màu chữ của theme trên viền chữ tối.
    calls.length = 0;
    r.render({ beat: 0.5 });
    const down = rings(calls, L).find((g) => g.button === 'left')!;
    expect(down.text?.fillStyle).toBe(CANVAS_THEMES.dark.cueText);
    expect(down.text?.globalAlpha).toBe(1);
    expect(Number(down.text?.args[1])).toBeCloseTo(cueTargets(L).cross[3], 6);
    expect(Number(down.text?.args[2])).toBeCloseTo(down.axis + 0.5, 6);
  });

  it('chữ "CHẠM" mờ dần khi vòng tới gần nút, không có lúc vòng đồng tâm / đứng trên nút (tên nút đọc được — D-390)', () => {
    const { r, calls, L } = setup();
    const T = cueTargets(L);
    const step = L.pxPerBeat * CUE_RING_SPEED;
    const downAt = (beat: number) => {
      calls.length = 0;
      r.render({ beat });
      return rings(calls, L).find((g) => g.button === 'left');
    };
    // Cue "Cúi Xuống" ở beat 1. Tâm vòng cách tâm nút ≥ CUE_TEXT_FADE_FAR × Ø → chữ đậm đủ.
    const far = downAt(1 - (CUE_TEXT_FADE_FAR * T.size) / step - 0.01);
    expect(far?.text?.globalAlpha).toBe(1);
    // Giữa hai ngưỡng → mờ một phần.
    const mid = downAt(1 - ((CUE_TEXT_FADE_FAR + CUE_TEXT_FADE_NEAR) / 2) * (T.size / step));
    expect(Number(mid?.text?.globalAlpha)).toBeGreaterThan(0.3);
    expect(Number(mid?.text?.globalAlpha)).toBeLessThan(0.7);
    // Gần hơn CUE_TEXT_FADE_NEAR × Ø, đúng beat, lúc đứng trên nút: còn vòng, không chữ.
    for (const beat of [1 - (0.4 * T.size) / step, 1, 1 + CUE_RING_HOLD_BEATS / 2]) {
      const ring = downAt(beat);
      expect(ring, `beat ${beat}`).toBeDefined();
      expect(ring?.text, `beat ${beat}`).toBeUndefined();
    }
  });

  it('vòng nhỏ (nút chế độ 22 px của màn dọc hẹp / trang mini): vẫn ghi "CHẠM" lúc còn xa (R7-1: mọi nơi có chữ)', () => {
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(360, 640, ctx), {
      scheme: 'mobile',
      lanePadding: 'pad',
    });
    r.setTimeline(mobileTl());
    r.render({ beat: 0 });
    const L = r.layout!;
    const T = cueTargets(L);
    expect(T.size).toBe(22);
    const far = rings(calls, L).filter(
      (g) => Math.abs(g.axis - T.axis) > CUE_TEXT_FADE_FAR * T.size + 1,
    );
    expect(far.length).toBeGreaterThan(0);
    for (const g of far) expect(g.text?.globalAlpha).toBe(1);
  });

  it('vòng rơi nhanh gấp 1.75 lần tile, đồng tâm với vòng đích đúng beat, đứng lại mờ dần rồi biến mất', () => {
    const { r, calls, L } = setup();
    const T = cueTargets(L);
    const downAt = (beat: number) => {
      calls.length = 0;
      r.render({ beat });
      return rings(calls, L).find((g) => g.button === 'left');
    };
    // 0.5 beat trước: cách tâm đích đúng 0.5 × 1.75 × pxPerBeat (tile: 0.5 × pxPerBeat).
    expect(downAt(0.5)?.axis).toBeCloseTo(T.axis - 0.5 * CUE_RING_SPEED * L.pxPerBeat, 6);
    // Đúng beat: đồng tâm với vòng đích, đủ đậm, mép ngoài nét = Ø vòng đích.
    const now = downAt(1);
    expect(now?.axis).toBeCloseTo(T.axis, 6);
    expect(now?.alpha).toBe(1);
    expect(now!.r + now!.line / 2).toBeCloseTo(T.size / 2, 6);
    // Đáp xong: đứng yên, mờ dần, rồi biến mất (không bị cắt / không rơi tiếp).
    const hold = downAt(1 + CUE_RING_HOLD_BEATS / 2);
    expect(hold?.axis).toBeCloseTo(T.axis, 6);
    expect(hold!.alpha).toBeLessThan(1);
    expect(calls.some((c) => c.name === 'clip')).toBe(false);
    expect(downAt(1 + CUE_RING_HOLD_BEATS + 0.01)).toBeUndefined();
  });

  it('vòng vẽ trên cùng: sau thân tile, nhãn tile và hit line', () => {
    const { calls, L } = setup({ subLabel: 'none' });
    const all = rings(calls, L);
    expect(all.length).toBeGreaterThan(0);
    const firstRing = Math.min(...all.map((g) => g.index));
    const digit = calls.map((c) => c.name === 'fillText' && /^[1-7]$/.test(String(c.args[0])));
    expect(digit.lastIndexOf(true)).toBeLessThan(firstRing);
    const bodies = calls.map((c) => c.name === 'roundRect');
    expect(bodies.lastIndexOf(true)).toBeLessThan(firstRing);
  });

  it('chữ "CHẠM" lọt trong lòng vòng; hai lần chạm cùng nút sát nhau → hai vòng riêng, cách nhau 1.75 × khoảng beat', () => {
    // Nửa Cung kiểu "chỉ 1 nốt": chạm trước mỗi nốt thăng — 3 nốt thăng cách 0.25 beat.
    const tl = mkTimeline([
      mkNote(0, 'Z', 0, 1),
      mkNote(1, 'X', 1, 1.25, 0, true),
      mkNote(2, 'C', 1.25, 1.5, 0, true),
      mkNote(3, 'V', 1.5, 2.5, 0, true),
    ]);
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(980, 743, ctx), {
      scheme: 'mobile',
      mobileSemitone: 'oneShot',
      lookahead: 8,
    });
    r.setTimeline(tl);
    r.render({ beat: 0.5 });
    const L = r.layout!;
    const T = cueTargets(L);
    const semis = rings(calls, L)
      .filter((g) => g.button === 'scroll')
      .sort((a, b) => b.axis - a.axis);
    expect(semis).toHaveLength(3);
    for (let i = 0; i + 1 < semis.length; i++) {
      expect(semis[i].axis - semis[i + 1].axis).toBeCloseTo(0.25 * CUE_RING_SPEED * L.pxPerBeat, 6);
    }
    // Khối chữ (fake: 0.6 em / ký tự, cao ~0.8 em) lọt trong lòng vòng (bán kính trong = r − nét / 2).
    const withText = semis.find((g) => g.text !== undefined);
    const px = Number(/(\d+)px/.exec(String(withText?.text?.font))?.[1]);
    expect(px).toBeGreaterThanOrEqual(7);
    const inner = semis[0].r - semis[0].line / 2;
    expect(Math.hypot((4 * px * 0.6) / 2, 0.4 * px)).toBeLessThanOrEqual(inner);
    expect(semis[0].r + semis[0].line / 2).toBeCloseTo(T.size / 2, 6);
  });

  it('lane ngang: vòng chạy phải → trái ở hàng của nút chế độ, đồng tâm vòng đích đúng beat', () => {
    const { ctx, calls } = fakeCtx();
    const r = new TilesRenderer(makeCanvas(1140, 440, ctx), {
      scheme: 'mobile',
      orientation: 'horizontal',
    });
    r.setTimeline(mobileTl());
    r.render({ beat: 1 });
    const L = r.layout!;
    const T = cueTargets(L);
    expect(T.cross[0]).toBeCloseTo(L.laneCrossStart[0] + 3 * L.laneCrossSize, 9);
    const down = rings(calls, L).find((g) => g.button === 'left');
    expect(down?.axis).toBeCloseTo(T.axis, 6);
    const up = rings(calls, L).find((g) => g.button === 'right');
    expect(up?.axis).toBeCloseTo(T.axis + 3 * CUE_RING_SPEED * L.pxPerBeat, 6);
  });

  it('cue vào lại (phát lại / nhảy / vòng loop kế): thay cue của kế hoạch tại nốt đó', () => {
    const { r, calls, L } = setup();
    const count = (button: MobileButton): number =>
      rings(calls, L).filter((g) => g.button === button).length;
    // Lượt mới từ 0 khi người chơi vẫn ở Ngẩng Lên → vòng "Ngẩng Tự Nhiên" tại nốt 0 (beat 0).
    calls.length = 0;
    r.render({ beat: -0.5 });
    expect(count('natural')).toBe(0);
    calls.length = 0;
    r.render({
      beat: -0.5,
      mobileEntry: {
        beat: 0,
        noteIndex: 0,
        cues: [{ beat: 0, noteIndex: 0, kind: 'octave', mode: 0 }],
        latch: { mode: 1, semitoneOn: false },
      },
    });
    expect(count('natural')).toBe(1);
    // Nhảy tới nốt "," (beat 4) khi đã ở Ngẩng Lên, Nửa Cung tắt → bỏ "Ngẩng Lên" + "Nửa Cung" @4.
    calls.length = 0;
    r.render({ beat: 2.5 });
    expect(count('right')).toBe(1);
    expect(count('scroll')).toBe(2);
    calls.length = 0;
    const entry = {
      beat: 4,
      noteIndex: 3,
      cues: [],
      latch: { mode: 1 as const, semitoneOn: false },
    };
    r.render({ beat: 2.5, mobileEntry: entry });
    expect(count('right')).toBe(0);
    expect(count('scroll')).toBe(1); // chỉ còn lần bật @3
    // Vòng loop kế: loop [0, 4) → các bản vẽ lại dùng mobileLoopEntry, vòng hiện tại thì không.
    calls.length = 0;
    r.render({ beat: 3, loop: { start: 0, end: 4 } });
    expect(count('natural')).toBe(0);
    calls.length = 0;
    r.render({
      beat: 3,
      loop: { start: 0, end: 4 },
      mobileLoopEntry: {
        beat: 0,
        noteIndex: 0,
        cues: [{ beat: 0, noteIndex: 0, kind: 'octave', mode: 0 }],
        latch: { mode: -1, semitoneOn: true },
      },
    });
    const loopNatural = rings(calls, L).filter((g) => g.button === 'natural');
    expect(loopNatural).toHaveLength(1);
    // Vòng kế: beat 0 của vòng sau = loop end (4) trên trục hiện tại.
    expect(ringBeat(L, 3, loopNatural[0].axis)).toBeCloseTo(4, 6);
    // Index nốt ngoài bài → bỏ qua (không ném lỗi).
    calls.length = 0;
    r.render({ beat: 2.5, mobileEntry: { ...entry, noteIndex: 99 } });
    expect(count('right')).toBe(1);
  });

  it('tên nút (modLabels) không vẽ trên canvas — vòng chỉ ghi "CHẠM" (tên ở bàn nút / banner)', () => {
    const { calls } = setup({
      modLabels: { left: 'Nút A', right: 'Nút B', natural: 'Giữa', scroll: 'Thăng' },
    });
    const t = texts(calls);
    expect(t).toContain('CHẠM');
    for (const word of ['Nút', 'A', 'B', 'Giữa', 'Thăng', 'CHẠM:']) expect(t).not.toContain(word);
  });

  it('EN: vòng "TAP" (không "TAP: …"); đổi về PC: nhãn Z X C…, mũi tên, không vòng chạm', () => {
    const { r, calls, L } = setup({ language: 'en' });
    const t = texts(calls);
    expect(t).toContain('TAP');
    expect(t.some((s) => s.startsWith('TAP:'))).toBe(false);
    expect(t).not.toContain('CHẠM');
    expect(rings(calls, L, 'TAP').length).toBeGreaterThan(0);
    calls.length = 0;
    r.setOptions({ scheme: 'pc', language: 'vi' });
    r.render({ beat: 0 });
    const pc = texts(calls);
    expect(pc).toEqual(expect.arrayContaining(['Z', 'N', ',', '↓']));
    expect(pc.some((s) => s.startsWith('CHẠM'))).toBe(false);
    expect(rings(calls, L)).toHaveLength(0);
    expect(targetArcs(calls, L)).toHaveLength(0);
  });

  it('ô nhịp đếm vào: vòng mờ như tile', () => {
    const { r, calls, L } = setup();
    calls.length = 0;
    r.render({ beat: 1, countIn: { start: -2, end: 2 } });
    const ghost = rings(calls, L).find((g) => g.button === 'left');
    expect(ghost?.alpha).toBeLessThan(0.3);
  });

  it('nền chroma: nét / chữ vòng màu đặc (alpha 1), không bán trong suốt', () => {
    const { r, calls, L } = setup({ background: 'chroma' });
    calls.length = 0;
    r.render({ beat: 1 + CUE_RING_HOLD_BEATS / 2 });
    const down = rings(calls, L).find((g) => g.button === 'left');
    expect(down).toBeDefined();
    expect(down!.alpha).toBe(1);
    expect(String(down!.stroke)).toMatch(/^rgb\(/);
    // Đứng trên nút: không chữ (chữ mờ hẳn thì không vẽ — trên chroma "alpha ~0" = tô màu nền lên nút).
    expect(down!.text).toBeUndefined();
    calls.length = 0;
    r.render({ beat: 0.5 });
    const falling = rings(calls, L).find((g) => g.button === 'left');
    expect(falling?.text?.globalAlpha).toBe(1);
    expect(String(falling?.text?.fillStyle)).toMatch(/^rgb\(/);
  });

  it('frame ổn định ở mobile: không measureText trong hot loop; đổi ngôn ngữ thì đo lại', () => {
    const { r, calls } = setup();
    calls.length = 0;
    r.render({ beat: 2.5 });
    expect(calls.some((c) => c.name === 'measureText')).toBe(false);
    r.setOptions({ language: 'en' });
    r.render({ beat: 2.5 });
    expect(calls.some((c) => c.name === 'measureText')).toBe(true);
  });

  it('sanitize: scheme / mobileSemitone / modLabels; cùng nội dung giữ nguyên object', () => {
    const labels = { left: 'a', right: 'b', natural: 'c', scroll: 'd' };
    const o = sanitizeRendererOptions({
      scheme: 'tablet' as never,
      mobileSemitone: 'oneShot',
      modLabels: labels,
    });
    expect(o.scheme).toBe('pc');
    expect(o.mobileSemitone).toBe('oneShot');
    expect(o.modLabels).toEqual(labels);
    const same = sanitizeRendererOptions({ modLabels: { ...labels } }, o);
    expect(same.modLabels).toBe(o.modLabels);
    expect(sanitizeRendererOptions({ modLabels: { left: 1 } as never }, o).modLabels).toBe(
      o.modLabels,
    );
    expect(sanitizeRendererOptions({ modLabels: null }, o).modLabels).toBeNull();
  });
});
