import { describe, expect, it } from 'vitest';
import { DEFAULT_EXTRACT, defaultLegatoBeats, extractMelody } from './extract';
import type { ExtractInputNote } from './extract';
import type { MonoNote } from './types';

/** Viết tắt: [midi, startBeat, beats]. */
type N = [number, number, number];
const notes = (...list: N[]): ExtractInputNote[] =>
  list.map(([midi, startBeat, beats]) => ({ midi, startBeat, beats }));
/** Kết quả gọn để so: [midi, startBeat, beats]. */
const compact = (out: MonoNote[]): N[] => out.map((n) => [n.midi, n.startBeat, n.beats]);

describe('extractMelody — defaults', () => {
  it('exposes the spec defaults', () => {
    expect(DEFAULT_EXTRACT).toEqual({ overlap: 'highest', grid: 0.25, minBeats: 1 / 32 });
    expect(defaultLegatoBeats(0.25)).toBe(0.125);
    expect(defaultLegatoBeats(0)).toBe(0.125);
    expect(defaultLegatoBeats(1 / 3)).toBeCloseTo(1 / 6);
  });

  it('passes a simple monophonic line through, sorted', () => {
    const out = extractMelody(notes([64, 2, 2], [60, 0, 1], [62, 1, 1]));
    expect(compact(out)).toEqual([
      [60, 0, 1],
      [62, 1, 1],
      [64, 2, 2],
    ]);
  });

  it('keeps gaps as rests; output notes carry only start / length / pitch', () => {
    const out = extractMelody(notes([60, 0, 0.5], [62, 2, 1]));
    expect(out).toEqual([
      { startBeat: 0, beats: 0.5, midi: 60 },
      { startBeat: 2, beats: 1, midi: 62 },
    ]);
    expect(Object.keys(out[0]).sort()).toEqual(['beats', 'midi', 'startBeat']);
  });

  it('ignores invalid notes', () => {
    const out = extractMelody([
      { midi: 60, startBeat: 0, beats: 0 },
      { midi: 61, startBeat: 0, beats: -1 },
      { midi: 62, startBeat: Number.NaN, beats: 1 },
      { midi: Number.NaN, startBeat: 0, beats: 1 },
      { midi: 64, startBeat: 1, beats: Number.POSITIVE_INFINITY },
      { midi: 65, startBeat: 2, beats: 1 },
    ]);
    expect(compact(out)).toEqual([[65, 2, 1]]);
    expect(extractMelody([])).toEqual([]);
  });
});

