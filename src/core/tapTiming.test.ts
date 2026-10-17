import { describe, expect, it } from 'vitest';
import { formatBeats } from './beats';
import {
  DEFAULT_TAP_GRID,
  MIN_FREE_TAP_BEATS,
  TapSession,
  collectTapTargets,
  computeTapDurations,
} from './tapTiming';
import type { TapTarget } from './tapTiming';
import type {
  Line,
  LineOrigin,
  LineSpan,
  Note,
  NoteKey,
  ParseResult,
  Rest,
  Section,
  Slur,
  Unit,
} from './types';

// Model + ParseResult dựng tay — không phụ thuộc parser (test có parser: tapTiming.integration.test.ts).
const n = (key: NoteKey, beats = 1): Note => ({
  kind: 'note',
  key,
  octave: 0,
  sharp: false,
  beats,
});
const rest = (beats = 1): Rest => ({ kind: 'rest', beats });
const slur = (...notes: Note[]): Slur => ({ kind: 'slur', notes });
const line = (units: Unit[]): Line => ({ units });

interface LineSpec {
  line: Line;
  /** Dòng `@repeat` chèn (số dòng của directive). */
  repeatLine?: number;
}

function parsed(
  sections: Array<{ name: string; lines: LineSpec[] }>,
  withSpans = true,
): ParseResult {
  const lineOrigins: LineOrigin[] = [];
  const lineSpans: LineSpan[] = [];
  const outSections: Section[] = sections.map((s) => ({
    name: s.name,
    lines: s.lines.map((spec) => {
      const i = lineOrigins.length;
      lineOrigins.push(
        spec.repeatLine === undefined
          ? { sourceLine: i + 1 }
          : { sourceLine: i + 1, repeatLine: spec.repeatLine },
      );
      lineSpans.push({
        line: i + 1,
        tokensStart: 0,
        repeated: spec.repeatLine !== undefined,
      });
      return spec.line;
    }),
  }));
  return {
    song: {
      id: 't',
      title: 'T',
      bpm: 90,
      timeSig: { num: 4, den: 4 },
      scrollDir: 1,
      sections: outSections,
    },
    diagnostics: [],
    lineOrigins,
    lineSpans: withSpans ? lineSpans : [],
    unitSpans: [],
    ok: true,
  };
}

/** Target dựng tay cho computeTapDurations / TapSession. */
const T = (
  kind: TapTarget['kind'],
  lineIndex: number,
  unitIndex: number,
  beats = 1,
): TapTarget => ({
  lineIndex,
  unitIndex,
  kind,
  beats,
  repeated: false,
  label: kind === 'rest' ? '_' : 'Z',
});

/** n nốt liền nhau trên dòng 0. */
const notes = (count: number): TapTarget[] =>
  Array.from({ length: count }, (_, i) => T('note', 0, i));

const beatsOf = (r: Array<{ beats: number }>): number[] => r.map((x) => x.beats);

