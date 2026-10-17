/**
 * "Dán kết quả của AI vào đây" (góp ý 2026-10-16, mục 8 / 9): văn bản người dùng dán — thường là cảm âm
 * `do1 re1 …` do prompt AI (`aiPrompt.ts`) sinh ra, có thể cả câu trả lời của AI (khối ```text … ``` lẫn chữ
 * giải thích), có thể đã là `.harm` — thành nguồn `.harm` chơi được ngay: cung / quãng dễ nhất do optimizer
 * tự chọn, không cần hộp thoại hay biết cú pháp cảm âm. Dùng chung trang "Tạo bài với AI" (`src/ai`) và ô dán
 * phía trên ô soạn của Editor.
 *
 * Thuần (không React / DOM) để test kỹ; chuỗi hiển thị do nơi gọi dựng từ `PasteIssue`.
 */

import { parseCamAm } from '../core/camam';
import type { CamAmConvention, CamAmDiagnostic } from '../core/camam';
import { GAME_SCROLL_DIR } from '../core/keys';
import { melodyPitches } from '../core/melody';
import type { Melody } from '../core/melody';
import { melodyToHarm } from '../core/melodyBuild';
import { keepOriginalKey, optimizeTranspose } from '../core/optimizer';
import type { OptimizerOptions, Placement } from '../core/optimizer';
import { LEGACY_LYRIC_SPLIT_RE, parseHarm } from '../core/parser';
import type { Diagnostic, Song } from '../core/types';
import { AI_PROMPT_EN, AI_PROMPT_VI } from './aiPrompt';
import { everySyllableHasOctaveDigit } from './tools/camamDigits';

/**
 * Loại văn bản đã dán:
 * - `empty`: trống;
 * - `prompt`: người dùng dán nhầm chính prompt (phải dán prompt vào AI, rồi dán CÂU TRẢ LỜI vào đây);
 * - `camam`: cảm âm (do re mi… — dạng prompt AI sinh ra) → chuyển sang `.harm`;
 * - `harm`: đã là `.harm` (phím Z X C …) → giữ nguyên văn;
 * - `invalid`: không đọc được nốt nào.
 */
export type PasteKind = 'empty' | 'prompt' | 'camam' | 'harm' | 'invalid';

/** Một chỗ không đọc được, theo dòng / cột của văn bản ĐÃ DÁN (1-based). */
export type PasteIssue =
  | { kind: 'camam'; line: number; column: number; diag: CamAmDiagnostic }
  | { kind: 'harm'; line: number; column: number; diag: Diagnostic }
  /** Cả dòng là chữ (không phải dòng nốt — vd. lời giải thích của AI) → bỏ qua. */
  | { kind: 'prose'; line: number; column: number };

export interface PasteConversion {
  kind: PasteKind;
  /** Nguồn `.harm` sẵn sàng lưu / đưa vào Editor; null khi không có nốt nào. */
  harm: string | null;
  /** `@title` của văn bản đã dán ('' nếu không có). */
  title: string;
  /** Số nốt (luyến n nốt tính n). */
  noteCount: number;
  /** Số dòng nốt. */
  lineCount: number;
  /**
   * Cảm âm: các phương án cung / quãng (dễ nhất trước; có thêm phương án giữ cung gốc nếu nó không nằm
   * trong top). `.harm` dán sẵn: [].
   */
  keyOptions: readonly Placement[];
  /** Phương án đang dùng (null nếu không phải cảm âm hoặc không có nốt). */
  placement: Placement | null;
  /** Chỗ không đọc được, theo thứ tự dòng / cột (các token này bị bỏ qua). */
  issues: readonly PasteIssue[];
  /**
   * Số khối code (``` / ~~~) đã ghép theo thứ tự (AI trả lời nhiều phần, hoặc người dùng dán tiếp phần sau vào
   * cuối ô); 0 = không có khối code (đọc cả văn bản).
   */
  blocks: number;
}

