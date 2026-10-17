import { describe, expect, it } from 'vitest';
import { donateMarkerLength, parseHarm } from './parser';
import { canonicalSong, serializeHarm } from './serializer';
import type { Line, LineSpan, ParseResult, Song, Unit, UnitSpan } from './types';
import seedQuocCa from '../library/seeds/quoc-ca-viet-nam.harm?raw';
import seedTakediskrush from '../library/seeds/takediskrush.harm?raw';
// Hai bài tự soạn chỉ dùng cho test (src/test/fixtures/, app không import).
import seed1 from '../test/fixtures/bai-thu-nhip-dieu.harm?raw';
import seed2 from '../test/fixtures/bai-thu-lap-doan.harm?raw';

// ── helpers ────────────────────────────────────────────────────────────────

function allLines(r: ParseResult): Line[] {
  return r.song.sections.flatMap((s) => s.lines);
}

/** Dòng nguồn như parser thấy (bỏ BOM, tách tại CRLF / LF / CR lẻ). */
function sourceLines(text: string): string[] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return body.split(/\r\n?|\n/);
}

/** Văn bản token của unit j thuộc dòng model i. */
function tokenText(text: string, r: ParseResult, i: number, j: number): string {
  const s = r.unitSpans[i]?.[j] as UnitSpan;
  return (sourceLines(text)[s.line - 1] ?? '').slice(s.start, s.end);
}

/** Phần độc lập với trạng thái hold của unit: loại, phím, độ dài. */
function shape(u: Unit): unknown {
  if (u.kind === 'rest') return ['rest', u.beats];
  if (u.kind === 'note') return ['note', u.key, u.beats];
  return ['slur', u.notes.map((n) => n.key), u.notes.map((n) => n.beats)];
}

/**
 * Bất biến của vị trí nguồn: song song với model, nằm trong dòng nguồn, token tại span parse lại ra
 * cùng unit.
 */
function checkSpans(text: string, r: ParseResult): string[] {
  const problems: string[] = [];
  const src = sourceLines(text);
  const lines = allLines(r);
  if (r.lineSpans.length !== lines.length) problems.push('lineSpans length');
  if (r.unitSpans.length !== lines.length) problems.push('unitSpans length');
  lines.forEach((line, i) => {
    const ls = r.lineSpans[i] as LineSpan;
    const origin = r.lineOrigins[i];
    if (!ls || !origin) return;
    if (ls.line !== origin.sourceLine) problems.push(`line ${i}: source line`);
    if (ls.repeated !== (origin.repeatLine !== undefined)) problems.push(`line ${i}: repeated`);
    const raw = src[ls.line - 1] ?? '';
    if ('lyric' in line || 'lyric' in ls) problems.push(`line ${i}: lyric key`);
    if (/\s/.test(raw.charAt(ls.tokensStart)) || ls.tokensStart >= raw.length) {
      problems.push(`line ${i}: tokensStart`);
    }
    const spans = r.unitSpans[i] ?? [];
    if (spans.length !== line.units.length) problems.push(`line ${i}: unit count`);
    let prevEnd = ls.tokensStart;
    spans.forEach((s, j) => {
      const tok = raw.slice(s.start, s.end);
      if (s.line !== ls.line) problems.push(`unit ${i}.${j}: line`);
      if (s.start < prevEnd || s.end <= s.start || s.end > raw.length) {
        problems.push(`unit ${i}.${j}: range`);
      }
      prevEnd = s.end;
      if (s.durStart !== null && (raw.charAt(s.durStart) !== '*' || s.durStart >= s.end)) {
        problems.push(`unit ${i}.${j}: durStart`);
      }
      if (s.durStart === null && tok.includes('*')) problems.push(`unit ${i}.${j}: no durStart`);
      // token đứng một mình (sau ": " — tiền tố kiểu cũ — để không bị đọc thành header / directive)
      // ra cùng loại / phím / độ dài
      const alone = allLines(parseHarm(`: ${tok}`))[0]?.units ?? [];
      const u = line.units[j];
      if (
        alone.length !== 1 ||
        !u ||
        JSON.stringify(shape(alone[0] as Unit)) !== JSON.stringify(shape(u))
      ) {
        problems.push(`unit ${i}.${j}: token ${JSON.stringify(tok)}`);
      }
    });
  });
  return problems;
}

