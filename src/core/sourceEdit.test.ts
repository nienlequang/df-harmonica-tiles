import { describe, expect, it } from 'vitest';
import { parseHarm } from './parser';
import { applyTextEdits, setUnitBeats } from './sourceEdit';
import type { Line, ParseResult, Unit } from './types';
import seedQuocCa from '../library/seeds/quoc-ca-viet-nam.harm?raw';
import seedTakediskrush from '../library/seeds/takediskrush.harm?raw';
// Hai bài tự soạn chỉ dùng cho test (src/test/fixtures/, app không import).
import seed1 from '../test/fixtures/bai-thu-nhip-dieu.harm?raw';
import seed2 from '../test/fixtures/bai-thu-lap-doan.harm?raw';

function allLines(r: ParseResult): Line[] {
  return r.song.sections.flatMap((s) => s.lines);
}
function totalBeats(u: Unit): number {
  return u.kind === 'slur' ? u.notes.reduce((s, n) => s + n.beats, 0) : u.beats;
}
/** Model không tính độ dài (loại, phím, quãng, scroll) — sửa dur không được đổi phần này. */
function pitches(r: ParseResult): unknown {
  return allLines(r).map((l) =>
    l.units.map((u) =>
      u.kind === 'rest'
        ? 'rest'
        : u.kind === 'note'
          ? [u.key, u.octave, u.sharp]
          : u.notes.map((n) => [n.key, n.octave, n.sharp]),
    ),
  );
}
function errorCount(r: ParseResult): number {
  return r.diagnostics.filter((d) => d.severity === 'error').length;
}
/** Dòng không phải dòng nốt (directive, header, comment, trống) — sửa tại chỗ không được đụng. */
function nonNoteLines(text: string): string[] {
  return text.split(/\r?\n/).filter((l) => /^\s*(?:@|#|\/\/|$)/.test(l));
}

// ── applyTextEdits ─────────────────────────────────────────────────────────

describe('applyTextEdits', () => {
  it('replaces, inserts and deletes on one line, in any input order', () => {
    const src = 'Z X C V';
    expect(
      applyTextEdits(src, [
        { line: 1, start: 6, end: 7, text: 'B*2' },
        { line: 1, start: 0, end: 0, text: 'lời: ' },
        { line: 1, start: 2, end: 4, text: '' },
      ]),
    ).toBe('lời: Z C B*2');
  });

  it('keeps BOM, \\r\\n / \\n line endings and the trailing newline', () => {
    const src = '﻿@title A\r\nZ X\nC\r\n';
    const out = applyTextEdits(src, [
      { line: 2, start: 1, end: 1, text: '*2' },
      { line: 3, start: 0, end: 1, text: 'V' },
      { line: 1, start: 7, end: 8, text: 'B' },
    ]);
    expect(out).toBe('﻿@title B\r\nZ*2 X\nV\r\n');
    // cột dòng 1 tính sau BOM, như parser
    expect(applyTextEdits('﻿Z', [{ line: 1, start: 0, end: 1, text: 'X' }])).toBe('﻿X');
  });

  it('counts a lone \\r as a line break like the parser, and keeps it', () => {
    const src = 'Z\rX\r\nC';
    const out = applyTextEdits(src, [
      { line: 2, start: 1, end: 1, text: '*2' },
      { line: 3, start: 0, end: 1, text: 'V' },
    ]);
    expect(out).toBe('Z\rX*2\r\nV');
    // setUnitBeats theo span của parser rơi đúng dòng 2
    expect(setUnitBeats(src, parseHarm(src), [{ lineIndex: 1, unitIndex: 0, beats: 3 }])).toBe(
      'Z\rX*3\r\nC',
    );
  });

  it('can edit the empty last line after a trailing newline', () => {
    expect(applyTextEdits('Z\n', [{ line: 2, start: 0, end: 0, text: 'X' }])).toBe('Z\nX');
    expect(applyTextEdits('', [{ line: 1, start: 0, end: 0, text: 'Z' }])).toBe('Z');
  });

  it('ignores out-of-range or malformed edits', () => {
    const src = 'Z X\nC';
    const bad = [
      { line: 0, start: 0, end: 0, text: 'a' },
      { line: 3, start: 0, end: 0, text: 'a' },
      { line: 1, start: -1, end: 0, text: 'a' },
      { line: 1, start: 0, end: 4, text: 'a' },
      { line: 2, start: 1, end: 0, text: 'a' },
      { line: 1.5, start: 0, end: 0, text: 'a' },
      { line: 1, start: Number.NaN, end: 0, text: 'a' },
      { line: 1, start: 0, end: 0, text: 5 as unknown as string },
    ];
    expect(applyTextEdits(src, bad)).toBe(src);
    expect(applyTextEdits(src, [...bad, { line: 2, start: 1, end: 1, text: '*2' }])).toBe(
      'Z X\nC*2',
    );
  });

  it('returns the source unchanged (same string) without edits', () => {
    const src = 'Z\r\nX';
    expect(applyTextEdits(src, [])).toBe(src);
  });

  it('throws RangeError on overlapping edits on the same line', () => {
    expect(() =>
      applyTextEdits('Z X C', [
        { line: 1, start: 0, end: 3, text: 'a' },
        { line: 1, start: 2, end: 5, text: 'b' },
      ]),
    ).toThrow(RangeError);
    // chèn bên trong vùng bị thay
    expect(() =>
      applyTextEdits('Z X C', [
        { line: 1, start: 0, end: 3, text: 'a' },
        { line: 1, start: 1, end: 1, text: 'b' },
      ]),
    ).toThrow(RangeError);
    // cùng một vùng hai lần
    expect(() =>
      applyTextEdits('Z X C', [
        { line: 1, start: 2, end: 3, text: 'a' },
        { line: 1, start: 2, end: 3, text: 'b' },
      ]),
    ).toThrow(RangeError);
  });

  it('touching edits are not overlapping; inserts at one point keep input order', () => {
    expect(
      applyTextEdits('Z X', [
        { line: 1, start: 0, end: 1, text: 'C' },
        { line: 1, start: 1, end: 2, text: '-' },
        { line: 1, start: 1, end: 1, text: '*2' },
      ]),
    ).toBe('C*2-X');
    expect(
      applyTextEdits('Z', [
        { line: 1, start: 1, end: 1, text: 'a' },
        { line: 1, start: 1, end: 1, text: 'b' },
        { line: 1, start: 0, end: 1, text: 'X' },
      ]),
    ).toBe('Xab');
    // dòng khác nhau không bao giờ chồng
    expect(
      applyTextEdits('Z\nX', [
        { line: 1, start: 0, end: 1, text: 'C' },
        { line: 2, start: 0, end: 1, text: 'V' },
      ]),
    ).toBe('C\nV');
  });
});

// ── setUnitBeats ───────────────────────────────────────────────────────────

describe('setUnitBeats', () => {
  it('replaces, inserts or removes *dur (beats 1 removes it)', () => {
    const src = 'lời ơi: Z X*2 _*.5 C';
    const r = parseHarm(src);
    const out = setUnitBeats(src, r, [
      { lineIndex: 0, unitIndex: 0, beats: 1.5 },
      { lineIndex: 0, unitIndex: 1, beats: 1 },
      { lineIndex: 0, unitIndex: 2, beats: 0.25 },
      { lineIndex: 0, unitIndex: 3, beats: 1 / 3 },
    ]);
    expect(out).toBe('lời ơi: Z*1.5 X _*0.25 C*1/3');
    expect(allLines(parseHarm(out))[0]?.units.map(totalBeats)).toEqual([1.5, 1, 0.25, 1 / 3]);
  });

  it('a slur takes the TOTAL; prefixes and holds are untouched', () => {
    const src = '[giữ chuột phải] X-S:C*2 [thả chuột phải] Z-S:X';
    const r = parseHarm(src);
    const out = setUnitBeats(src, r, [
      { lineIndex: 0, unitIndex: 0, beats: 3 },
      { lineIndex: 0, unitIndex: 1, beats: 0.5 },
    ]);
    expect(out).toBe('[giữ chuột phải] X-S:C*3 [thả chuột phải] Z-S:X*0.5');
    const back = parseHarm(out);
    expect(allLines(back)[0]?.units.map(totalBeats)).toEqual([3, 0.5]);
    expect(pitches(back)).toEqual(pitches(r));
  });

  it('fixes an invalid duration in place', () => {
    const src = 'Z*0 X*abc';
    const r = parseHarm(src);
    expect(r.ok).toBe(false);
    const out = setUnitBeats(src, r, [
      { lineIndex: 0, unitIndex: 0, beats: 2 },
      { lineIndex: 0, unitIndex: 1, beats: 1 },
    ]);
    expect(out).toBe('Z*2 X');
    expect(parseHarm(out).ok).toBe(true);
  });

  it('skips invalid indices and non-positive / non-finite beats', () => {
    const src = 'Z X';
    const r = parseHarm(src);
    expect(
      setUnitBeats(src, r, [
        { lineIndex: 1, unitIndex: 0, beats: 2 },
        { lineIndex: 0, unitIndex: 2, beats: 2 },
        { lineIndex: -1, unitIndex: 0, beats: 2 },
        { lineIndex: 0, unitIndex: 0.5, beats: 2 },
        { lineIndex: 0, unitIndex: 0, beats: 0 },
        { lineIndex: 0, unitIndex: 0, beats: -1 },
        { lineIndex: 0, unitIndex: 0, beats: Number.NaN },
        { lineIndex: 0, unitIndex: 0, beats: Number.POSITIVE_INFINITY },
      ]),
    ).toBe(src);
  });

  it('@repeat: changes hitting the same source token → last one wins', () => {
    const src = '# A\nZ X\n# B\n@repeat A';
    const r = parseHarm(src);
    expect(r.lineSpans.map((s) => s.repeated)).toEqual([false, true]);
    const out = setUnitBeats(src, r, [
      { lineIndex: 1, unitIndex: 0, beats: 2 },
      { lineIndex: 0, unitIndex: 0, beats: 0.5 },
      { lineIndex: 1, unitIndex: 1, beats: 4 },
    ]);
    expect(out).toBe('# A\nZ*0.5 X*4\n# B\n@repeat A');
    expect(allLines(parseHarm(out)).map((l) => l.units.map(totalBeats))).toEqual([
      [0.5, 4],
      [0.5, 4],
    ]);
  });

  it('keeps \\r\\n and the BOM', () => {
    const src = '﻿@bpm 90\r\nZ X\r\n';
    expect(setUnitBeats(src, parseHarm(src), [{ lineIndex: 0, unitIndex: 1, beats: 2 }])).toBe(
      '﻿@bpm 90\r\nZ X*2\r\n',
    );
  });

  it.each([
    ['quoc-ca-viet-nam', seedQuocCa],
    ['takediskrush', seedTakediskrush],
    ['bai-thu-nhip-dieu', seed1],
    ['bai-thu-lap-doan', seed2],
  ])('seed %s: every unit rewritten re-parses to the expected beats', (_id, src) => {
    const r = parseHarm(src);
    const pattern = [0.5, 1, 1.5, 2, 1 / 3, 0.25, 4, 0.75];
    const changes: Array<{ lineIndex: number; unitIndex: number; beats: number }> = [];
    // giá trị mong đợi theo token nguồn: thay đổi sau cùng thắng (dòng @repeat dùng chung token)
    const expectedByToken = new Map<string, number>();
    let k = 0;
    r.unitSpans.forEach((spans, i) => {
      spans.forEach((s, j) => {
        const beats = pattern[k++ % pattern.length] ?? 1;
        changes.push({ lineIndex: i, unitIndex: j, beats });
        expectedByToken.set(`${s.line}:${s.start}`, beats);
      });
    });
    const out = setUnitBeats(src, r, changes);
    const back = parseHarm(out);
    // độ dài không đổi số chữ / số unit: cùng các diagnostic (chỉ cột token có thể dời)
    expect(back.diagnostics.map((d) => [d.code, d.line])).toEqual(
      r.diagnostics.map((d) => [d.code, d.line]),
    );
    expect(errorCount(back)).toBe(0);
    expect(pitches(back)).toEqual(pitches(r));
    expect(nonNoteLines(out)).toEqual(nonNoteLines(src));
    const got = allLines(back).map((l) => l.units.map(totalBeats));
    const want = r.unitSpans.map((spans) =>
      spans.map((s) => expectedByToken.get(`${s.line}:${s.start}`)),
    );
    expect(got.length).toBe(want.length);
    got.forEach((line, i) => {
      line.forEach((b, j) => expect(b).toBeCloseTo(want[i]?.[j] ?? Number.NaN, 12));
    });
    // đặt lại 1 beat cho mọi unit: bỏ hết *dur
    const reset = setUnitBeats(
      out,
      back,
      changes.map((c) => ({ ...c, beats: 1 })),
    );
    expect(reset).not.toMatch(/[ZXCVBNM,_]\*/);
  });
});
