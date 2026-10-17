import { describe, expect, it } from 'vitest';
import { buildTimeline } from './timeline';
import type { Line, Note, NoteKey, Octave, Rest, Section, Slur, Song, Unit } from './types';

// Model dựng tay — không phụ thuộc parser.
const n = (key: NoteKey, beats = 1, octave: Octave = 0, sharp = false): Note => ({
  kind: 'note',
  key,
  octave,
  sharp,
  beats,
});
const L = (key: NoteKey, beats = 1): Note => n(key, beats, -1);
const R = (key: NoteKey, beats = 1): Note => n(key, beats, 1);
const S = (key: NoteKey, beats = 1): Note => n(key, beats, 0, true);
const RS = (key: NoteKey, beats = 1): Note => n(key, beats, 1, true);
const rest = (beats = 1): Rest => ({ kind: 'rest', beats });
const slur = (...notes: Note[]): Slur => ({ kind: 'slur', notes });
const line = (units: Unit[]): Line => ({ units });
const sec = (name: string, ...lines: Line[]): Section => ({ name, lines });
const song = (sections: Section[], extra: Partial<Song> = {}): Song => ({
  id: 't',
  title: 'Test',
  bpm: 120,
  timeSig: { num: 4, den: 4 },
  scrollDir: 1,
  sections,
  ...extra,
});
const oneLine = (...units: Unit[]): Song => song([sec('Main', line(units))]);