describe('collectTapTargets', () => {
  const song = parsed([
    {
      name: 'A',
      lines: [
        {
          line: line([n('N', 0.5), slur(n('X', 0.5), n('C', 0.5)), rest(0.5), n('M', 2)]),
        },
        { line: line([n('Z'), n('X')]) },
      ],
    },
    { name: 'Trống', lines: [] },
    {
      name: 'B',
      lines: [
        { line: line([n('B')]) },
        {
          line: line([n('N', 0.5), slur(n('X', 0.5), n('C', 0.5)), rest(0.5), n('M', 2)]),
          repeatLine: 9,
        },
      ],
    },
  ]);

  it('maps units in order with labels and beats (slur = sum), no lyric fields', () => {
    const t = collectTapTargets(song, 0);
    expect(t).toStrictEqual<TapTarget[]>([
      {
        lineIndex: 0,
        unitIndex: 0,
        kind: 'note',
        beats: 0.5,
        repeated: false,
        label: 'N',
      },
      {
        lineIndex: 0,
        unitIndex: 1,
        kind: 'slur',
        beats: 1,
        repeated: false,
        label: 'X-C',
      },
      {
        lineIndex: 0,
        unitIndex: 2,
        kind: 'rest',
        beats: 0.5,
        repeated: false,
        label: '_',
      },
      {
        lineIndex: 0,
        unitIndex: 3,
        kind: 'note',
        beats: 2,
        repeated: false,
        label: 'M',
      },
      {
        lineIndex: 1,
        unitIndex: 0,
        kind: 'note',
        beats: 1,
        repeated: false,
        label: 'Z',
      },
      {
        lineIndex: 1,
        unitIndex: 1,
        kind: 'note',
        beats: 1,
        repeated: false,
        label: 'X',
      },
    ]);
  });

  it('labels 3-note slurs', () => {
    const p = parsed([
      { name: 'A', lines: [{ line: line([slur(n('Z', 1), n('X', 1), n('C', 1))]) }] },
    ]);
    const [t] = collectTapTargets(p, null);
    expect(t).toMatchObject({ kind: 'slur', label: 'Z-X-C', beats: 3 });
  });

  it('whole song skips @repeat lines; line indices stay global (empty section adds none)', () => {
    const t = collectTapTargets(song, null);
    expect([...new Set(t.map((x) => x.lineIndex))]).toEqual([0, 1, 2]);
    expect(t.every((x) => !x.repeated)).toBe(true);
    expect(t.at(-1)).toMatchObject({ lineIndex: 2, unitIndex: 0, label: 'B' });
  });

  it('a single section keeps @repeat lines and marks them repeated', () => {
    const t = collectTapTargets(song, 2);
    expect(t.map((x) => [x.lineIndex, x.unitIndex, x.repeated])).toEqual([
      [2, 0, false],
      [3, 0, true],
      [3, 1, true],
      [3, 2, true],
      [3, 3, true],
    ]);
  });

  it('falls back to lineOrigins when lineSpans are missing', () => {
    const noSpans = parsed(
      [
        {
          name: 'A',
          lines: [{ line: line([n('Z')]) }, { line: line([n('X')]), repeatLine: 5 }],
        },
      ],
      false,
    );
    expect(collectTapTargets(noSpans, null).map((x) => x.label)).toEqual(['Z']);
    expect(collectTapTargets(noSpans, 0).map((x) => x.repeated)).toEqual([false, true]);
  });

  it('empty or unknown section → []', () => {
    expect(collectTapTargets(song, 1)).toEqual([]);
    expect(collectTapTargets(song, 3)).toEqual([]);
    expect(collectTapTargets(song, -1)).toEqual([]);
    expect(collectTapTargets(song, 0.5)).toEqual([]);
  });
});

