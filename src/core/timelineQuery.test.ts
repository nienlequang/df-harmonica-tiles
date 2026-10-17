import { describe, expect, it } from 'vitest';
import { buildTimeline } from './timeline';
import {
  firstNoteEndingAfter,
  lastNoteStartingBefore,
  lineIndexAt,
  nextLineStart,
  noteIndexAt,
  prevLineStart,
  runIndexAt,
  sectionIndexAt,
} from './timelineQuery';
import type { Line, Note, NoteKey, Octave, Rest, Section, Song, Timeline, Unit } from './types';

const n = (key: NoteKey, beats = 1, octave: Octave = 0, sharp = false): Note => ({
  kind: 'note',
  key,
  octave,
  sharp,
  beats,
});
const rest = (beats = 1): Rest => ({ kind: 'rest', beats });
const line = (units: Unit[]): Line => ({ units });
const sec = (name: string, ...lines: Line[]): Section => ({ name, lines });
const song = (sections: Section[]): Song => ({
  id: 'q',
  title: 'Query',
  bpm: 120,
  timeSig: { num: 4, den: 4 },
  scrollDir: 1,
  sections,
});

/*
 * Fixture:
 *  S0 "A"
 *   line0: Z [0,1]  _ [1,2]  X [2,3]  C [3,4]
 *   line1: _ [4,5]  R:V [5,6]  R:B [6,7]            run0 [5,7]
 *  S1 "Empty"      (start = end = 7)
 *  S2 "B"
 *   line2: S:N*2 [7,9]                              run1 [7,9]
 *   line3: _ [9,10]
 *  totalBeats = 10
 */
const tl: Timeline = buildTimeline(
  song([
    sec('A', line([n('Z'), rest(), n('X'), n('C')]), line([rest(), n('V', 1, 1), n('B', 1, 1)])),
    sec('Empty'),
    sec('B', line([n('N', 2, 0, true)]), line([rest()])),
  ]),
);
const empty: Timeline = buildTimeline(song([]));

describe('timeline fixture sanity', () => {
  it('has the expected shape', () => {
    expect(tl.notes.map((x) => [x.startBeat, x.endBeat])).toEqual([
      [0, 1],
      [2, 3],
      [3, 4],
      [5, 6],
      [6, 7],
      [7, 9],
    ]);
    expect(tl.holdRuns.map((r) => [r.startBeat, r.endBeat])).toEqual([
      [5, 7],
      [7, 9],
    ]);
    expect(tl.lines.map((l) => l.startBeat)).toEqual([0, 4, 7, 9]);
    expect(tl.totalBeats).toBe(10);
  });
});

describe('noteIndexAt', () => {
  it('finds the note under the beat, -1 in gaps and outside', () => {
    const cases: [number, number][] = [
      [-1, -1],
      [0, 0],
      [0.999, 0],
      [1, -1],
      [1.5, -1],
      [2, 1],
      [3, 2],
      [3.999, 2],
      [4, -1],
      [4.5, -1],
      [5, 3],
      [6, 4],
      [7, 5],
      [8.99, 5],
      [9, -1],
      [10, -1],
      [100, -1],
    ];
    for (const [beat, expected] of cases)
      expect(noteIndexAt(tl, beat), `beat ${beat}`).toBe(expected);
  });

  it('returns -1 on an empty timeline', () => {
    expect(noteIndexAt(empty, 0)).toBe(-1);
  });
});

describe('firstNoteEndingAfter / lastNoteStartingBefore', () => {
  it('culls by end beat', () => {
    expect(firstNoteEndingAfter(tl, -5)).toBe(0);
    expect(firstNoteEndingAfter(tl, 0)).toBe(0);
    expect(firstNoteEndingAfter(tl, 0.5)).toBe(0);
    expect(firstNoteEndingAfter(tl, 1)).toBe(1);
    expect(firstNoteEndingAfter(tl, 1.5)).toBe(1);
    expect(firstNoteEndingAfter(tl, 3)).toBe(2);
    expect(firstNoteEndingAfter(tl, 8.9)).toBe(5);
    expect(firstNoteEndingAfter(tl, 9)).toBe(6);
    expect(firstNoteEndingAfter(tl, 50)).toBe(6);
    expect(firstNoteEndingAfter(empty, 0)).toBe(0);
  });

  it('finds the last note starting strictly before the beat', () => {
    expect(lastNoteStartingBefore(tl, -1)).toBe(-1);
    expect(lastNoteStartingBefore(tl, 0)).toBe(-1);
    expect(lastNoteStartingBefore(tl, 0.1)).toBe(0);
    expect(lastNoteStartingBefore(tl, 2)).toBe(0);
    expect(lastNoteStartingBefore(tl, 2.1)).toBe(1);
    expect(lastNoteStartingBefore(tl, 7)).toBe(4);
    expect(lastNoteStartingBefore(tl, 100)).toBe(5);
    expect(lastNoteStartingBefore(empty, 1)).toBe(-1);
  });
});

describe('runIndexAt', () => {
  it('matches [start, end) of hold runs', () => {
    const cases: [number, number][] = [
      [-1, -1],
      [0, -1],
      [4.99, -1],
      [5, 0],
      [6.99, 0],
      [7, 1],
      [8.5, 1],
      [9, -1],
      [20, -1],
    ];
    for (const [beat, expected] of cases)
      expect(runIndexAt(tl, beat), `beat ${beat}`).toBe(expected);
    expect(runIndexAt(empty, 0)).toBe(-1);
  });
});

