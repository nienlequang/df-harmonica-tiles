/**
 * Nhận biết cảm âm viết theo quy ước "chỉ hậu tố số" (do1, re2, fa#1…) — dạng mà prompt AI
 * (`aiPrompt.ts`) sinh ra — để bộ chuyển kết quả AI (`../camamConvert.ts`) tự chọn convention `digits`.
 *
 * Quét token giống `parseCamAm` (src/core/camam.ts): bỏ dòng trống, `//`, `@…`, `# …`; tiền tố kiểu cũ
 * tới `:` đầu tiên theo sau là khoảng trắng bị bỏ qua; token cách nhau bởi khoảng trắng hoặc dấu phẩy;
 * `*dur` bỏ qua; `_` và `-` không phải âm. Token không đọc được không tính (parser sẽ báo lỗi riêng).
 */

import { LEGACY_LYRIC_SPLIT_RE } from '../../core/parser';

/** Âm, dài trước (cùng thứ tự với camam.ts để tách token dính giống hệt). */
const SYLLABLES = ['sol', 'son', 'pha', 'do', 're', 'mi', 'fa', 'la', 'si', 'ti'] as const;

const SEP_RE = /[\s,]+/;
const MARK_RE = /\p{M}/gu;
const HYPHENS_RE = /^-+$/;

/** Bỏ dấu, chữ thường (đ / Đ / Ð → d). */
function fold(s: string): string {
  return s.replace(/[đĐÐ]/g, 'd').normalize('NFD').replace(MARK_RE, '').toLowerCase();
}

/**
 * Các âm trong một token nốt (đã bỏ `*dur`, đã fold): mảng cờ "có hậu tố số" theo từng âm, null nếu
 * token không đọc được.
 */
function syllableDigits(base: string): boolean[] | null {
  const out: boolean[] = [];
  let i = 0;
  while (i < base.length) {
    const name = SYLLABLES.find((s) => base.startsWith(s, i));
    if (!name) return null;
    i += name.length;
    let digit = false;
    while (i < base.length) {
      const c = base.charAt(i);
      if (c === '#' || c === '♯' || c === 'b' || c === '♭') {
        i++;
      } else if (c >= '0' && c <= '9') {
        if (digit || c < '1' || c > '3') return null;
        digit = true;
        i++;
      } else break;
    }
    out.push(digit);
    if (base.charAt(i) === '-') {
      i++;
      if (i >= base.length) return null;
    }
  }
  return out.length > 0 ? out : null;
}

export interface OctaveDigitCount {
  /** Số âm đọc được. */
  syllables: number;
  /** Số âm có hậu tố số quãng (1–3). */
  withDigit: number;
}

/** Đếm âm và âm có hậu tố số trong văn bản cảm âm. */
export function countOctaveDigits(text: string): OctaveDigitCount {
  let syllables = 0;
  let withDigit = 0;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (const raw of src.split(/\r\n?|\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('//') || line.startsWith('@') || line.startsWith('#')) {
      continue;
    }
    const split = LEGACY_LYRIC_SPLIT_RE.exec(raw);
    const tokens = (split ? raw.slice(split.index + 1) : raw).split(SEP_RE);
    for (const tok of tokens) {
      if (tok === '') continue;
      const star = tok.lastIndexOf('*');
      const base = fold(star >= 0 ? tok.slice(0, star) : tok);
      if (base === '_' || HYPHENS_RE.test(base)) continue;
      const flags = syllableDigits(base);
      if (!flags) continue;
      syllables += flags.length;
      withDigit += flags.filter(Boolean).length;
    }
  }
  return { syllables, withDigit };
}

/** true khi có ít nhất một âm và MỌI âm đều có hậu tố số quãng (vd. kết quả của prompt AI). */
export function everySyllableHasOctaveDigit(text: string): boolean {
  const { syllables, withDigit } = countOctaveDigits(text);
  return syllables > 0 && withDigit === syllables;
}
