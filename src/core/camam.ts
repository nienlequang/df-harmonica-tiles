/**
 * Cảm âm importer (spec mục 6): đọc giai điệu viết bằng tên nốt Đô Rê Mi… thành `Melody`
 * (cao độ midi tuyệt đối) để chạy optimizer rồi sinh `.harm`.
 *
 * Cấu trúc dòng giống `.harm`: `@title/@artist/@bpm/@time`, `# Section`, `// comment`, dòng
 * trống bỏ qua, dòng nốt `tokens` (section mặc định `Main`). Tiền tố kiểu cũ `chữ: ` trước token
 * (như `.harm` cũ có lời) được bỏ qua im lặng.
 *
 * Token (cách nhau bởi khoảng trắng hoặc dấu phẩy):
 * - Âm: do/đô/đồ, re/rê, mi, fa/pha, sol/son, la, si/ti — không phân biệt hoa thường, bỏ qua dấu.
 * - Dấu hóa ngay sau âm: `#` `♯` = +1, `b` `♭` = −1 (Sib, Mib, Fa#…).
 * - Quãng: convention `case` — âm mở đầu chữ thường = quãng 1, chữ hoa = quãng 2; hậu tố số 1/2/3
 *   ghi đè (`do3`, `Re3`). Convention `digits` — bỏ qua hoa thường, chỉ hậu tố số (mặc định quãng 1).
 *   Quãng 1 Đô = midi 60 (C4), quãng 2 = 72, quãng 3 = 84.
 * - Token dính nhiều âm (`Dola`, `solfa`, `do-re`) = 1 luyến, chia đều độ dài.
 * - `_` = nghỉ; `*dur` (thập phân hoặc a/b) đặt độ dài cả token (mặc định 1 beat).
 * - `-` đứng riêng kéo dài đơn vị trước đó 1 beat (`--` = 2, `-*dur` = dur).
 * Token lạ → diagnostic (dòng/cột) và bị bỏ qua. Không bao giờ throw.
 */
import { parseBeats, parseDecimal } from './beats';
import type { Melody, MelodyEvent, MelodySection } from './melody';
import { LEGACY_LYRIC_SPLIT_RE, isValidTimeSig } from './parser';
import type { TimeSig } from './types';
import { DEFAULT_BPM, DEFAULT_SECTION_NAME, DEFAULT_TIME_SIG } from './types';

export type CamAmConvention = 'case' | 'digits';

/** Các convention theo thứ tự hiển thị (UI chọn). */
export const CAMAM_CONVENTIONS: readonly CamAmConvention[] = ['case', 'digits'];

export interface CamAmDiagnostic {
  /** Dòng nguồn, 1-based. */
  line: number;
  /** Cột nguồn (UTF-16 index + 1), 1-based. */
  column: number;
  /** Độ dài vùng lỗi (cả token), tối thiểu 1. */
  length: number;
  code: 'unknown-token' | 'invalid-duration';
  /** Nguyên văn token. */
  token: string;
}

export interface CamAmResult {
  melody: Melody;
  diagnostics: CamAmDiagnostic[];
  /** Số nốt (không tính nghỉ; luyến n âm tính n). */
  noteCount: number;
}

export interface CamAmOptions {
  /** Mặc định `'case'`. */
  convention?: CamAmConvention;
  /** Tên bài khi văn bản không có `@title`. */
  title?: string;
  /** bpm khi văn bản không có `@bpm` hợp lệ (mặc định 90). */
  bpm?: number;
}

/** midi của Đô quãng 1 (C4). */
export const CAMAM_BASE_MIDI = 60;

/** Âm → semitone so với Đô. Âm 3 chữ đứng trước để tách token dính theo kiểu dài nhất trước. */
const SYLLABLES: readonly (readonly [string, number])[] = [
  ['sol', 7],
  ['son', 7],
  ['pha', 5],
  ['do', 0],
  ['re', 2],
  ['mi', 4],
  ['fa', 5],
  ['la', 9],
  ['si', 11],
  ['ti', 11],
];

