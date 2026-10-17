import { describe, expect, it } from 'vitest';
import type { Melody } from '../core/melody';
import { melodyPitches } from '../core/melody';
import { melodyToHarm } from '../core/melodyBuild';
import { optimizeTranspose } from '../core/optimizer';
import { parseHarm } from '../core/parser';
import type { ArrangeContext } from './arrange';
import {
  AUTO_SECTION_PREFIX,
  DEFAULT_ARRANGE,
  arrangeMelody,
  snapBeats,
  titleFromFileName,
} from './arrange';
import type { MonoNote } from './types';

const n = (startBeat: number, beats: number, midi = 60): MonoNote => ({ startBeat, beats, midi });

/** Chuỗi nốt đen liền nhau từ `start`. */
const quarters = (start: number, count: number, midi = 60): MonoNote[] =>
  Array.from({ length: count }, (_, i) => n(start + i, 1, midi + (i % 3)));

const ctx = (over: Partial<ArrangeContext> = {}): ArrangeContext => ({
  title: 'Bài',
  bpm: 100,
  timeSig: { num: 4, den: 4 },
  markers: [],
  grid: 0.25,
  ...over,
});

/** Dạng gọn: [tên section, các dòng "midi:beats" / "_beats"]. */
function shape(m: Melody): Array<[string, string[]]> {
  return m.sections.map((s) => [
    s.name,
    s.lines.map((l) =>
      l.events.map((e) => (e.midi === null ? `_${e.beats}` : `${e.midi}:${e.beats}`)).join(' '),
    ),
  ]);
}

/** Số dòng mỗi section và beat bắt đầu của mỗi dòng (tính từ đầu bài). */
function lineStarts(m: Melody): number[] {
  const out: number[] = [];
  let t = 0;
  for (const s of m.sections) {
    for (const l of s.lines) {
      out.push(t);
      for (const e of l.events) t += e.beats;
    }
  }
  return out;
}

describe('titleFromFileName', () => {
  it('strips the extension and turns _ / - into spaces', () => {
    expect(titleFromFileName('bai_thu-tieng viet.mid')).toBe('bai thu tieng viet');
    expect(titleFromFileName('C:\\music\\Song.MIDI')).toBe('Song');
    expect(titleFromFileName('dir/sub/My__Song--v2.kar')).toBe('My Song v2');
    expect(titleFromFileName('Mr. Lambo.mid')).toBe('Mr. Lambo');
    expect(titleFromFileName('  no extension  ')).toBe('no extension');
    expect(titleFromFileName('.mid')).toBe('');
  });
});

describe('snapBeats', () => {
  it('removes float noise near simple fractions only', () => {
    expect(snapBeats(5 * (1 / 3))).toBe(5 / 3);
    expect(snapBeats(2.0000000001)).toBe(2);
    expect(snapBeats(0.7499999999)).toBe(0.75);
    // không gần k/d nào → làm tròn 9 chữ số
    expect(snapBeats(1 - 0.9)).toBe(0.1);
    expect(snapBeats(0.1 + 0.2)).toBe(0.3);
    expect(snapBeats(0.1234567891234)).toBe(0.123456789);
    expect(snapBeats(230 / 480 + 1e-12)).toBe(23 / 48);
  });

  it('snaps every denominator up to 64 (quintuplets, septuplets) like formatBeats', () => {
    expect(snapBeats(0.142857143)).toBe(1 / 7);
    expect(snapBeats(0.142857142)).toBe(1 / 7);
    expect(snapBeats(3 * (1 / 7))).toBe(3 / 7);
    expect(snapBeats(0.2 + 1e-10)).toBe(1 / 5);
    expect(snapBeats(5 / 9 + 1e-9)).toBe(5 / 9);
    expect(snapBeats(1 / 63 + 1e-10)).toBe(1 / 63);
  });

  it('a 7-in-1-beat group keeps exact 1/7 durations', () => {
    const sept = Array.from({ length: 7 }, (_, i) => n(i / 7, 1 / 7, 60 + i));
    const m = arrangeMelody([...sept, n(1, 1, 72)], ctx({ grid: 0 }));
    expect(m.sections[0].lines[0].events.map((e) => e.beats)).toEqual([
      ...Array.from({ length: 7 }, () => 1 / 7),
      1,
    ]);
  });
});