describe('extractMelody — overlap policy', () => {
  const chord = notes([60, 0, 2], [64, 0, 1], [67, 0, 1], [72, 2, 1]);

  it('chord: highest keeps the top note', () => {
    expect(compact(extractMelody(chord, { overlap: 'highest' }))).toEqual([
      [67, 0, 1],
      [72, 2, 1],
    ]);
  });

  it('chord: lowest keeps the bottom note', () => {
    expect(compact(extractMelody(chord, { overlap: 'lowest' }))).toEqual([
      [60, 0, 2],
      [72, 2, 1],
    ]);
  });

  it('chord: longest keeps the longest note (tie → higher)', () => {
    expect(compact(extractMelody(chord, { overlap: 'longest' }))).toEqual([
      [60, 0, 2],
      [72, 2, 1],
    ]);
    const tie = notes([60, 0, 1], [67, 0, 1], [64, 0, 1]);
    expect(compact(extractMelody(tie, { overlap: 'longest' }))).toEqual([[67, 0, 1]]);
  });

  it('chord with equal top pitch prefers the longer copy', () => {
    const out = extractMelody(notes([67, 0, 1], [67, 0, 2], [60, 0, 3]), { overlap: 'highest' });
    expect(compact(out)).toEqual([[67, 0, 2]]);
  });

  it('groups onsets within 1/64 beat as one chord', () => {
    const out = extractMelody(notes([60, 0, 1], [67, 0.01, 0.99]), { overlap: 'highest', grid: 0 });
    expect(compact(out)).toEqual([[67, 0.01, 0.99]]);
    // lệch hơn 1/64 → onset riêng, nốt sau (cao hơn) cắt nốt trước
    const apart = extractMelody(notes([60, 0, 1], [67, 0.05, 0.95]), {
      overlap: 'highest',
      grid: 0,
    });
    expect(compact(apart)).toEqual([
      [60, 0, 0.05],
      [67, 0.05, 0.95],
    ]);
  });

  it('drops accompaniment under a sustained melody note (highest)', () => {
    const song = notes(
      [72, 0, 4], // melody giữ 4 beat
      [60, 1, 1],
      [64, 2, 1],
      [67, 3, 1],
      [74, 4, 1],
    );
    expect(compact(extractMelody(song, { overlap: 'highest' }))).toEqual([
      [72, 0, 4],
      [74, 4, 1],
    ]);
  });

  it('lowest takes lower onsets under a sustained note and cuts it', () => {
    const song = notes([72, 0, 4], [60, 1, 1], [64, 2, 1], [67, 3, 1], [74, 4, 1]);
    expect(compact(extractMelody(song, { overlap: 'lowest' }))).toEqual([
      [72, 0, 1],
      [60, 1, 1],
      [64, 2, 1],
      [67, 3, 1],
      [74, 4, 1],
    ]);
    // nốt cao hơn chồng lên nốt đang giữ bị bỏ
    expect(compact(extractMelody(notes([60, 0, 4], [72, 1, 1]), { overlap: 'lowest' }))).toEqual([
      [60, 0, 4],
    ]);
  });

  it('highest: a higher onset under a sounding note cuts it; equal pitch is dropped', () => {
    expect(compact(extractMelody(notes([60, 0, 4], [67, 2, 1]), { overlap: 'highest' }))).toEqual([
      [60, 0, 2],
      [67, 2, 1],
    ]);
    expect(compact(extractMelody(notes([60, 0, 4], [60, 2, 1]), { overlap: 'highest' }))).toEqual([
      [60, 0, 4],
    ]);
  });

  it('longest keeps whichever overlapping note is longer (original length)', () => {
    // nốt sau ngắn hơn → bỏ, nốt dài vang trọn
    expect(compact(extractMelody(notes([72, 0, 4], [60, 1, 1]), { overlap: 'longest' }))).toEqual([
      [72, 0, 4],
    ]);
    // nốt sau dài hơn → nốt trước bị cắt tại onset mới
    expect(compact(extractMelody(notes([72, 0, 1.5], [60, 1, 2]), { overlap: 'longest' }))).toEqual(
      [
        [72, 0, 1],
        [60, 1, 2],
      ],
    );
    // bằng nhau → nốt cao hơn
    expect(compact(extractMelody(notes([60, 0, 2], [64, 1, 2]), { overlap: 'longest' }))).toEqual([
      [60, 0, 1],
      [64, 1, 2],
    ]);
    expect(compact(extractMelody(notes([64, 0, 2], [60, 1, 2]), { overlap: 'longest' }))).toEqual([
      [64, 0, 2],
    ]);
  });

  it('longest: a sustained melody note survives a moving accompaniment under it', () => {
    // C5 4 beat + 8 nốt móc đơn đệm trong cùng track (trước đây: C5 bị cắt còn 0,5 beat)
    const accomp = [52, 55, 59, 55, 52, 55, 59, 55].map((midi, k): N => [midi, k * 0.5, 0.5]);
    const input = notes([72, 0, 4], ...accomp, [74, 4, 2]);
    expect(compact(extractMelody(input, { overlap: 'longest' }))).toEqual([
      [72, 0, 4],
      [74, 4, 2],
    ]);
  });

  it('a dropped lower note does not resurface after the melody note ends', () => {
    // 60 bắt đầu khi 72 còn vang, kéo dài qua lúc 72 hết → vẫn bỏ (không lấp chỗ trống)
    const out = extractMelody(notes([72, 0, 1], [60, 0.5, 3], [74, 2, 1]), { overlap: 'highest' });
    expect(compact(out)).toEqual([
      [72, 0, 1],
      [74, 2, 1],
    ]);
  });

  it('a note starting under a still-sounding higher note is dropped (highest)', () => {
    const out = extractMelody(notes([72, 0, 2], [60, 1, 1]), { overlap: 'highest' });
    expect(compact(out)).toEqual([[72, 0, 2]]);
    // longest: nốt ngắn bắt đầu trong lúc nốt dài còn vang bị bỏ
    const longest = extractMelody(notes([60, 0, 4], [72, 1, 1]), { overlap: 'longest' });
    expect(compact(longest)).toEqual([[60, 0, 4]]);
  });
});

