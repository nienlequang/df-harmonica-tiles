import { describe, expect, it } from 'vitest';
import seedQuocCa from '../library/seeds/quoc-ca-viet-nam.harm?raw';
import seedTakediskrush from '../library/seeds/takediskrush.harm?raw';
// Hai bài tự soạn chỉ dùng cho test (src/test/fixtures/, app không import).
import seed1 from '../test/fixtures/bai-thu-nhip-dieu.harm?raw';
import seed2 from '../test/fixtures/bai-thu-lap-doan.harm?raw';
import type { Melody, MelodyEvent } from './melody';
import { melodyPitches } from './melody';
import { melodyToHarm, melodyToSong, songToMelody } from './melodyBuild';
import type { Placement } from './optimizer';
import { evaluateTranspose, optimizeTranspose } from './optimizer';
import { parseHarm } from './parser';
import { serializeHarm } from './serializer';
import { songStats } from './stats';
import { buildTimeline } from './timeline';
import type { Line, Note, ScrollDir, Song, Unit } from './types';

function note(key: Note['key'], beats = 1, octave: Note['octave'] = 0, sharp = false): Note {
  return { kind: 'note', key, octave, sharp, beats };
}

function melodyOf(lines: { events: MelodyEvent[] }[], name = 'A'): Melody {
  return { title: 'Thử', bpm: 90, timeSig: { num: 4, den: 4 }, sections: [{ name, lines }] };
}

function place(m: Melody, t = 0, fold = false): Placement {
  const p = evaluateTranspose(melodyPitches(m), t, { fold });
  expect(p).not.toBeNull();
  return p as Placement;
}

function allLines(song: Song): Line[] {
  return song.sections.flatMap((s) => s.lines);
}

