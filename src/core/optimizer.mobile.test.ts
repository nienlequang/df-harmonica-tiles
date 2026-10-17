import { describe, expect, it } from 'vitest';
import type { KeyChoice } from './keys';
import { keyChoicesForMidi } from './keys';
import { buildMobilePlan } from './mobile';
import type { OptimizerOptions, Placement, PlacementStats } from './optimizer';
import {
  MOBILE_COST,
  evaluateTranspose,
  keepOriginalKey,
  optimizeTranspose,
  placementCost,
} from './optimizer';
import { buildTimeline } from './timeline';
import type { Song, Unit } from './types';

type Semitone = 'toggle' | 'oneShot';
const SEMITONES: readonly Semitone[] = ['toggle', 'oneShot'];
const mobile = (semitone: Semitone, extra: OptimizerOptions = {}): OptimizerOptions => ({
  ...extra,
  scheme: 'mobile',
  mobileSemitone: semitone,
});

function fmt(c: KeyChoice | null): string | null {
  if (c === null) return null;
  const p = (c.octave === -1 ? 'L' : c.octave === 1 ? 'R' : '') + (c.sharp ? 'S' : '');
  return p === '' ? c.key : `${p}:${c.key}`;
}

function must(p: Placement | null): Placement {
  expect(p).not.toBeNull();
  return p as Placement;
}

/** Số lần chạm theo đúng định nghĩa (độc lập với DP): trạng thái giữ qua rest, đầu bài 0 / tắt. */
function tapsOf(
  choices: readonly (KeyChoice | null)[],
  semitone: Semitone,
): { octaveTaps: number; semitoneTaps: number; scrollNotes: number } {
  let octaveTaps = 0;
  let semitoneTaps = 0;
  let scrollNotes = 0;
  let mode = 0;
  let on = false;
  for (const c of choices) {
    if (c === null) continue;
    if (c.octave !== mode) octaveTaps++;
    mode = c.octave;
    if (c.sharp) scrollNotes++;
    if (semitone === 'oneShot') {
      if (c.sharp) semitoneTaps++;
    } else if (c.sharp !== on) {
      semitoneTaps++;
      on = c.sharp;
    }
  }
  return { octaveTaps, semitoneTaps, scrollNotes };
}

function mobileCostOf(choices: readonly (KeyChoice | null)[], semitone: Semitone): number {
  const t = tapsOf(choices, semitone);
  return MOBILE_COST.scroll * t.scrollNotes + MOBILE_COST.tap * (t.octaveTaps + t.semitoneTaps);
}