describe('extractMelody — truncation and legato', () => {
  it('cuts each note at the next chosen onset', () => {
    const out = extractMelody(notes([60, 0, 3], [62, 1, 1], [64, 2, 2]), { overlap: 'highest' });
    expect(compact(out)).toEqual([
      [60, 0, 1],
      [62, 1, 1],
      [64, 2, 2],
    ]);
  });

  it('a short legato overlap is the next melody note, even when descending', () => {
    const legato = notes([64, 0, 1.1], [62, 1, 1.1], [60, 2, 1]);
    expect(compact(extractMelody(legato, { overlap: 'highest' }))).toEqual([
      [64, 0, 1],
      [62, 1, 1],
      [60, 2, 1],
    ]);
    // grid tắt vẫn có dung sai tối thiểu 1/8 beat
    expect(compact(extractMelody(legato, { overlap: 'highest', grid: 0 }))).toEqual([
      [64, 0, 1],
      [62, 1, 1],
      [60, 2, 1],
    ]);
  });

  it('legatoBeats can be overridden', () => {
    const legato = notes([64, 0, 1.1], [62, 1, 1]);
    expect(
      compact(extractMelody(legato, { overlap: 'highest', grid: 0, legatoBeats: 0.05 })),
    ).toEqual([[64, 0, 1.1]]);
  });
});

describe('extractMelody — tie merge', () => {
  it('default (never): repeated same-pitch notes stay separate (C C G G)', () => {
    const twinkle = notes([60, 0, 1], [60, 1, 1], [67, 2, 1], [67, 3, 1]);
    expect(extractMelody(twinkle)).toHaveLength(4);
    expect(extractMelody(twinkle, { mergeTies: 'never' })).toHaveLength(4);
  });

  it('always: merges consecutive same-pitch notes into one', () => {
    const twinkle = notes([60, 0, 1], [60, 1, 1], [67, 2, 1], [67, 3, 1]);
    expect(compact(extractMelody(twinkle, { mergeTies: 'always' }))).toEqual([
      [60, 0, 2],
      [67, 2, 2],
    ]);
  });

  it('always: merges a tie created by cutting an overlapping same-pitch note', () => {
    const out = extractMelody(notes([60, 0, 1], [60, 0.5, 1.5]), {
      overlap: 'longest',
      mergeTies: 'always',
    });
    expect(compact(out)).toEqual([[60, 0, 2]]);
  });

  it('always: does not merge across a gap or a different pitch', () => {
    const out = extractMelody(notes([60, 0, 0.5], [60, 1, 1], [62, 2, 1]), {
      mergeTies: 'always',
    });
    expect(compact(out)).toEqual([
      [60, 0, 0.5],
      [60, 1, 1],
      [62, 2, 1],
    ]);
  });
});

describe('extractMelody — minimum length', () => {
  it('drops notes shorter than minBeats (default 1/32)', () => {
    const out = extractMelody(notes([60, 0, 0.02], [62, 1, 1 / 32], [64, 2, 1]), { grid: 0 });
    expect(compact(out)).toEqual([
      [62, 1, 1 / 32],
      [64, 2, 1],
    ]);
  });

  it('drops a note left too short after being cut', () => {
    const out = extractMelody(notes([60, 0, 2], [67, 0.02, 1]), { overlap: 'highest', grid: 0 });
    expect(compact(out)).toEqual([[67, 0.02, 1]]);
  });

  it('respects a custom minBeats', () => {
    const out = extractMelody(notes([60, 0, 0.2], [62, 1, 1]), { grid: 0, minBeats: 0.25 });
    expect(compact(out)).toEqual([[62, 1, 1]]);
  });

  it('drops a note left too short after being cut by a higher note', () => {
    const cut = extractMelody(notes([60, 0, 2], [67, 0.02, 1]), { overlap: 'highest', grid: 0 });
    expect(compact(cut)).toEqual([[67, 0.02, 1]]);
  });
});