describe('computeTapDurations — tempo', () => {
  it('bpm 60: 1000 ms = 1 beat', () => {
    const r = computeTapDurations(notes(3), [0, 1000, 3000], { bpm: 60, quantize: false });
    expect(r).toEqual([
      { lineIndex: 0, unitIndex: 0, beats: 1 },
      { lineIndex: 0, unitIndex: 1, beats: 2 },
      { lineIndex: 0, unitIndex: 2, beats: 1 },
    ]);
  });

  it('bpm 120: 500 ms = 1 beat', () => {
    const r = computeTapDurations(notes(4), [100, 600, 850, 1850], { bpm: 120, quantize: true });
    expect(beatsOf(r)).toEqual([1, 0.5, 2, 1]);
  });

  it('bpm 76: 60000/76 ms = 1 beat (seed 1 tempo)', () => {
    const beat = 60000 / 76;
    const taps = [0, beat * 0.5, beat * 1, beat * 3, beat * 4.5];
    for (const quantize of [true, false]) {
      const r = computeTapDurations(notes(5), taps, { bpm: 76, quantize });
      expect(beatsOf(r)).toEqual([0.5, 0.5, 2, 1.5, 1]);
    }
  });

  it('invalid bpm falls back to 90', () => {
    for (const bpm of [0, -60, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = computeTapDurations(notes(2), [0, 1000], { bpm, quantize: false });
      expect(r[0]?.beats).toBe(1.5);
    }
  });
});

describe('computeTapDurations — quantize', () => {
  const at60 = (dtMs: number, quantize: boolean, grid?: number): number =>
    computeTapDurations(notes(2), [0, dtMs], { bpm: 60, quantize, grid })[0]?.beats ?? NaN;

  it('on: rounds to the nearest multiple of 0.25', () => {
    expect(DEFAULT_TAP_GRID).toBe(0.25);
    expect(at60(480, true)).toBe(0.5);
    expect(at60(620, true)).toBe(0.5);
    expect(at60(630, true)).toBe(0.75);
    expect(at60(1130, true)).toBe(1.25);
  });

  it('on: never below one grid step', () => {
    expect(at60(100, true)).toBe(0.25);
    expect(at60(0, true)).toBe(0.25);
  });

  it('off: keeps the raw value (rounded to 0.001), min 1/16 beat', () => {
    expect(at60(480, false)).toBe(0.48);
    expect(at60(473.3333, false)).toBe(0.473);
    expect(at60(30, false)).toBe(MIN_FREE_TAP_BEATS);
    expect(at60(0, false)).toBe(0.0625);
  });

  it('custom grid: 1/8 and triplet 1/3 (written as a fraction)', () => {
    expect(at60(130, true, 0.125)).toBe(0.125);
    expect(at60(390, true, 0.125)).toBe(0.375);
    const third = at60(680, true, 1 / 3);
    expect(third).toBe(2 / 3);
    expect(formatBeats(third)).toBe('2/3');
    expect(at60(300, true, 0.1)).toBe(0.3);
    expect(formatBeats(at60(300, true, 0.1))).toBe('0.3');
  });

  it('invalid grid falls back to 0.25', () => {
    expect(at60(480, true, 0)).toBe(0.5);
    expect(at60(100, true, -1)).toBe(0.25);
  });
});

describe('computeTapDurations — rests', () => {
  it('rests between two taps keep their beats and are subtracted from the earlier unit', () => {
    const targets = [T('note', 0, 0), T('rest', 0, 1, 0.5), T('note', 0, 2), T('note', 0, 3)];
    const r = computeTapDurations(targets, [0, 1500, 2500], { bpm: 60, quantize: true });
    expect(r).toEqual([
      { lineIndex: 0, unitIndex: 0, beats: 1 },
      { lineIndex: 0, unitIndex: 2, beats: 1 },
      { lineIndex: 0, unitIndex: 3, beats: 1 },
    ]);
  });

  it('several rests (across a line break) are all subtracted', () => {
    const targets = [T('note', 0, 0), T('rest', 0, 1, 0.5), T('rest', 1, 0, 1), T('note', 1, 1)];
    const r = computeTapDurations(targets, [0, 3000], { bpm: 60, quantize: false });
    expect(beatsOf(r)).toEqual([1.5, 1]);
  });

  it('rests longer than the interval clamp to the minimum', () => {
    const targets = [T('note', 0, 0), T('rest', 0, 1, 4), T('note', 0, 2)];
    expect(beatsOf(computeTapDurations(targets, [0, 1000], { bpm: 60, quantize: true }))).toEqual([
      0.25, 1,
    ]);
    expect(beatsOf(computeTapDurations(targets, [0, 1000], { bpm: 60, quantize: false }))).toEqual([
      0.0625, 1,
    ]);
  });

  it('leading / trailing rests are not part of the result', () => {
    const targets = [T('rest', 0, 0, 2), T('note', 0, 1), T('note', 0, 2), T('rest', 0, 3, 3)];
    const r = computeTapDurations(targets, [0, 750], { bpm: 60, quantize: true });
    expect(r.map((x) => x.unitIndex)).toEqual([1, 2]);
    expect(beatsOf(r)).toEqual([0.75, 1]);
  });
});

describe('computeTapDurations — last note and partial taps', () => {
  it('the last unit gets lastBeats (default 1), regardless of quantize', () => {
    expect(beatsOf(computeTapDurations(notes(2), [0, 500], { bpm: 60, quantize: true }))).toEqual([
      0.5, 1,
    ]);
    expect(
      beatsOf(computeTapDurations(notes(2), [0, 500], { bpm: 60, quantize: false, lastBeats: 4 })),
    ).toEqual([0.5, 4]);
    expect(
      beatsOf(computeTapDurations(notes(2), [0, 500], { bpm: 60, quantize: true, lastBeats: 0 })),
    ).toEqual([0.5, 1]);
  });

  it('fewer taps than targets: only tapped units, the final tapped one gets lastBeats', () => {
    const r = computeTapDurations(notes(5), [0, 2000, 2500], {
      bpm: 60,
      quantize: true,
      lastBeats: 2,
    });
    expect(r).toEqual([
      { lineIndex: 0, unitIndex: 0, beats: 2 },
      { lineIndex: 0, unitIndex: 1, beats: 0.5 },
      { lineIndex: 0, unitIndex: 2, beats: 2 },
    ]);
  });

  it('one tap → lastBeats; no taps / no tappable targets → []', () => {
    expect(computeTapDurations(notes(3), [42], { bpm: 60, quantize: true })).toEqual([
      { lineIndex: 0, unitIndex: 0, beats: 1 },
    ]);
    expect(computeTapDurations(notes(3), [], { bpm: 60, quantize: true })).toEqual([]);
    expect(computeTapDurations([T('rest', 0, 0)], [0, 1000], { bpm: 60, quantize: true })).toEqual(
      [],
    );
    expect(computeTapDurations([], [0], { bpm: 60, quantize: true })).toEqual([]);
  });

  it('extra taps beyond the targets are ignored', () => {
    const r = computeTapDurations(notes(2), [0, 1000, 5000, 9000], { bpm: 60, quantize: true });
    expect(beatsOf(r)).toEqual([1, 1]);
  });

  it('non-finite tap times leave the unit at lastBeats', () => {
    const r = computeTapDurations(notes(3), [0, Number.NaN, 2000], { bpm: 60, quantize: true });
    expect(beatsOf(r)).toEqual([1, 1, 1]);
  });

  it('a skipped line between two targets (whole-song @repeat) ends a segment → lastBeats', () => {
    const targets = [T('note', 0, 0), T('note', 0, 1), T('note', 4, 0), T('note', 4, 1)];
    const r = computeTapDurations(targets, [0, 500, 60000, 60250], {
      bpm: 60,
      quantize: true,
      lastBeats: 1.5,
    });
    expect(beatsOf(r)).toEqual([0.5, 1.5, 0.25, 1.5]);
  });

  it('a slur is one tap and gets the whole interval', () => {
    const targets: TapTarget[] = [{ ...T('slur', 0, 0, 1), label: 'X-C' }, T('note', 0, 1)];
    expect(beatsOf(computeTapDurations(targets, [0, 2000], { bpm: 60, quantize: true }))).toEqual([
      2, 1,
    ]);
  });
});

describe('TapSession', () => {
  const targets = [
    T('rest', 0, 0),
    T('note', 0, 1),
    T('rest', 0, 2),
    T('slur', 0, 3),
    T('note', 1, 0),
  ];

  it('walks the tappable targets, skipping rests', () => {
    const s = new TapSession(targets);
    expect([s.index, s.count, s.total, s.done]).toEqual([1, 0, 3, false]);
    s.tap(100);
    expect(s.index).toBe(3);
    s.tap(600);
    expect(s.index).toBe(4);
    s.tap(900);
    expect([s.index, s.count, s.done]).toEqual([5, 3, true]);
    expect(s.taps()).toEqual([100, 600, 900]);
  });

  it('ignores taps once done', () => {
    const s = new TapSession(targets);
    for (const t of [0, 1, 2, 3, 4]) s.tap(t * 100);
    expect(s.taps()).toEqual([0, 100, 200]);
  });

  it('undo removes the last tap and goes back one target; undo on empty is a no-op', () => {
    const s = new TapSession(targets);
    s.undo();
    expect(s.index).toBe(1);
    s.tap(10);
    s.tap(20);
    s.undo();
    expect(s.index).toBe(3);
    expect(s.taps()).toEqual([10]);
    s.tap(30);
    expect(s.taps()).toEqual([10, 30]);
  });

  it('undo after done reopens the session', () => {
    const s = new TapSession(targets);
    s.tap(1);
    s.tap(2);
    s.tap(3);
    s.undo();
    expect([s.done, s.index]).toEqual([false, 4]);
  });

  it('reset clears every tap', () => {
    const s = new TapSession(targets);
    s.tap(1);
    s.tap(2);
    s.reset();
    expect([s.index, s.count, s.done]).toEqual([1, 0, false]);
    expect(s.taps()).toEqual([]);
  });

  it('ignores non-finite times and clamps times going backwards', () => {
    const s = new TapSession(targets);
    s.tap(Number.NaN);
    s.tap(Number.POSITIVE_INFINITY);
    expect(s.count).toBe(0);
    s.tap(500);
    s.tap(400);
    expect(s.taps()).toEqual([500, 500]);
  });

  it('taps() is a snapshot', () => {
    const s = new TapSession(targets);
    s.tap(1);
    const snap = s.taps();
    s.tap(2);
    expect(snap).toEqual([1]);
  });

  it('no tappable targets → done immediately, index = targets.length', () => {
    const s = new TapSession([T('rest', 0, 0), T('rest', 0, 1)]);
    expect([s.done, s.index, s.total]).toEqual([true, 2, 0]);
    s.tap(5);
    expect(s.taps()).toEqual([]);
    expect(new TapSession([]).done).toBe(true);
  });

  it('feeds computeTapDurations directly', () => {
    const s = new TapSession(targets);
    s.tap(0);
    s.tap(2000);
    s.tap(2500);
    const r = computeTapDurations(targets, s.taps(), { bpm: 60, quantize: true });
    // rest (1 beat) giữa unit 1 và cụm luyến bị trừ khỏi khoảng 2 beat
    expect(r).toEqual([
      { lineIndex: 0, unitIndex: 1, beats: 1 },
      { lineIndex: 0, unitIndex: 3, beats: 0.5 },
      { lineIndex: 1, unitIndex: 0, beats: 1 },
    ]);
  });
});