describe('arrangeMelody — lines', () => {
  it('breaks every barsPerLine bars (default 2 bars of 4/4)', () => {
    const m = arrangeMelody(quarters(0, 16), ctx());
    expect(m.sections).toHaveLength(1);
    expect(m.sections[0].name).toBe(`${AUTO_SECTION_PREFIX} 1`);
    expect(m.sections[0].lines.map((l) => l.events.length)).toEqual([8, 8]);
    expect(lineStarts(m)).toEqual([0, 8]);
    expect(m.sections[0].lines[0]).not.toHaveProperty('lyric');
  });

  it('starts at the bar containing the first note with a leading rest', () => {
    // ô nhịp đầu = [4, 8) → dòng 1 = [4, 12)
    const m = arrangeMelody(quarters(5, 8), ctx());
    expect(shape(m)).toEqual([['Phần 1', ['_1 60:1 61:1 62:1 60:1 61:1 62:1 60:1', '61:1']]]);
    // không có rest đầu khi nốt đầu ở đúng đầu ô nhịp; nốt đầu ở beat 13 → bắt đầu từ ô nhịp 3
    expect(shape(arrangeMelody([n(13, 1)], ctx()))).toEqual([['Phần 1', ['_1 60:1']]]);
  });

  it('breaks at a rest >= breakRestBeats; the rest ends the previous line', () => {
    const notes = [...quarters(0, 3), ...quarters(4, 2), n(6.5, 1, 70)];
    expect(shape(arrangeMelody(notes, ctx()))).toEqual([
      ['Phần 1', ['60:1 61:1 62:1 _1', '60:1 61:1 _0.5 70:1']],
    ]);
  });

  it('turns gaps >= grid into rests and absorbs smaller gaps into the previous note', () => {
    const notes = [n(0, 0.9), n(1, 0.5, 62), n(1.75, 1, 64)];
    expect(shape(arrangeMelody(notes, ctx({ grid: 0.25 })))).toEqual([
      ['Phần 1', ['60:1 62:0.5 _0.25 64:1']],
    ]);
    // grid 0 (tắt quantize): mọi khoảng trống dương là rest
    expect(shape(arrangeMelody(notes, ctx({ grid: 0 })))).toEqual([
      ['Phần 1', ['60:0.9 _0.1 62:0.5 _0.25 64:1']],
    ]);
  });

  it('keeps a long note whole; the next note starts the new line', () => {
    const notes = [n(0, 6), n(6, 4, 62), n(10, 2, 64)];
    expect(shape(arrangeMelody(notes, ctx()))).toEqual([['Phần 1', ['60:6 62:4', '64:2']]]);
  });

  it('does not break right after a pickup (line starting within half a bar of a break point)', () => {
    const notes = [...quarters(0, 4), n(7.5, 0.5, 70), ...quarters(8, 8), n(16, 1, 72)];
    const m = arrangeMelody(notes, ctx());
    expect(shape(m)[0][1]).toEqual([
      '60:1 61:1 62:1 60:1 _3.5',
      '70:0.5 60:1 61:1 62:1 60:1 61:1 62:1 60:1 61:1',
      '72:1',
    ]);
    expect(lineStarts(m)).toEqual([0, 7.5, 16]);
  });

  it('uses beats per bar from the time signature (3/4, 6/8)', () => {
    const m34 = arrangeMelody(quarters(4, 8), ctx({ timeSig: { num: 3, den: 4 } }));
    expect(m34.timeSig).toEqual({ num: 3, den: 4 });
    // ô nhịp đầu = [3, 6) (rest 1 beat), dòng = 2 ô nhịp = 6 beat → dòng 2 từ beat 9 của file
    expect(lineStarts(m34)).toEqual([0, 6]);
    expect(shape(m34)[0][1]).toEqual(['_1 60:1 61:1 62:1 60:1 61:1', '62:1 60:1 61:1']);
    const m68 = arrangeMelody(quarters(0, 12), ctx({ timeSig: { num: 6, den: 8 } }));
    expect(m68.sections[0].lines.map((l) => l.events.length)).toEqual([6, 6]);
  });

  it('honors custom options and falls back to defaults for non-positive values', () => {
    const notes = [...quarters(0, 3), ...quarters(4, 6)];
    const custom = arrangeMelody(notes, ctx(), {
      breakRestBeats: 2,
      barsPerLine: 1,
      barsPerSection: 2,
    });
    expect(shape(custom)).toEqual([
      ['Phần 1', ['60:1 61:1 62:1 _1', '60:1 61:1 62:1 60:1']],
      ['Phần 2', ['61:1 62:1']],
    ]);
    const bad = arrangeMelody(notes, ctx(), {
      breakRestBeats: 0,
      barsPerLine: -1,
      barsPerSection: Number.NaN,
    });
    expect(bad).toEqual(arrangeMelody(notes, ctx(), DEFAULT_ARRANGE));
  });

  it('keeps exact triplet values (grid 1/3)', () => {
    const third = 1 / 3;
    const notes = [0, 1, 2, 3, 4, 5].map((k) => n(k * third, third, 60 + k));
    notes.push(n(2 + 2 * third, 1, 70));
    const m = arrangeMelody(notes, ctx({ grid: third }));
    const events = m.sections[0].lines[0].events;
    expect(events.slice(0, 6).map((e) => e.beats)).toEqual(Array(6).fill(1 / 3));
    expect(events[6]).toEqual({ midi: null, beats: 2 / 3 });
    expect(events[7]).toEqual({ midi: 70, beats: 1 });
  });

  it('shortens a note that overlaps the previous one (defensive)', () => {
    expect(shape(arrangeMelody([n(0, 2), n(1, 2, 62)], ctx()))).toEqual([
      ['Phần 1', ['60:2 62:1']],
    ]);
  });

  it('ignores invalid notes and returns no sections for an empty melody', () => {
    const empty = arrangeMelody([n(Number.NaN, 1), n(0, 0), n(1, -1)], ctx());
    expect(empty).toEqual({ title: 'Bài', bpm: 100, timeSig: { num: 4, den: 4 }, sections: [] });
  });
});

