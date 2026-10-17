import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { BUILD_INFO, formatBuildDate } from './buildInfo';

describe('buildInfo (trang Dev notes)', () => {
  it('phiên bản = package.json; Vitest không có commit / ngày build (trang ghi "không rõ")', () => {
    expect(BUILD_INFO.version).toBe(pkg.version);
    expect(BUILD_INFO.commit).toBe('');
    expect(BUILD_INFO.builtAt).toBe('');
  });

  it('formatBuildDate: ISO → "YYYY-MM-DD HH:MM UTC", không phụ thuộc múi giờ; rỗng / sai → ""', () => {
    expect(formatBuildDate('2026-10-16T05:30:12.345Z')).toBe('2026-10-16 05:30 UTC');
    expect(formatBuildDate('2026-10-16T23:59:59+07:00')).toBe('2026-10-16 16:59 UTC');
    expect(formatBuildDate('')).toBe('');
    expect(formatBuildDate('không phải ngày')).toBe('');
  });
});