/** Ký tự tách token: khoảng trắng hoặc dấu phẩy. */
const SEP_RE = /[\s,]/;
const MARK_RE = /\p{M}/gu;
const TIME_RE = /^(\d+)\/(\d+)$/;
const HYPHENS_RE = /^-+$/;

interface FoldedChar {
  /** Ký tự đã bỏ dấu, chữ thường. */
  c: string;
  /** Ký tự gốc là chữ hoa. */
  upper: boolean;
}

/** Bỏ dấu tiếng Việt (đ → d) — giữ hoa thường; dấu kết hợp đứng riêng thành rỗng. */
function foldChar(ch: string): string {
  if (ch === 'đ') return 'd';
  // Đ (U+0110) và Ð (U+00D0, eth hoa) trông giống hệt nhau
  if (ch === 'Đ' || ch === 'Ð') return 'D';
  return ch.normalize('NFD').replace(MARK_RE, '');
}

function foldToken(s: string): FoldedChar[] {
  const out: FoldedChar[] = [];
  for (const ch of s) {
    for (const f of foldChar(ch)) {
      const c = f.toLowerCase();
      out.push({ c, upper: f !== c });
    }
  }
  return out;
}

function matchAt(chars: readonly FoldedChar[], at: number, name: string): boolean {
  if (at + name.length > chars.length) return false;
  for (let k = 0; k < name.length; k++) {
    if (chars[at + k]?.c !== name.charAt(k)) return false;
  }
  return true;
}

/**
 * Một token nốt (không gồm `*dur`) → danh sách midi; null nếu không đọc được.
 * Tách tham lam: tại mỗi vị trí thử âm dài nhất trước, rồi dấu hóa / hậu tố số, rồi `-` tùy chọn.
 */
function parseSyllables(base: string, convention: CamAmConvention): number[] | null {
  const chars = foldToken(base);
  const n = chars.length;
  const out: number[] = [];
  let i = 0;
  while (i < n) {
    const first = chars[i];
    if (!first) return null;
    let semitone = -1;
    let len = 0;
    for (const [name, s] of SYLLABLES) {
      if (matchAt(chars, i, name)) {
        semitone = s;
        len = name.length;
        break;
      }
    }
    if (semitone < 0) return null;
    i += len;

    let accidental = 0;
    let digit: number | null = null;
    while (i < n) {
      const c = chars[i]?.c ?? '';
      if (c === '#' || c === '♯') accidental++;
      else if (c === 'b' || c === '♭') accidental--;
      else if (c >= '0' && c <= '9') {
        if (digit !== null) return null;
        digit = Number(c);
      } else break;
      i++;
    }
    if (digit !== null && (digit < 1 || digit > 3)) return null;
    const octave = digit ?? (convention === 'case' && first.upper ? 2 : 1);
    const midi = CAMAM_BASE_MIDI + 12 * (octave - 1) + semitone + accidental;
    if (midi < 0 || midi > 127) return null;
    out.push(midi);

    // `-` chỉ được nằm giữa hai âm (`do-re`); `do-`, `do--re` sai
    if (chars[i]?.c === '-') {
      i++;
      if (i >= n) return null;
    }
  }
  return out.length > 0 ? out : null;
}

type TokenKind =
  | { kind: 'notes'; midis: number[]; total: number; durError: boolean }
  | { kind: 'rest'; beats: number; durError: boolean }
  | { kind: 'extend'; beats: number; durError: boolean }
  | { kind: 'bad' };