describe('arrangeMelody — sections', () => {
  it('makes a "Phần N" section every barsPerSection bars', () => {
    const m = arrangeMelody(quarters(0, 40), ctx());
    expect(m.sections.map((s) => [s.name, s.lines.length])).toEqual([
      ['Phần 1', 4],
      ['Phần 2', 1],
    ]);
  });

  it('puts a pickup line into the section it leads into; numbers sections in order', () => {
    const notes = [...quarters(0, 28), n(31.5, 0.5, 70), ...quarters(32, 4)];
    const m = arrangeMelody(notes, ctx());
    expect(m.sections.map((s) => [s.name, s.lines.length])).toEqual([
      ['Phần 1', 4],
      ['Phần 2', 1],
    ]);
    expect(m.sections[1].lines[0].events[0]).toEqual({ midi: 70, beats: 0.5 });
    // 8 ô nhịp trống ở giữa: section rỗng bị bỏ, đánh số liền
    const gap = arrangeMelody([...quarters(0, 4), ...quarters(64, 4)], ctx());
    expect(gap.sections.map((s) => s.name)).toEqual(['Phần 1', 'Phần 2']);
  });

  it('names sections from markers and breaks lines at marker positions', () => {
    const m = arrangeMelody(
      quarters(0, 24),
      ctx({
        markers: [
          { beat: 16, text: 'Chorus' },
          { beat: 0, text: 'Intro' },
          { beat: 6, text: '  Verse\n1 ' },
          { beat: 10, text: '   ' }, // rỗng → bỏ
          { beat: 40, text: 'Outro' }, // sau nốt cuối → không có dòng
        ],
      }),
    );
    expect(m.sections.map((s) => [s.name, s.lines.map((l) => l.events.length)])).toEqual([
      ['Intro', [6]],
      ['Verse 1', [10]],
      ['Chorus', [8]],
    ]);
    expect(lineStarts(m)).toEqual([0, 6, 16]);
  });

  it('puts lines before the first marker into "Main"; the last of several markers wins', () => {
    const m = arrangeMelody(
      quarters(0, 16),
      ctx({
        markers: [
          { beat: 8, text: 'A' },
          { beat: 9, text: 'B' },
        ],
      }),
    );
    expect(m.sections.map((s) => [s.name, s.lines.length])).toEqual([
      ['Main', 1],
      ['B', 1],
    ]);
  });

  it('starts a marker section at the pickup line before it', () => {
    const notes = [...quarters(0, 12), n(15.5, 0.5, 70), ...quarters(16, 4)];
    const m = arrangeMelody(
      notes,
      ctx({
        markers: [
          { beat: 0, text: 'Verse' },
          { beat: 16, text: 'Chorus' },
        ],
      }),
    );
    expect(m.sections.map((s) => [s.name, s.lines.length])).toEqual([
      ['Verse', 2],
      ['Chorus', 1],
    ]);
    expect(m.sections[1].lines[0].events[0]).toEqual({ midi: 70, beats: 0.5 });
  });
});