describe('melodyToSong', () => {
  const melody: Melody = {
    title: 'Bài thử',
    artist: 'Ai đó',
    bpm: 100,
    timeSig: { num: 3, den: 4 },
    sections: [
      {
        name: 'A',
        lines: [
          {
            events: [
              { midi: 60, beats: 1 },
              { midi: null, beats: 0.5 },
              { midi: 74, beats: 0.5 },
              { midi: 76, beats: 0.5 },
            ],
          },
          { events: [{ midi: 62, beats: 2 }] },
          { events: [{ midi: 64, beats: 1 }] },
        ],
      },
      { name: 'Trống', lines: [] },
    ],
  };

  it('maps events → units with the placement choices, keeps sections / lines / metadata', () => {
    const song = melodyToSong(melody, place(melody));
    expect(song).toEqual({
      id: '',
      title: 'Bài thử',
      artist: 'Ai đó',
      bpm: 100,
      timeSig: { num: 3, den: 4 },
      scrollDir: 1,
      sections: [
        {
          name: 'A',
          lines: [
            {
              units: [
                note('Z'),
                { kind: 'rest', beats: 0.5 },
                note('X', 0.5, 1),
                note('C', 0.5, 1),
              ],
            },
            { units: [note('X', 2)] },
            { units: [note('C')] },
          ],
        },
        { name: 'Trống', lines: [] },
      ],
    });
    expect(allLines(song).every((l) => !('lyric' in (l as Line)))).toBe(true);
  });

  it('applies id / scrollDir options and does not share timeSig with the melody', () => {
    const song = melodyToSong(melody, place(melody), { id: 'abc', scrollDir: -1 });
    expect(song.id).toBe('abc');
    expect(song.scrollDir).toBe(-1);
    expect(song.timeSig).not.toBe(melody.timeSig);
  });

  it('omits artist when missing or blank', () => {
    const m: Melody = {
      ...melodyOf([{ events: [{ midi: 60, beats: 1 }] }]),
      artist: '  ',
    };
    const song = melodyToSong(m, place(m));
    expect('artist' in song).toBe(false);
    expect(song.sections[0]?.lines[0]).toEqual({ units: [note('Z')] });
  });

  it('groups consecutive notes with the same slurId and equal beats into a Slur', () => {
    const m = melodyOf([
      {
        events: [
          { midi: 60, beats: 0.5, slurId: 1 },
          { midi: 62, beats: 0.5, slurId: 1 },
          { midi: 64, beats: 0.5, slurId: 1 },
          // cùng slurId nhưng beats khác → nốt rời
          { midi: 65, beats: 1, slurId: 2 },
          { midi: 67, beats: 0.5, slurId: 2 },
          // slurId chỉ 1 nốt → nốt rời
          { midi: 69, beats: 1, slurId: 3 },
          // rest ngắt nhóm (kể cả rest mang slurId)
          { midi: 71, beats: 0.5, slurId: 4 },
          { midi: null, beats: 1, slurId: 4 },
          { midi: 72, beats: 0.5, slurId: 4 },
          // hai luyến liền nhau khác slurId
          { midi: 62, beats: 0.25, slurId: 5 },
          { midi: 64, beats: 0.25, slurId: 5 },
          { midi: 65, beats: 0.25, slurId: 6 },
          { midi: 67, beats: 0.25, slurId: 6 },
          // không có slurId → nốt rời dù beats bằng nhau
          { midi: 60, beats: 0.5 },
          { midi: 60, beats: 0.5 },
        ],
      },
    ]);
    const units: Unit[] = allLines(melodyToSong(m, place(m)))[0]?.units ?? [];
    expect(units).toEqual([
      { kind: 'slur', notes: [note('Z', 0.5), note('X', 0.5), note('C', 0.5)] },
      note('V', 1),
      note('B', 0.5),
      note('N', 1),
      note('M', 0.5),
      { kind: 'rest', beats: 1 },
      note(',', 0.5),
      { kind: 'slur', notes: [note('X', 0.25), note('C', 0.25)] },
      { kind: 'slur', notes: [note('V', 0.25), note('B', 0.25)] },
      note('Z', 0.5),
      note('Z', 0.5),
    ]);
  });

  it('drops lines without events (D-013) but keeps all-rest lines and empty sections', () => {
    const m = melodyOf([
      { events: [] },
      { events: [{ midi: null, beats: 2 }] },
      { events: [{ midi: 60, beats: 1 }] },
    ]);
    const song = melodyToSong(m, place(m));
    expect(song.sections[0]?.lines).toEqual([
      { units: [{ kind: 'rest', beats: 2 }] },
      { units: [note('Z')] },
    ]);
  });

  it('empty melody → song without sections; all-rest melody → rest lines', () => {
    const empty: Melody = { title: '', bpm: 90, timeSig: { num: 4, den: 4 }, sections: [] };
    expect(melodyToSong(empty, place(empty)).sections).toEqual([]);
    const rests = melodyOf([
      {
        events: [
          { midi: null, beats: 1 },
          { midi: null, beats: 0.5 },
        ],
      },
    ]);
    expect(allLines(melodyToSong(rests, place(rests)))).toEqual([
      {
        units: [
          { kind: 'rest', beats: 1 },
          { kind: 'rest', beats: 0.5 },
        ],
      },
    ]);
  });

  it('throws RangeError when the placement does not match the melody', () => {
    const m = melodyOf([
      {
        events: [
          { midi: 60, beats: 1 },
          { midi: 62, beats: 1 },
        ],
      },
    ]);
    const p = place(m);
    expect(() => melodyToSong(m, { ...p, choices: p.choices.slice(1) })).toThrow(RangeError);
    expect(() => melodyToSong(m, { ...p, choices: [p.choices[0] ?? null, null] })).toThrow(
      RangeError,
    );
    expect(() => melodyToHarm(m, { ...p, choices: [] })).toThrow(RangeError);
  });

  it('throws RangeError for non-positive or non-finite beats', () => {
    for (const beats of [0, -1, Number.NaN, Infinity]) {
      const m = melodyOf([
        {
          events: [
            { midi: 60, beats: 1 },
            { midi: null, beats },
          ],
        },
      ]);
      expect(() => melodyToSong(m, place(m))).toThrow(RangeError);
    }
  });

  it('a rest event with a (stray) choice is still a rest', () => {
    const m = melodyOf([{ events: [{ midi: null, beats: 1 }] }]);
    const p: Placement = { ...place(m), choices: [{ key: 'Z', octave: 0, sharp: false }] };
    expect(allLines(melodyToSong(m, p))[0]?.units).toEqual([{ kind: 'rest', beats: 1 }]);
  });
});

