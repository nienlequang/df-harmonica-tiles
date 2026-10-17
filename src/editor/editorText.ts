import type { LineOrigin } from '../core/types';

/**
 * Helper thuần cho Editor: vị trí con trỏ ↔ (dòng, cột) và ánh xạ dòng nguồn → dòng model.
 * Vị trí của parser (Diagnostic) tính trên dòng đã bỏ BOM: cột 1-based = UTF-16 index + 1.
 */

const BOM = '﻿';

/**
 * Textarea luôn trả `\n` (CRLF / CR bị chuẩn hóa trong value) → editor làm việc trên văn bản LF
 * để offset con trỏ khớp với văn bản trong state.
 */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** Offset bắt đầu của từng dòng (index 0 = dòng 1). */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

/**
 * Offset UTF-16 của (dòng, cột) 1-based trong `text` (LF). Dòng / cột ngoài phạm vi bị kẹp vào
 * văn bản; dòng 1 có BOM thì cột tính sau BOM (giống parser).
 */
export function offsetAt(text: string, line: number, column: number): number {
  const starts = lineStarts(text);
  const li = Math.min(starts.length, Math.max(1, Math.floor(Number.isFinite(line) ? line : 1)));
  const start = starts[li - 1] ?? 0;
  const nextStart = starts[li];
  const end = nextStart === undefined ? text.length : nextStart - 1;
  const bom = li === 1 && text.startsWith(BOM) ? 1 : 0;
  const col = Math.max(1, Math.floor(Number.isFinite(column) ? column : 1));
  return Math.min(end, start + bom + col - 1);
}

/** (dòng, cột) 1-based của offset (cột sau BOM ở dòng 1, như parser). */
export function positionAt(text: string, offset: number): { line: number; column: number } {
  const off = Math.min(text.length, Math.max(0, Math.floor(Number.isFinite(offset) ? offset : 0)));
  let line = 1;
  let start = 0;
  for (let i = text.indexOf('\n'); i >= 0 && i < off; i = text.indexOf('\n', i + 1)) {
    line++;
    start = i + 1;
  }
  const bom = line === 1 && text.startsWith(BOM) && off > 0 ? 1 : 0;
  return { line, column: off - start - bom + 1 };
}

/**
 * Dòng model để "Phát từ dòng con trỏ": dòng model đầu tiên có (repeatLine ?? sourceLine) >= dòng
 * con trỏ — con trỏ trên `@repeat X` ra dòng đầu tiên do directive đó chèn; con trỏ trên comment /
 * dòng trống ra dòng nốt kế tiếp. Con trỏ sau mọi dòng nốt → dòng cuối. Bài không có dòng → -1.
 */
export function modelLineAtSource(lineOrigins: readonly LineOrigin[], sourceLine: number): number {
  if (lineOrigins.length === 0) return -1;
  for (let i = 0; i < lineOrigins.length; i++) {
    const o = lineOrigins[i];
    if (o && (o.repeatLine ?? o.sourceLine) >= sourceLine) return i;
  }
  return lineOrigins.length - 1;
}