describe('arrangeMelody — pickup at the start (anacrusis)', () => {
  // nốt đón 2 móc đơn ở cuối ô nhịp đón (beat 3, 3.5 — như MusicXML dời ô nhịp đón), rồi ô nhịp 1, 2, 3
  const song = (): MonoNote[] => [
    n(3, 0.5, 67),
    n(3.5, 0.5, 69),
    n(4, 2, 71),
    n(6, 2, 72),
    n(8, 4, 74),
    ...quarters(12, 8, 76),
  ];
  const pickupLine = '_3 67:0.5 69:0.5 71:2 72:2 74:4';

  it('line 1 = pickup + barsPerLine full bars; the line grid starts at the first full bar', () => {
    const m = arrangeMelody(song(), ctx());
    expect(shape(m)).toEqual([['Phần 1', [pickupLine, '76:1 77:1 78:1 76:1 77:1 78:1 76:1 77:1']]]);
    expect(lineStarts(m)).toEqual([0, 12]);
    expect(m.sections[0].lines[0]).not.toHaveProperty('lyric');
  });

  it('a marker on bar 1 takes the pickup line (no stray "Main")', () => {
    const m = arrangeMelody(song(), ctx({ markers: [{ beat: 4, text: 'Verse' }] }));
    expect(m.sections.map((s) => s.name)).toEqual(['Verse']);
    expect(shape(m)[0][1][0]).toBe(pickupLine);
  });

  it('a marker on the pickup itself does not split the pickup notes', () => {
    const m = arrangeMelody(
      song(),
      ctx({
        markers: [
          { beat: 3, text: 'Intro' },
          { beat: 12, text: 'Verse' },
        ],
      }),
    );
    expect(shape(m)).toEqual([
      ['Intro', [pickupLine]],
      ['Verse', ['76:1 77:1 78:1 76:1 77:1 78:1 76:1 77:1']],
    ]);
  });

  it('a first note in the first half of its bar keeps the grid at that bar', () => {
    // nốt đầu ở beat 1 (không phải nốt đón): dòng vẫn [0, 8), [8, 16)
    const m = arrangeMelody([n(1, 1), ...quarters(2, 10)], ctx());
    expect(lineStarts(m)).toEqual([0, 8]);
  });
});

describe('arrangeMelody — metadata, no lyrics', () => {
  it('never produces lyrics or slurs: events carry only pitch + length', () => {
    const m = arrangeMelody(
      [n(0, 1, 72), n(1, 0.5, 74), n(1.5, 0.5, 76), n(2, 1, 77), n(3, 1, 79)],
      ctx(),
    );
    const line = m.sections[0].lines[0];
    expect(line).not.toHaveProperty('lyric');
    expect(line.events.every((e) => e.slurId === undefined && !('syllable' in e))).toBe(true);
    const placement = optimizeTranspose(melodyPitches(m))[0];
    const harm = melodyToHarm(m, placement);
    expect(parseHarm(harm).diagnostics).toEqual([]);
    expect(harm).not.toMatch(/:(?=\s|$)/m);
  });

  it('copies title, artist, bpm and a valid time signature', () => {
    const base = arrangeMelody([n(0, 1)], ctx({ title: 'X', artist: 'Ca sĩ', bpm: 87.5 }));
    expect(base).toMatchObject({ title: 'X', artist: 'Ca sĩ', bpm: 87.5 });
    expect(arrangeMelody([n(0, 1)], ctx({ artist: '  ' }))).not.toHaveProperty('artist');
    expect(arrangeMelody([n(0, 1)], ctx())).not.toHaveProperty('artist');
    const badTs = arrangeMelody(quarters(0, 9), ctx({ timeSig: { num: 4, den: 0 } }));
    expect(badTs.timeSig).toEqual({ num: 4, den: 4 });
    expect(lineStarts(badTs)).toEqual([0, 8]);
  });
});
