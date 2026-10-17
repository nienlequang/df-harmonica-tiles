import { describe, expect, it } from 'vitest';
import { parseHarm } from './parser';
import { canonicalSong, serializeHarm } from './serializer';
import type { Line, Note, NoteKey, Octave, Section, Song, TimeSig, Unit } from './types';
import { NOTE_KEYS } from './types';
import seedQuocCa from '../library/seeds/quoc-ca-viet-nam.harm?raw';
import seedTakediskrush from '../library/seeds/takediskrush.harm?raw';
// Hai bài tự soạn chỉ dùng cho test (src/test/fixtures/, app không import).
import seed1 from '../test/fixtures/bai-thu-nhip-dieu.harm?raw';
import seed2 from '../test/fixtures/bai-thu-lap-doan.harm?raw';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** JSON không phụ thuộc thứ tự key. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  );
}

/** Số đơn vị phát ra (nốt, nốt trong luyến, rest) — không được mất khi round-trip. */
function soundCount(song: Song): number {
  let count = 0;
  for (const s of song.sections) {
    for (const l of s.lines) {
      for (const u of l.units) count += u.kind === 'slur' ? u.notes.length : 1;
    }
  }
  return count;
}

/**
 * Round-trip: parse(serialize(song)) = canonicalSong(song), không diagnostic lỗi/cảnh báo, không
 * mất nốt; canonicalSong là điểm bất động trên model parser đọc ra; serialize idempotent; không có
 * CR (chuẩn hóa EOL của Editor — D-100 — không đổi gì).
 */
function check(song: Song): string {
  const text = serializeHarm(song);
  expect(text.includes('\r'), text).toBe(false);
  const r = parseHarm(text, { id: song.id });
  expect(
    r.diagnostics.filter((d) => d.severity !== 'info'),
    text,
  ).toEqual([]);
  expect(r.song, text).toStrictEqual(canonicalSong(song));
  expect(canonicalSong(r.song), text).toStrictEqual(r.song);
  expect(soundCount(r.song), text).toBe(soundCount(song));
  expect(serializeHarm(r.song)).toBe(text);
  return text;
}

describe('round-trip: seeds', () => {
  it.each([
    ['quoc-ca-viet-nam', seedQuocCa],
    ['takediskrush', seedTakediskrush],
    ['bai-thu-nhip-dieu', seed1],
    ['bai-thu-lap-doan', seed2],
  ])('%s: parse → serialize → parse is identical and idempotent', (id, src) => {
    const song = parseHarm(src, { id }).song;
    const text = check(song);
    // các option khác vẫn đọc lại được không lỗi
    for (const opts of [{ durations: false }, { sectionHeaders: false }, { directives: false }]) {
      const r = parseHarm(serializeHarm(song, opts));
      expect(r.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
    }
    expect(text.endsWith('\n')).toBe(true);
  });

  it('a hand-written variant (abbreviations, prefixes, standalone holds) normalizes', () => {
    const src = [
      '@title  Thử ',
      '# A',
      '[R]',
      'một hai: z x',
      'ba: c [/R] L:v',
      '[s] [l] b n [/l] [/s] RS:m-, _*.5',
      '@repeat A',
    ].join('\r\n');
    const song = parseHarm(src).song;
    const text = check(song);
    // tiền tố lời kiểu cũ ("một hai: ", "ba: ") bị bỏ, nốt giữ nguyên
    expect(text).toContain('\n[giữ chuột phải] Z X\n');
    expect(text).toContain('\nC [thả chuột phải] [giữ chuột trái] V');
  });
});

// ── random songs ───────────────────────────────────────────────────────────

const BEATS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 1 / 3, 2 / 3];
const WORDS = [
  'một',
  'hai',
  'kèn',
  'Đàn',
  'gió',
  'mưa',
  'la',
  'test',
  'nốt',
  'nhạc',
  'phím',
  'xoá',
  '1̇',
  '(x2)',
  'a.b',
  '100%',
  'tình-yêu',
  '[ngân]',
  'Ê',
  'ĐỜI',
  'là',
  'sớm',
  'chiều',
  "it's",
  '#1',
  '@home',
  'L',
  'Z-X',
  '_',
  // chuỗi mà văn bản `.harm` không ghi nguyên được (D-043): ": ", đầu dòng @ # //, xuống dòng
  'nói:',
  'a: b',
  ':',
  '::',
  '@x',
  '//y',
  '//',
  '#',
  '@',
  ' ',
  'x\ny',
  'x\r\ny',
  'x\ry',
  `a:${String.fromCharCode(0xa0)}b`,
  String.fromCharCode(0x2060),
];
const SECTION_NAMES = [
  'ĐOẠN 1',
  'Điệp khúc',
  'A',
  'Main',
  'Verse 2',
  'KẾT',
  'C#',
  'RAP',
  'Phần 3',
  // tên cần chuẩn hóa: rỗng, khoảng trắng, xuống dòng, bắt đầu bằng #
  '',
  '  ',
  ' Điệp  khúc ',
  'A\nB',
  'A\rB',
  '#',
  '# A',
  '@x',
];
const TIME_SIGS: TimeSig[] = [
  { num: 4, den: 4 },
  { num: 3, den: 4 },
  { num: 6, den: 8 },
  { num: 2, den: 2 },
  { num: 7, den: 16 },
  { num: 4, den: 4 },
  { num: 3, den: 4 },
  // ngoài miền @time → 4/4
  { num: 5, den: 3 },
  { num: 0, den: 4 },
  { num: 4.5, den: 4 },
];

