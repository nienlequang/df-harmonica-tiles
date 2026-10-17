/**
 * Donate text (spec mục 6): guide gửi qua donate bị giới hạn N ký tự mỗi tin, nên văn bản được chia
 * tại ranh giới dòng thành nhiều phần đánh số `k/n `. Dán lại tất cả các phần (mỗi phần một dòng
 * mới) vào Editor là ra đúng bài: parser coi `k/n ` đầu dòng là dấu chunk (`donateMarkerLength`).
 * Dòng dài hơn một phần được chia thành nhiều dòng `.harm` hợp lệ (cùng dãy nốt) và directive /
 * header quá dài được rút gọn bằng `…` — không bao giờ ra mảnh mà parser đọc thành loại dòng khác.
 */
import { LEGACY_LYRIC_SPLIT_RE, LINE_BREAK_RE, donateMarkerLength } from './parser';
import { serializeHarm } from './serializer';
import type { Song } from './types';

export interface DonateOptions {
  durations: boolean;
  sectionHeaders: boolean;
  /** Số ký tự tối đa mỗi phần (UTF-16, gồm cả tiền tố `k/n `), mặc định 200. */
  limit: number;
}

export const DEFAULT_DONATE_LIMIT = 200;
/**
 * Giới hạn nhỏ nhất được tôn trọng; nhỏ hơn thì dùng giá trị này. Ở mức này nhãn giữ/thả dài nhất
 * (`[giữ chuột trái]`, 16 ký tự) vẫn vừa một phần khi có tới 9999 phần (tiền tố `k/n ` ≤ 10 ký
 * tự); chỉ token dài bất thường (luyến rất nhiều nốt) mới có thể bị cắt cứng.
 */
export const MIN_DONATE_LIMIT = 30;

/**
 * Văn bản donate của bài: `serializeHarm` với các option (luôn có directive), bỏ mọi dòng trống,
 * không có xuống dòng cuối.
 */
export function buildDonateText(song: Song, opts: Omit<DonateOptions, 'limit'>): string {
  const text = serializeHarm(song, {
    durations: opts.durations,
    sectionHeaders: opts.sectionHeaders,
    directives: true,
  });
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .join('\n');
}

const WS_RE = /\s/;
const ELLIPSIS = '…';

/** Ngân sách (ký tự) của mảnh thứ i khi chia một dòng. */
type BudgetOf = (piece: number) => number;