/** Vét cạn mọi cách bấm (melody ngắn) → cost Mobile nhỏ nhất. */
function bruteForceMobile(pitches: readonly (number | null)[], semitone: Semitone): number {
  const options = pitches.map((p) => (p === null ? [null] : keyChoicesForMidi(p)));
  let best = Infinity;
  const cur: (KeyChoice | null)[] = [];
  const rec = (i: number): void => {
    if (i === options.length) {
      best = Math.min(best, mobileCostOf(cur, semitone));
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

function randomMelody(n: number, seed: number, lo: number, hi: number, restRate = 0.1) {
  const r = rng(seed);
  return Array.from({ length: n }, () =>
    r() < restRate ? null : lo + Math.floor(r() * (hi - lo + 1)),
  );
}

/** Lựa chọn của placement → Song (mỗi nốt / rest 1 beat) để so với buildMobilePlan. */
function songOf(choices: readonly (KeyChoice | null)[]): Song {
  const units: Unit[] = choices.map((c) =>
    c === null
      ? { kind: 'rest', beats: 1 }
      : { kind: 'note', key: c.key, octave: c.octave, sharp: c.sharp, beats: 1 },
  );
  return {
    id: 'x',
    title: 'x',
    bpm: 90,
    timeSig: { num: 4, den: 4 },
    scrollDir: 1,
    sections: units.length > 0 ? [{ name: 'Main', lines: [{ units }] }] : [],
  };
}

/**
 * Melody dựng sẵn: C4 D4 E4 F4 (liền), rồi D5 _ E5 _ F5 (cách nhau bởi rest).
 * Lớp cung không cần scroll: shift 0 và shift 7.
 *   PC  (rest phá run, +1 mỗi nốt có modifier):
 *     t=0   → Z X C V | R:X _ R:C _ R:V = 3 run × (4+1) = 15
 *     t=-12 → L:Z L:X L:C L:V (1 run: 4+4 = 8) | X _ C _ V          = 8
 *     t=-5  → L:B L:N L:M Z (4+3 = 7) | N _ M _ ,                    = 7  ← tốt nhất
 *     t=+7  → B N M , | R:N _ R:M _ R:, = 15
 *   Mobile (chạm giữ trạng thái qua rest):
 *     t=0   → chạm Ngẩng Lên 1 lần = 4  ← tốt nhất (hòa t=+7, shift 0 trước)
 *     t=+7  → 4;  t=-12 → Cúi Xuống + Ngẩng Tự Nhiên = 8;  t=-5 → 8
 */
const CRAFTED = [60, 62, 64, 65, null, 74, null, 76, null, 77];

describe('placementCost — mobile stats', () => {
  it('= 10 × scroll + 4 × (octave taps + semitone taps) + 1000 × folded; no per-note cost', () => {
    expect(MOBILE_COST).toEqual({ scroll: 10, tap: 4, folded: 1000 });
    const stats: PlacementStats = {
      noteCount: 9,
      scrollNotes: 2,
      holdRuns: 5,
      modifiedNotes: 7,
      foldedNotes: 1,
      octaveTaps: 3,
      semitoneTaps: 2,
    };
    expect(placementCost(stats)).toBe(20 + 4 * 5 + 1000);
    expect(placementCost({ ...stats, semitoneTaps: undefined })).toBe(20 + 12 + 1000);
    // không có số lần chạm → cost PC như cũ
    const { octaveTaps: _o, semitoneTaps: _s, ...pc } = stats;
    expect(placementCost(pc)).toBe(20 + 4 * 5 + 7 + 1000);
  });
});

describe('optimizer — scheme mobile', () => {
  it('rests do not break the latched mode (one tap instead of a run per note)', () => {
    const pitches = [74, null, 76, null, 77];
    const pc = must(evaluateTranspose(pitches, 0));
    const mob = must(evaluateTranspose(pitches, 0, mobile('toggle')));
    expect(pc.choices.map(fmt)).toEqual(['R:X', null, 'R:C', null, 'R:V']);
    expect(mob.choices.map(fmt)).toEqual(['R:X', null, 'R:C', null, 'R:V']);
    expect(pc.cost).toBe(15);
    expect(mob.cost).toBe(4);
    expect(mob.stats).toEqual({
      noteCount: 3,
      scrollNotes: 0,
      holdRuns: 3,
      modifiedNotes: 3,
      foldedNotes: 0,
      octaveTaps: 1,
      semitoneTaps: 0,
    });
  });

  it('stays in a latched mode when the alternative key needs a tap (C5 after Ngẩng Lên = R:Z)', () => {
    // D5 C5 D5: PC giữ luôn R (7); Mobile cũng ở lại Ngẩng Lên — `,` sẽ tốn 2 lần chạm
    const mob = must(evaluateTranspose([74, 72, 74], 0, mobile('toggle')));
    expect(mob.choices.map(fmt)).toEqual(['R:X', 'R:Z', 'R:X']);
    expect(mob.cost).toBe(4);
    // nhưng nốt thường đứng một mình vẫn bấm thường (không chạm gì)
    expect(must(evaluateTranspose([72], 0, mobile('toggle'))).choices.map(fmt)).toEqual([',']);
  });

  it('semitone taps: toggle taps on/off, oneShot taps before every sharp note', () => {
    // C#4 C#4 C4 (t=0)
    const pitches = [61, 61, 60];
    const toggle = must(evaluateTranspose(pitches, 0, mobile('toggle')));
    const oneShot = must(evaluateTranspose(pitches, 0, mobile('oneShot')));
    expect(toggle.choices.map(fmt)).toEqual(['S:Z', 'S:Z', 'Z']);
    expect(toggle.stats).toMatchObject({ scrollNotes: 2, octaveTaps: 0, semitoneTaps: 2 });
    expect(toggle.cost).toBe(20 + 8);
    expect(oneShot.stats).toMatchObject({ scrollNotes: 2, octaveTaps: 0, semitoneTaps: 2 });
    expect(oneShot.cost).toBe(20 + 8);
    // ba nốt thăng liền nhau: toggle chạm 1 lần, oneShot 3 lần
    const three = [61, null, 61, 61];
    expect(must(evaluateTranspose(three, 0, mobile('toggle'))).stats.semitoneTaps).toBe(1);
    expect(must(evaluateTranspose(three, 0, mobile('oneShot'))).stats.semitoneTaps).toBe(3);
    expect(must(evaluateTranspose(three, 0, mobile('toggle'))).cost).toBe(34);
    expect(must(evaluateTranspose(three, 0, mobile('oneShot'))).cost).toBe(42);
  });

  it('crafted melody: latching makes a different transpose the cheapest (pc -5, mobile 0)', () => {
    const pc = optimizeTranspose(CRAFTED);
    expect(pc.slice(0, 2).map((p) => [p.transpose, p.cost])).toEqual([
      [-5, 7],
      [-12, 8],
    ]);
    for (const semitone of SEMITONES) {
      const mob = optimizeTranspose(CRAFTED, mobile(semitone));
      expect(mob.slice(0, 2).map((p) => [p.transpose, p.cost])).toEqual([
        [0, 4],
        [7, 4],
      ]);
      expect(mob[0]?.choices.map(fmt)).toEqual([
        'Z',
        'X',
        'C',
        'V',
        null,
        'R:X',
        null,
        'R:C',
        null,
        'R:V',
      ]);
      expect(mob[0]?.stats).toMatchObject({ octaveTaps: 1, semitoneTaps: 0, holdRuns: 3 });
    }
    // cùng transpose, hai cost model cho giá khác nhau
    expect(must(evaluateTranspose(CRAFTED, 0)).cost).toBe(15);
    expect(must(evaluateTranspose(CRAFTED, -12, mobile('toggle'))).cost).toBe(8);
    expect(must(evaluateTranspose(CRAFTED, -5, mobile('toggle'))).cost).toBe(8);
    // giữ cung gốc: PC hạ 1 quãng tám, Mobile giữ nguyên
    expect(keepOriginalKey(CRAFTED)?.transpose).toBe(-12);
    expect(keepOriginalKey(CRAFTED, mobile('toggle'))?.transpose).toBe(0);
  });

  it('DP cost equals the brute-force mobile minimum on short melodies (both semitone modes)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const pitches = randomMelody(7, seed, 48, 84, 0.25);
      for (const semitone of SEMITONES) {
        const p = must(evaluateTranspose(pitches, 0, mobile(semitone)));
        expect(p.cost, `seed ${seed} ${semitone}`).toBe(bruteForceMobile(pitches, semitone));
      }
    }
  });

  it('stats match the choices, cost = placementCost(stats), taps = buildMobilePlan of the result', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const pitches = randomMelody(60, seed, 40, 92, 0.15);
      for (const semitone of SEMITONES) {
        for (const t of [-12, -5, 0, 3]) {
          const p = must(evaluateTranspose(pitches, t, mobile(semitone, { fold: true })));
          const taps = tapsOf(p.choices, semitone);
          expect(p.stats).toMatchObject(taps);
          expect(p.cost).toBe(placementCost(p.stats));
          const plan = buildMobilePlan(buildTimeline(songOf(p.choices)), { semitone });
          expect(plan.stats).toEqual({
            octaveTaps: p.stats.octaveTaps,
            semitoneTaps: p.stats.semitoneTaps,
          });
        }
      }
    }
  });

  it('branch-and-bound gives the per-shift optimum of evaluating every transpose', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const fold = seed % 2 === 0;
      const m = randomMelody(40, seed, fold ? 35 : 55, fold ? 100 : 75, 0.15);
      for (const semitone of SEMITONES) {
        const opts = mobile(semitone, { fold, scrollDir: seed % 3 === 0 ? -1 : 1 });
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
        const got = optimizeTranspose(m, { ...opts, top: 12 });
        expect(got.map((p) => p.transpose)).toEqual(expected);
        for (const p of got) expect(evaluateTranspose(m, p.transpose, opts)).toEqual(p);
      }
    }
  });

  it('empty / all-rest melody → transpose 0 with zero taps', () => {
    const r = optimizeTranspose([null, null], mobile('toggle'));
    expect(r).toHaveLength(1);
    expect(r[0]?.stats).toEqual({
      noteCount: 0,
      scrollNotes: 0,
      holdRuns: 0,
      modifiedNotes: 0,
      foldedNotes: 0,
      octaveTaps: 0,
      semitoneTaps: 0,
    });
    expect(r[0]?.cost).toBe(0);
  });

  it('5000 notes × all transposes stays fast', () => {
    const fastest = (fn: () => void, budget: number): number => {
      let best = Infinity;
      for (let i = 0; i < 6 && best >= budget; i++) {
        const t0 = performance.now();
        fn();
        best = Math.min(best, performance.now() - t0);
      }
      return best;
    };
    const narrow = randomMelody(5000, 7, 60, 72, 0.08);
    const wide = randomMelody(5000, 2024, 45, 95, 0.08);
    const run1 = (): Placement[] => optimizeTranspose(narrow, mobile('toggle'));
    const run2 = (): Placement[] => optimizeTranspose(wide, mobile('oneShot', { fold: true }));
    expect(run1()).toHaveLength(3);
    expect(run2()).toHaveLength(3);
    expect(fastest(run1, 400)).toBeLessThan(400);
    expect(fastest(run2, 400)).toBeLessThan(400);
  });
});

describe('optimizer — scheme pc is unchanged', () => {
  it("explicit scheme 'pc' (with any mobileSemitone) equals the default, without tap stats", () => {
    for (let seed = 1; seed <= 5; seed++) {
      const m = randomMelody(80, seed, 50, 80, 0.15);
      const base = optimizeTranspose(m, { top: 12 });
      expect(optimizeTranspose(m, { top: 12, scheme: 'pc' })).toEqual(base);
      expect(optimizeTranspose(m, { top: 12, scheme: 'pc', mobileSemitone: 'oneShot' })).toEqual(
        base,
      );
      for (const p of base) {
        expect('octaveTaps' in p.stats).toBe(false);
        expect('semitoneTaps' in p.stats).toBe(false);
      }
      expect(keepOriginalKey(m, { scheme: 'pc' })).toEqual(keepOriginalKey(m));
    }
  });

  it('mobileSemitone alone (without scheme) does nothing', () => {
    const m = [61, 61, null, 74, 76];
    expect(evaluateTranspose(m, 0, { mobileSemitone: 'oneShot' })).toEqual(evaluateTranspose(m, 0));
  });
});