function randomSong(rnd: () => number, index: number): Song {
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)] as T;
  const octave = (): Octave => {
    const x = rnd();
    return x < 0.5 ? 0 : x < 0.75 ? -1 : 1;
  };
  const note = (beats: number): Note => ({
    kind: 'note',
    key: pick(NOTE_KEYS) as NoteKey,
    octave: octave(),
    sharp: rnd() < 0.25,
    beats,
  });
  const unit = (): Unit => {
    const x = rnd();
    if (x < 0.15) return { kind: 'rest', beats: pick(BEATS) };
    if (x < 0.32) {
      const count = rnd() < 0.6 ? 2 : 3;
      const b = pick(BEATS);
      return { kind: 'slur', notes: Array.from({ length: count }, () => note(b)) };
    }
    // model hợp kiểu nhưng parser không sinh ra: luyến 1 nốt, luyến rỗng, luyến lệch độ dài
    if (x < 0.34) return { kind: 'slur', notes: [note(pick(BEATS))] };
    if (x < 0.35) return { kind: 'slur', notes: [] };
    if (x < 0.37) return { kind: 'slur', notes: [note(pick(BEATS)), note(pick(BEATS))] };
    return note(pick(BEATS));
  };
  // key `lyric` của model kiểu cũ (vd. JSON nhập trước khi bỏ tính năng lời): mọi chuỗi, kể cả bắt
  // đầu bằng @ # // hay chứa ": " — serializer phải bỏ hẳn, không ghi gì
  const lyric = (): string => {
    const words = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => pick(WORDS));
    const pad = rnd() < 0.1 ? ' ' : '';
    return pad + words.join(' ') + pad;
  };

  // chuỗi dài nốt cùng modifier để thử gom nhóm xuyên dòng / section
  const runOctave = (): Octave => octave();
  const sections: Section[] = [];
  const sectionCount = 1 + Math.floor(rnd() * 4);
  for (let s = 0; s < sectionCount; s++) {
    const lines: Line[] = [];
    const lineCount = rnd() < 0.1 ? 0 : 1 + Math.floor(rnd() * 5);
    for (let l = 0; l < lineCount; l++) {
      const units: Unit[] = [];
      // thỉnh thoảng dòng không có đơn vị nào (bị bỏ, D-013)
      const unitCount = rnd() < 0.03 ? 0 : 1 + Math.floor(rnd() * 8);
      const sticky = rnd() < 0.3 ? runOctave() : null;
      for (let u = 0; u < unitCount; u++) {
        const x = unit();
        if (sticky !== null && x.kind === 'note') x.octave = sticky;
        units.push(x);
      }
      const ly = rnd() < 0.5 ? lyric() : '';
      lines.push(ly !== '' ? ({ lyric: ly, units } as Line) : { units });
    }
    sections.push({ name: pick(SECTION_NAMES), lines });
  }

  const song: Song = {
    id: `rnd-${index}`,
    title: rnd() < 0.2 ? '' : `Bài ${index}: ${pick(WORDS)}`,
    bpm: pick([40, 60, 76, 90, 120.5, 160, 200]),
    timeSig: pick(TIME_SIGS),
    scrollDir: rnd() < 0.5 ? 1 : -1,
    sections,
  };
  if (rnd() < 0.5) song.artist = `${pick(WORDS)} ${pick(WORDS)}`;
  return song;
}

describe('round-trip: random songs', () => {
  it('parse(serialize(song)) deep-equals canonicalSong(song) for 400 seeded random songs', () => {
    const rnd = mulberry32(42);
    let holds = 0;
    let canonicalized = 0;
    for (let i = 0; i < 400; i++) {
      const song = randomSong(rnd, i);
      const text = check(song);
      holds += text.split('[giữ').length - 1;
      if (stable(canonicalSong(song)) !== stable(song)) canonicalized++;
    }
    // bảo đảm bộ sinh thật sự có modifier, và có cả model cần chuẩn hóa lẫn model đã chuẩn
    expect(holds).toBeGreaterThan(400);
    expect(canonicalized).toBeGreaterThan(50);
    expect(canonicalized).toBeLessThan(400);
  }, 60_000); // property test nặng (~3 s khi chạy riêng): ngân sách riêng để không flaky khi CPU bị tranh

  it('serialized random songs never contain a rest inside a hold', () => {
    const rnd = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const text = serializeHarm(randomSong(rnd, i), {
        directives: false,
        sectionHeaders: false,
      });
      // mọi rest phải xuất hiện khi không giữ gì; hết bài thì đã thả hết
      const tokens = text.match(/\[[^\]]+\]|\S+/g) ?? [];
      const state = { l: false, r: false, s: false };
      for (const t of tokens) {
        if (t === '[giữ chuột trái]') state.l = true;
        else if (t === '[thả chuột trái]') state.l = false;
        else if (t === '[giữ chuột phải]') state.r = true;
        else if (t === '[thả chuột phải]') state.r = false;
        else if (t === '[giữ scroll]') state.s = true;
        else if (t === '[thả scroll]') state.s = false;
        else if (/^_(\*|$)/.test(t)) expect(state).toEqual({ l: false, r: false, s: false });
      }
      expect(state).toEqual({ l: false, r: false, s: false });
    }
  });
});
