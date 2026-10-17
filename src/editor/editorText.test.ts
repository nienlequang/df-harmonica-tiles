import { describe, expect, it } from 'vitest';
import { parseHarm } from '../core/parser';
import { lineStarts, modelLineAtSource, normalizeEol, offsetAt, positionAt } from './editorText';

// Bài tự soạn chỉ dùng cho test (src/test/fixtures/, app không import): dài, có @repeat + giữ chuột.
import SEED_2 from '../test/fixtures/bai-thu-lap-doan.harm?raw';

describe('normalizeEol / lineStarts', () => {
  it('CRLF và CR thành LF', () => {
    expect(normalizeEol('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });
  it('offset đầu mỗi dòng', () => {
    expect(lineStarts('ab\ncd\n\ne')).toEqual([0, 3, 6, 7]);
    expect(lineStarts('')).toEqual([0]);
  });
});

describe('offsetAt / positionAt', () => {
  const text = '@title A\nZ X Q\n\nlast';

  it('dòng/cột 1-based → offset và ngược lại', () => {
    expect(offsetAt(text, 1, 1)).toBe(0);
    expect(offsetAt(text, 2, 5)).toBe(13);
    expect(text[13]).toBe('Q');
    expect(positionAt(text, 13)).toEqual({ line: 2, column: 5 });
    expect(offsetAt(text, 4, 3)).toBe(text.indexOf('last') + 2);
  });

  it('kẹp dòng / cột ngoài phạm vi', () => {
    expect(offsetAt(text, 2, 99)).toBe(14); // cuối dòng 2 (trước \n)
    expect(offsetAt(text, 99, 1)).toBe(text.indexOf('last'));
    expect(offsetAt(text, 0, 0)).toBe(0);
    expect(offsetAt(text, Number.NaN, Number.NaN)).toBe(0);
    expect(positionAt(text, 999)).toEqual({ line: 4, column: 5 });
    expect(positionAt(text, -5)).toEqual({ line: 1, column: 1 });
  });

  it('con trỏ ngay trước xuống dòng vẫn thuộc dòng đó', () => {
    expect(positionAt('ab\ncd', 2)).toEqual({ line: 1, column: 3 });
    expect(positionAt('ab\ncd', 3)).toEqual({ line: 2, column: 1 });
  });

  it('BOM: cột dòng 1 tính sau BOM như parser', () => {
    const bom = '﻿Z Q';
    const d = parseHarm(bom).diagnostics.find((x) => x.code === 'unknown-token');
    expect(d).toMatchObject({ line: 1, column: 3 });
    expect(bom[offsetAt(bom, 1, 3)]).toBe('Q');
    expect(positionAt(bom, 3)).toEqual({ line: 1, column: 3 });
  });
});

describe('modelLineAtSource', () => {
  it('bài rỗng → -1; con trỏ sau mọi dòng → dòng cuối', () => {
    expect(modelLineAtSource([], 3)).toBe(-1);
    const origins = [{ sourceLine: 2 }, { sourceLine: 4 }];
    expect(modelLineAtSource(origins, 1)).toBe(0);
    expect(modelLineAtSource(origins, 3)).toBe(1);
    expect(modelLineAtSource(origins, 9)).toBe(1);
  });

  it('seed 2: dòng thường, comment, @repeat trỏ tới dòng do repeat chèn', () => {
    const lines = SEED_2.split('\n');
    const at = (prefix: string) => lines.findIndex((l) => l.startsWith(prefix)) + 1;
    const { lineOrigins } = parseHarm(SEED_2);

    // Điệp khúc gốc: dòng thứ 3 của section ĐIỆP KHÚC (sau 6 dòng ĐOẠN 1 + 5 dòng ĐOẠN 2)
    const chorus3 = at('# ĐIỆP KHÚC') + 3;
    expect(modelLineAtSource(lineOrigins, chorus3)).toBe(13);
    // Header / dòng trống → dòng nốt kế tiếp
    expect(modelLineAtSource(lineOrigins, at('# ĐOẠN 2'))).toBe(6);
    expect(modelLineAtSource(lineOrigins, 1)).toBe(0);

    // `# ĐOẠN 5` gồm 2 directive @repeat
    const repeat1 = at('@repeat ĐOẠN 2');
    const repeat2 = repeat1 + 1;
    expect(lines[repeat2 - 1]).toBe('@repeat ĐIỆP KHÚC');
    const i1 = modelLineAtSource(lineOrigins, repeat1);
    const i2 = modelLineAtSource(lineOrigins, repeat2);
    expect(i1).toBe(26);
    expect(i2).toBe(31);
    expect(lineOrigins[i1]).toMatchObject({ repeatLine: repeat1 });
    expect(lineOrigins[i2]).toMatchObject({ repeatLine: repeat2 });
    // dòng repeat trỏ về dòng gốc của điệp khúc
    expect(lineOrigins[i2]?.sourceLine).toBe(at('# ĐIỆP KHÚC') + 1);
  });
});