function classifyToken(tok: string, convention: CamAmConvention): TokenKind {
  const star = tok.lastIndexOf('*');
  const base = star >= 0 ? tok.slice(0, star) : tok;
  let total = 1;
  let durError = false;
  if (star >= 0) {
    const v = parseBeats(tok.slice(star + 1));
    if (v === null) durError = true;
    else total = v;
  }
  if (base === '_') return { kind: 'rest', beats: total, durError };
  if (HYPHENS_RE.test(base)) {
    // `--*2` mơ hồ → coi là token lạ
    if (star >= 0 && base.length > 1) return { kind: 'bad' };
    return { kind: 'extend', beats: star >= 0 ? total : base.length, durError };
  }
  const midis = parseSyllables(base, convention);
  if (!midis) return { kind: 'bad' };
  return { kind: 'notes', midis, total, durError };
}

interface Token {
  text: string;
  /** Index 0-based (UTF-16) trong dòng. */
  start: number;
}

function tokenize(line: string, from: number): Token[] {
  const tokens: Token[] = [];
  let i = from;
  const n = line.length;
  while (i < n) {
    if (SEP_RE.test(line.charAt(i))) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < n && !SEP_RE.test(line.charAt(j))) j++;
    tokens.push({ text: line.slice(i, j), start: i });
    i = j;
  }
  return tokens;
}

/** Đơn vị vừa ghi (nốt, luyến hoặc nghỉ) — đích của `-`. */
interface UnitRef {
  events: MelodyEvent[];
  total: number;
}

interface SectionState {
  section: MelodySection;
  /** Đã nằm trong melody.sections chưa (Main được tạo lười). */
  materialized: boolean;
}

class CamAmParser {
  readonly diagnostics: CamAmDiagnostic[] = [];
  readonly sections: MelodySection[] = [];
  noteCount = 0;
  title = '';
  artist = '';
  bpm: number | null = null;
  timeSig: TimeSig = { num: DEFAULT_TIME_SIG.num, den: DEFAULT_TIME_SIG.den };

  private current: SectionState = {
    section: { name: DEFAULT_SECTION_NAME, lines: [] },
    materialized: false,
  };
  private lastUnit: UnitRef | null = null;
  private nextSlurId = 1;

  constructor(private readonly convention: CamAmConvention) {}

