import { describe, expect, it } from 'vitest';
import { drawRecordRoll } from './RecordRoll';
import type { RollColors, RollNote } from './RecordRoll';

interface Call {
  name: string;
  args: unknown[];
}

/** Context 2D giả: ghi lại mọi lời gọi hàm (thuộc tính gán thì bỏ qua). */
function fakeCtx(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      return (...args: unknown[]) => {
        calls.push({ name: prop, args });
      };
    },
    set(t, prop: string, value: unknown) {
      t[prop] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const COLORS: RollColors = {
  bg: '#000',
  laneAlt: '#111',
  beatLine: '#222',
  barLine: '#333',
  gutterText: '#999',
  noteEdge: '#000',
  playheadCore: '#fff',
  playheadGlow: '#0f0',
  font: 'sans-serif',
};

// N Cúi Xuống (6 chấm dưới), V# thường, "," Ngẩng Lên (1 hai chấm trên).
const NOTES: RollNote[] = [
  { key: 'N', octave: -1, sharp: false, startBeat: 0, beats: 1 },
  { key: 'V', octave: 0, sharp: true, startBeat: 1, beats: 1 },
  { key: ',', octave: 1, sharp: false, startBeat: 2, beats: 1 },
];

function draw(scheme?: 'pc' | 'mobile') {
  const { ctx, calls } = fakeCtx();
  drawRecordRoll(
    ctx,
    { width: 600, height: 168, dpr: 1 },
    NOTES,
    { from: 0, to: 4, beatsPerBar: 4, playhead: null, scheme },
    COLORS,
  );
  const texts = calls.filter((c) => c.name === 'fillText').map((c) => String(c.args[0]));
  const arcs = calls.filter((c) => c.name === 'arc');
  return { texts, arcs };
}

describe('drawRecordRoll', () => {
  it('PC: cột tên làn và nhãn ô là phím Z X C … ,', () => {
    const { texts, arcs } = draw();
    expect(texts).toEqual(expect.arrayContaining(['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', 'V#']));
    expect(arcs).toHaveLength(0);
  });

  it('Mobile: số giản phổ có chấm quãng vẽ riêng, không có chữ Z X C…', () => {
    const { texts, arcs } = draw('mobile');
    expect(texts).toEqual(expect.arrayContaining(['1', '2', '3', '4', '5', '6', '7', '4#']));
    for (const k of ['Z', 'X', 'C', 'N', 'M', ',', 'V#']) expect(texts).not.toContain(k);
    // Không dùng dấu chấm kết hợp (U+0307 / U+0323) trong chữ.
    expect(texts.some((t) => /[̣̇]/.test(t))).toBe(false);
    // Chấm: làn "," (1 chấm) + nốt N Cúi Xuống (1) + nốt "," Ngẩng Lên (2).
    expect(arcs).toHaveLength(4);
  });
});
