import { describe, expect, it } from 'vitest';
import type { Melody } from '../core/melody';
import { melodyPitches } from '../core/melody';
import { melodyToHarm } from '../core/melodyBuild';
import { optimizeTranspose } from '../core/optimizer';
import { parseHarm } from '../core/parser';
import type { ArrangeContext } from './arrange';
import { AUTO_SECTION_PREFIX } from './arrange';
import { autoArrangeMelody, LINE_NOTES, MAX_LINE_NOTES } from './autoArrange';
import type { MonoNote } from './types';

const n = (startBeat: number, beats: number, midi = 60): MonoNote => ({ startBeat, beats, midi });

/** Chuỗi nốt liền nhau dài `dur` beat từ `start`. */
const run = (start: number, count: number, dur = 1, midi = 60): MonoNote[] =>
  Array.from({ length: count }, (_, i) => n(start + i * dur, dur, midi + (i % 5)));

const ctx = (over: Partial<ArrangeContext> = {}): ArrangeContext => ({
  title: 'Bài',
  bpm: 100,
  timeSig: { num: 4, den: 4 },
  markers: [],
  grid: 0.25,
  ...over,
});

/** Số nốt mỗi dòng, theo section: [[tên, [số nốt dòng 1, …]], …]. */
function noteCounts(m: Melody): Array<[string, number[]]> {
  return m.sections.map((s) => [
    s.name,
    s.lines.map((l) => l.events.filter((e) => e.midi !== null).length),
  ]);
}

/** Beat bắt đầu (nốt đầu) của mỗi dòng, tính từ đầu ô nhịp chứa nốt đầu. */
function lineNoteStarts(m: Melody, origin = 0): number[] {
  const out: number[] = [];
  let t = origin;
  for (const s of m.sections) {
    for (const l of s.lines) {
      let first: number | null = null;
      for (const e of l.events) {
        if (e.midi !== null && first === null) first = t;
        t += e.beats;
      }
      if (first !== null) out.push(first);
    }
  }
  return out;
}

/** Mọi event nốt theo thứ tự: [midi, beats]. */
function allNotes(m: Melody): Array<[number, number]> {
  return m.sections.flatMap((s) =>
    s.lines.flatMap((l) =>
      l.events.flatMap((e) => (e.midi === null ? [] : [[e.midi, e.beats] as [number, number]])),
    ),
  );
}

function totalBeats(m: Melody): number {
  return m.sections.reduce(
    (sum, s) => sum + s.lines.reduce((a, l) => a + l.events.reduce((b, e) => b + e.beats, 0), 0),
    0,
  );
}

/** Câu `count` nốt đen + nghỉ `rest` beat, lặp `times` lần từ `start`. */
function phrases(times: number, count: number, rest: number, start = 0): MonoNote[] {
  const out: MonoNote[] = [];
  let t = start;
  for (let k = 0; k < times; k++) {
    out.push(...run(t, count, 1, 60 + k));
    t += count + rest;
  }
  return out;
}