describe('buildTimeline — beats', () => {
  it('returns an empty timeline for a song without sections', () => {
    const tl = buildTimeline(song([]));
    expect(tl.notes).toEqual([]);
    expect(tl.lines).toEqual([]);
    expect(tl.sections).toEqual([]);
    expect(tl.holdRuns).toEqual([]);
    expect(tl.totalBeats).toBe(0);
    expect(tl.beatsPerBar).toBe(4);
    expect(tl.baseOctave).toBe(4);
    expect(tl.scrollDir).toBe(1);
    expect(tl.bpm).toBe(120);
  });

  it('advances the cursor over notes, rests and sequential slur notes', () => {
    const tl = buildTimeline(oneLine(n('Z'), rest(0.5), slur(n('X', 0.5), n('C', 0.5)), n('V', 2)));
    expect(tl.notes.map((x) => [x.key, x.startBeat, x.endBeat, x.unitIndex])).toEqual([
      ['Z', 0, 1, 0],
      ['X', 1.5, 2, 2],
      ['C', 2, 2.5, 2],
      ['V', 2.5, 4.5, 3],
    ]);
    expect(tl.notes.map((x) => x.index)).toEqual([0, 1, 2, 3]);
    expect(tl.totalBeats).toBe(4.5);
  });

  it('counts leading and trailing rests in line, section and total length', () => {
    const tl = buildTimeline(
      song([sec('A', line([rest(1), n('Z')]), line([n('X', 2), rest(0.5)]))]),
    );
    expect(tl.notes.map((x) => [x.startBeat, x.endBeat])).toEqual([
      [1, 2],
      [2, 4],
    ]);
    expect(tl.lines.map((l) => [l.startBeat, l.endBeat])).toEqual([
      [0, 2],
      [2, 4.5],
    ]);
    expect(tl.sections[0]).toMatchObject({ startBeat: 0, endBeat: 4.5 });
    expect(tl.totalBeats).toBe(4.5);
  });

  it('handles a slur with three notes and keeps 2000+ notes O(n)', () => {
    const tl = buildTimeline(oneLine(slur(n('Z', 1 / 3), n('X', 1 / 3), n('C', 1 / 3))));
    expect(tl.notes).toHaveLength(3);
    expect(tl.totalBeats).toBeCloseTo(1, 10);

    const lines: Line[] = [];
    for (let i = 0; i < 500; i++) {
      lines.push(line([n('Z', 0.5), R('X', 0.5), slur(n('C', 0.25), n('V', 0.25)), rest(0.5)]));
    }
    const t0 = performance.now();
    const big = buildTimeline(song([sec('Big', ...lines)]));
    const elapsed = performance.now() - t0;
    expect(big.notes).toHaveLength(2000);
    expect(big.holdRuns).toHaveLength(500);
    expect(big.totalBeats).toBe(1000);
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('buildTimeline — midi & modifiers', () => {
  const combos: [Octave, boolean][] = [
    [0, false],
    [-1, false],
    [1, false],
    [0, true],
    [-1, true],
    [1, true],
  ];

  it('computes midi for every modifier combo with baseOctave 3, 4 and 5', () => {
    for (const baseOctave of [3, 4, 5]) {
      const units = combos.map(([o, s]) => n('N', 1, o, s));
      const tl = buildTimeline(oneLine(...units), { baseOctave });
      const base = 12 * (baseOctave + 1) + 9;
      expect(tl.baseOctave).toBe(baseOctave);
      expect(tl.notes.map((x) => x.midi)).toEqual([
        base,
        base - 12,
        base + 12,
        base + 1,
        base - 11,
        base + 13,
      ]);
    }
    // Giá trị tuyệt đối với baseOctave mặc định 4 (Z = C4 = 60).
    const tl = buildTimeline(oneLine(n('Z'), L('Z'), R(','), S('N'), RS('M')));
    expect(tl.notes.map((x) => x.midi)).toEqual([60, 48, 84, 70, 84]);
  });

  it('sets modifiers per note', () => {
    const tl = buildTimeline(oneLine(...combos.map(([o, s]) => n('B', 1, o, s))));
    expect(tl.notes.map((x) => x.modifiers)).toEqual([
      { left: false, right: false, scroll: false },
      { left: true, right: false, scroll: false },
      { left: false, right: true, scroll: false },
      { left: false, right: false, scroll: true },
      { left: true, right: false, scroll: true },
      { left: false, right: true, scroll: true },
    ]);
    expect(tl.notes.map((x) => [x.octave, x.sharp])).toEqual(combos);
  });

  it('uses song.scrollDir unless overridden', () => {
    const down = song([sec('A', line([S('N'), RS('Z')]))], { scrollDir: -1 });
    const tlSong = buildTimeline(down);
    expect(tlSong.scrollDir).toBe(-1);
    expect(tlSong.notes.map((x) => x.midi)).toEqual([68, 71]);

    const tlOverride = buildTimeline(down, { scrollDir: 1 });
    expect(tlOverride.scrollDir).toBe(1);
    expect(tlOverride.notes.map((x) => x.midi)).toEqual([70, 73]);

    const up = song([sec('A', line([S('N')]))], { scrollDir: 1 });
    expect(buildTimeline(up).notes[0].midi).toBe(70);
    expect(buildTimeline(up, { scrollDir: -1 }).notes[0].midi).toBe(68);
  });
});

describe('buildTimeline — lines, slurs', () => {
  it('lines and notes carry no lyric / karaoke fields (lyrics removed)', () => {
    const tl = buildTimeline(oneLine(n('Z'), rest(), slur(n('X', 0.5), n('C', 0.5)), n('V')));
    expect(Object.keys(tl.lines[0]).sort()).toEqual([
      'endBeat',
      'firstNote',
      'index',
      'noteCount',
      'sectionIndex',
      'startBeat',
    ]);
    expect(tl.notes.every((x) => !('syllableIndex' in x))).toBe(true);
    expect(tl.notes.map((x) => x.unitIndex)).toEqual([0, 2, 2, 3]);
  });

  it('numbers slurs globally and records pos/count', () => {
    const tl = buildTimeline(
      song([
        sec('A', line([slur(n('Z', 0.5), n('X', 0.5)), n('C')])),
        sec(
          'B',
          line([n('V'), slur(n('B', 0.5), n('N', 0.5))]),
          line([slur(n('M', 0.25), n(',', 0.25), n('Z', 0.5))]),
        ),
      ]),
    );
    expect(tl.notes.map((x) => x.slur)).toEqual([
      { id: 0, pos: 0, count: 2 },
      { id: 0, pos: 1, count: 2 },
      null,
      null,
      { id: 1, pos: 0, count: 2 },
      { id: 1, pos: 1, count: 2 },
      { id: 2, pos: 0, count: 3 },
      { id: 2, pos: 1, count: 3 },
      { id: 2, pos: 2, count: 3 },
    ]);
  });

  it('fills line indices, firstNote and noteCount (all-rest line points at the next note)', () => {
    const tl = buildTimeline(
      song([sec('A', line([n('Z'), n('X')]), line([rest(2)])), sec('B', line([n('C')]), line([]))]),
    );
    expect(
      tl.lines.map((l) => [
        l.index,
        l.sectionIndex,
        l.firstNote,
        l.noteCount,
        l.startBeat,
        l.endBeat,
      ]),
    ).toEqual([
      [0, 0, 0, 2, 0, 2],
      [1, 0, 2, 0, 2, 4],
      [2, 1, 2, 1, 4, 5],
      [3, 1, 3, 0, 5, 5],
    ]);
    expect(tl.notes.map((x) => [x.lineIndex, x.sectionIndex])).toEqual([
      [0, 0],
      [0, 0],
      [2, 1],
    ]);
  });
});

describe('buildTimeline — sections', () => {
  it('keeps empty sections with start = end = cursor', () => {
    const tl = buildTimeline(
      song([
        sec('Intro'),
        sec('A', line([n('Z'), n('X')])),
        sec('RAP'),
        sec('B', line([n('C', 2)]), line([n('V')])),
        sec('Outro'),
      ]),
    );
    expect(
      tl.sections.map((s) => [s.index, s.name, s.startBeat, s.endBeat, s.firstLine, s.lineCount]),
    ).toEqual([
      [0, 'Intro', 0, 0, 0, 0],
      [1, 'A', 0, 2, 0, 1],
      [2, 'RAP', 2, 2, 1, 0],
      [3, 'B', 2, 5, 1, 2],
      [4, 'Outro', 5, 5, 3, 0],
    ]);
    expect(tl.totalBeats).toBe(5);
  });

  it('computes beatsPerBar from the time signature and copies metadata', () => {
    const ts = { num: 3, den: 4 };
    const s = song([], { bpm: 76, timeSig: ts, scrollDir: -1 });
    const tl = buildTimeline(s);
    expect(tl.beatsPerBar).toBe(3);
    expect(tl.timeSig).toEqual(ts);
    expect(tl.bpm).toBe(76);
    expect(tl.scrollDir).toBe(-1);
    expect(buildTimeline(song([], { timeSig: { num: 4, den: 4 } })).beatsPerBar).toBe(4);
    expect(buildTimeline(song([], { timeSig: { num: 6, den: 8 } })).beatsPerBar).toBe(3);
    expect(buildTimeline(song([], { timeSig: { num: 2, den: 2 } })).beatsPerBar).toBe(4);
  });
});

describe('buildTimeline — hold runs', () => {
  it('plain notes have no run', () => {
    const tl = buildTimeline(oneLine(n('Z'), n('X'), slur(n('C'), n('V'))));
    expect(tl.holdRuns).toEqual([]);
    expect(tl.notes.every((x) => x.runIndex === null)).toBe(true);
  });

  it('same modifier across a line break and a section break is one run', () => {
    const tl = buildTimeline(
      song([
        sec('A', line([n('Z'), R('N'), R('B', 0.5)]), line([R('C', 2)])),
        sec('B', line([R('V')]), line([n('X')])),
      ]),
    );
    expect(tl.holdRuns).toEqual([
      {
        index: 0,
        octave: 1,
        sharp: false,
        modifiers: { left: false, right: true, scroll: false },
        startBeat: 1,
        endBeat: 5.5,
        firstNote: 1,
        noteCount: 4,
      },
    ]);
    expect(tl.notes.map((x) => x.runIndex)).toEqual([null, 0, 0, 0, 0, null]);
  });

  it('a rest breaks the run, also across lines', () => {
    const tl = buildTimeline(
      song([sec('A', line([R('N'), rest(0.5), R('N')]), line([rest(), R('B')]))]),
    );
    expect(tl.holdRuns.map((r) => [r.startBeat, r.endBeat, r.firstNote, r.noteCount])).toEqual([
      [0, 1, 0, 1],
      [1.5, 2.5, 1, 1],
      [3.5, 4.5, 2, 1],
    ]);
    expect(tl.notes.map((x) => x.runIndex)).toEqual([0, 1, 2]);
  });

  it('a plain note breaks the run', () => {
    const tl = buildTimeline(oneLine(L('N'), n('Z'), L('N')));
    expect(tl.holdRuns).toHaveLength(2);
    expect(tl.notes.map((x) => x.runIndex)).toEqual([0, null, 1]);
  });

  it('(R) then (R+sharp) then (R) is three runs', () => {
    const tl = buildTimeline(oneLine(R('Z'), R('X'), RS('C'), R('V')));
    expect(
      tl.holdRuns.map((r) => [r.octave, r.sharp, r.startBeat, r.endBeat, r.noteCount]),
    ).toEqual([
      [1, false, 0, 2, 2],
      [1, true, 2, 3, 1],
      [1, false, 3, 4, 1],
    ]);
    expect(tl.holdRuns[1].modifiers).toEqual({ left: false, right: true, scroll: true });
    expect(tl.notes.map((x) => x.runIndex)).toEqual([0, 0, 1, 2]);
  });

  it('left then right adjacent is two runs; scroll-only is its own run', () => {
    const tl = buildTimeline(oneLine(L('Z'), R('Z'), S('N'), S('N')));
    expect(tl.holdRuns.map((r) => [r.octave, r.sharp, r.firstNote, r.noteCount])).toEqual([
      [-1, false, 0, 1],
      [1, false, 1, 1],
      [0, true, 2, 2],
    ]);
  });

  it('slur notes join runs individually (Z-L:N)', () => {
    const tl = buildTimeline(oneLine(slur(n('Z', 0.5), L('N', 0.5)), L('B'), slur(L('V'), L('C'))));
    expect(tl.holdRuns).toHaveLength(1);
    expect(tl.holdRuns[0]).toMatchObject({
      startBeat: 0.5,
      endBeat: 4,
      firstNote: 1,
      noteCount: 4,
    });
    expect(tl.notes.map((x) => x.runIndex)).toEqual([null, 0, 0, 0, 0]);
  });
});