describe('melodyToHarm', () => {
  it('equals serializeHarm(melodyToSong(...)) when there is nothing to warn about', () => {
    const m = melodyOf([
      {
        events: [
          { midi: 60, beats: 1 },
          { midi: 74, beats: 1 },
        ],
      },
    ]);
    const p = place(m);
    expect(melodyToHarm(m, p, { id: 'x' })).toBe(serializeHarm(melodyToSong(m, p, { id: 'x' })));
  });

  // dòng 1: 1 nốt gập; dòng 2: không; dòng 3: 2 nốt gập + cảnh báo riêng của event
  const folded = melodyOf(
    [
      {
        events: [
          { midi: 40, beats: 1 },
          { midi: 60, beats: 1 },
        ],
      },
      { events: [{ midi: 62, beats: 1 }] },
      {
        events: [
          { midi: 100, beats: 1 },
          { midi: 101, beats: 1 },
          { midi: 64, beats: 1, warning: 'nốt chồng\nbị bỏ' },
          { midi: null, beats: 1, warning: 'nốt chồng bị bỏ' },
        ],
      },
    ],
    'Phần 1',
  );
  const pf = place(folded, 0, true);

  it('inserts //! comments right above lines with folded notes or event warnings', () => {
    expect(pf.stats.foldedNotes).toBe(3);
    const harm = melodyToHarm(folded, pf);
    const plain = serializeHarm(melodyToSong(folded, pf));
    const lines = harm.split('\n');
    // bỏ comment → đúng văn bản serializer
    expect(lines.filter((l) => !l.startsWith('//!')).join('\n')).toBe(plain);

    const r = parseHarm(harm);
    expect(r.ok).toBe(true);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const ann = r.diagnostics.filter((d) => d.code === 'annotation');
    expect(ann.map((d) => [d.line, d.params?.text])).toEqual([
      [(r.lineSpans[0]?.line ?? 0) - 1, 'Có 1 nốt bị gập quãng cho vừa tầm C3–C6'],
      [(r.lineSpans[2]?.line ?? 0) - 2, 'Có 2 nốt bị gập quãng cho vừa tầm C3–C6'],
      [(r.lineSpans[2]?.line ?? 0) - 1, 'nốt chồng bị bỏ'],
    ]);
    // không có cảnh báo nào khác (chỉ annotation)
    expect(
      r.diagnostics.filter((d) => d.severity === 'warning' && d.code !== 'annotation'),
    ).toEqual([]);
    // model đọc lại = melodyToSong
    expect(r.song).toEqual(melodyToSong(folded, pf));
    expect(harm.endsWith('\n')).toBe(true);
  });

  it('first line of a section: the comment goes between the header and the line', () => {
    const lines = melodyToHarm(folded, pf).split('\n');
    const h = lines.indexOf('# Phần 1');
    expect(lines[h + 1]).toBe('//! Có 1 nốt bị gập quãng cho vừa tầm C3–C6');
  });

  it('custom warningText and baseOctave-aware default text', () => {
    const custom = melodyToHarm(folded, pf, { warningText: (n) => `${n} folded` });
    expect(custom).toContain('//! 1 folded\n');
    expect(custom).toContain('//! 2 folded\n//! nốt chồng bị bỏ\n');
    const p5 = evaluateTranspose(melodyPitches(folded), 0, { fold: true, baseOctave: 5 });
    expect(p5).not.toBeNull();
    const harm5 = melodyToHarm(folded, p5 as Placement, { baseOctave: 5 });
    expect(harm5).toContain('cho vừa tầm C4–C7');
    // câu cảnh báo rỗng thì không chèn
    const empty = melodyToHarm(folded, pf, { warningText: () => '  ' });
    expect(empty).not.toContain('gập');
    expect(empty.match(/^\/\/!/gm)).toHaveLength(1);
  });

  it('a warning on a rest-only line is still shown', () => {
    const m = melodyOf([
      { events: [{ midi: 60, beats: 1 }] },
      { events: [{ midi: null, beats: 1, warning: 'nghỉ lạ' }] },
    ]);
    const harm = melodyToHarm(m, place(m));
    const r = parseHarm(harm);
    const ann = r.diagnostics.filter((d) => d.code === 'annotation');
    expect(ann).toHaveLength(1);
    expect(ann[0]?.line).toBe((r.lineSpans[1]?.line ?? 0) - 1);
  });
});

describe('songToMelody', () => {
  const src = [
    '@title T',
    '@artist A',
    '@bpm 120',
    '@time 3/4',
    '# Một',
    'Z*2 _*.5 X-C*2',
    'R:Z S:V LS:N',
    '# Hai',
    'C-V N-M',
  ].join('\n');
  const song = parseHarm(src).song;

  it('maps notes via noteMidi, rests to null, slur notes share a slurId', () => {
    const m = songToMelody(song, { baseOctave: 4, scrollDir: 1 });
    expect(m).toEqual({
      title: 'T',
      artist: 'A',
      bpm: 120,
      timeSig: { num: 3, den: 4 },
      sections: [
        {
          name: 'Một',
          lines: [
            {
              events: [
                { midi: 60, beats: 2 },
                { midi: null, beats: 0.5 },
                { midi: 62, beats: 1, slurId: 0 },
                { midi: 64, beats: 1, slurId: 0 },
              ],
            },
            {
              events: [
                { midi: 72, beats: 1 },
                { midi: 66, beats: 1 },
                { midi: 58, beats: 1 },
              ],
            },
          ],
        },
        {
          name: 'Hai',
          lines: [
            {
              events: [
                { midi: 64, beats: 0.5, slurId: 1 },
                { midi: 65, beats: 0.5, slurId: 1 },
                { midi: 69, beats: 0.5, slurId: 2 },
                { midi: 71, beats: 0.5, slurId: 2 },
              ],
            },
          ],
        },
      ],
    });
  });

  it('follows baseOctave and scrollDir', () => {
    const m = songToMelody(song, { baseOctave: 5, scrollDir: -1 });
    expect(melodyPitches(m)).toEqual([72, null, 74, 76, 84, 76, 68, 76, 77, 81, 83]);
    const m3 = songToMelody(song, { baseOctave: 3, scrollDir: 1 });
    expect(melodyPitches(m3)[0]).toBe(48);
  });

  it('1-note slur → plain event, empty slur skipped, no artist key when missing', () => {
    const s: Song = {
      id: '',
      title: 'x',
      bpm: 90,
      timeSig: { num: 4, den: 4 },
      scrollDir: 1,
      sections: [
        {
          name: 'Main',
          lines: [
            {
              units: [
                { kind: 'slur', notes: [note('Z', 0.5)] },
                { kind: 'slur', notes: [] },
              ],
            },
          ],
        },
      ],
    };
    const m = songToMelody(s, { baseOctave: 4, scrollDir: 1 });
    expect('artist' in m).toBe(false);
    expect(m.sections[0]?.lines[0]).toEqual({ events: [{ midi: 60, beats: 0.5 }] });
  });
});

