import { describe, expect, it } from 'vitest';
import { parseHarm } from './parser';
import { buildTimeline } from './timeline';
import type { Line, Note, ParseResult, Section, Slur } from './types';
import seedQuocCa from '../library/seeds/quoc-ca-viet-nam.harm?raw';
import seedTakediskrush from '../library/seeds/takediskrush.harm?raw';
import seedJiMoDeRen from '../library/seeds/ji-mo-de-ren.harm?raw';
import seedSaoMinh from '../library/seeds/sao-minh-chua-nam-tay-nhau.harm?raw';
// Hai bài tự soạn chỉ dùng cho test (src/test/fixtures/, app không import): dài, phủ @repeat, luyến, giữ chuột
// qua nhiều dòng, Nửa Cung, đoạn rỗng… nên các test chi tiết dưới đây ghim nội dung của chúng.
import seed1 from '../test/fixtures/bai-thu-nhip-dieu.harm?raw';
import seed2 from '../test/fixtures/bai-thu-lap-doan.harm?raw';

function notesOf(lines: Line[]): Note[] {
  return lines.flatMap((l) =>
    l.units.flatMap((u) => (u.kind === 'note' ? [u] : u.kind === 'slur' ? u.notes : [])),
  );
}
function section(r: ParseResult, name: string): Section {
  const s = r.song.sections.find((x) => x.name === name);
  expect(s, name).toBeDefined();
  return s as Section;
}
/** Số dòng (1-based) của dòng nguồn bắt đầu bằng `prefix`. */
function sourceLineOf(text: string, prefix: string): number {
  const i = text.split(/\r?\n/).findIndex((l) => l.startsWith(prefix));
  expect(i, prefix).toBeGreaterThanOrEqual(0);
  return i + 1;
}

