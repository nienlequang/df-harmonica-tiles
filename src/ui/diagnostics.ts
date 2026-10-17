import type { Diagnostic } from '../core/types';
import type { TFunction } from '../i18n/useT';
import { isStringKey } from '../i18n/strings';

/**
 * Diagnostic của parser → thông điệp đã dịch (DECISIONS D-017: core chỉ trả `code` + `params`).
 * - `params.button` / `params.other` ('left' | 'right' | 'scroll') dịch qua `diag.button.<x>`;
 * - `params.fromLine` (lỗi phát sinh khi replay `@repeat`, D-041) nối thêm `diag.fromRepeat`;
 * - code chưa có chuỗi (core thêm code mới trước UI) → hiện nguyên code, không crash.
 */
export function formatDiagnostic(t: TFunction, d: Diagnostic): string {
  const params: Record<string, string | number> = { ...d.params };
  for (const name of ['button', 'other'] as const) {
    const key = `diag.button.${String(params[name])}`;
    if (params[name] !== undefined && isStringKey(key)) params[name] = t(key);
  }
  const msgKey = `diag.${d.code}`;
  let message = isStringKey(msgKey) ? t(msgKey, params) : d.code;
  const fromLine = d.params?.fromLine;
  if (typeof fromLine === 'number') message += ` ${t('diag.fromRepeat', { line: fromLine })}`;
  return message;
}

/** Chỉ các diagnostic mức lỗi, theo thứ tự dòng/cột trong nguồn. */
export function errorDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics
    .filter((d) => d.severity === 'error')
    .sort((a, b) => a.line - b.line || a.column - b.column);
}
