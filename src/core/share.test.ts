import LZString from 'lz-string';
import { describe, expect, it } from 'vitest';
import { parseHarm } from './parser';
import {
  SHARE_URL_SOFT_LIMIT,
  buildShareUrl,
  decodeShareData,
  encodeShareData,
  isShareUrlLong,
  isShareableSource,
  sanitizeShareSource,
} from './share';
import seed1 from '../test/fixtures/bai-thu-nhip-dieu.harm?raw';
import seed2 from '../test/fixtures/bai-thu-lap-doan.harm?raw';

const LOC = { origin: 'https://harmonica.example.app', pathname: '/' };

describe('share data', () => {
  it.each([
    ['seed 1', seed1],
    ['seed 2', seed2],
    ['emoji + CRLF + BOM', '﻿@title 😀 Thử\r\nlời ơi: Z X*2 [giữ scroll] N [thả scroll]\r\n'],
    ['tab and NBSP', `a\tb${String.fromCharCode(0xa0)}c: Z`],
  ])('%s: encode → decode returns the exact source', (_name, src) => {
    const data = encodeShareData(src);
    expect(data).toMatch(/^[A-Za-z0-9+\-$]+$/);
    expect(decodeShareData(data)).toBe(src);
  });

  it('is plain lz-string compressToEncodedURIComponent', () => {
    expect(encodeShareData(seed1)).toBe(LZString.compressToEncodedURIComponent(seed1));
  });

  it('compresses: seed 2 link is far below the soft limit', () => {
    const url = buildShareUrl(seed2, LOC);
    expect(url.length).toBeLessThan(seed2.length);
    expect(isShareUrlLong(url)).toBe(false);
  });

  it('null on empty or invalid data, never throws', () => {
    for (const bad of [
      '',
      '   ',
      '!!!',
      'abc def!',
      '%E0%A4%A',
      'Q',
      'AAAA',
      '////',
      undefined as unknown as string,
      null as unknown as string,
    ]) {
      expect(decodeShareData(bad), String(bad)).toBeNull();
    }
    expect(decodeShareData(encodeShareData(''))).toBeNull();
  });

  it('tolerates links mangled by chat apps (percent-encoding, "+" → space, whitespace)', () => {
    const src = '@title Chia sẻ\nĐồ rê mi: Z X C [giữ chuột phải] V [thả chuột phải]';
    const data = encodeShareData(src);
    expect(decodeShareData(` ${data}\n`)).toBe(src);
    expect(decodeShareData(encodeURIComponent(data))).toBe(src);
    expect(decodeShareData(data.replace(/\+/g, ' '))).toBe(src);
  });

  it.each([
    ['vertical tab (Word soft line break)', '@title A\u000bB\nZ X', '@title A B\nZ X'],
    ['form feed', 'Z X\f', 'Z X '],
    ['NUL in a legacy lyric prefix', 'lời\u0000: Z', 'lời : Z'],
  ])('%s: a source that parses ok gives a link that decodes', (_name, src, clean) => {
    // trước đây: parse ok nhưng decodeShareData(encodeShareData(src)) = null (link "hỏng")
    expect(parseHarm(src).ok).toBe(true);
    expect(sanitizeShareSource(src)).toBe(clean);
    expect(isShareableSource(src)).toBe(true);
    const back = decodeShareData(encodeShareData(src));
    expect(back).toBe(clean);
    // parser coi \v \f là khoảng trắng; NUL chỉ nằm trong tiền tố kiểu cũ (bị bỏ): cùng dãy nốt
    const r = parseHarm(back ?? '');
    expect(r.ok).toBe(true);
    expect(r.song.sections).toStrictEqual(parseHarm(src).song.sections);
  });

  it('other C0 controls and lone surrogates are cleaned before compressing', () => {
    const fffd = String.fromCharCode(0xfffd);
    const hi = String.fromCharCode(0xd83d);
    const lo = String.fromCharCode(0xde00);
    for (const [src, clean] of [
      ['\u0001Z\u001fX\u0008', ' Z X '],
      [`a${hi} b${lo} 😀`, `a${fffd} b${fffd} 😀`],
      [`${lo}${hi}`, `${fffd}${fffd}`],
    ] as const) {
      expect(sanitizeShareSource(src)).toBe(clean);
      expect(decodeShareData(encodeShareData(src))).toBe(clean);
    }
  });

  it('sanitizeShareSource keeps normal text untouched (same string)', () => {
    for (const src of [seed1, seed2, 'a\tb\r\nc\n', '\ufeff😀 Đồ rê', '']) {
      expect(sanitizeShareSource(src)).toBe(src);
    }
    expect(sanitizeShareSource(undefined as unknown as string)).toBe('');
  });

  it('isShareableSource: false for an empty / blank song (its link could only show "broken")', () => {
    for (const blank of ['', '   ', ' \n\r\n\t', '\u0000\u000b']) {
      expect(isShareableSource(blank), JSON.stringify(blank)).toBe(false);
    }
    expect(decodeShareData(encodeShareData(''))).toBeNull();
    expect(isShareableSource('Z')).toBe(true);
  });

  it('fuzz: every shareable source round-trips to its sanitized form', () => {
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const pool = [
      'Z',
      'X',
      ' ',
      '\n',
      '\r',
      '\t',
      ':',
      '[',
      ']',
      'ế',
      '😀',
      '\u0000',
      '\u000b',
      '\f',
      '\u001b',
      '\ud800',
      '\udfff',
      '\u2028',
      '\ufeff',
    ];
    for (let n = 0; n < 300; n++) {
      let s = '';
      const len = Math.floor(rnd() * 40);
      for (let i = 0; i < len; i++) s += pool[Math.floor(rnd() * pool.length)] ?? '';
      const back = decodeShareData(encodeShareData(s));
      if (isShareableSource(s)) expect(back, JSON.stringify(s)).toBe(sanitizeShareSource(s));
      else expect(back === null || back.trim() === '', JSON.stringify(s)).toBe(true);
    }
  });

  it('a truncated link does not decode to the original song', () => {
    const data = encodeShareData(seed2);
    const cut = decodeShareData(data.slice(0, Math.floor(data.length / 2)));
    expect(cut).not.toBe(seed2);
  });
});