describe('extractMelody — quantize', () => {
  it('snaps start and end to 1/4 beat', () => {
    const jitter = notes([60, 0.04, 0.9], [62, 0.98, 0.55], [64, 1.6, 0.35], [65, 2.1, 1.85]);
    expect(compact(extractMelody(jitter, { grid: 0.25 }))).toEqual([
      [60, 0, 1],
      [62, 1, 0.5],
      [64, 1.5, 0.5],
      [65, 2, 2],
    ]);
  });

  it('snaps to 1/8 beat', () => {
    const swing = notes([60, 0.01, 0.37], [62, 0.38, 0.12], [64, 0.49, 0.6]);
    expect(compact(extractMelody(swing, { grid: 0.125 }))).toEqual([
      [60, 0, 0.375],
      [62, 0.375, 0.125],
      [64, 0.5, 0.625],
    ]);
  });

  it('snaps triplets to a 1/3 grid', () => {
    // từ tick 480 PPQ: 0, 160, 320, 480 với dur 150 tick
    const trip = notes([60, 0, 150 / 480], [62, 160 / 480, 150 / 480], [64, 320 / 480, 150 / 480]);
    const out = extractMelody(trip, { grid: 1 / 3 });
    expect(out.map((n) => n.midi)).toEqual([60, 62, 64]);
    out.forEach((n, i) => {
      expect(n.startBeat).toBeCloseTo(i / 3, 9);
      expect(n.beats).toBeCloseTo(1 / 3, 9);
    });
    // grid 1/4 làm méo chùm ba nhưng không mất nốt
    expect(extractMelody(trip, { grid: 0.25 })).toHaveLength(3);
  });

  it('absorbs gaps shorter than one grid cell; gaps >= grid become rests', () => {
    // khoảng trống 0.2 < 0.25 → nốt trước kéo tới nốt kế (không sinh rest 0.25 giả)
    expect(compact(extractMelody(notes([60, 0, 0.8], [62, 1, 1]), { grid: 0.25 }))).toEqual([
      [60, 0, 1],
      [62, 1, 1],
    ]);
    // khoảng trống 0.3 >= 0.25 → rest
    expect(compact(extractMelody(notes([60, 0, 0.7], [62, 1, 1]), { grid: 0.25 }))).toEqual([
      [60, 0, 0.75],
      [62, 1, 1],
    ]);
    // staccato thật (nửa độ dài) vẫn giữ rest
    expect(compact(extractMelody(notes([60, 0, 0.5], [62, 1, 1]), { grid: 0.25 }))).toEqual([
      [60, 0, 0.5],
      [62, 1, 1],
    ]);
  });

  it('grid 0 keeps raw timing', () => {
    const raw = notes([60, 0.04, 0.9], [62, 0.98, 0.55]);
    expect(compact(extractMelody(raw, { grid: 0 }))).toEqual([
      [60, 0.04, 0.9],
      [62, 0.98, 0.55],
    ]);
  });

  it('extends a collapsed short note to one grid cell when the cell is free', () => {
    // staccato ngắn: 0.95..1.05 → làm tròn thành 1..1 → kéo dài thành 1..1.25
    const out = extractMelody(notes([60, 0.95, 0.1], [62, 2, 1]), { grid: 0.25 });
    expect(compact(out)).toEqual([
      [60, 1, 0.25],
      [62, 2, 1],
    ]);
  });

  it('drops a collapsed note whose cell is taken by the next note (later note wins)', () => {
    // nốt hoa mỹ ngay trước nốt chính
    const out = extractMelody(notes([62, 0.9, 0.08], [60, 0.98, 1.02]), { grid: 0.25 });
    expect(compact(out)).toEqual([[60, 1, 1]]);
    // 1/32 dày đặc trên grid 1/4 → còn một nốt mỗi ô
    const fast = notes([60, 0, 0.125], [62, 0.125, 0.125], [64, 0.25, 0.125], [65, 0.375, 0.125]);
    expect(compact(extractMelody(fast, { grid: 0.25 }))).toEqual([
      [60, 0, 0.25],
      [64, 0.25, 0.25],
      [65, 0.5, 0.25],
    ]);
  });

  it('a grace note collapsed by quantize loses to the main note', () => {
    const out = extractMelody(notes([62, 0, 1 / 16], [64, 1 / 16, 15 / 16], [65, 1, 1]));
    expect(compact(out)).toEqual([
      [64, 0, 1],
      [65, 1, 1],
    ]);
  });

  it('output is always monophonic, sorted, on grid, and >= one cell (fuzz)', () => {
    let seed = 12345;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (const grid of [0.25, 0.125, 1 / 3]) {
      for (const overlap of ['highest', 'lowest', 'longest'] as const) {
        for (let round = 0; round < 20; round++) {
          const input: ExtractInputNote[] = [];
          for (let k = 0; k < 40; k++) {
            input.push({
              midi: 48 + Math.floor(rand() * 36),
              startBeat: Math.floor(rand() * 64) / 8 + (rand() - 0.5) * 0.1,
              beats: 0.01 + rand() * 2,
            });
          }
          const out = extractMelody(input, { grid, overlap });
          for (let k = 0; k < out.length; k++) {
            const n = out[k];
            expect(n.beats).toBeGreaterThanOrEqual(grid - 1e-9);
            expect(Math.abs(n.startBeat / grid - Math.round(n.startBeat / grid))).toBeLessThan(
              1e-6,
            );
            expect(Math.abs(n.beats / grid - Math.round(n.beats / grid))).toBeLessThan(1e-6);
            if (k > 0) {
              const p = out[k - 1];
              expect(n.startBeat).toBeGreaterThanOrEqual(p.startBeat + p.beats - 1e-9);
            }
          }
        }
      }
    }
  });
});