export interface PasteConvertOptions {
  /** Z = C{baseOctave} (Cài đặt → quãng gốc). */
  baseOctave: number;
  /** Cost model của optimizer (Cài đặt → Kiểu điều khiển). Mặc định 'pc'. */
  scheme?: 'pc' | 'mobile';
  mobileSemitone?: 'toggle' | 'oneShot';
  /**
   * Transpose người dùng chọn ở ô "Cung" (tùy chọn). null / không có / không còn trong `keyOptions` →
   * phương án dễ nhất.
   */
  transpose?: number | null;
  /** Câu cảnh báo `//!` cho dòng có n nốt bị gập quãng (mặc định tiếng Việt của melodyBuild). */
  warningText?: (n: number) => string;
}

/** Số phương án cung tốt nhất đưa vào ô chọn (như bảng optimizer của Editor). */
const TOP_KEYS = 3;
/** Dòng có ít hơn tỉ lệ này token đọc được là dòng chữ (lời giải thích), bỏ qua cả dòng. */
const PROSE_READABLE_RATIO = 0.5;

const FENCE_OPEN_RE = /^\s*(`{3,}|~{3,})/;
const TOKEN_SEP_RE = /[\s,]+/;
const EXTEND_TOKEN_RE = /^-+(\*.*)?$/;

/** Câu mở đầu của hai prompt: thấy là biết người dùng dán nhầm prompt thay vì câu trả lời. */
const PROMPT_MARKERS: readonly string[] = [AI_PROMPT_VI, AI_PROMPT_EN].map(
  (p) => p.split('\n')[0]?.slice(0, 60) ?? '',
);

export interface PastedBody {
  /** Nội dung cần đọc (LF, không BOM; chỉ phần trong các khối ``` nếu có). */
  text: string;
  /** Số dòng của văn bản gốc nằm trước `text` (cộng vào số dòng để báo lỗi đúng chỗ đã dán). */
  lineOffset: number;
  /** Số khối code đã lấy (0 = không có khối nào, `text` = cả văn bản). */
  blocks: number;
}

/**
 * Lấy phần cần đọc của văn bản đã dán: bỏ BOM, đổi CRLF → LF; nếu có khối code (``` hoặc ~~~ — câu trả lời
 * của AI) thì lấy nội dung của MỌI khối theo thứ tự (bài dài: AI chia nhiều khối / nhiều lần "viết tiếp" —
 * góp ý vòng R6; thiếu hàng rào đóng → tới hết văn bản). Dòng ngoài khối (lời giải thích) và dòng hàng rào
 * thành dòng trống để số dòng trong `text` + `lineOffset` vẫn trỏ đúng dòng đã dán.
 */
