/**
 * Sửa văn bản `.harm` tại chỗ theo vị trí nguồn của parser (`ParseResult.unitSpans`): tap timing
 * ghi `*dur`. Chỉ đụng đúng vùng cần đổi nên comment, `@repeat`, khoảng trắng và kiểu xuống dòng
 * của người soạn được giữ nguyên.
 */
import { formatBeats } from './beats';
import type { ParseResult } from './types';

/** Một thay đổi trên một dòng nguồn: thay `[start, end)` (cột 0-based, UTF-16) bằng `text`. */
export interface TextEdit {
  /** Dòng nguồn, 1-based (cùng cách đếm với parser: BOM bỏ, tách tại `\n` / `\r\n` / `\r`). */
  line: number;
  start: number;
  /** Exclusive. `start === end` = chèn. */
  end: number;
  text: string;
}

interface SplitSource {
  bom: string;
  /** Nội dung từng dòng (không gồm ký tự xuống dòng). */
  lines: string[];
  /** seps[i] = ký tự xuống dòng sau lines[i] (`\n`, `\r\n` hoặc `\r`); dòng cuối không có. */
  seps: string[];
}

/**
 * Tách nguồn giống parser (bỏ BOM, tách tại `LINE_BREAK_RE`: CRLF / LF / CR lẻ) nhưng nhớ BOM và
 * kiểu xuống dòng.
 */
function splitSource(source: string): SplitSource {
  const text = typeof source === 'string' ? source : '';
  const bom = text.charCodeAt(0) === 0xfeff ? text.charAt(0) : '';
  const parts = text.slice(bom.length).split(/(\r\n?|\n)/);
  const lines: string[] = [];
  const seps: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) lines.push(parts[i] ?? '');
    else seps.push(parts[i] ?? '\n');
  }
  return { bom, lines, seps };
}

function joinSource(src: SplitSource): string {
  let out = src.bom;
  for (let i = 0; i < src.lines.length; i++) {
    out += src.lines[i] ?? '';
    if (i < src.seps.length) out += src.seps[i] ?? '';
  }
  return out;
}

function validEdit(e: TextEdit, lines: readonly string[]): boolean {
  if (typeof e !== 'object' || e === null || typeof e.text !== 'string') return false;
  if (!Number.isInteger(e.line) || !Number.isInteger(e.start) || !Number.isInteger(e.end)) {
    return false;
  }
  const text = lines[e.line - 1];
  return text !== undefined && e.start >= 0 && e.start <= e.end && e.end <= text.length;
}

/**
 * Áp các thay đổi vào nguồn. Giữ nguyên BOM và kiểu xuống dòng (`\n` / `\r\n` / `\r`) của từng dòng.
 * Thay đổi ngoài phạm vi (dòng không tồn tại, cột vượt độ dài dòng, `start > end`, không phải số
 * nguyên) bị bỏ qua. Hai thay đổi chồng nhau trên cùng dòng → RangeError (chèn đúng tại mép một
 * vùng thay thế không tính là chồng; nhiều lần chèn cùng một chỗ giữ theo thứ tự đầu vào).
 */
export function applyTextEdits(source: string, edits: readonly TextEdit[]): string {
  const src = splitSource(source);
  const byLine = new Map<number, Array<{ e: TextEdit; i: number }>>();
  edits.forEach((e, i) => {
    if (!validEdit(e, src.lines)) return;
    const list = byLine.get(e.line);
    if (list) list.push({ e, i });
    else byLine.set(e.line, [{ e, i }]);
  });
  if (byLine.size === 0) return source;

  for (const [lineNo, list] of byLine) {
    list.sort((a, b) => a.e.start - b.e.start || a.e.end - b.e.end || a.i - b.i);
    const text = src.lines[lineNo - 1] ?? '';
    // ghép từng đoạn từ trái sang phải — tương đương áp từ phải sang trái, O(độ dài dòng)
    let out = '';
    let pos = 0;
    for (const { e } of list) {
      if (e.start < pos) {
        throw new RangeError(
          `applyTextEdits: overlapping edits on line ${lineNo} at column ${e.start}`,
        );
      }
      out += text.slice(pos, e.start) + e.text;
      pos = e.end;
    }
    src.lines[lineNo - 1] = out + text.slice(pos);
  }
  return joinSource(src);
}

function isIndex(n: number, length: number): boolean {
  return Number.isInteger(n) && n >= 0 && n < length;
}

/**
 * Ghi độ dài cho các unit (tap timing): thay / chèn / bỏ `*dur` của token nguồn theo `unitSpans`.
 * `beats === 1` → bỏ `*dur`; luyến: `beats` là TỔNG cả cụm (đúng như `X-C*2`). Nhiều thay đổi rơi
 * vào cùng một token nguồn (dòng lặp bởi `@repeat`) → thay đổi sau cùng thắng. Index sai hoặc
 * `beats` không dương / không hữu hạn → bỏ qua. `parsed` phải là kết quả parse của `source`.
 */
export function setUnitBeats(
  source: string,
  parsed: ParseResult,
  changes: ReadonlyArray<{ lineIndex: number; unitIndex: number; beats: number }>,
): string {
  const byToken = new Map<string, TextEdit>();
  for (const c of changes) {
    if (!isIndex(c.lineIndex, parsed.unitSpans.length)) continue;
    const spans = parsed.unitSpans[c.lineIndex] ?? [];
    if (!isIndex(c.unitIndex, spans.length)) continue;
    const span = spans[c.unitIndex];
    if (!span || typeof c.beats !== 'number' || !Number.isFinite(c.beats) || c.beats <= 0) {
      continue;
    }
    const key = `${span.line}:${span.start}`;
    // xóa trước khi set để thứ tự Map theo thay đổi sau cùng (không bắt buộc, cho dễ debug)
    byToken.delete(key);
    byToken.set(key, {
      line: span.line,
      start: span.durStart ?? span.end,
      end: span.end,
      text: c.beats === 1 ? '' : `*${formatBeats(c.beats)}`,
    });
  }
  return applyTextEdits(source, [...byToken.values()]);
}
