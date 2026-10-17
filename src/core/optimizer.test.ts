import { describe, expect, it } from 'vitest';
import type { KeyChoice } from './keys';
import { keyChoicesForMidi, noteMidi, playableRange } from './keys';
import type { OptimizerOptions, Placement, PlacementStats } from './optimizer';
import {
  COST,
  TRANSPOSE_LIMIT,
  evaluateTranspose,
  keepOriginalKey,
  optimizeTranspose,
  placementCost,
} from './optimizer';

const C4 = 60;

/** Chuỗi lựa chọn dạng gọn để so: "Z", "R:X", "L:N", "S:V", "RS:Z", null cho rest. */
function fmt(c: KeyChoice | null): string | null {
  if (c === null) return null;
  const p = (c.octave === -1 ? 'L' : c.octave === 1 ? 'R' : '') + (c.sharp ? 'S' : '');
  return p === '' ? c.key : `${p}:${c.key}`;
}

function must(p: Placement | null): Placement {
  expect(p).not.toBeNull();
  return p as Placement;
}

/** Thống kê theo đúng định nghĩa (độc lập với DP): run = dải liên tiếp cùng (octave, sharp) ≠ (0,false), rest phá run. */
function statsOf(choices: readonly (KeyChoice | null)[]): Omit<PlacementStats, 'foldedNotes'> {
  let noteCount = 0;
  let scrollNotes = 0;
  let modifiedNotes = 0;
  let holdRuns = 0;
  let prev: KeyChoice | null = null;
  for (const c of choices) {
    if (c === null) {
      prev = null;
      continue;
    }
    noteCount++;
    const mod = c.octave !== 0 || c.sharp;
    if (mod) {
      modifiedNotes++;
      if (c.sharp) scrollNotes++;
      if (prev === null || prev.octave !== c.octave || prev.sharp !== c.sharp) holdRuns++;
    }
    prev = c;
  }
  return { noteCount, scrollNotes, modifiedNotes, holdRuns };
}

/** Vét cạn mọi cách bấm (chỉ cho melody ngắn) → cost nhỏ nhất. */
function bruteForceCost(pitches: readonly (number | null)[], opts: OptimizerOptions = {}): number {
  const base = opts.baseOctave ?? 4;
  const dir = opts.scrollDir ?? 1;
  const options = pitches.map((p) => (p === null ? [null] : keyChoicesForMidi(p, base, dir)));
  let best = Infinity;
  const cur: (KeyChoice | null)[] = [];
  const rec = (i: number): void => {
    if (i === options.length) {
      best = Math.min(best, placementCost({ ...statsOf(cur), foldedNotes: 0 }));
      return;
    }
    for (const c of options[i] ?? []) {
      cur.push(c);
      rec(i + 1);
      cur.pop();
    }
  };
  rec(0);
  return best;
}