// ── line / unit spans ──────────────────────────────────────────────────────

describe('parseHarm: lineSpans / unitSpans', () => {
  it('plain token line: spans of note, dur, rest, slur (whole token incl. *dur)', () => {
    const text = 'Z X*2  _*.5 X-C*2 [L] N [/L] L:B-RS:,*1.5';
    const r = parseHarm(text);
    expect(r.diagnostics).toEqual([]);
    expect(r.lineSpans).toEqual([{ line: 1, tokensStart: 0, repeated: false }]);
    expect(r.unitSpans).toEqual([
      [
        { line: 1, start: 0, end: 1, durStart: null },
        { line: 1, start: 2, end: 5, durStart: 3 },
        { line: 1, start: 7, end: 11, durStart: 8 },
        { line: 1, start: 12, end: 17, durStart: 15 },
        { line: 1, start: 22, end: 23, durStart: null },
        { line: 1, start: 29, end: 41, durStart: 37 },
      ],
    ]);
    expect(tokenText(text, r, 0, 5)).toBe('L:B-RS:,*1.5');
  });

  it('legacy lyric prefix: tokensStart is the first token after ": " (prefix dropped)', () => {
    const text = '  Một  hai :   Z X';
    const r = parseHarm(text);
    expect(r.lineSpans).toEqual([{ line: 1, tokensStart: 15, repeated: false }]);
    expect(r.unitSpans[0]?.map((s) => s.start)).toEqual([15, 17]);
    expect(checkSpans(text, r)).toEqual([]);
  });

  it('a modifier as first token still marks tokensStart', () => {
    const r = parseHarm('lời: [giữ chuột phải] X-C [thả chuột phải]');
    expect(r.lineSpans[0]).toEqual({ line: 1, tokensStart: 5, repeated: false });
    expect(r.unitSpans[0]).toEqual([{ line: 1, start: 22, end: 25, durStart: null }]);
  });

  it('tokensStart skips leading whitespace and an empty legacy prefix before ":"', () => {
    expect(parseHarm('\t  Z').lineSpans[0]?.tokensStart).toBe(3);
    const r = parseHarm('  :  Z X');
    expect(allLines(r)[0]).toStrictEqual({
      units: [
        { kind: 'note', key: 'Z', octave: 0, sharp: false, beats: 1 },
        { kind: 'note', key: 'X', octave: 0, sharp: false, beats: 1 },
      ],
    });
    expect(r.lineSpans[0]).toEqual({ line: 1, tokensStart: 5, repeated: false });
  });

  it('a legacy prefix containing ":" (not followed by space) is dropped whole', () => {
    const r = parseHarm('10:30 sáng: Z X');
    expect(r.diagnostics).toEqual([]);
    expect(r.lineSpans[0]?.tokensStart).toBe(12);
  });

  it('columns are UTF-16 indexes (emoji, combining marks) and ignore the BOM', () => {
    const text = '﻿😀 é: Z\r\nX*2';
    const r = parseHarm(text);
    expect(r.lineSpans).toEqual([
      { line: 1, tokensStart: 7, repeated: false },
      { line: 2, tokensStart: 0, repeated: false },
    ]);
    expect(r.unitSpans).toEqual([
      [{ line: 1, start: 7, end: 8, durStart: null }],
      [{ line: 2, start: 0, end: 3, durStart: 1 }],
    ]);
    expect(checkSpans(text, r)).toEqual([]);
  });

  it('units with a bad duration still get a span with durStart (to be fixed in place)', () => {
    const r = parseHarm('Z*0 _*abc Q X');
    expect(r.ok).toBe(false);
    expect(r.unitSpans[0]).toEqual([
      { line: 1, start: 0, end: 3, durStart: 1 },
      { line: 1, start: 4, end: 9, durStart: 5 },
      { line: 1, start: 12, end: 13, durStart: null },
    ]);
  });

  it('lines without units have no span; spans stay parallel to model lines', () => {
    const text = [
      '# A',
      '[giữ chuột phải]',
      'lời: X C',
      '// c',
      '',
      'chỉ lời:',
      '[thả chuột phải]',
      'N',
    ].join('\n');
    const r = parseHarm(text);
    expect(allLines(r)).toHaveLength(2);
    expect(r.lineSpans.map((s) => s.line)).toEqual([3, 8]);
    expect(r.unitSpans.map((u) => u.length)).toEqual([2, 1]);
  });

  it('@repeat lines point at the ORIGINAL source line and columns, repeated: true', () => {
    const text = ['# A', 'một: Z X*2', '  N', '# B', '@repeat A', 'hai: C'].join('\n');
    const r = parseHarm(text);
    expect(r.lineSpans).toEqual([
      { line: 2, tokensStart: 5, repeated: false },
      { line: 3, tokensStart: 2, repeated: false },
      { line: 2, tokensStart: 5, repeated: true },
      { line: 3, tokensStart: 2, repeated: true },
      { line: 6, tokensStart: 5, repeated: false },
    ]);
    expect(r.unitSpans[2]).toEqual(r.unitSpans[0]);
    expect(r.unitSpans[3]).toEqual([{ line: 3, start: 2, end: 3, durStart: null }]);
    expect(checkSpans(text, r)).toEqual([]);
  });

  it('empty file and directive-only files have no spans', () => {
    expect(parseHarm('').lineSpans).toEqual([]);
    expect(parseHarm('@title X\n# A\n// c').unitSpans).toEqual([]);
  });

  it.each([
    ['quoc-ca-viet-nam', seedQuocCa],
    ['takediskrush', seedTakediskrush],
    ['bai-thu-nhip-dieu', seed1],
    ['bai-thu-lap-doan', seed2],
  ])('seed %s: every span matches its source token', (_id, src) => {
    const r = parseHarm(src);
    // Bài ngắn nhất: Quốc ca — 9 dòng (v1.0.1 bỏ "Phần 3" + "Phần 4").
    expect(r.lineSpans.length).toBeGreaterThanOrEqual(9);
    expect(checkSpans(src, r)).toEqual([]);
  });

  it('seed 2: repeated chorus lines point back at the chorus source lines', () => {
    const r = parseHarm(seed2);
    // dòng nốt đầu tiên ngay dưới `# ĐIỆP KHÚC`
    const chorusLine = sourceLines(seed2).indexOf('# ĐIỆP KHÚC') + 2;
    expect(chorusLine).toBeGreaterThan(1);
    const repeated = r.lineSpans.filter((s) => s.repeated);
    expect(repeated.length).toBeGreaterThan(0);
    expect(repeated.filter((s) => s.line === chorusLine)).toHaveLength(3);
  });

  it('stays linear on a very long line', () => {
    const text = `lời: ${'Z*2 [L] X-C*.5 [/L] '.repeat(20_000)}`;
    const t0 = performance.now();
    const r = parseHarm(text);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(r.unitSpans[0]).toHaveLength(40_000);
    expect(r.unitSpans[0]?.at(-1)?.end).toBe(text.length - 6);
  });
});

