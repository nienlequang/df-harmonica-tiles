import { describe, expect, it } from 'vitest';
import { AI_PROMPT_EN, AI_PROMPT_VI } from '../aiPrompt';
import { countOctaveDigits, everySyllableHasOctaveDigit } from './camamDigits';

describe('countOctaveDigits / everySyllableHasOctaveDigit', () => {
  it('mọi âm có số quãng (dạng prompt AI) → true', () => {
    const text = [
      '@title Bài mẫu',
      '@bpm 76',
      '# Đoạn 1',
      '// không chắc ô nhịp 2',
      'Đây là câu: la1*0.5 mi1*0.5 do2 re2mi2 si1*2 _*0.5',
      'Câu hai: fa#1 sib1 do2*1/3 Do3 - _',
    ].join('\n');
    expect(countOctaveDigits(text)).toEqual({ syllables: 10, withDigit: 10 });
    expect(everySyllableHasOctaveDigit(text)).toBe(true);
  });

  it('một âm không có số → false', () => {
    expect(everySyllableHasOctaveDigit('do1 re1 mi')).toBe(false);
    // luyến: âm thứ hai thiếu số
    expect(countOctaveDigits('do1re')).toEqual({ syllables: 2, withDigit: 1 });
    expect(everySyllableHasOctaveDigit('Dola')).toBe(false);
  });

  it('không có âm nào → false', () => {
    expect(everySyllableHasOctaveDigit('')).toBe(false);
    expect(everySyllableHasOctaveDigit('@title X\n# A\n// do1\n_ _*2 -')).toBe(false);
  });

  it('bỏ qua lời, directive, header, comment và token không đọc được', () => {
    // "do" trong lời không tính; "xyz", "do4" (quãng ngoài 1..3), "do-" không đọc được
    const text = 'do re mi: do1 re2 xyz do4 do- mi3\n# do\n@title do';
    expect(countOctaveDigits(text)).toEqual({ syllables: 3, withDigit: 3 });
    expect(everySyllableHasOctaveDigit(text)).toBe(true);
  });

  it('dấu phẩy, CRLF, BOM, dấu tiếng Việt, ♯ ♭, dấu nối giữa hai âm', () => {
    const text = '﻿Đô1,Rê2\r\nPha♯1 si♭2 do1-re1\rsol3*2';
    expect(countOctaveDigits(text)).toEqual({ syllables: 7, withDigit: 7 });
  });

  it('dòng có dấu hai chấm không theo sau khoảng trắng không bị coi là lời', () => {
    expect(countOctaveDigits('do1:re1')).toEqual({ syllables: 0, withDigit: 0 });
    expect(countOctaveDigits('lời: do1')).toEqual({ syllables: 1, withDigit: 1 });
  });

  it('ví dụ đầu ra trong cả hai prompt AI đều được nhận ra', () => {
    for (const p of [AI_PROMPT_VI, AI_PROMPT_EN]) {
      const example = /\n```text\n([\s\S]*?)\n```$/.exec(p)?.[1] ?? '';
      expect(everySyllableHasOctaveDigit(example)).toBe(true);
    }
  });
});
