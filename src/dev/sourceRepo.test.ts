import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import license from '../../LICENSE?raw';
import { SOURCE_REPO_URL } from './sourceRepo';

describe('mã nguồn công khai (D-444)', () => {
  it('SOURCE_REPO_URL trùng `repository` của package.json; giấy phép MIT; vẫn `private` (không publish lên npm)', () => {
    expect(SOURCE_REPO_URL).toBe('https://github.com/nienlequang/df-harmonica-tiles');
    expect(pkg.repository).toEqual({ type: 'git', url: `git+${SOURCE_REPO_URL}.git` });
    expect(pkg.license).toBe('MIT');
    expect(pkg.private).toBe(true);
  });

  it('LICENSE là văn bản MIT chuẩn, đúng chủ bản quyền', () => {
    const text = license.replace(/\r\n/g, '\n');
    expect(text.startsWith('MIT License\n\nCopyright (c) 2026 nienlequang\n\n')).toBe(true);
    expect(text).toContain(
      'Permission is hereby granted, free of charge, to any person obtaining a copy',
    );
    expect(text).toContain(
      'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
    );
    expect(text.endsWith('SOFTWARE.\n')).toBe(true);
  });
});
