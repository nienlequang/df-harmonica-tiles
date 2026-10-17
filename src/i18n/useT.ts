import { useCallback } from 'react';
import { useSettings } from '../ui/settings';
import type { Lang, StringKey, TParams } from './strings';
import { STRINGS, isStringKey } from './strings';

export type TFunction = (key: StringKey, params?: TParams) => string;

/** Số đếm bằng một: số 1 hoặc chuỗi "1" (số đã định dạng sẵn, vd. `formatBeats(1)`). */
function isOne(value: string | number | undefined): boolean {
  return value === 1 || value === '1';
}

/** `{name}` hoặc `{name:một|nhiều}` (dạng số ít / số nhiều theo tham số `name`). */
const PLACEHOLDER = /\{(\w+)(?::([^{}|]*)\|([^{}|]*))?\}/g;

/**
 * Dịch có số ít (DECISIONS D-064, D-143):
 * - `params.n` là 1 và có key `<key>_one` → dùng key đó ("Imported 1 song", không "1 songs");
 * - `{x:một|nhiều}` trong câu → chữ "một" khi `params.x` là 1, không thì "nhiều" — cho tham số đếm
 *   không tên `n` hoặc câu có nhiều số đếm ("1 track with notes", "1 error · 2 warnings").
 * Tiếng Việt không chia số nên `_one` bên `vi` chỉ lặp lại câu gốc (type buộc `en` và `vi` cùng bộ
 * key) và câu `vi` không cần `{x:…|…}`. Thay một lượt trên template: giá trị chèn vào (tên bài, tên
 * file có dấu ngoặc) không bị hiểu thành placeholder.
 */
export function translateCount(lang: Lang, key: StringKey, params?: TParams): string {
  let k = key;
  if (isOne(params?.n)) {
    const one = `${key}_one`;
    if (isStringKey(one)) k = one;
  }
  const template = STRINGS[lang][k] ?? STRINGS.vi[k] ?? k;
  if (!params) return template;
  return template.replace(
    PLACEHOLDER,
    (m: string, name: string, one: string | undefined, other: string | undefined) => {
      if (!(name in params)) return m;
      if (one === undefined || other === undefined) return String(params[name]);
      return isOne(params[name]) ? one : other;
    },
  );
}

/** Hook dịch theo ngôn ngữ trong settings. */
export function useT(): TFunction {
  const lang = useSettings((s) => s.language);
  return useCallback(
    (key: StringKey, params?: TParams) => translateCount(lang, key, params),
    [lang],
  );
}

/** Dịch ngoài React (canvas renderer, v.v.). */
export function tNow(key: StringKey, params?: TParams): string {
  return translateCount(useSettings.getState().language, key, params);
}