// ── donate chunk markers ───────────────────────────────────────────────────

describe('parseHarm: donate chunk markers "k/n "', () => {
  it('donateMarkerLength', () => {
    expect(donateMarkerLength('1/5 @title X')).toBe(4);
    expect(donateMarkerLength('  12/15\tZ')).toBe(8);
    expect(donateMarkerLength('1/2 3/4 x')).toBe(8);
    expect(donateMarkerLength('3/5')).toBe(3);
    expect(donateMarkerLength('3/5   ')).toBe(6);
    expect(donateMarkerLength('1/3: Z')).toBe(0);
    expect(donateMarkerLength('1/2x Z')).toBe(0);
    expect(donateMarkerLength('Z 1/2 X')).toBe(0);
    expect(donateMarkerLength('/2 Z')).toBe(0);
    expect(donateMarkerLength('')).toBe(0);
  });

  it('donateMarkerLength is linear on adversarial input', () => {
    const inputs = [
      `${'1/2 '.repeat(50_000)}x`,
      `${' '.repeat(200_000)}x`,
      `${'1'.repeat(100_000)}/${'2'.repeat(100_000)}x`,
      `${'1/2'.repeat(50_000)}`,
      `${'1/2 \t'.repeat(40_000)}3/`,
    ];
    const t0 = performance.now();
    const lens = inputs.map(donateMarkerLength);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(lens).toEqual([200_000, 0, 0, 0, 200_000]);
  });

  it('strips the marker before classifying: directive, header, comment, note line', () => {
    const text = [
      '1/5 @title Bài thử chia tin',
      '2/5 @bpm 160',
      '3/5 # ĐIỆP KHÚC',
      '4/5 // ghi chú',
      '5/5 Lời cũ: B*1.5 V*.5 C',
    ].join('\n');
    const r = parseHarm(text);
    expect(r.diagnostics).toEqual([]);
    expect(r.song.title).toBe('Bài thử chia tin');
    expect(r.song.bpm).toBe(160);
    expect(r.song.sections.map((s) => s.name)).toEqual(['ĐIỆP KHÚC']);
    expect(allLines(r)).toEqual([
      {
        units: [
          { kind: 'note', key: 'B', octave: 0, sharp: false, beats: 1.5 },
          { kind: 'note', key: 'V', octave: 0, sharp: false, beats: 0.5 },
          { kind: 'note', key: 'C', octave: 0, sharp: false, beats: 1 },
        ],
      },
    ]);
  });

  it('spans and diagnostics stay relative to the original line', () => {
    const text = '2/5 Lời: Q N*2\n10/12 [thả chuột trái]';
    const r = parseHarm(text);
    expect(r.lineSpans[0]).toEqual({ line: 1, tokensStart: 9, repeated: false });
    expect(r.unitSpans[0]).toEqual([{ line: 1, start: 11, end: 14, durStart: 12 }]);
    expect(r.diagnostics.map((d) => [d.code, d.line, d.column, d.length])).toEqual([
      ['unknown-token', 1, 10, 1],
      ['release-without-hold', 2, 7, 16],
    ]);
  });

  it('a line that is only a marker is ignored', () => {
    const r = parseHarm('3/5\n 4/5  \n1/2 3/4\nZ');
    expect(r.diagnostics).toEqual([]);
    expect(allLines(r)).toHaveLength(1);
  });

  it('several leading markers are all stripped; "1/3:" is a legacy prefix (dropped)', () => {
    for (const text of ['1/2 3/4 lời: Z', '1/3: Z', '1/2x y: Z']) {
      const r = parseHarm(text);
      expect(r.diagnostics).toEqual([]);
      expect(allLines(r)).toEqual([
        { units: [{ kind: 'note', key: 'Z', octave: 0, sharp: false, beats: 1 }] },
      ]);
    }
  });

  it('@repeat of a marker line replays it with the same columns', () => {
    const text = '# A\n2/5 một: Z\n# B\n3/5 @repeat A';
    const r = parseHarm(text);
    expect(r.diagnostics).toEqual([]);
    expect(allLines(r)).toHaveLength(2);
    expect(r.lineSpans[1]).toEqual({ line: 2, tokensStart: 9, repeated: true });
  });

  it('the serializer never writes a lyric, even from a model carrying a legacy `lyric` key', () => {
    const legacyLine = {
      lyric: '2/9 năm ấy',
      units: [
        { kind: 'note', key: 'Z', octave: 0, sharp: false, beats: 1 },
        { kind: 'note', key: 'X', octave: 0, sharp: false, beats: 1 },
        { kind: 'note', key: 'C', octave: 0, sharp: false, beats: 1 },
      ],
    } as Line;
    const song: Song = {
      id: '',
      title: '',
      bpm: 90,
      timeSig: { num: 4, den: 4 },
      scrollDir: 1,
      sections: [{ name: 'A', lines: [legacyLine] }],
    };
    const text = serializeHarm(song);
    expect(text).not.toContain('năm ấy');
    expect(text).toContain('\nZ X C\n');
    const r = parseHarm(text);
    expect(r.diagnostics).toEqual([]);
    expect(r.song).toStrictEqual(canonicalSong(song));
    expect(allLines(r)[0]).not.toHaveProperty('lyric');
    // model parser đọc ra là điểm bất động
    expect(canonicalSong(r.song)).toStrictEqual(r.song);
  });
});
