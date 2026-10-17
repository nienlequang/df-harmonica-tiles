/**
 * Chia sẻ bài bằng link (spec mục 2 + 6): văn bản `.harm` nén lz-string an toàn cho URL, đặt trong
 * hash `#/s/<data>` — không server, mở link là có bài.
 */
import LZString from 'lz-string';

/** Link dài hơn mức này có thể bị cắt bởi app chat / trình duyệt cũ — UI nên cảnh báo. */
export const SHARE_URL_SOFT_LIMIT = 8000;

/** Bảng chữ của `compressToEncodedURIComponent`. */
const DATA_RE = /^[A-Za-z0-9+\-$]+$/;

/** U+FFFD thay cho surrogate lẻ. */
const REPLACEMENT = String.fromCharCode(0xfffd);

/**
 * Nguồn đúng như link sẽ chở: ký tự điều khiển C0 (trừ tab / xuống dòng) → dấu cách (parser vốn coi
 * `\v` `\f` là khoảng trắng; NUL… dán từ Word / PDF không mang nghĩa), surrogate lẻ → U+FFFD. Đây là
 * những thứ `decodeShareData` coi là dấu hiệu link hỏng, nên phải dọn trước khi nén.
 */
export function sanitizeShareSource(source: string): string {
  if (typeof source !== 'string') return '';
  let out = '';
  let from = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i);
    let rep: string | null = null;
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) {
      rep = ' ';
    } else if (c >= 0xd800 && c <= 0xdbff) {
      const next = source.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
      else rep = REPLACEMENT;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      rep = REPLACEMENT;
    }
    if (rep !== null) {
      out += source.slice(from, i) + rep;
      from = i + 1;
    }
  }
  return from === 0 ? source : out + source.slice(from);
}

/**
 * Có tạo được link mở ra bài không: nguồn (đã dọn) còn chữ khác khoảng trắng. Bài rỗng thì link chỉ
 * mở ra màn hình "link hỏng" — UI nên tắt / chặn nút Chia sẻ.
 */
export function isShareableSource(source: string): boolean {
  return sanitizeShareSource(source).trim() !== '';
}

/**
 * Nguồn `.harm` → chuỗi dữ liệu cho `#/s/<data>` (lz-string, an toàn cho URL), sau khi dọn bằng
 * `sanitizeShareSource`: với mọi nguồn `isShareableSource`, `decodeShareData(encodeShareData(s))`
 * === `sanitizeShareSource(s)` (= `s` với văn bản bình thường).
 */
export function encodeShareData(source: string): string {
  return LZString.compressToEncodedURIComponent(sanitizeShareSource(source));
}

/**
 * Chuỗi dữ liệu từ link → nguồn `.harm`; null nếu rỗng hoặc không giải nén được. Chịu được link bị
 * app chat percent-encode (`%24`) hoặc đổi `+` thành dấu cách. Không bao giờ throw.
 */
export function decodeShareData(data: string): string | null {
  if (typeof data !== 'string') return null;
  let d = data.trim();
  if (d.includes('%')) {
    try {
      d = decodeURIComponent(d);
    } catch {
      return null;
    }
  }
  d = d.replace(/ /g, '+');
  if (d === '' || !DATA_RE.test(d)) return null;
  try {
    const out = LZString.decompressFromEncodedURIComponent(d);
    // giống chữ thật: không có gì mà encode đã dọn (ký tự điều khiển, surrogate lẻ). lz-string giải
    // nén dữ liệu hỏng thường ra rác như vậy thay vì null.
    return typeof out === 'string' && out !== '' && sanitizeShareSource(out) === out ? out : null;
  } catch {
    return null;
  }
}

/** Link chia sẻ đầy đủ: `origin + pathname + '#/s/' + data` (bỏ query / hash hiện tại). */
export function buildShareUrl(source: string, loc: { origin: string; pathname: string }): string {
  return `${loc.origin}${loc.pathname}#/s/${encodeShareData(source)}`;
}

/** Link dài quá `SHARE_URL_SOFT_LIMIT` ký tự. */
export function isShareUrlLong(url: string): boolean {
  return url.length > SHARE_URL_SOFT_LIMIT;
}
