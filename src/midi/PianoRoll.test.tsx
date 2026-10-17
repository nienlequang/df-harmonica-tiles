import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawPianoRoll, PianoRoll, pianoRollColors, pianoRollView } from './PianoRoll';

/** Context 2D giả: ghi lại các fillRect cùng màu đang dùng. */
function fakeCtx() {
  const rects: Array<{ x: number; y: number; w: number; h: number; fill: string }> = [];
  const ctx = {
    fillStyle: '',
    setTransform: vi.fn(),
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, fill: String(ctx.fillStyle) });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects };
}

const COLORS = { bg: 'bg', grid: 'grid', note: 'note', playhead: 'ph' };

describe('pianoRollView', () => {
  it('không có nốt → khung mặc định C4–C5, 0–4 beat', () => {
    expect(pianoRollView([])).toEqual({ from: 0, to: 4, minMidi: 60, maxMidi: 72 });
  });

  it('nới tầm cho đủ 12 bán cung, khung beat theo nốt', () => {
    const v = pianoRollView([
      { startBeat: 1, beats: 1, midi: 64 },
      { startBeat: 2, beats: 2, midi: 66 },
    ]);
    expect(v.maxMidi - v.minMidi).toBe(12);
    expect(v.minMidi).toBeLessThanOrEqual(64);
    expect(v.maxMidi).toBeGreaterThanOrEqual(66);
    expect(v.from).toBe(0);
    expect(v.to).toBe(4);
  });

  it('tầm rộng giữ nguyên; from/to truyền vào thắng; to <= from → from + 1', () => {
    const notes = [
      { startBeat: -1, beats: 1, midi: 40 },
      { startBeat: 3, beats: 1, midi: 90 },
    ];
    expect(pianoRollView(notes)).toEqual({ from: -1, to: 4, minMidi: 40, maxMidi: 90 });
    expect(pianoRollView(notes, 2, 10)).toMatchObject({ from: 2, to: 10 });
    expect(pianoRollView(notes, 5, 5)).toMatchObject({ from: 5, to: 6 });
  });

  it('bỏ nốt hỏng (NaN, beats <= 0)', () => {
    const v = pianoRollView([
      { startBeat: NaN, beats: 1, midi: 10 },
      { startBeat: 0, beats: 0, midi: 120 },
      { startBeat: 0, beats: 1, midi: 60 },
    ]);
    expect(v.minMidi).toBeGreaterThan(10);
    expect(v.maxMidi).toBeLessThan(120);
  });
});

describe('drawPianoRoll', () => {
  it('vẽ nền, vạch ô nhịp, mỗi nốt trong khung một ô, playhead', () => {
    const { ctx, rects } = fakeCtx();
    const notes = [
      { startBeat: 0, beats: 1, midi: 60 },
      { startBeat: 1, beats: 1, midi: 72 },
      { startBeat: 20, beats: 1, midi: 65 }, // ngoài khung
    ];
    const view = { from: 0, to: 8, minMidi: 60, maxMidi: 72 };
    drawPianoRoll(ctx, { width: 160, height: 26, dpr: 2 }, notes, view, COLORS, {
      beatsPerBar: 4,
      playhead: 2,
    });
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(rects[0]).toMatchObject({ x: 0, y: 0, w: 160, h: 26, fill: 'bg' });
    expect(rects.filter((r) => r.fill === 'grid')).toHaveLength(2); // beat 0, 4
    const drawn = rects.filter((r) => r.fill === 'note');
    expect(drawn).toHaveLength(2);
    // nốt cao hơn nằm phía trên
    expect(drawn[1].y).toBeLessThan(drawn[0].y);
    expect(drawn[0].x).toBe(0);
    expect(drawn[1].x).toBe(20);
    const ph = rects.filter((r) => r.fill === 'ph');
    expect(ph).toHaveLength(1);
    expect(ph[0].x).toBe(39);
  });

  it('playhead ngoài khung / null thì không vẽ; vạch quá dày thì bỏ', () => {
    const { ctx, rects } = fakeCtx();
    drawPianoRoll(
      ctx,
      { width: 40, height: 20, dpr: 1 },
      [],
      { from: 0, to: 4000, minMidi: 60, maxMidi: 72 },
      COLORS,
      { beatsPerBar: 1, playhead: 5000 },
    );
    expect(rects.filter((r) => r.fill === 'grid')).toHaveLength(0);
    expect(rects.filter((r) => r.fill === 'ph')).toHaveLength(0);
  });
});

describe('pianoRollColors', () => {
  it('nốt màu chữ trung tính, playhead accent — không tô nốt bằng accent, không dùng --warn (D-238)', () => {
    const el = document.createElement('div');
    el.style.setProperty('--surface-2', '#111111');
    el.style.setProperty('--border', '#222222');
    el.style.setProperty('--text', '#eeeeee');
    el.style.setProperty('--accent', '#0ff796');
    el.style.setProperty('--warning', '#f2c230');
    el.style.setProperty('--warn', '#f2c230');
    document.body.appendChild(el);
    const c = pianoRollColors(el);
    el.remove();
    expect(c).toEqual({ bg: '#111111', grid: '#222222', note: '#eeeeee', playhead: '#0ff796' });
    expect(c.note).not.toBe('#0ff796');
  });

  it('không có token → màu dự phòng của theme tối, nốt vẫn không phải accent', () => {
    const c = pianoRollColors(document.createElement('div'));
    expect(c.note).toBe('#e9edf1');
    expect(c.playhead).toBe('#0ff796');
  });
});

describe('<PianoRoll>', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('canvas role="img" có nhãn; getContext null (jsdom) không throw', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    render(<PianoRoll notes={[{ startBeat: 0, beats: 1, midi: 60 }]} label="Cuộn thử" />);
    const img = screen.getByRole('img', { name: 'Cuộn thử' });
    expect(img.tagName).toBe('CANVAS');
    expect((img as HTMLCanvasElement).style.height).toBe('48px');
  });

  it('có bề rộng → vẽ theo DPR, vẽ lại khi đổi nốt', () => {
    const { ctx, rects } = fakeCtx();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ctx as unknown as CanvasRenderingContext2D & ImageBitmapRenderingContext,
    );
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100);
    const { rerender, container } = render(
      <PianoRoll notes={[{ startBeat: 0, beats: 1, midi: 60 }]} label="r" height={30} />,
    );
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.width).toBe(100 * Math.max(1, window.devicePixelRatio || 1));
    expect(rects.filter((r) => r.fill.length > 0 && r.w > 0).length).toBeGreaterThan(1);
    const before = rects.length;
    rerender(
      <PianoRoll
        notes={[
          { startBeat: 0, beats: 1, midi: 60 },
          { startBeat: 1, beats: 1, midi: 62 },
        ]}
        label="r"
        height={30}
      />,
    );
    expect(rects.length).toBeGreaterThan(before);
  });

  it('getContext throw cũng được chịu', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('no canvas');
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100);
    expect(() => render(<PianoRoll notes={[]} label="x" />)).not.toThrow();
  });
});