describe('buildShareUrl / isShareUrlLong', () => {
  it('origin + pathname + #/s/ + data (current hash and query dropped)', () => {
    const src = 'Z X C';
    expect(buildShareUrl(src, { origin: 'http://localhost:5173', pathname: '/app/' })).toBe(
      `http://localhost:5173/app/#/s/${encodeShareData(src)}`,
    );
  });

  it('the hash part opens the song again', () => {
    const url = buildShareUrl(seed1, LOC);
    const hash = url.slice(url.indexOf('#'));
    expect(hash.startsWith('#/s/')).toBe(true);
    const back = decodeShareData(hash.slice('#/s/'.length));
    expect(back).toBe(seed1);
    expect(parseHarm(back ?? '').song).toStrictEqual(parseHarm(seed1).song);
  });

  it('soft limit is 8000 characters', () => {
    expect(SHARE_URL_SOFT_LIMIT).toBe(8000);
    expect(isShareUrlLong('x'.repeat(8000))).toBe(false);
    expect(isShareUrlLong('x'.repeat(8001))).toBe(true);
  });

  it('a huge song makes a long link', () => {
    let big = '';
    let seed = 7;
    const keys = 'ZXCVBNM,';
    for (let i = 0; i < 20_000; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      big += `${keys[seed % 8]}*${(seed >> 8) % 4} `;
      if (i % 12 === 11) big += '\n';
    }
    expect(isShareUrlLong(buildShareUrl(big, LOC))).toBe(true);
  });
});