  run(text: string): void {
    const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i] ?? '';
      try {
        this.handleLine(raw, i + 1);
      } catch (err) {
        // lưới an toàn: không bao giờ throw ra ngoài
        console.error('parseCamAm: internal error at line', i + 1, err);
        this.diag('unknown-token', i + 1, 1, raw.length, raw.trim());
      }
    }
  }

  private diag(
    code: CamAmDiagnostic['code'],
    line: number,
    column: number,
    length: number,
    token: string,
  ): void {
    this.diagnostics.push({
      line: Math.max(1, line),
      column: Math.max(1, column),
      length: Math.max(1, length),
      code,
      token,
    });
  }

  private handleLine(raw: string, lineNo: number): void {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('//')) return;
    if (trimmed.charAt(0) === '@') {
      this.directive(trimmed);
      return;
    }
    if (trimmed.charAt(0) === '#') {
      const name = trimmed.replace(/^#+/, '').trim() || DEFAULT_SECTION_NAME;
      const state: SectionState = { section: { name, lines: [] }, materialized: true };
      this.sections.push(state.section);
      this.current = state;
      return;
    }
    this.noteLine(raw, lineNo);
  }

  /** Chỉ đọc @title/@artist/@bpm/@time; giá trị sai hoặc directive khác bị bỏ qua (dòng sau thắng). */
  private directive(trimmed: string): void {
    const name = /^@([A-Za-z]*)/.exec(trimmed)?.[1] ?? '';
    const value = trimmed.slice(1 + name.length).trim();
    switch (name.toLowerCase()) {
      case 'title':
        this.title = value;
        return;
      case 'artist':
        this.artist = value;
        return;
      case 'bpm': {
        const v = value.includes('/') ? null : parseDecimal(value);
        if (v !== null && v > 0) this.bpm = v;
        return;
      }
      case 'time': {
        const m = TIME_RE.exec(value);
        const ts = { num: Number(m?.[1]), den: Number(m?.[2]) };
        if (m && isValidTimeSig(ts)) this.timeSig = ts;
        return;
      }
    }
  }

  private noteLine(raw: string, lineNo: number): void {
    // tiền tố kiểu cũ tới ":" đầu tiên theo sau là khoảng trắng / hết dòng (như .harm): bỏ qua
    const split = LEGACY_LYRIC_SPLIT_RE.exec(raw);
    const tokStart = split ? split.index + 1 : 0;

    const events: MelodyEvent[] = [];
    for (const tok of tokenize(raw, tokStart)) {
      const col = tok.start + 1;
      const len = tok.text.length;
      const c = classifyToken(tok.text, this.convention);
      if (c.kind === 'bad') {
        this.diag('unknown-token', lineNo, col, len, tok.text);
        continue;
      }
      if (c.kind === 'extend' && !this.lastUnit) {
        // `-` chưa có gì phía trước để kéo dài
        this.diag('unknown-token', lineNo, col, len, tok.text);
        continue;
      }
      if (c.durError) this.diag('invalid-duration', lineNo, col, len, tok.text);
      switch (c.kind) {
        case 'extend': {
          const unit = this.lastUnit;
          if (!unit) break;
          unit.total += c.beats;
          // luyến: giữ các nốt cùng độ dài (contract Melody) → chia đều tổng mới
          for (const e of unit.events) e.beats = unit.total / unit.events.length;
          break;
        }
        case 'rest': {
          const e: MelodyEvent = { midi: null, beats: c.beats };
          events.push(e);
          this.lastUnit = { events: [e], total: c.beats };
          break;
        }
        case 'notes': {
          const count = c.midis.length;
          const slurId = count > 1 ? this.nextSlurId++ : undefined;
          const unitEvents = c.midis.map((midi): MelodyEvent => {
            const e: MelodyEvent = { midi, beats: c.total / count };
            if (slurId !== undefined) e.slurId = slurId;
            return e;
          });
          events.push(...unitEvents);
          this.noteCount += count;
          this.lastUnit = { events: unitEvents, total: c.total };
          break;
        }
      }
    }

    // dòng không có đơn vị mới (chỉ `-` hoặc toàn token lạ) không vào melody
    if (events.length === 0) return;
    const line = { events };
    const st = this.current;
    if (!st.materialized) {
      st.materialized = true;
      this.sections.push(st.section);
    }
    st.section.lines.push(line);
  }
}

/**
 * Parse văn bản cảm âm thành `Melody`. `@title` / `@bpm` trong văn bản thắng `opts.title` /
 * `opts.bpm` (opts chỉ là giá trị mặc định). Không bao giờ throw: token lạ / độ dài sai nằm trong
 * `diagnostics`, melody là kết quả best-effort.
 */
export function parseCamAm(text: string, opts: CamAmOptions = {}): CamAmResult {
  const o: CamAmOptions = opts ?? {};
  const convention: CamAmConvention = o.convention === 'digits' ? 'digits' : 'case';
  const parser = new CamAmParser(convention);
  parser.run(typeof text === 'string' ? text : '');

  const fallbackBpm =
    typeof o.bpm === 'number' && Number.isFinite(o.bpm) && o.bpm > 0 ? o.bpm : DEFAULT_BPM;
  const fallbackTitle = typeof o.title === 'string' ? o.title.trim() : '';
  const melody: Melody = {
    title: parser.title !== '' ? parser.title : fallbackTitle,
    ...(parser.artist !== '' ? { artist: parser.artist } : {}),
    bpm: parser.bpm ?? fallbackBpm,
    timeSig: parser.timeSig,
    sections: parser.sections,
  };
  return { melody, diagnostics: parser.diagnostics, noteCount: parser.noteCount };
}
