import { describe, expect, it } from 'vitest';
import { formatBeats, formatDecimal, parseBeats, parseDecimal } from './beats';

describe('parseBeats', () => {
  it('accepts decimals in every form', () => {
    expect(parseBeats('1')).toBe(1);
    expect(parseBeats('4')).toBe(4);
    expect(parseBeats('1.5')).toBe(1.5);
    expect(parseBeats('.5')).toBe(0.5);
    expect(parseBeats('0.25')).toBe(0.25);
    expect(parseBeats('2.')).toBe(2);
    expect(parseBeats('007')).toBe(7);
    expect(parseBeats(' 2 ')).toBe(2);
  });

  it('accepts fractions a/b with decimal parts', () => {
    expect(parseBeats('1/3')).toBe(1 / 3);
    expect(parseBeats('2/3')).toBe(2 / 3);
    expect(parseBeats('3/2')).toBe(1.5);
    expect(parseBeats('1.5/3')).toBe(0.5);
    expect(parseBeats('.5/2')).toBe(0.25);
  });

  it('rejects malformed, zero, negative and non-finite values', () => {
    for (const bad of [
      '',
      ' ',
      '.',
      '0',
      '0.0',
      '-1',
      '+1',
      'abc',
      '1e3',
      '1,5',
      '1..5',
      '0x10',
      'Infinity',
      'NaN',
      '1/0',
      '0/3',
      '1/',
      '/2',
      '1/2/3',
      '1/-2',
      '1 / 2',
      '9'.repeat(400),
    ]) {
      expect(parseBeats(bad), bad).toBeNull();
    }
  });

  it('parseDecimal is the decimal-only variant (allows 0)', () => {
    expect(parseDecimal('0')).toBe(0);
    expect(parseDecimal('76.5')).toBe(76.5);
    expect(parseDecimal('1/2')).toBeNull();
    expect(parseDecimal('1e2')).toBeNull();
  });

  it('keeps the same accept/reject set for decimals', () => {
    const accepted: [string, number][] = [
      ['1', 1],
      ['1.5', 1.5],
      ['.5', 0.5],
      ['2.', 2],
      ['007', 7],
      ['0.25', 0.25],
      ['12.34', 12.34],
      ['0', 0],
    ];
    for (const [s, v] of accepted) expect(parseDecimal(s), s).toBe(v);
    for (const bad of ['', '.', '1..5', '1e3', '+1', '1,5', '1.2.3', '-1', '..5', '1.5.']) {
      expect(parseDecimal(bad), bad).toBeNull();
    }
  });

  it('rejects long invalid digit runs in linear time (no regex backtracking blow-up)', () => {
    const digits = '1'.repeat(200_000);
    const t0 = performance.now();
    expect(parseBeats(`${digits}x`)).toBeNull();
    expect(parseDecimal(`${digits}x`)).toBeNull();
    expect(parseBeats(`${digits}.${digits}x`)).toBeNull();
    expect(parseBeats(`1/${digits}x`)).toBeNull();
    // bản regex cũ mất cỡ phút với 200k chữ số
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('formatBeats', () => {
  it('keeps short decimals and integers as is', () => {
    expect(formatBeats(1)).toBe('1');
    expect(formatBeats(4)).toBe('4');
    expect(formatBeats(0.5)).toBe('0.5');
    expect(formatBeats(0.25)).toBe('0.25');
    expect(formatBeats(0.125)).toBe('0.125');
    expect(formatBeats(0.0625)).toBe('0.0625');
    expect(formatBeats(1.5)).toBe('1.5');
    expect(formatBeats(1234567)).toBe('1234567');
  });

  it('writes long repeating values as reduced fractions', () => {
    expect(formatBeats(1 / 3)).toBe('1/3');
    expect(formatBeats(2 / 3)).toBe('2/3');
    expect(formatBeats(4 / 3)).toBe('4/3');
    expect(formatBeats(1 / 6)).toBe('1/6');
    expect(formatBeats(0.03125)).toBe('1/32');
    expect(formatBeats(1 / 7)).toBe('1/7');
  });

  it('falls back to the decimal when no small fraction fits or it is not shorter', () => {
    expect(formatBeats(0.1)).toBe('0.1');
    expect(formatBeats(Math.PI)).toBe(String(Math.PI));
    expect(formatBeats(1234567.5)).toBe('1234567.5');
  });

  it('never uses exponent notation', () => {
    expect(formatDecimal(1e-7)).toBe('0.0000001');
    expect(formatDecimal(1.5e-7)).toBe('0.00000015');
    expect(formatDecimal(1e21)).toBe('1000000000000000000000');
    expect(formatDecimal(1.25e22)).toBe('12500000000000000000000');
    expect(formatBeats(1e-7)).not.toMatch(/e/i);
  });

  it('round-trips through parseBeats', () => {
    const values = [
      1,
      0.5,
      0.25,
      0.75,
      0.125,
      1 / 3,
      2 / 3,
      1 / 6,
      1 / 9,
      2 / 9,
      0.1,
      0.2,
      0.3,
      1.1,
      Math.PI,
      Math.E,
      1e-7,
      5e-324,
      1e21,
      Number.MAX_VALUE,
      123456.789,
    ];
    // các giá trị chia luyến 2..7 nốt
    for (let d = 1; d <= 64; d++) {
      for (const t of [0.25, 0.5, 1, 1.5, 2, 3, 1 / 3, 2 / 3]) values.push(t / d);
    }
    let seed = 7;
    for (let i = 0; i < 500; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      values.push((seed / 2147483648) * 16 + 1e-9);
    }
    for (const v of values) {
      const s = formatBeats(v);
      expect(parseBeats(s), `${v} -> ${s}`).toBe(v);
    }
  });
});