describe('fixture 1: Bài thử nhịp điệu', () => {
  const r = parseHarm(seed1, { id: 'fixture-bai-thu-nhip-dieu' });

  it('parses with zero diagnostics', () => {
    expect(r.diagnostics).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('reads the directives', () => {
    expect(r.song.id).toBe('fixture-bai-thu-nhip-dieu');
    expect(r.song.title).toBe('Bài thử nhịp điệu');
    expect('artist' in r.song).toBe(false);
    expect(r.song.bpm).toBe(76);
    expect(r.song.timeSig).toEqual({ num: 4, den: 4 });
    expect(r.song.scrollDir).toBe(1);
  });

  it('has 3 sections with 4 / 4 / 8 lines', () => {
    expect(r.song.sections.map((s) => [s.name, s.lines.length])).toEqual([
      ['ĐOẠN 1', 4],
      ['ĐOẠN 2', 4],
      ['ĐIỆP KHÚC', 8],
    ]);
  });

  it('ĐOẠN 1 line 1 = N M , B (X-C right) N rest; first unit is half a beat', () => {
    const l = section(r, 'ĐOẠN 1').lines[0] as Line;
    expect(l).not.toHaveProperty('lyric');
    expect(l.units).toStrictEqual([
      { kind: 'note', key: 'N', octave: 0, sharp: false, beats: 0.5 },
      { kind: 'note', key: 'M', octave: 0, sharp: false, beats: 0.5 },
      { kind: 'note', key: ',', octave: 0, sharp: false, beats: 1 },
      { kind: 'note', key: 'B', octave: 0, sharp: false, beats: 2 },
      {
        kind: 'slur',
        notes: [
          { kind: 'note', key: 'X', octave: 1, sharp: false, beats: 0.5 },
          { kind: 'note', key: 'C', octave: 1, sharp: false, beats: 0.5 },
        ],
      },
      { kind: 'note', key: 'N', octave: 0, sharp: false, beats: 2 },
      { kind: 'rest', beats: 1 },
    ]);
    expect(l.units[0]?.kind === 'note' && l.units[0].beats).toBe(0.5);
  });

  it('ĐIỆP KHÚC: every note is held right (octave 1), none sharp', () => {
    const notes = notesOf(section(r, 'ĐIỆP KHÚC').lines);
    expect(notes).toHaveLength(53);
    expect(notes.every((x) => x.octave === 1 && !x.sharp)).toBe(true);
    // rest cuối không thuộc hold
    const last = section(r, 'ĐIỆP KHÚC').lines[7] as Line;
    expect(last.units.at(-1)).toStrictEqual({ kind: 'rest', beats: 0.5 });
  });

  it('verses only use right-hold inside the X-C slurs', () => {
    for (const name of ['ĐOẠN 1', 'ĐOẠN 2']) {
      const lines = section(r, name).lines;
      const slurs = lines.flatMap((l) => l.units.filter((u): u is Slur => u.kind === 'slur'));
      expect(slurs).toHaveLength(2);
      expect(slurs.flatMap((s) => s.notes).every((x) => x.octave === 1)).toBe(true);
      const plain = lines.flatMap((l) => l.units.filter((u): u is Note => u.kind === 'note'));
      expect(plain.every((x) => x.octave === 0 && !x.sharp)).toBe(true);
    }
  });

  it('has 118 notes in total (34 + 31 + 53) and no sharps', () => {
    const notes = notesOf(r.song.sections.flatMap((s) => s.lines));
    expect(notes).toHaveLength(118);
    expect(notesOf(section(r, 'ĐOẠN 1').lines)).toHaveLength(34);
    expect(notesOf(section(r, 'ĐOẠN 2').lines)).toHaveLength(31);
    expect(notes.some((x) => x.sharp)).toBe(false);
  });

  it('lineOrigins point at the source lines', () => {
    expect(r.lineOrigins).toHaveLength(16);
    expect(r.lineOrigins[0]).toEqual({ sourceLine: sourceLineOf(seed1, '# ĐOẠN 1') + 1 });
    expect(r.lineOrigins.every((o) => o.repeatLine === undefined)).toBe(true);
  });
});

describe('fixture 2: Bài thử lặp đoạn và giữ chuột', () => {
  const r = parseHarm(seed2, { id: 'fixture-bai-thu-lap-doan' });

  it('parses with zero diagnostics', () => {
    expect(r.ok).toBe(true);
    expect(r.diagnostics).toEqual([]);
  });

  it('reads the directives', () => {
    expect(r.song.title).toBe('Bài thử lặp đoạn và giữ chuột');
    expect(r.song.artist).toBe('Tác giả thử');
    expect(r.song.bpm).toBe(160);
    expect(r.song.timeSig).toEqual({ num: 4, den: 4 });
    expect(r.song.scrollDir).toBe(1);
  });

  it('has the sections in order (ĐOẠN 3 kept empty)', () => {
    expect(r.song.sections.map((s) => [s.name, s.lines.length])).toEqual([
      ['ĐOẠN 1', 6],
      ['ĐOẠN 2', 5],
      ['ĐIỆP KHÚC', 8],
      ['ĐOẠN 3', 0],
      ['ĐOẠN 4', 7],
      ['ĐOẠN 5', 13],
      ['ĐOẠN 6', 6],
      ['KẾT', 18],
    ]);
  });

  it('ĐOẠN 5 = @repeat ĐOẠN 2 + @repeat ĐIỆP KHÚC (deep equal, repeatLine set)', () => {
    const d2 = section(r, 'ĐOẠN 2').lines;
    const chorus = section(r, 'ĐIỆP KHÚC').lines;
    expect(section(r, 'ĐOẠN 5').lines).toStrictEqual([...d2, ...chorus]);

    const start = r.song.sections
      .slice(
        0,
        r.song.sections.findIndex((s) => s.name === 'ĐOẠN 5'),
      )
      .reduce((acc, s) => acc + s.lines.length, 0);
    const origins = r.lineOrigins.slice(start, start + 13);
    const rep2 = sourceLineOf(seed2, '@repeat ĐOẠN 2');
    const repChorus = sourceLineOf(seed2, '@repeat ĐIỆP KHÚC');
    expect(origins.slice(0, 5).every((o) => o.repeatLine === rep2)).toBe(true);
    expect(origins.slice(5).every((o) => o.repeatLine === repChorus)).toBe(true);
    expect(origins[0]?.sourceLine).toBe(sourceLineOf(seed2, '# ĐOẠN 2') + 1);
  });

  it('KẾT has 2 own lines + 8 + 8 chorus lines', () => {
    const ket = section(r, 'KẾT').lines;
    const chorus = section(r, 'ĐIỆP KHÚC').lines;
    expect(ket).toHaveLength(18);
    expect(ket.slice(2, 10)).toStrictEqual(chorus);
    expect(ket.slice(10)).toStrictEqual(chorus);
  });

  it('reads "Z-L:N" as a slur [Z normal, N left]', () => {
    const l = section(r, 'ĐOẠN 2').lines[1] as Line;
    expect(l.units.at(-1)).toStrictEqual({
      kind: 'slur',
      notes: [
        { kind: 'note', key: 'Z', octave: 0, sharp: false, beats: 0.5 },
        { kind: 'note', key: 'N', octave: -1, sharp: false, beats: 0.5 },
      ],
    });
  });

  it('only ĐOẠN 6 has sharp notes (4 sharp N, no octave)', () => {
    const d6 = notesOf(section(r, 'ĐOẠN 6').lines);
    const sharp = d6.filter((x) => x.sharp);
    expect(sharp).toHaveLength(4);
    expect(sharp.every((x) => x.key === 'N' && x.octave === 0)).toBe(true);
    const others = r.song.sections.filter((s) => s.name !== 'ĐOẠN 6').flatMap((s) => s.lines);
    expect(notesOf(others).some((x) => x.sharp)).toBe(false);
  });

  it('every plain note is 1 beat (slur notes 1/2)', () => {
    for (const s of r.song.sections) {
      for (const l of s.lines) {
        for (const u of l.units) {
          if (u.kind === 'note') expect(u.beats).toBe(1);
          else if (u.kind === 'slur') expect(u.notes.every((x) => x.beats === 0.5)).toBe(true);
          else throw new Error('seed 2 has no rests');
        }
      }
    }
  });

  it('uses left-hold in ĐOẠN 4 across lines', () => {
    const d4 = section(r, 'ĐOẠN 4').lines;
    // dòng 1 kết thúc khi còn giữ trái: dòng 2 bắt đầu bằng C V N vẫn đang giữ
    expect(d4[1]?.units.slice(0, 3).map((u) => u.kind === 'note' && u.octave)).toEqual([
      -1, -1, -1,
    ]);
    const right = notesOf(d4).filter((x) => x.octave === 1);
    expect(right).toEqual([{ kind: 'note', key: 'X', octave: 1, sharp: false, beats: 1 }]);
  });

  it('has 578 notes in total', () => {
    const counts = r.song.sections.map((s) => [s.name, notesOf(s.lines).length]);
    expect(counts).toEqual([
      ['ĐOẠN 1', 70],
      ['ĐOẠN 2', 56],
      ['ĐIỆP KHÚC', 75],
      ['ĐOẠN 3', 0],
      ['ĐOẠN 4', 44],
      ['ĐOẠN 5', 131],
      ['ĐOẠN 6', 38],
      ['KẾT', 164],
    ]);
    expect(notesOf(r.song.sections.flatMap((s) => s.lines))).toHaveLength(578);
    expect(r.lineOrigins).toHaveLength(63);
  });
});

describe('bài mẫu Quốc ca Việt Nam (v1.0.1: chỉ còn "Phần 1" + "Phần 2")', () => {
  const r = parseHarm(seedQuocCa, { id: 'seed-quoc-ca-viet-nam' });

  it('2 đoạn 4 / 5 dòng, 73 nốt, 82,75 beat (1:02 ở 80 BPM), nốt đầu ở beat 2,75', () => {
    expect(r.diagnostics).toEqual([]);
    expect(r.song.sections.map((s) => [s.name, s.lines.length])).toEqual([
      ['Phần 1', 4],
      ['Phần 2', 5],
    ]);
    expect(notesOf(r.song.sections.flatMap((s) => s.lines))).toHaveLength(73);
    const tl = buildTimeline(r.song);
    expect(tl.totalBeats).toBeCloseTo(82.75, 9);
    expect(Math.floor((tl.totalBeats * 60) / r.song.bpm)).toBe(62);
    expect(tl.notes[0]?.startBeat).toBeCloseTo(2.75, 9);
    // Giữ chuột phải đã thả trước nốt cuối (dòng cuối của "Phần 2"): bài kết thúc ở quãng thường.
    expect(tl.notes.at(-1)).toMatchObject({ key: ',', octave: 0, sharp: false });
    const lastHold = tl.holdRuns.at(-1);
    expect(lastHold?.endBeat).toBeLessThanOrEqual(tl.notes.at(-1)!.startBeat);
  });

  it('file kết thúc bằng đúng một dấu xuống dòng; không còn "# Phần 3" / "# Phần 4"', () => {
    expect(seedQuocCa.endsWith(',*2 _*0.75\n')).toBe(true);
    expect(seedQuocCa.endsWith('\n\n')).toBe(false);
    expect(seedQuocCa).not.toMatch(/^# Phần [34]/m);
  });
});

describe('bài mẫu 寂寞的人伤心的歌 (v1.0.2: chuyển từ cảm âm bằng convertPasted, hạ 7 nửa cung)', () => {
  const r = parseHarm(seedJiMoDeRen, { id: 'seed-ji-mo-de-ren' });

  it('10 đoạn / 46 dòng, 504 nốt, 360 beat (2:52 ở 125 BPM), trong tầm C4..F5, một nốt Nửa Cung', () => {
    expect(r.diagnostics).toEqual([]);
    expect(r.song.title).toBe('寂寞的人伤心的歌 (Bài Ca Đau Khổ Của Kẻ Cô Đơn)');
    expect(r.song.artist).toBe('龙梅子、杨海彪');
    expect(r.song.bpm).toBe(125);
    expect(r.song.timeSig).toEqual({ num: 4, den: 4 });
    expect(r.song.scrollDir).toBe(1);
    expect(r.song.sections.map((s) => [s.name, s.lines.length])).toEqual([
      ['Dạo đầu', 1],
      ['Mở đầu', 4],
      ['Đoạn 1', 4],
      ['Đoạn 2 - lượt 1', 4],
      ['Điệp khúc - lượt 1', 8],
      ['Chuyển đoạn', 4],
      ['Đoạn 2 - lượt 2', 4],
      ['Điệp khúc - lượt 2', 8],
      ['Điệp khúc - lượt 3', 8],
      ['Kết', 1],
    ]);
    const tl = buildTimeline(r.song);
    expect(tl.notes).toHaveLength(504);
    expect(tl.totalBeats).toBeCloseTo(360, 9);
    expect(Math.floor((tl.totalBeats * 60) / r.song.bpm)).toBe(172);
    const midis = tl.notes.map((n) => n.midi);
    expect(Math.min(...midis)).toBe(60);
    expect(Math.max(...midis)).toBe(77);
    expect(tl.notes.filter((n) => n.sharp)).toHaveLength(1);
    // Giữ chuột phải đã thả ở cuối bài.
    expect(tl.holdRuns.at(-1)?.endBeat).toBeLessThanOrEqual(tl.totalBeats);
  });

  it('ghi chú // của nguồn giữ nguyên (comment thường, không phải cảnh báo //!); một dấu xuống dòng ở cuối', () => {
    expect(seedJiMoDeRen).toMatch(/^\/\/ Đọc giản phổ theo 1=do/m);
    expect(seedJiMoDeRen).toMatch(/^\/\/ Ô cuối: lấy nốt nữ ở phách đầu/m);
    expect(seedJiMoDeRen).not.toMatch(/^\/\/!/m);
    expect(seedJiMoDeRen.endsWith(']\n')).toBe(true);
    expect(seedJiMoDeRen.endsWith('\n\n')).toBe(false);
  });
});

describe('seeds: no lyrics left', () => {
  it.each([
    ['quoc-ca-viet-nam', seedQuocCa],
    ['takediskrush', seedTakediskrush],
    ['ji-mo-de-ren', seedJiMoDeRen],
    ['sao-minh-chua-nam-tay-nhau', seedSaoMinh],
    ['fixture bai-thu-nhip-dieu', seed1],
    ['fixture bai-thu-lap-doan', seed2],
  ])('%s: parses with 0 diagnostics and no note line has a legacy "lời: " prefix', (_id, src) => {
    const r = parseHarm(src);
    expect(r.diagnostics).toEqual([]);
    for (const raw of src.split(/\r?\n/)) {
      const t = raw.trim();
      if (t === '' || t.startsWith('//') || t.startsWith('@') || t.startsWith('#')) continue;
      expect(t, raw).not.toMatch(/:(?=\s|$)/);
    }
    expect(r.song.sections.flatMap((s) => s.lines).every((l) => !('lyric' in l))).toBe(true);
  });
});