describe('round trip: songToMelody → evaluateTranspose(…, 0) → melodyToSong', () => {
  const seeds = [
    ['quoc-ca-viet-nam', seedQuocCa],
    ['takediskrush', seedTakediskrush],
    ['bai-thu-nhip-dieu', seed1],
    ['bai-thu-lap-doan', seed2],
  ] as const;
  const variants: { baseOctave: number; scrollDir: ScrollDir }[] = [
    { baseOctave: 4, scrollDir: 1 },
    { baseOctave: 4, scrollDir: -1 },
    { baseOctave: 3, scrollDir: 1 },
    { baseOctave: 5, scrollDir: -1 },
  ];

  for (const [name, text] of seeds) {
    for (const v of variants) {
      it(`${name} (base ${v.baseOctave}, scroll ${v.scrollDir}) reproduces pitches exactly`, () => {
        const original = parseHarm(text).song;
        const melody = songToMelody(original, v);
        const pitches = melodyPitches(melody);
        const p = evaluateTranspose(pitches, 0, v);
        expect(p).not.toBeNull();
        const placement = p as Placement;
        const song = melodyToSong(melody, placement, { id: original.id, scrollDir: v.scrollDir });

        // cao độ + vị trí rest giống hệt
        expect(melodyPitches(songToMelody(song, v))).toEqual(pitches);
        const a = buildTimeline(original, v);
        const b = buildTimeline(song, { baseOctave: v.baseOctave });
        expect(b.notes.map((n) => [n.midi, n.startBeat, n.endBeat])).toEqual(
          a.notes.map((n) => [n.midi, n.startBeat, n.endBeat]),
        );
        expect(b.totalBeats).toBe(a.totalBeats);
        // cấu trúc: section, số dòng, loại unit (luyến giữ nguyên)
        expect(song.sections.map((s) => s.name)).toEqual(original.sections.map((s) => s.name));
        expect(allLines(song)).toHaveLength(allLines(original).length);
        expect(allLines(song).map((l) => l.units.map((u) => u.kind))).toEqual(
          allLines(original).map((l) => l.units.map((u) => u.kind)),
        );
        // thống kê optimizer khớp định nghĩa hold run của timeline
        const st = songStats(b);
        expect(st.noteCount).toBe(placement.stats.noteCount);
        expect(st.holdRunCount).toBe(placement.stats.holdRuns);
        expect(st.scrollNoteCount).toBe(placement.stats.scrollNotes);
        expect(st.modifiedNoteCount).toBe(placement.stats.modifiedNotes);

        // .harm sinh ra parse lại sạch, đúng model
        const harm = melodyToHarm(melody, placement, { id: original.id, scrollDir: v.scrollDir });
        const r = parseHarm(harm, { id: original.id });
        expect(r.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
        expect(r.song).toEqual(song);
      });
    }
  }

  it('optimized placements of seed 2 also keep the timing and line structure', () => {
    const original = parseHarm(seed2).song;
    const melody = songToMelody(original, { baseOctave: 4, scrollDir: 1 });
    for (const p of optimizeTranspose(melodyPitches(melody))) {
      const song = melodyToSong(melody, p);
      const a = buildTimeline(original);
      const b = buildTimeline(song);
      expect(b.notes.map((n) => n.midi - p.transpose)).toEqual(a.notes.map((n) => n.midi));
      expect(allLines(song).map((l) => l.units.length)).toEqual(
        allLines(original).map((l) => l.units.length),
      );
    }
  });
});