/** Bộ sinh số giả ngẫu nhiên tất định (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomMelody(
  n: number,
  seed: number,
  lo: number,
  hi: number,
  restRate = 0.1,
): (number | null)[] {
  const r = rng(seed);
  return Array.from({ length: n }, () =>
    r() < restRate ? null : lo + Math.floor(r() * (hi - lo + 1)),
  );
}

describe('placementCost', () => {
  it('= 10 × scroll + 4 × run + 1 × modified + 1000 × folded', () => {
    expect(COST).toEqual({ scroll: 10, run: 4, modified: 1, folded: 1000 });
    expect(
      placementCost({
        noteCount: 9,
        scrollNotes: 2,
        holdRuns: 3,
        modifiedNotes: 5,
        foldedNotes: 1,
      }),
    ).toBe(20 + 12 + 5 + 1000);
    expect(
      placementCost({
        noteCount: 0,
        scrollNotes: 0,
        holdRuns: 0,
        modifiedNotes: 0,
        foldedNotes: 0,
      }),
    ).toBe(0);
  });
});

describe('evaluateTranspose', () => {
  it('C major scale C4..C5 at transpose 0: all plain keys, cost 0', () => {
    const p = must(evaluateTranspose([60, 62, 64, 65, 67, 69, 71, 72], 0));
    expect(p.choices.map(fmt)).toEqual(['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',']);
    expect(p.transpose).toBe(0);
    expect(p.shift).toBe(0);
    expect(p.cost).toBe(0);
    expect(p.stats).toEqual({
      noteCount: 8,
      scrollNotes: 0,
      holdRuns: 0,
      modifiedNotes: 0,
      foldedNotes: 0,
    });
    expect(p.folded).toEqual(Array(8).fill(false));
  });

  it('applies the transpose to every pitch and reports shift mod 12', () => {
    const p = must(evaluateTranspose([C4, null, 62], -12));
    expect(p.choices.map(fmt)).toEqual(['L:Z', null, 'L:X']);
    expect(p.shift).toBe(0);
    expect(p.stats.holdRuns).toBe(2); // rest phá run (D-020)
    expect(must(evaluateTranspose([C4], -1)).shift).toBe(11);
    expect(must(evaluateTranspose([C4], 13)).shift).toBe(1);
    expect(must(evaluateTranspose([C4], 5)).choices.map(fmt)).toEqual(['V']);
  });

  it('returns null when a note is out of C3..C6 and fold is off', () => {
    expect(evaluateTranspose([47], 0)).toBeNull();
    expect(evaluateTranspose([85], 0)).toBeNull();
    expect(evaluateTranspose([48, 84], 0)).not.toBeNull();
    expect(evaluateTranspose([84], 1)).toBeNull();
    expect(evaluateTranspose([48], -1)).toBeNull();
  });

  it('range edges: C3 = L:Z, C6 = R:, (both scroll directions)', () => {
    expect(must(evaluateTranspose([48, 84], 0)).choices.map(fmt)).toEqual(['L:Z', 'R:,']);
    expect(must(evaluateTranspose([48, 84], 0, { scrollDir: -1 })).choices.map(fmt)).toEqual([
      'L:Z',
      'R:,',
    ]);
  });

  it('fold moves out-of-range notes by whole octaves to the nearest in-range pitch', () => {
    // 40 (E2) → 52 (E3); 90 (F#6) → 78 (F#5); 30 → 54; 101 → 77
    const pitches = [40, null, 90, 30, 101, 60];
    const p = must(evaluateTranspose(pitches, 0, { fold: true }));
    expect(p.folded).toEqual([true, false, true, true, true, false]);
    expect(p.stats.foldedNotes).toBe(4);
    const midis = p.choices.map((c) => (c ? noteMidi(c.key, c.octave, c.sharp) : null));
    expect(midis).toEqual([52, null, 78, 54, 77, 60]);
    expect(p.cost).toBe(placementCost(p.stats));
    expect(p.cost).toBeGreaterThanOrEqual(4 * COST.folded);
    // không bật fold → null
    expect(evaluateTranspose(pitches, 0)).toBeNull();
  });

  it('prefers a long hold run over many short ones (R:X R:Z R:X beats X , X)', () => {
    // 74 72 74: ",": cost 0 nhưng phải giữ lại 2 lần (4+1+4+1 = 10) — giữ luôn: 4+3 = 7
    const p = must(evaluateTranspose([74, 72, 74], 0));
    expect(p.choices.map(fmt)).toEqual(['R:X', 'R:Z', 'R:X']);
    expect(p.cost).toBe(7);
    expect(p.stats).toMatchObject({ holdRuns: 1, modifiedNotes: 3, scrollNotes: 0 });
  });

  it('uses the plain key when it is just as good (C5 alone → ",")', () => {
    expect(must(evaluateTranspose([72], 0)).choices.map(fmt)).toEqual([',']);
    expect(must(evaluateTranspose([60], 0)).choices.map(fmt)).toEqual(['Z']);
    // C5 giữa hai nốt thường
    expect(must(evaluateTranspose([71, 72, 71], 0)).choices.map(fmt)).toEqual(['M', ',', 'M']);
  });

  it('a rest breaks a hold run', () => {
    // không có rest: 1 run
    expect(must(evaluateTranspose([74, 76, 74], 0)).stats.holdRuns).toBe(1);
    const p = must(evaluateTranspose([74, null, 76], 0));
    expect(p.choices.map(fmt)).toEqual(['R:X', null, 'R:C']);
    expect(p.stats.holdRuns).toBe(2);
    expect(p.cost).toBe(10);
  });

  it('runs are by combined (octave, sharp): R then RS starts a new run', () => {
    // 74 (R:X) rồi 75 (D#5 = RS:X) rồi 74
    const p = must(evaluateTranspose([74, 75, 74], 0));
    expect(p.choices.map(fmt)).toEqual(['R:X', 'RS:X', 'R:X']);
    expect(p.stats).toMatchObject({ holdRuns: 3, scrollNotes: 1, modifiedNotes: 3 });
    expect(p.cost).toBe(10 + 3 * 4 + 3);
  });

  it('sharp notes follow scrollDir: +1 → key below, -1 → key above', () => {
    // F#4 = 66
    expect(must(evaluateTranspose([66], 0)).choices.map(fmt)).toEqual(['S:V']);
    expect(must(evaluateTranspose([66], 0, { scrollDir: -1 })).choices.map(fmt)).toEqual(['S:B']);
    // C#4 = 61, Bb4 = 70
    expect(must(evaluateTranspose([61, 70], 0)).choices.map(fmt)).toEqual(['S:Z', 'S:N']);
    expect(must(evaluateTranspose([61, 70], 0, { scrollDir: -1 })).choices.map(fmt)).toEqual([
      'S:X',
      'S:M',
    ]);
    const p = must(evaluateTranspose([61, 70], 0));
    expect(p.stats).toMatchObject({ scrollNotes: 2, modifiedNotes: 2, holdRuns: 1 });
    expect(p.cost).toBe(2 * 10 + 4 + 2);
  });

  it('baseOctave 3 and 5 shift the playable range', () => {
    expect(playableRange(3)).toEqual({ min: 36, max: 72 });
    expect(must(evaluateTranspose([48, 36, 72], 0, { baseOctave: 3 })).choices.map(fmt)).toEqual([
      'Z',
      'L:Z',
      'R:,',
    ]);
    expect(evaluateTranspose([35], 0, { baseOctave: 3 })).toBeNull();
    expect(evaluateTranspose([73], 0, { baseOctave: 3 })).toBeNull();
    expect(must(evaluateTranspose([72, 60, 96], 0, { baseOctave: 5 })).choices.map(fmt)).toEqual([
      'Z',
      'L:Z',
      'R:,',
    ]);
    expect(evaluateTranspose([59], 0, { baseOctave: 5 })).toBeNull();
  });

  it('empty and all-rest melodies give an empty placement', () => {
    const empty = must(evaluateTranspose([], 0));
    expect(empty).toEqual({
      transpose: 0,
      shift: 0,
      cost: 0,
      stats: { noteCount: 0, scrollNotes: 0, holdRuns: 0, modifiedNotes: 0, foldedNotes: 0 },
      choices: [],
      folded: [],
    });
    const rests = must(evaluateTranspose([null, null], 7));
    expect(rests.choices).toEqual([null, null]);
    expect(rests.folded).toEqual([false, false]);
    expect(rests.shift).toBe(7);
    expect(rests.cost).toBe(0);
  });

  it('non-integer / non-finite pitches are unplayable (null)', () => {
    expect(evaluateTranspose([60.5], 0)).toBeNull();
    expect(evaluateTranspose([Number.NaN], 0)).toBeNull();
    expect(evaluateTranspose([Infinity], 0, { fold: true })).toBeNull();
  });

  it('throws RangeError for a non-integer transpose or baseOctave', () => {
    expect(() => evaluateTranspose([60], 0.5)).toThrow(RangeError);
    expect(() => evaluateTranspose([60], Number.NaN)).toThrow(RangeError);
    expect(() => evaluateTranspose([60], 0, { baseOctave: 4.5 })).toThrow(RangeError);
    expect(() => optimizeTranspose([60], { baseOctave: Number.NaN })).toThrow(RangeError);
  });

  it('stats always match the returned choices and cost = placementCost(stats)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const pitches = randomMelody(60, seed, 40, 92, 0.15);
      for (const t of [-12, -5, 0, 3]) {
        const p = evaluateTranspose(pitches, t, { fold: true, scrollDir: seed % 2 ? 1 : -1 });
        const pl = must(p);
        expect({ ...statsOf(pl.choices), foldedNotes: pl.stats.foldedNotes }).toEqual(pl.stats);
        expect(pl.cost).toBe(placementCost(pl.stats));
      }
    }
  });

  it('every choice actually sounds the (transposed, possibly folded) pitch', () => {
    const pitches = randomMelody(200, 7, 30, 100, 0.1);
    for (const dir of [1, -1] as const) {
      const p = must(evaluateTranspose(pitches, 2, { fold: true, scrollDir: dir }));
      const { min, max } = playableRange(4);
      p.choices.forEach((c, i) => {
        const src = pitches[i] ?? null;
        if (src === null) {
          expect(c).toBeNull();
          return;
        }
        expect(c).not.toBeNull();
        const m = noteMidi(
          (c as KeyChoice).key,
          (c as KeyChoice).octave,
          (c as KeyChoice).sharp,
          4,
          dir,
        );
        expect(m).toBeGreaterThanOrEqual(min);
        expect(m).toBeLessThanOrEqual(max);
        expect((((m - (src + 2)) % 12) + 12) % 12).toBe(0);
        expect(p.folded[i]).toBe(m !== src + 2);
      });
    }
  });

  it('DP cost equals the brute-force minimum on short melodies', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const pitches = randomMelody(7, seed, 48, 84, 0.2);
      const opts: OptimizerOptions = { scrollDir: seed % 3 === 0 ? -1 : 1 };
      expect(must(evaluateTranspose(pitches, 0, opts)).cost).toBe(bruteForceCost(pitches, opts));
    }
  });

  it('is deterministic', () => {
    const pitches = randomMelody(300, 99, 50, 82);
    expect(evaluateTranspose(pitches, 0)).toEqual(evaluateTranspose(pitches, 0));
  });
});

describe('optimizeTranspose', () => {
  it('C D E: shift 0 first on ties, then the nearest shift, then smaller |transpose|', () => {
    const r = optimizeTranspose([60, 62, 64]);
    // cost 0 ở shift 0 (C D E), 5 (F G A, t=+5), 7 (G A B, t=+7)
    expect(r.map((p) => [p.transpose, p.shift, p.cost])).toEqual([
      [0, 0, 0],
      [5, 5, 0],
      [7, 7, 0],
    ]);
  });

  it('black-key melody: best shifts are ±1 semitone, smaller transpose first on full ties', () => {
    // F# G# A#: t=0 cần 3 nốt scroll; F G A (t=-1), G A B (t=+1), C D E (t=-6) đều cost 0
    const r = optimizeTranspose([66, 68, 70]);
    expect(r.map((p) => p.transpose)).toEqual([-1, 1, -6]);
    expect(r.map((p) => p.shift)).toEqual([11, 1, 6]);
    const all = optimizeTranspose([66, 68, 70], { top: 12 });
    expect(all).toHaveLength(12);
    const orig = all.find((p) => p.shift === 0);
    expect(orig?.transpose).toBe(0);
    expect(orig?.stats.scrollNotes).toBe(3);
    expect(orig?.cost).toBe(3 * 11 + 4);
  });

  it('keeps one placement per shift class, choosing the cheapest octave', () => {
    // D6 E6 (86 88): t=0 ngoài tầm; t=-12 → R:X R:C (6); t=-24 → X C (0)
    const r = optimizeTranspose([86, 88], { top: 12 });
    expect(new Set(r.map((p) => p.shift)).size).toBe(r.length);
    expect(r[0]?.transpose).toBe(-24);
    expect(r[0]?.cost).toBe(0);
    const costs = r.map((p) => p.cost);
    expect([...costs].sort((a, b) => a - b)).toEqual(costs);
  });

  it('honours top (default 3, clamped to 0..12)', () => {
    const m = [60, 62, 64, 65, 67];
    expect(optimizeTranspose(m)).toHaveLength(3);
    expect(optimizeTranspose(m, { top: 1 })).toHaveLength(1);
    expect(optimizeTranspose(m, { top: 0 })).toEqual([]);
    expect(optimizeTranspose(m, { top: -2 })).toEqual([]);
    expect(optimizeTranspose(m, { top: 99 })).toHaveLength(12);
    expect(optimizeTranspose(m, { top: Number.NaN })).toHaveLength(3);
  });

  it('returns [] when nothing fits; fold makes the widest melody placeable', () => {
    const wide = [40, 60, 90]; // 50 semitone > tầm 36
    expect(optimizeTranspose(wide)).toEqual([]);
    expect(keepOriginalKey(wide)).toBeNull();
    const r = optimizeTranspose(wide, { fold: true });
    expect(r.length).toBe(3);
    // gập ít nốt nhất có thể: 1 nốt
    expect(r[0]?.stats.foldedNotes).toBe(1);
    expect(r[0]?.folded.filter(Boolean)).toHaveLength(1);
    expect(keepOriginalKey(wide, { fold: true })?.stats.foldedNotes).toBe(1);
  });

  it('fold does not change the result of a melody that fits', () => {
    const m = randomMelody(80, 5, 55, 80);
    const a = optimizeTranspose(m);
    const b = optimizeTranspose(m, { fold: true });
    expect(b[0]?.transpose).toBe(a[0]?.transpose);
    expect(b[0]?.cost).toBe(a[0]?.cost);
    expect(b[0]?.stats.foldedNotes).toBe(0);
  });

  it('only tries transposes within ±48', () => {
    expect(TRANSPOSE_LIMIT).toBe(48);
    // 120 cần t ≤ -36 để vào tầm; 130 cần ≤ -46; 140 cần ≤ -56 → không được
    expect(optimizeTranspose([120])[0]?.transpose).toBe(-48);
    expect(optimizeTranspose([140])).toEqual([]);
  });

  it('every returned placement equals evaluateTranspose at its transpose', () => {
    const m = randomMelody(150, 11, 52, 80, 0.1);
    for (const opts of [{}, { scrollDir: -1 as const }, { baseOctave: 3 }, { fold: true }]) {
      for (const p of optimizeTranspose(m, { ...opts, top: 12 })) {
        expect(evaluateTranspose(m, p.transpose, opts)).toEqual(p);
      }
    }
  });

  it('the first placement is optimal over every fitting transpose', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const m = randomMelody(40, seed, 50, 78, 0.1);
      const best = optimizeTranspose(m)[0];
      for (let t = -48; t <= 48; t++) {
        const p = evaluateTranspose(m, t);
        if (p) expect(best?.cost).toBeLessThanOrEqual(p.cost);
      }
    }
  });

  it('empty / all-rest melody → a single transpose-0 placement', () => {
    expect(optimizeTranspose([]).map((p) => p.transpose)).toEqual([0]);
    const r = optimizeTranspose([null, null, null]);
    expect(r).toHaveLength(1);
    expect(r[0]?.choices).toEqual([null, null, null]);
    expect(r[0]?.cost).toBe(0);
    expect(optimizeTranspose([], { top: 0 })).toEqual([]);
  });

  it('invalid pitches → []', () => {
    expect(optimizeTranspose([60, 61.5])).toEqual([]);
    expect(keepOriginalKey([Number.NaN])).toBeNull();
  });

  it('branch-and-bound gives exactly the per-shift optimum of evaluating every transpose', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const fold = seed % 2 === 0;
      const m = randomMelody(50, seed, fold ? 35 : 55, fold ? 100 : 75, 0.1);
      const opts: OptimizerOptions = { fold, scrollDir: seed % 3 === 0 ? -1 : 1 };
      // tham chiếu: evaluate mọi t, giữ tốt nhất mỗi lớp (cost, |t|, t), rồi sắp như spec
      const best = new Map<number, Placement>();
      for (let t = -48; t <= 48; t++) {
        const p = evaluateTranspose(m, t, opts);
        if (!p) continue;
        const cur = best.get(p.shift);
        const order = cur
          ? p.cost - cur.cost ||
            Math.abs(p.transpose) - Math.abs(cur.transpose) ||
            p.transpose - cur.transpose
          : -1;
        if (order < 0) best.set(p.shift, p);
      }
      const dist = (s: number): number => (s <= 6 ? s : 12 - s);
      const expected = [...best.values()]
        .sort(
          (a, b) =>
            a.cost - b.cost ||
            (a.shift === 0 ? 0 : 1) - (b.shift === 0 ? 0 : 1) ||
            dist(a.shift) - dist(b.shift) ||
            Math.abs(a.transpose) - Math.abs(b.transpose) ||
            a.transpose - b.transpose,
        )
        .map((p) => p.transpose);
      expect(optimizeTranspose(m, { ...opts, top: 12 }).map((p) => p.transpose)).toEqual(expected);
    }
  });

  it('5000 notes × all transposes runs in < 150 ms', () => {
    /** Thời gian nhanh nhất qua vài lần chạy (bỏ nhiễu khi CPU đang bị tranh trong suite song song). */
    const fastest = (fn: () => void, budget: number): number => {
      let best = Infinity;
      for (let i = 0; i < 8 && best >= budget; i++) {
        const t0 = performance.now();
        fn();
        best = Math.min(best, performance.now() - t0);
      }
      return best;
    };
    const wide = randomMelody(5000, 2024, 45, 95, 0.08); // rộng hơn tầm: mọi transpose đều gập
    const narrow = randomMelody(5000, 7, 60, 72, 0.08); // hẹp: ~85 transpose vừa tầm
    const cases: [string, () => Placement[]][] = [
      ['wide + fold', () => optimizeTranspose(wide, { fold: true })],
      ['narrow', () => optimizeTranspose(narrow)],
      ['narrow + fold', () => optimizeTranspose(narrow, { fold: true, scrollDir: -1 })],
    ];
    for (const [name, run] of cases) {
      expect(run(), name).toHaveLength(3);
      expect(fastest(run, 150), name).toBeLessThan(150);
    }
  });
});

describe('keepOriginalKey', () => {
  it('returns the best shift-0 placement (octave moves only)', () => {
    expect(keepOriginalKey([66, 68, 70])?.transpose).toBe(0);
    expect(keepOriginalKey([86, 88])?.transpose).toBe(-24);
    // C3..C4: t=0 → L-run (4+5) ; t=+12 → plain (0)
    expect(keepOriginalKey([48, 50, 52, 53, 55])?.transpose).toBe(12);
    const p = keepOriginalKey([60, 62, 64], { scrollDir: -1 });
    expect(p?.shift).toBe(0);
    expect(p?.cost).toBe(0);
  });

  it('empty / all-rest melody → transpose 0', () => {
    expect(keepOriginalKey([])?.transpose).toBe(0);
    expect(keepOriginalKey([null])?.choices).toEqual([null]);
  });

  it('null when no octave placement fits', () => {
    // 49 nhưng phải ≥ 48 và 85 ≤ 84 cùng lúc → không dời quãng tám nào vừa
    expect(keepOriginalKey([49, 85])).toBeNull();
    expect(keepOriginalKey([49, 85], { fold: true })?.stats.foldedNotes).toBe(1);
  });
});
