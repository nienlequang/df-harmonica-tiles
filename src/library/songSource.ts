import type { Song } from '../core/types';
import { DEFAULT_BPM } from '../core/types';

/**
 * Helper thuần trên văn bản nguồn `.harm` (bài user lưu dạng source, DECISIONS D-010)
 * và vài tiện ích hiển thị cho thư viện. Không phụ thuộc parser.
 */

const BOM = '﻿';

function splitBom(source: string): [bom: string, body: string] {
  return source.startsWith(BOM) ? [BOM, source.slice(1)] : ['', source];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Regex mọi dòng directive `@name ...` (không phân biệt hoa thường), nhóm 1 = giá trị. */
function directiveRegExp(name: string): RegExp {
  return new RegExp(`^[ \\t]*@${escapeRegExp(name)}(?=[ \\t\\r]|$)([^\\r\\n]*)`, 'gim');
}

/** Mọi dòng `@name` theo thứ tự trong nguồn (body đã bỏ BOM). */
function directiveMatches(body: string, name: string): RegExpExecArray[] {
  return Array.from(body.matchAll(directiveRegExp(name)));
}

/**
 * Giá trị (đã trim) của directive `@name` CUỐI CÙNG trong nguồn — khớp parser: directive viết
 * sau ghi đè directive trước (D-066). '' nếu có directive mà không có giá trị, null nếu không có.
 */
export function getDirective(source: string, name: string): string | null {
  const [, body] = splitBom(source);
  const m = directiveMatches(body, name).at(-1);
  return m ? (m[1] ?? '').trim() : null;
}

/**
 * Đặt `@title` trong nguồn: thay dòng `@title` cuối cùng (dòng parser dùng — D-066), không có
 * thì chèn lên đầu. Giữ nguyên kiểu xuống dòng (LF/CRLF) và BOM. Title rỗng → bỏ mọi dòng
 * `@title` (nếu chỉ bỏ dòng cuối, một `@title` phía trên sẽ lại có hiệu lực).
 */
export function setTitleInSource(source: string, title: string): string {
  const clean = title.replace(/[\r\n]+/g, ' ').trim();
  const [bom, body] = splitBom(source);
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const matches = directiveMatches(body, 'title');
  const last = matches.at(-1);

  if (last) {
    if (clean) {
      const end = last.index + last[0].length;
      return bom + body.slice(0, last.index) + `@title ${clean}` + body.slice(end);
    }
    // Bỏ từng dòng (từ dưới lên để index phía trên không đổi), kèm ký tự xuống dòng sau nó.
    let out = body;
    for (const m of [...matches].reverse()) {
      let after = m.index + m[0].length;
      if (out.startsWith('\r\n', after)) after += 2;
      else if (out.startsWith('\n', after)) after += 1;
      out = out.slice(0, m.index) + out.slice(after);
    }
    return bom + out;
  }
  if (!clean) return source;
  return bom + `@title ${clean}` + (body.length > 0 ? eol + body : eol);
}

/**
 * Đặt directive `@name value` trong nguồn (vd. `@bpm 132`): thay dòng `@name` cuối cùng (dòng parser dùng —
 * D-066); không có thì chèn ngay sau khối đầu bài (các dòng directive / comment / trống liền nhau từ đầu),
 * không có khối đó thì lên đầu. Giữ kiểu xuống dòng (LF/CRLF) và BOM. `value` rỗng → không đổi gì.
 * `@title` dùng `setTitleInSource` (tên rỗng = bỏ dòng).
 */
export function setDirectiveInSource(source: string, name: string, value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ').trim();
  if (!clean) return source;
  const [bom, body] = splitBom(source);
  const line = `@${name} ${clean}`;
  const last = directiveMatches(body, name).at(-1);
  if (last) {
    const end = last.index + last[0].length;
    return bom + body.slice(0, last.index) + line + body.slice(end);
  }
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);
  let after = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = (lines[i] ?? '').trim();
    if (t.startsWith('@')) after = i;
    else if (t !== '' && !t.startsWith('//')) break;
  }
  if (after < 0) return bom + line + (body.length > 0 ? eol + body : eol);
  lines.splice(after + 1, 0, line);
  return bom + lines.join(eol);
}

/** Bỏ dấu tiếng Việt + đ → d, chữ thường, gộp khoảng trắng (dùng cho search, slug). */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D'))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Search không phân biệt hoa thường / dấu: mọi từ trong query phải xuất hiện trong
 * một trong các field. Query rỗng → luôn khớp.
 */
export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const words = foldText(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const hay = foldText(fields.filter((f): f is string => typeof f === 'string').join(' '));
  return words.every((w) => hay.includes(w));
}

/** "Quốc ca Việt Nam" → "quoc-ca-viet-nam". Rỗng nếu không còn ký tự hợp lệ. */
export function slugify(text: string, maxLength = 60): string {
  return foldText(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

export interface QuickSongStats {
  /** Tổng beat (gồm rest). */
  totalBeats: number;
  /** Số nốt (nốt trong luyến đếm riêng). */
  noteCount: number;
  /** Thời lượng ở bpm của bài (giây). */
  durationSec: number;
}

/** Thống kê nhanh từ model (không cần timeline). */
export function quickSongStats(song: Song): QuickSongStats {
  let totalBeats = 0;
  let noteCount = 0;
  for (const section of song.sections) {
    for (const line of section.lines) {
      for (const unit of line.units) {
        if (unit.kind === 'slur') {
          noteCount += unit.notes.length;
          for (const n of unit.notes) totalBeats += n.beats;
        } else {
          if (unit.kind === 'note') noteCount += 1;
          totalBeats += unit.beats;
        }
      }
    }
  }
  const bpm = song.bpm > 0 && Number.isFinite(song.bpm) ? song.bpm : DEFAULT_BPM;
  return { totalBeats, noteCount, durationSec: (totalBeats * 60) / bpm };
}

/**
 * 125.6 → "2:05". Làm tròn xuống giống đồng hồ Player (`formatClock`) để thẻ thư viện và
 * thanh seek hiện cùng một độ dài (D-067); +1e-6 bù sai số float (30 s tính ra 29.9999…).
 */
export function formatDuration(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds + 1e-6) : 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export interface NewSongTemplateOptions {
  title: string;
  section: string;
  /** Dòng comment hướng dẫn (không có `//`). */
  comment?: string;
  bpm?: number;
}

/** Nguồn `.harm` tối thiểu cho nút "Bài mới" (`@scroll +1`: Nửa Cung của game luôn thăng). */
export function newSongTemplate(opts: NewSongTemplateOptions): string {
  const lines = [
    `@title ${opts.title.replace(/[\r\n]+/g, ' ').trim()}`,
    `@bpm ${opts.bpm ?? DEFAULT_BPM}`,
    '@time 4/4',
    '@scroll +1',
  ];
  if (opts.comment) lines.push(`// ${opts.comment.replace(/[\r\n]+/g, ' ')}`);
  lines.push('', `# ${opts.section}`);
  lines.push('Z X C V B N M ,');
  return `${lines.join('\n')}\n`;
}
