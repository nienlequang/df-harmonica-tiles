import { describe, expect, it } from 'vitest';
import type { Diagnostic, DiagnosticCode } from '../core/types';
import type { StringKey, TParams } from '../i18n/strings';
import { translateCount } from '../i18n/useT';
import { errorDiagnostics, formatDiagnostic } from './diagnostics';

const tVi = (key: StringKey, params?: TParams) => translateCount('vi', key, params);
const tEn = (key: StringKey, params?: TParams) => translateCount('en', key, params);

const diag = (over: Partial<Diagnostic>): Diagnostic => ({
  severity: 'error',
  code: 'unknown-token',
  line: 1,
  column: 1,
  length: 1,
  ...over,
});

describe('formatDiagnostic', () => {
  it('điền tham số vào chuỗi diag.<code>', () => {
    expect(formatDiagnostic(tVi, diag({ params: { token: 'Q' } }))).toBe('Token lạ: "Q"');
    expect(formatDiagnostic(tEn, diag({ params: { token: 'Q' } }))).toBe('Unknown token: "Q"');
  });

  it('dịch tên nút chuột (button / other)', () => {
    const d = diag({ code: 'hold-conflict', params: { button: 'left', other: 'right' } });
    expect(formatDiagnostic(tVi, d)).toBe('Không thể giữ chuột trái khi đang giữ chuột phải');
    expect(formatDiagnostic(tEn, d)).toBe('Cannot hold left mouse while holding right mouse');
  });

  it('lỗi phát sinh khi replay @repeat: nối dòng gốc', () => {
    const d = diag({ code: 'release-without-hold', params: { button: 'scroll', fromLine: 4 } });
    expect(formatDiagnostic(tVi, d)).toBe('Thả scroll khi chưa giữ (trong @repeat, dòng gốc 4)');
  });

  it('code chưa có chuỗi → hiện code, không crash', () => {
    const d = diag({ code: 'brand-new-code' as DiagnosticCode });
    expect(formatDiagnostic(tVi, d)).toBe('brand-new-code');
  });
});

describe('errorDiagnostics', () => {
  it('chỉ giữ lỗi, sắp theo dòng rồi cột', () => {
    const list = [
      diag({ line: 5, column: 2 }),
      diag({ severity: 'warning', line: 1 }),
      diag({ line: 2, column: 9 }),
      diag({ line: 2, column: 3 }),
      diag({ severity: 'info', line: 1 }),
    ];
    expect(errorDiagnostics(list).map((d) => [d.line, d.column])).toEqual([
      [2, 3],
      [2, 9],
      [5, 2],
    ]);
  });
});