describe('lineIndexAt / sectionIndexAt', () => {
  it('returns the last line started, clamped after the end', () => {
    const cases: [number, number][] = [
      [-0.1, -1],
      [0, 0],
      [3.99, 0],
      [4, 1],
      [6.99, 1],
      [7, 2],
      [9, 3],
      [10, 3],
      [50, 3],
    ];
    for (const [beat, expected] of cases)
      expect(lineIndexAt(tl, beat), `beat ${beat}`).toBe(expected);
    expect(lineIndexAt(empty, 0)).toBe(-1);
  });

  it('skips empty sections', () => {
    expect(sectionIndexAt(tl, -1)).toBe(-1);
    expect(sectionIndexAt(tl, 0)).toBe(0);
    expect(sectionIndexAt(tl, 6.99)).toBe(0);
    expect(sectionIndexAt(tl, 7)).toBe(2);
    expect(sectionIndexAt(tl, 10)).toBe(2);
    expect(sectionIndexAt(tl, 100)).toBe(2);
    expect(sectionIndexAt(empty, 0)).toBe(-1);

    const leadingEmpty = buildTimeline(
      song([sec('Intro'), sec('A', line([n('Z')])), sec('Outro')]),
    );
    expect(sectionIndexAt(leadingEmpty, 0)).toBe(1);
    expect(sectionIndexAt(leadingEmpty, 1)).toBe(1);
    expect(sectionIndexAt(leadingEmpty, 5)).toBe(1);

    const allEmpty = buildTimeline(song([sec('X'), sec('Y')]));
    expect(sectionIndexAt(allEmpty, 0)).toBe(-1);
  });
});

describe('nextLineStart / prevLineStart', () => {
  it('jumps to the next line start, totalBeats at the end', () => {
    expect(nextLineStart(tl, -1)).toBe(0);
    expect(nextLineStart(tl, 0)).toBe(4);
    expect(nextLineStart(tl, 3.9)).toBe(4);
    expect(nextLineStart(tl, 4)).toBe(7);
    expect(nextLineStart(tl, 4 - 1e-9)).toBe(7);
    expect(nextLineStart(tl, 7)).toBe(9);
    expect(nextLineStart(tl, 9)).toBe(10);
    expect(nextLineStart(tl, 9.5)).toBe(10);
    expect(nextLineStart(empty, 0)).toBe(0);
  });

  it('goes to the current line start past the threshold, else the previous line', () => {
    expect(prevLineStart(tl, -1)).toBe(0);
    expect(prevLineStart(tl, 0)).toBe(0);
    expect(prevLineStart(tl, 0.3)).toBe(0);
    expect(prevLineStart(tl, 3)).toBe(0);
    expect(prevLineStart(tl, 4)).toBe(0);
    expect(prevLineStart(tl, 4.2)).toBe(0);
    expect(prevLineStart(tl, 4.6)).toBe(4);
    expect(prevLineStart(tl, 7)).toBe(4);
    expect(prevLineStart(tl, 7.5)).toBe(4);
    expect(prevLineStart(tl, 7.51)).toBe(7);
    expect(prevLineStart(tl, 15)).toBe(9);
    expect(prevLineStart(tl, 4.01, 0)).toBe(4);
    expect(prevLineStart(tl, 4.4, 2)).toBe(0);
    expect(prevLineStart(empty, 3)).toBe(0);
  });

  it('skips zero-length lines sharing a start', () => {
    const t = buildTimeline(song([sec('A', line([n('Z')]), line([]), line([n('X')]))]));
    expect(t.lines.map((l) => l.startBeat)).toEqual([0, 1, 1]);
    expect(prevLineStart(t, 1.1)).toBe(0);
    expect(nextLineStart(t, 0)).toBe(1);
    expect(nextLineStart(t, 1)).toBe(2);
  });
});

describe('binary search agrees with a linear scan', () => {
  it('on a long irregular timeline', () => {
    const lines: Line[] = [];
    for (let i = 0; i < 60; i++) {
      const units: Unit[] = [];
      for (let j = 0; j < 5; j++) {
        const k = (i * 7 + j * 3) % 10;
        if (k === 0) units.push(rest(0.5));
        else
          units.push(
            n('Z', k % 3 === 0 ? 1.5 : 0.25 * (1 + (k % 4)), ((k % 3) - 1) as Octave, k > 7),
          );
      }
      lines.push(line(units));
    }
    const big = buildTimeline(
      song([sec('A', ...lines.slice(0, 30)), sec('B'), sec('C', ...lines.slice(30))]),
    );
    for (let beat = -1; beat <= big.totalBeats + 1; beat += 0.125) {
      const note = big.notes.findIndex((x) => x.startBeat <= beat && beat < x.endBeat);
      expect(noteIndexAt(big, beat)).toBe(note);
      const run = big.holdRuns.findIndex((r) => r.startBeat <= beat && beat < r.endBeat);
      expect(runIndexAt(big, beat)).toBe(run);
      const firstEnd = big.notes.findIndex((x) => x.endBeat > beat);
      expect(firstNoteEndingAfter(big, beat)).toBe(firstEnd === -1 ? big.notes.length : firstEnd);
      let lastStart = -1;
      big.notes.forEach((x, i) => {
        if (x.startBeat < beat) lastStart = i;
      });
      expect(lastNoteStartingBefore(big, beat)).toBe(lastStart);
      let li = -1;
      big.lines.forEach((l, i) => {
        if (l.startBeat <= beat) li = i;
      });
      expect(lineIndexAt(big, beat)).toBe(li);
    }
  });
});