export function extractPasted(raw: string): PastedBody {
  const text = (raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw).replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  if (!lines.some((l) => FENCE_OPEN_RE.test(l))) return { text, lineOffset: 0, blocks: 0 };
  const out: string[] = [];
  let blocks = 0;
  let closeRe: RegExp | null = null;
  for (const line of lines) {
    if (closeRe === null) {
      const fence = FENCE_OPEN_RE.exec(line)?.[1];
      if (fence !== undefined) {
        blocks++;
        closeRe = new RegExp(`^\\s*${fence.charAt(0) === '~' ? '~' : '`'}{${fence.length},}\\s*$`);
      }
      out.push('');
    } else if (closeRe.test(line)) {
      closeRe = null;
      out.push('');
    } else {
      out.push(line);
    }
  }
  let lead = 0;
  while (lead < out.length && (out[lead] ?? '').trim() === '') lead++;
  let end = out.length;
  while (end > lead && (out[end - 1] ?? '').trim() === '') end--;
  return { text: out.slice(lead, end).join('\n'), lineOffset: lead, blocks };
}

/** true khi văn bản là (một phần lớn của) prompt AI chứ không phải câu trả lời. */
export function looksLikePrompt(raw: string): boolean {
  return PROMPT_MARKERS.some((m) => m !== '' && raw.includes(m));
}

/** Số nốt + số dòng nốt của một Song (luyến n nốt tính n). */
function songCounts(song: Song): { notes: number; lines: number } {
  let notes = 0;
  let lines = 0;
  for (const s of song.sections) {
    for (const l of s.lines) {
      lines++;
      for (const u of l.units) {
        if (u.kind === 'note') notes++;
        else if (u.kind === 'slur') notes += u.notes.length;
      }
    }
  }
  return { notes, lines };
}

/**
 * Dòng nốt cảm âm mà phần lớn token không đọc được = dòng chữ (vd. "Đây là cảm âm bài … do Văn Cao sáng
 * tác" — "do" trùng tên nốt). Directive / section / comment / dòng trống không phải dòng chữ.
 */
function isProseLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '' || /^(\/\/|@|#)/.test(trimmed)) return false;
  const split = LEGACY_LYRIC_SPLIT_RE.exec(line);
  const tokens = (split ? line.slice(split.index + 1) : line).split(TOKEN_SEP_RE).filter(Boolean);
  if (tokens.length === 0) return false;
  const bad = parseCamAm(line).diagnostics.filter(
    (d) => d.code === 'unknown-token' && !EXTEND_TOKEN_RE.test(d.token),
  ).length;
  return tokens.length - bad < tokens.length * PROSE_READABLE_RATIO;
}

/**
 * Ghi chú `//` của AI (vd. "// không chắc nốt thứ 3 của dòng dưới") gắn vào nốt đầu của dòng nốt kế tiếp
 * dưới dạng `warning` → `melodyToHarm` ghi lại thành `//! …` ngay trên dòng đó (Editor hiện cảnh báo đúng
 * chỗ, màn chơi không hiện). Dòng nốt = dòng cho ra ít nhất một nốt / nghỉ (dòng chỉ có `-` thì không) — đếm
 * giống `parseCamAm`, nên thứ tự khớp các dòng của melody.
 */
function attachComments(body: string, melody: Melody): void {
  const lines = melody.sections.flatMap((s) => s.lines);
  let k = 0;
  let pending: string[] = [];
  for (const raw of body.split('\n')) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('//')) {
      const text = trimmed.replace(/^\/\/!?\s*/, '').trim();
      if (text !== '') pending.push(text);
      continue;
    }
    if (trimmed === '' || /^(@|#)/.test(trimmed)) continue;
    if (parseCamAm(raw).melody.sections.length === 0) continue;
    const first = lines[k++]?.events[0];
    if (first && pending.length > 0) {
      first.warning = [first.warning, ...pending].filter(Boolean).join(' · ');
    }
    pending = [];
  }
}

function byPosition(a: PasteIssue, b: PasteIssue): number {
  return a.line - b.line || a.column - b.column;
}

function emptyResult(kind: PasteKind, blocks = 0): PasteConversion {
  return {
    kind,
    harm: null,
    title: '',
    noteCount: 0,
    lineCount: 0,
    keyOptions: [],
    placement: null,
    issues: [],
    blocks,
  };
}

/** Các phương án cung: top optimizer + giữ cung gốc (nếu chưa có trong top). */
function keyOptionsFor(pitches: readonly (number | null)[], opts: OptimizerOptions): Placement[] {
  try {
    const top = optimizeTranspose(pitches, { ...opts, top: TOP_KEYS });
    const original = keepOriginalKey(pitches, opts);
    if (original && !top.some((p) => p.transpose === original.transpose)) top.push(original);
    return top;
  } catch (err) {
    // baseOctave sai (settings đã sanitize nên không xảy ra) — coi như không có phương án
    console.error(err);
    return [];
  }
}

/**
 * Văn bản đã dán → `.harm`. Không bao giờ throw.
 *
 * Cảm âm: quy ước "chỉ hậu tố số" khi mọi âm có số quãng (dạng prompt AI), không thì chữ thường = quãng 1 /
 * chữ hoa = quãng 2; dòng chữ (lời giải thích) bị bỏ cả dòng; token lạ bị bỏ qua và báo trong `issues`.
 * Cung / quãng = phương án dễ nhất của optimizer (gập quãng luôn bật như bảng optimizer — D-321), `@scroll
 * +1` (Nửa Cung của game luôn thăng).
 */
export function convertPasted(raw: string, opts: PasteConvertOptions): PasteConversion {
  if (typeof raw !== 'string' || raw.trim() === '') return emptyResult('empty');
  if (looksLikePrompt(raw)) return emptyResult('prompt');
  const { text, lineOffset, blocks } = extractPasted(raw);
  if (text.trim() === '') return emptyResult('empty', blocks);

  // Đã là .harm (phím Z X C …) và đọc trọn vẹn → giữ nguyên văn.
  const harmParsed = parseHarm(text);
  const harmCount = songCounts(harmParsed.song);
  const harmErrors = harmParsed.diagnostics.filter((d) => d.severity === 'error');
  const asHarm = (): PasteConversion => ({
    kind: 'harm',
    harm: `${text.replace(/\s+$/, '')}\n`,
    title: harmParsed.song.title.trim(),
    noteCount: harmCount.notes,
    lineCount: harmCount.lines,
    keyOptions: [],
    placement: null,
    issues: harmErrors
      .map((d): PasteIssue => ({
        kind: 'harm',
        line: d.line + lineOffset,
        column: d.column,
        diag: d,
      }))
      .sort(byPosition),
    blocks,
  });
  if (harmCount.notes > 0 && harmErrors.length === 0) return asHarm();

  // Cảm âm: bỏ dòng chữ (giữ số dòng để báo lỗi đúng chỗ).
  const lines = text.split('\n');
  const issues: PasteIssue[] = [];
  const kept = lines.map((line, i) => {
    if (!isProseLine(line)) return line;
    issues.push({ kind: 'prose', line: i + 1 + lineOffset, column: 1 });
    return '';
  });
  const body = kept.join('\n');
  const convention: CamAmConvention = everySyllableHasOctaveDigit(body) ? 'digits' : 'case';
  const cam = parseCamAm(body, { convention });
  attachComments(body, cam.melody);

  if (cam.noteCount === 0) return harmCount.notes > 0 ? asHarm() : emptyResult('invalid', blocks);
  if (harmCount.notes > cam.noteCount) return asHarm();

  for (const d of cam.diagnostics) {
    issues.push({ kind: 'camam', line: d.line + lineOffset, column: d.column, diag: d });
  }
  issues.sort(byPosition);

  const mobile = opts.scheme === 'mobile';
  const optimizerOpts: OptimizerOptions = mobile
    ? {
        baseOctave: opts.baseOctave,
        scrollDir: GAME_SCROLL_DIR,
        fold: true,
        scheme: 'mobile',
        mobileSemitone: opts.mobileSemitone ?? 'toggle',
      }
    : { baseOctave: opts.baseOctave, scrollDir: GAME_SCROLL_DIR, fold: true };
  const keyOptions = keyOptionsFor(melodyPitches(cam.melody), optimizerOpts);
  const wanted = opts.transpose ?? null;
  const placement =
    (wanted === null ? undefined : keyOptions.find((p) => p.transpose === wanted)) ??
    keyOptions[0] ??
    null;
  const lineCount = cam.melody.sections.reduce((n, s) => n + s.lines.length, 0);

  let harm: string | null = null;
  if (placement) {
    try {
      harm = melodyToHarm(cam.melody, placement, {
        baseOctave: opts.baseOctave,
        scrollDir: GAME_SCROLL_DIR,
        ...(opts.warningText ? { warningText: opts.warningText } : {}),
      });
    } catch (err) {
      console.error(err);
      harm = null;
    }
  }

  return {
    kind: 'camam',
    harm,
    title: cam.melody.title.trim(),
    noteCount: cam.noteCount,
    lineCount,
    keyOptions,
    placement: harm === null ? null : placement,
    issues,
    blocks,
  };
}