describe('autoArrangeMelody — dòng', () => {
  it('rỗng / đầu vào hỏng → không có section', () => {
    expect(autoArrangeMelody([], ctx())).toEqual({
      melody: { title: 'Bài', bpm: 100, timeSig: { num: 4, den: 4 }, sections: [] },
      markerSections: 0,
    });
    const bad = [n(Number.NaN, 1), n(0, 0), n(1, -1), n(2, Infinity)];
    expect(autoArrangeMelody(bad, ctx()).melody.sections).toEqual([]);
  });

  it('câu 7 nốt + nghỉ 1 beat (2 ô nhịp) → mỗi câu một dòng, nghỉ ở cuối dòng', () => {
    const { melody, markerSections } = autoArrangeMelody(phrases(4, 7, 1), ctx());
    expect(markerSections).toBe(0);
    expect(noteCounts(melody)).toEqual([[`${AUTO_SECTION_PREFIX} 1`, [7, 7, 7, 7]]]);
    expect(lineNoteStarts(melody)).toEqual([0, 8, 16, 24]);
    const firstLine = melody.sections[0].lines[0].events;
    expect(firstLine[firstLine.length - 1]).toEqual({ midi: null, beats: 1 });
  });

  it('móc đơn liên tục không nghỉ → ngắt ở vạch nhịp, mỗi dòng 1 ô nhịp (8 nốt)', () => {
    const { melody } = autoArrangeMelody(run(0, 64, 0.5), ctx());
    const counts = noteCounts(melody).flatMap(([, c]) => c);
    expect(counts).toEqual([8, 8, 8, 8, 8, 8, 8, 8]);
    expect(lineNoteStarts(melody)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
    // 8 dòng → 2 section 4 dòng
    expect(noteCounts(melody).map(([name, c]) => [name, c.length])).toEqual([
      [`${AUTO_SECTION_PREFIX} 1`, 4],
      [`${AUTO_SECTION_PREFIX} 2`, 4],
    ]);
  });

  it('nốt đen liên tục → dòng 2 ô nhịp (8 nốt), ngắt ở mốc 2 ô nhịp', () => {
    const { melody } = autoArrangeMelody(run(0, 32), ctx());
    expect(lineNoteStarts(melody)).toEqual([0, 8, 16, 24]);
  });

  it('nốt tròn (1 nốt mỗi ô nhịp) → dòng dài hơn (4 nốt / 4 ô nhịp) thay vì dòng 1–2 nốt', () => {
    const { melody } = autoArrangeMelody(run(0, 8, 4), ctx());
    expect(noteCounts(melody).flatMap(([, c]) => c)).toEqual([4, 4]);
  });

  it('nhịp 3/4, nốt đen liên tục → dòng 2 ô nhịp (6 nốt)', () => {
    const { melody } = autoArrangeMelody(run(0, 24), ctx({ timeSig: { num: 3, den: 4 } }));
    expect(lineNoteStarts(melody)).toEqual([0, 6, 12, 18]);
  });

  it('dòng nhắm 4–12 nốt; không dòng nào vượt MAX_LINE_NOTES', () => {
    const { melody } = autoArrangeMelody(run(0, 200, 0.25), ctx());
    const counts = noteCounts(melody).flatMap(([, c]) => c);
    expect(counts.every((c) => c <= MAX_LINE_NOTES)).toBe(true);
    expect(counts.every((c) => c >= LINE_NOTES.min && c <= 16)).toBe(true);
  });

  it('nốt đón sau chỗ nghỉ mở dòng mới (không bị ngắt ở vạch nhịp ngay sau nó)', () => {
    // nốt đón beat 3, câu 1: beat 4..9 + nốt trắng 8..10, nghỉ 10..11, nốt đón 11, câu 2 từ 12…
    const notes: MonoNote[] = [
      n(3, 1, 67),
      ...run(4, 4, 1, 72),
      n(8, 2, 74),
      n(11, 1, 67),
      ...run(12, 4, 1, 72),
      n(16, 2, 74),
      n(19, 1, 67),
      ...run(20, 4, 1, 72),
      n(24, 4, 72),
    ];
    const { melody } = autoArrangeMelody(notes, ctx());
    // dòng 1 có rest đầu bài (ô nhịp 0, beat 0..3)
    expect(melody.sections[0].lines[0].events[0]).toEqual({ midi: null, beats: 3 });
    expect(lineNoteStarts(melody)).toEqual([3, 11, 19]);
    expect(noteCounts(melody).flatMap(([, c]) => c)).toEqual([6, 6, 6]);
  });

  it('rest đầu bài tính từ đầu ô nhịp chứa nốt đầu; ô nhịp trống phía trước bị bỏ', () => {
    const { melody } = autoArrangeMelody(run(9.5, 8, 0.5), ctx());
    expect(melody.sections[0].lines[0].events[0]).toEqual({ midi: null, beats: 1.5 });
    expect(totalBeats(melody)).toBe(1.5 + 4);
  });

  it('khoảng trống nhỏ hơn grid được cộng vào nốt trước; grid 0 thì thành rest', () => {
    const notes = [n(0, 0.9), n(1, 1), n(2, 2)];
    expect(allNotes(autoArrangeMelody(notes, ctx({ grid: 0.25 })).melody)).toEqual([
      [60, 1],
      [60, 1],
      [60, 2],
    ]);
    const raw = autoArrangeMelody(notes, ctx({ grid: 0 })).melody;
    expect(raw.sections[0].lines[0].events[1]).toEqual({ midi: null, beats: 0.1 });
  });

  it('mỗi nốt hợp lệ = đúng một event nốt, giữ thứ tự; tổng độ dài khớp', () => {
    // giai điệu giả ngẫu nhiên (LCG) có nghỉ, nốt đón, nốt dài
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const notes: MonoNote[] = [];
    let t = 1;
    for (let i = 0; i < 300; i++) {
      const dur = [0.25, 0.5, 0.5, 1, 1, 1.5, 2][Math.floor(rnd() * 7)];
      notes.push(n(t, dur, 55 + Math.floor(rnd() * 24)));
      t += dur + (rnd() < 0.15 ? [0.5, 1, 2, 8][Math.floor(rnd() * 4)] : 0);
    }
    const { melody } = autoArrangeMelody(notes, ctx());
    expect(allNotes(melody)).toEqual(notes.map((x) => [x.midi, x.beats]));
    // ô nhịp đầu bắt đầu ở beat 0 (nốt đầu ở beat 1): tổng = hết nốt cuối
    const last = notes[notes.length - 1];
    expect(totalBeats(melody)).toBeCloseTo(last.startBeat + last.beats, 6);
    // dòng mới luôn bắt đầu bằng nốt (trừ dòng đầu)
    const lines = melody.sections.flatMap((s) => s.lines);
    expect(lines.slice(1).every((l) => l.events[0].midi !== null)).toBe(true);
  });

  it('time signature sai → 4/4', () => {
    const { melody } = autoArrangeMelody(run(0, 8), ctx({ timeSig: { num: 0, den: 3 } }));
    expect(melody.timeSig).toEqual({ num: 4, den: 4 });
  });
});

describe('autoArrangeMelody — section', () => {
  it('nghỉ dài ≥ 2 ô nhịp luôn mở section mới', () => {
    const notes = [...phrases(2, 7, 1), ...phrases(2, 7, 1, 16 + 8)];
    const { melody } = autoArrangeMelody(notes, ctx());
    expect(noteCounts(melody)).toEqual([
      [`${AUTO_SECTION_PREFIX} 1`, [7, 7]],
      [`${AUTO_SECTION_PREFIX} 2`, [7, 7]],
    ]);
  });

  it('không marker: khoảng 4 dòng một section (12 dòng → 3 × 4)', () => {
    const { melody } = autoArrangeMelody(phrases(12, 7, 1), ctx());
    expect(noteCounts(melody).map(([, c]) => c.length)).toEqual([4, 4, 4]);
  });

  it('bài ngắn (≤ 5 dòng) → một section', () => {
    const { melody } = autoArrangeMelody(phrases(5, 7, 1), ctx());
    expect(melody.sections.length).toBe(1);
  });

  it('marker hợp lý → section theo marker, marker ép ngắt dòng; dòng trước marker đầu → Main', () => {
    const notes = run(0, 48); // 12 ô nhịp nốt đen liên tục
    const markers = [
      { beat: 16, text: 'Verse' },
      { beat: 32, text: '  Điệp   khúc ' },
    ];
    const { melody, markerSections } = autoArrangeMelody(notes, ctx({ markers }));
    expect(markerSections).toBe(3);
    expect(melody.sections.map((s) => s.name)).toEqual(['Main', 'Verse', 'Điệp khúc']);
    expect(lineNoteStarts(melody)).toEqual([0, 8, 16, 24, 32, 40]);
  });

  it('marker lệch vạch nhịp vẫn ép ngắt dòng tại nốt đầu từ marker', () => {
    const notes = run(0, 48);
    const { melody } = autoArrangeMelody(
      notes,
      ctx({
        markers: [
          { beat: 0, text: 'A' },
          { beat: 21, text: 'B' },
        ],
      }),
    );
    expect(melody.sections.map((s) => s.name)).toEqual(['A', 'B']);
    const starts = lineNoteStarts(melody);
    expect(starts).toContain(21);
    expect(starts[0]).toBe(0);
  });

  it('nốt đón trước marker (sau chỗ nghỉ) thuộc section của marker', () => {
    const notes = [...run(0, 14), n(15, 1, 67), ...run(16, 14, 1, 72)];
    const { melody } = autoArrangeMelody(
      notes,
      ctx({
        markers: [
          { beat: 0, text: 'Intro' },
          { beat: 16, text: 'Chorus' },
        ],
      }),
    );
    expect(melody.sections.map((s) => s.name)).toEqual(['Intro', 'Chorus']);
    const chorusFirst = melody.sections[1].lines[0].events[0];
    expect(chorusFirst).toEqual({ midi: 67, beats: 1 });
  });

  it('marker dày đặc (mỗi ô nhịp, kiểu tên hợp âm) → bỏ marker, section tự động', () => {
    const notes = phrases(8, 7, 1);
    const markers = Array.from({ length: 16 }, (_, i) => ({ beat: i * 4, text: `C${i}` }));
    const { melody, markerSections } = autoArrangeMelody(notes, ctx({ markers }));
    expect(markerSections).toBe(0);
    expect(melody.sections.every((s) => s.name.startsWith(AUTO_SECTION_PREFIX))).toBe(true);
  });

  it('chỉ một marker ở đầu bài (một section) → không dùng marker', () => {
    const { markerSections, melody } = autoArrangeMelody(
      phrases(8, 7, 1),
      ctx({ markers: [{ beat: 0, text: 'Song' }] }),
    );
    expect(markerSections).toBe(0);
    expect(melody.sections[0].name).toBe(`${AUTO_SECTION_PREFIX} 1`);
  });

  it('marker sau nốt cuối / rỗng / NaN bị bỏ qua', () => {
    const { markerSections } = autoArrangeMelody(
      phrases(8, 7, 1),
      ctx({
        markers: [
          { beat: 1000, text: 'Outro' },
          { beat: 8, text: '   ' },
          { beat: Number.NaN, text: 'X' },
        ],
      }),
    );
    expect(markerSections).toBe(0);
  });
});

describe('autoArrangeMelody → .harm', () => {
  it('kết quả dựng thành .harm parse không lỗi', () => {
    const notes = [n(3, 1, 67), ...phrases(6, 7, 1, 4), ...run(60, 16, 0.5, 70)];
    const { melody } = autoArrangeMelody(notes, ctx({ title: 'Thử' }));
    const pitches = melodyPitches(melody);
    const placement = optimizeTranspose(pitches, { baseOctave: 4, fold: true, top: 1 })[0];
    expect(placement).toBeTruthy();
    const harm = melodyToHarm(melody, placement, { baseOctave: 4, scrollDir: 1 });
    const r = parseHarm(harm);
    expect(r.ok).toBe(true);
    expect(r.song.title).toBe('Thử');
    expect(r.song.sections.length).toBe(melody.sections.length);
  });
});