function isWs(s: string, i: number): boolean {
  return WS_RE.test(s.charAt(i));
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** `s` cắt còn ≤ `max` đơn vị UTF-16, không cắt đôi cặp surrogate. */
function cutAt(s: string, max: number): string {
  if (s.length <= max) return s;
  let e = Math.max(0, max);
  if (e > 0 && isHighSurrogate(s.charCodeAt(e - 1))) e--;
  return s.slice(0, e);
}

/**
 * `text` rút gọn còn ≤ `room` ký tự, kết thúc bằng `…` (vừa sẵn thì giữ nguyên): cắt ở khoảng trắng
 * nếu còn giữ được ít nhất nửa chỗ, không thì cắt cứng (không cắt đôi surrogate). null nếu không còn
 * chữ nào để giữ.
 */
function shorten(text: string, room: number): string | null {
  if (text.length <= room) return text;
  const keep = room - 1;
  if (keep < 1) return null;
  let w = Math.min(keep, text.length - 1);
  while (w > 0 && !isWs(text, w)) w--;
  const base = (w >= keep / 2 ? text.slice(0, w) : cutAt(text, keep)).trimEnd();
  return base.trim() === '' ? null : base + ELLIPSIS;
}

/**
 * Directive / header dài quá `budget`: giữ `@tên ` / `# `, rút gọn giá trị bằng `…` — không bao giờ
 * chia (mảnh sau sẽ bị đọc thành dòng nốt). Không còn chỗ cho giá trị thì cắt cứng (vẫn là dòng
 * `@…` / `#…`). `@repeat` bị rút gọn có thể không còn khớp section (`buildDonateText` không ghi nó).
 */
function truncateHeadLine(line: string, budget: number): string {
  if (line.length <= budget) return line;
  const head = /^(?:@[A-Za-z]*|#+)\s*/.exec(line)?.[0] ?? '';
  const value =
    head.length < line.length ? shorten(line.slice(head.length), budget - head.length) : null;
  return value !== null ? head + value : cutAt(line, budget);
}

/**
 * Vị trí khoảng trắng tách được, từ cột `zone` (tăng dần). `brackets`: bỏ khoảng trắng trong token
 * `[...]` (giống tokenizer của parser: `[` mở token ngoặc tới `]` kế tiếp).
 */
function spacePositions(line: string, zone: number, brackets: boolean): number[] {
  const ws: number[] = [];
  let inBracket = false;
  for (let i = zone; i < line.length; i++) {
    const ch = line.charAt(i);
    if (brackets) {
      if (!inBracket && ch === '[') inBracket = true;
      else if (inBracket && ch === ']') inBracket = false;
    }
    if (!inBracket && WS_RE.test(ch)) ws.push(i);
  }
  return ws;
}

/** Vị trí khoảng trắng lớn nhất w với lo < w ≤ hi, -1 nếu không có (tìm nhị phân). */
function lastWs(ws: readonly number[], lo: number, hi: number): number {
  let a = 0;
  let b = ws.length;
  while (a < b) {
    const mid = (a + b) >> 1;
    if ((ws[mid] ?? 0) <= hi) a = mid + 1;
    else b = mid;
  }
  const w = a > 0 ? (ws[a - 1] ?? -1) : -1;
  return w > lo ? w : -1;
}

/**
 * Chia `line` tại các khoảng trắng `ws`, mảnh i dài ≤ `budgetOf(i)` (gồm `cont` — tiền tố của các
 * mảnh nối tiếp, vd. `// ` cho comment); mảnh đầu phải kết thúc sau cột `firstMin`. Không có chỗ
 * tách thì cắt cứng (không cắt đôi cặp surrogate) — chỉ xảy ra với một token dài hơn cả một phần.
 */
function splitAtSpaces(
  line: string,
  ws: readonly number[],
  firstMin: number,
  cont: string,
  budgetOf: BudgetOf,
): string[] {
  const pieces: string[] = [];
  let p = 0;
  while (p < line.length) {
    const full = budgetOf(pieces.length);
    const pre = pieces.length > 0 && full > cont.length + 1 ? cont : '';
    const budget = Math.max(1, full - pre.length);
    if (line.length - p <= budget) {
      pieces.push(pre + line.slice(p));
      break;
    }
    const max = p + budget;
    const w = lastWs(ws, pieces.length === 0 ? Math.max(p, firstMin) : p, max);
    if (w >= 0) {
      pieces.push(pre + line.slice(p, w).trimEnd());
      p = w;
      while (p < line.length && isWs(line, p)) p++;
    } else {
      let e = max;
      if (e - p > 1 && isHighSurrogate(line.charCodeAt(e - 1))) e--;
      pieces.push(pre + line.slice(p, e));
      p = e;
    }
  }
  return pieces;
}

/**
 * Dòng nốt dài: mỗi mảnh là một dòng nốt hợp lệ, tách tại khoảng trắng giữa các token (không bao giờ
 * trong `[...]`). Tiền tố lời kiểu cũ (`lời: `, parser bỏ qua) bị bỏ.
 */
function splitNoteLine(line: string, budgetOf: BudgetOf): string[] {
  const m = LEGACY_LYRIC_SPLIT_RE.exec(line);
  const body = m ? line.slice(m.index + 1).trim() : line;
  if (body === '') return [];
  if (body.length <= budgetOf(0)) return [body];
  return splitAtSpaces(body, spacePositions(body, 0, true), 0, '', budgetOf);
}

/**
 * Chia một dòng dài thành các phần, phần i dài ≤ `budgetOf(i)`; mỗi phần đọc lại cùng loại với dòng
 * gốc. Comment: tách ở khoảng trắng, mảnh sau thêm `// `. Directive / header: rút gọn bằng `…`.
 * Dòng nốt: `splitNoteLine`. Dấu chunk `k/n ` có sẵn ở đầu dòng (vô nghĩa với parser) bị bỏ.
 */
function splitLongLine(line: string, budgetOf: BudgetOf): string[] {
  const body = line.slice(donateMarkerLength(line)).trim();
  if (body === '') return [];
  if (body.startsWith('//')) {
    return splitAtSpaces(body, spacePositions(body, 0, false), 0, '// ', budgetOf);
  }
  if (/^[@#]/.test(body)) return [truncateHeadLine(body, budgetOf(0))];
  return splitNoteLine(body, budgetOf);
}

function digits(n: number): number {
  return String(n).length;
}

/** Xếp dòng vào các phần, giả định n có `d` chữ số: phần k có ngân sách limit − |`k/n `|. */
function pack(lines: readonly string[], limit: number, d: number): string[] {
  const budget = (k: number): number => Math.max(1, limit - (digits(k) + d + 2));
  const out: string[] = [];
  let cur: string | null = null;
  const flush = (): void => {
    if (cur !== null) out.push(cur);
    cur = null;
  };
  for (const line of lines) {
    const k = out.length + 1;
    if (cur !== null && cur.length + 1 + line.length <= budget(k)) {
      cur += `\n${line}`;
      continue;
    }
    flush();
    const k2 = out.length + 1;
    if (line.length <= budget(k2)) {
      cur = line;
      continue;
    }
    // dòng dài hơn cả một phần trống: chia, phần cuối còn nhận thêm dòng sau
    const pieces = splitLongLine(line, (i) => budget(k2 + i));
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i] ?? '';
      if (i < pieces.length - 1) out.push(piece);
      else cur = piece;
    }
  }
  flush();
  return out;
}

/**
 * Chia văn bản donate thành các phần dài ≤ `limit` ký tự (UTF-16, gồm tiền tố). Tách tại ranh giới
 * dòng; mỗi phần có tiền tố `k/n ` (tính vào giới hạn; số chữ số của n đổi thì tính lại). Vừa một
 * phần thì trả nguyên văn, không tiền tố. Một dòng dài hơn ngân sách được chia thành nhiều dòng
 * cùng loại (`splitLongLine`): dòng nốt tách giữa các token (không bao giờ trong `[...]`),
 * directive / header được rút gọn bằng `…`; cắt cứng chỉ khi
 * một token dài hơn cả một phần. Dán lại (`join('\n')`) văn bản không lỗi thì không sinh lỗi và giữ
 * nguyên dãy nốt. Dòng trống bị bỏ, khoảng trắng hai đầu dòng bị cắt, `\r\n` / `\r` → `\n`. `limit` <
 * MIN_DONATE_LIMIT dùng MIN_DONATE_LIMIT; NaN dùng mặc định. Văn bản rỗng → [].
 */
export function chunkDonateText(text: string, limit: number = DEFAULT_DONATE_LIMIT): string[] {
  const src = typeof text === 'string' ? text : '';
  const body = src.charCodeAt(0) === 0xfeff ? src.slice(1) : src;
  const lines = body
    .split(LINE_BREAK_RE)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  if (lines.length === 0) return [];
  const lim = Number.isNaN(limit) ? DEFAULT_DONATE_LIMIT : Math.max(MIN_DONATE_LIMIT, limit);
  const whole = lines.join('\n');
  if (whole.length <= lim) return [whole];
  const cap = Math.floor(lim);
  // d tăng dần (ngân sách giảm → số phần không giảm) nên vòng lặp dừng
  for (let d = 1; ;) {
    const parts = pack(lines, cap, d);
    const n = parts.length;
    if (digits(n) <= d) return parts.map((p, i) => `${i + 1}/${n} ${p}`);
    d = digits(n);
  }
}
