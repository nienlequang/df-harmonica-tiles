import { parseBeats, parseDecimal } from './beats';
import { isNoteKey } from './keys';
import type { HoldButton, HoldAction } from './modifierLabels';
import { parseModifierLabel } from './modifierLabels';
import type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticSeverity,
  Line,
  LineOrigin,
  LineSpan,
  Note,
  NoteKey,
  Octave,
  ParseOptions,
  ParseResult,
  ScrollDir,
  Section,
  Song,
  TimeSig,
  Unit,
  UnitSpan,
} from './types';
import { DEFAULT_BPM, DEFAULT_SECTION_NAME, DEFAULT_TIME_SIG } from './types';

/** Mức độ của từng mã lỗi. */
export const DIAGNOSTIC_SEVERITY: Readonly<Record<DiagnosticCode, DiagnosticSeverity>> = {
  'release-without-hold': 'error',
  'hold-conflict': 'error',
  'hold-duplicate': 'error',
  'prefix-conflict': 'error',
  'unknown-token': 'error',
  'invalid-duration': 'error',
  'unknown-repeat': 'error',
  'unknown-directive': 'warning',
  'invalid-directive-value': 'error',
  'unclosed-hold': 'warning',
  annotation: 'warning',
  'repeat-limit': 'warning',
  'legacy-prefix-ignored': 'warning',
};

/**
 * Ngân sách văn bản `@repeat` được chèn lại trong một lần parse, tính bằng ký tự nguồn (mỗi dòng
 * replay tốn `độ dài dòng + 1`, tính cả xuống dòng). Đo theo ký tự chứ không theo dòng để chặn
 * đúng khối lượng việc: một dòng rất dài nhân đôi bằng repeat lồng nhau vẫn bị chặn (D-042).
 * Phần mở rộng vì thế không bao giờ tốn hơn một file 100 KB viết thẳng; bài thật chỉ chèn vài
 * nghìn ký tự. Vượt ngân sách → dừng chèn từ dòng đó, warning `repeat-limit` (một lần).
 */
export const MAX_REPEAT_CHARS = 100_000;

/**
 * Xuống dòng: CRLF, LF và cả CR lẻ — giống Editor (D-100), nhập file và serializer (CR lẻ trong text
 * một dòng → dấu cách), nên dòng parser đọc luôn là dòng người dùng nhìn thấy trong Editor.
 */
export const LINE_BREAK_RE = /\r\n?|\n/;

/**
 * Tiền tố lời kiểu cũ (`lời: tokens`, trước khi bỏ tính năng lời — SPEC 2026-10-15): `:` đầu tiên
 * theo sau là khoảng trắng / hết dòng. Parser vẫn nhận để file / link cũ chạy được, nhưng bỏ hẳn
 * phần trước `:` (không lưu). Lời thật → im lặng; phần bị bỏ toàn là token nốt hợp lệ (dấu `:` gõ
 * lạc: `Z X C: V`) hoặc sau `:` không còn gì → cảnh báo `legacy-prefix-ignored`. Prefix token
 * `L:2`, `RS:X`… có `:` dính liền ký tự sau nên không khớp.
 */
export const LEGACY_LYRIC_SPLIT_RE = /:(?=\s|$)/;
/** Số ký tự tối đa của phần bị bỏ được trích trong cảnh báo `legacy-prefix-ignored`. */
const LEGACY_PREFIX_SHOWN = 24;
const WS_RE = /\s/;
/**
 * Dấu chunk donate `k/n ` ở đầu dòng (một hoặc nhiều dấu liền nhau, kèm khoảng trắng hai bên).
 * Neo `^`, mỗi lần lặp tách được ngay ở `/` và khoảng trắng → tuyến tính.
 */
const DONATE_MARKER_RE = /^\s*(?:\d+\/\d+(?:\s+|$))+/;

/**
 * Độ dài dấu chunk donate (`1/5 `, `2/5 `…) ở đầu dòng, 0 nếu không có. Khi dán lại text donate,
 * parser coi phần này như khoảng trắng (cột vẫn tính theo dòng gốc); dòng chỉ có dấu bị bỏ qua.
 */
export function donateMarkerLength(line: string): number {
  const m = DONATE_MARKER_RE.exec(line);
  return m ? m[0].length : 0;
}

const PART_RE = /^(?:([A-Za-z]+):)?([ZXCVBNMzxcvbnm,])$/;
const TIME_RE = /^(\d+)\/(\d+)$/;
const TIME_DENS = new Set([1, 2, 4, 8, 16, 32]);
const VALID_PREFIXES = new Set(['L', 'R', 'S', 'LS', 'SL', 'RS', 'SR']);

/** Nhịp mà `@time` chấp nhận: tử 1..32 (nguyên), mẫu thuộc {1, 2, 4, 8, 16, 32}. */
export function isValidTimeSig(ts: TimeSig): boolean {
  return Number.isInteger(ts.num) && ts.num >= 1 && ts.num <= 32 && TIME_DENS.has(ts.den);
}

/**
 * Khóa so tên section dự phòng cho `@repeat` (sau so khớp chính xác): NFC, chữ thường, gộp mọi
 * khoảng trắng (kể cả NBSP) thành một dấu cách.
 */
function sectionKey(name: string): string {
  return name.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

type Params = Record<string, string | number>;

interface Pos {
  line: number;
  column: number;
  length: number;
  /** Dòng nguồn của token khi hold được mở trong lúc replay `@repeat` (D-041). */
  fromLine?: number;
}

interface RawLine {
  /** Nguyên văn dòng nguồn. */
  text: string;
  sourceLine: number;
}

interface SectionState {
  section: Section;
  /** Mọi dòng nốt (kể cả dòng chỉ có modifier, dòng do @repeat chèn) theo thứ tự. */
  raw: RawLine[];
  /** Đã nằm trong song.sections chưa (Main được tạo lười). */
  materialized: boolean;
  /** Đã tìm được bằng @repeat chưa. */
  registered: boolean;
}

interface Replay {
  repeatLine: number;
  /** Độ dài vùng gạch chân cho lỗi báo tại dòng @repeat (từ cột 1). */
  repeatLength: number;
}

interface Token {
  text: string;
  /** Index 0-based trong dòng gốc. */
  start: number;
}

interface NotePart {
  key: NoteKey;
  l: boolean;
  r: boolean;
  s: boolean;
}

type TokenKind =
  | { kind: 'mod'; action: HoldAction; button: HoldButton }
  | { kind: 'rest'; beats: number; durError: boolean }
  | {
      kind: 'notes';
      parts: NotePart[];
      total: number;
      durError: boolean;
      /** Prefix tự mâu thuẫn (`LR:`) — lỗi token, không phụ thuộc trạng thái hold. */
      prefixConflict: boolean;
    }
  | { kind: 'bad' };

function leadingWs(s: string): number {
  return s.length - s.trimStart().length;
}

/** Tách token kèm vị trí. `[` luôn mở token ngoặc tới `]` kế tiếp. */
function tokenize(line: string, from: number): { tokens: Token[]; unclosed: Token | null } {
  const tokens: Token[] = [];
  let i = from;
  const n = line.length;
  while (i < n) {
    const ch = line.charAt(i);
    if (WS_RE.test(ch)) {
      i++;
      continue;
    }
    if (ch === '[') {
      const close = line.indexOf(']', i + 1);
      if (close < 0) {
        return { tokens, unclosed: { text: line.slice(i).trimEnd(), start: i } };
      }
      tokens.push({ text: line.slice(i, close + 1), start: i });
      i = close + 1;
      continue;
    }
    let j = i + 1;
    while (j < n) {
      const c = line.charAt(j);
      if (c === '[' || WS_RE.test(c)) break;
      j++;
    }
    tokens.push({ text: line.slice(i, j), start: i });
    i = j;
  }
  return { tokens, unclosed: null };
}

function classifyToken(tok: string): TokenKind {
  if (tok.charAt(0) === '[') {
    const mod = parseModifierLabel(tok.slice(1, -1));
    return mod ? { kind: 'mod', action: mod.action, button: mod.button } : { kind: 'bad' };
  }
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

  const parts: NotePart[] = [];
  let prefixConflict = false;
  for (const p of base.split('-')) {
    const m = PART_RE.exec(p);
    if (!m) return { kind: 'bad' };
    const key = (m[2] ?? '').toUpperCase();
    if (!isNoteKey(key)) return { kind: 'bad' };
    const prefix = (m[1] ?? '').toUpperCase();
    let l = false;
    let r = false;
    let s = false;
    if (prefix !== '') {
      if (VALID_PREFIXES.has(prefix)) {
        l = prefix.includes('L');
        r = prefix.includes('R');
        s = prefix.includes('S');
      } else if (
        /^[LRS]+$/.test(prefix) &&
        new Set(prefix).size === prefix.length &&
        prefix.includes('L') &&
        prefix.includes('R')
      ) {
        // LR:, RL:, LRS:… — bỏ phần L/R, giữ S
        prefixConflict = true;
        s = prefix.includes('S');
      } else {
        return { kind: 'bad' };
      }
    }
    parts.push({ key, l, r, s });
  }
  return { kind: 'notes', parts, total, durError, prefixConflict };
}

class HarmParser {
  private readonly diags: Diagnostic[] = [];
  private readonly lineOrigins: LineOrigin[] = [];
  private readonly lineSpans: LineSpan[] = [];
  private readonly unitSpans: UnitSpan[][] = [];
  private readonly sections: Section[] = [];
  /** Section đã đăng ký theo tên chính xác / theo `sectionKey` (bản đăng ký sau cùng thắng). */
  private readonly byName = new Map<string, SectionState>();
  private readonly byKey = new Map<string, SectionState>();
  private current: SectionState;
  private holds: Record<HoldButton, Pos | null> = { left: null, right: null, scroll: null };
  private repeatBudget = MAX_REPEAT_CHARS;
  private repeatLimited = false;

  private title = '';
  private artist = '';
  private bpm = DEFAULT_BPM;
  private timeSig: TimeSig = { num: DEFAULT_TIME_SIG.num, den: DEFAULT_TIME_SIG.den };
  private scrollDir: ScrollDir = 1;

  constructor(private readonly id: string) {
    // Main lười: chỉ vào song khi có Line đầu tiên
    this.current = {
      section: { name: DEFAULT_SECTION_NAME, lines: [] },
      raw: [],
      materialized: false,
      registered: false,
    };
  }

  run(text: string): void {
    const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const lines = src.split(LINE_BREAK_RE);
    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1;
      const raw = lines[i] ?? '';
      try {
        this.handleLine(raw, lineNo);
      } catch (err) {
        // lưới an toàn: parser không bao giờ throw ra ngoài
        console.error('parseHarm: internal error at line', lineNo, err);
        this.diag('unknown-token', lineNo, 1, Math.max(1, raw.length), { token: raw.trim() });
      }
    }
    for (const button of ['left', 'right', 'scroll'] as const) {
      const pos = this.holds[button];
      if (pos) {
        this.diag('unclosed-hold', pos.line, pos.column, pos.length, {
          button,
          ...(pos.fromLine !== undefined ? { fromLine: pos.fromLine } : {}),
        });
      }
    }
  }

  result(): ParseResult {
    const song: Song = {
      id: this.id,
      title: this.title,
      ...(this.artist !== '' ? { artist: this.artist } : {}),
      bpm: this.bpm,
      timeSig: this.timeSig,
      scrollDir: this.scrollDir,
      sections: this.sections,
    };
    const diagnostics = this.diags
      .map((d, i) => ({ d, i }))
      .sort((a, b) => a.d.line - b.d.line || a.d.column - b.d.column || a.i - b.i)
      .map((x) => x.d);
    return {
      song,
      diagnostics,
      lineOrigins: this.lineOrigins,
      lineSpans: this.lineSpans,
      unitSpans: this.unitSpans,
      ok: !diagnostics.some((d) => d.severity === 'error'),
    };
  }

  private diag(
    code: DiagnosticCode,
    line: number,
    column: number,
    length: number,
    params?: Params,
  ): void {
    const d: Diagnostic = {
      severity: DIAGNOSTIC_SEVERITY[code],
      code,
      line: Math.max(1, line),
      column: Math.max(1, column),
      length: Math.max(1, length),
    };
    if (params && Object.keys(params).length > 0) d.params = params;
    this.diags.push(d);
  }

  private handleLine(line: string, lineNo: number): void {
    // dấu chunk donate `k/n ` → khoảng trắng cùng độ dài: cột/vị trí vẫn theo dòng gốc
    const marker = donateMarkerLength(line);
    const raw = marker > 0 ? ' '.repeat(marker) + line.slice(marker) : line;
    const trimmed = raw.trim();
    if (trimmed === '') return;
    const lead = leadingWs(raw);
    if (trimmed.startsWith('//')) {
      if (trimmed.startsWith('//!')) {
        this.diag('annotation', lineNo, lead + 1, trimmed.length, {
          text: trimmed.slice(3).trim(),
        });
      }
      return;
    }
    if (trimmed.charAt(0) === '@') {
      this.directive(raw, trimmed, lead, lineNo);
      return;
    }
    if (trimmed.charAt(0) === '#') {
      const name = trimmed.replace(/^#+/, '').trim() || DEFAULT_SECTION_NAME;
      const state: SectionState = {
        section: { name, lines: [] },
        raw: [],
        materialized: true,
        registered: false,
      };
      this.sections.push(state.section);
      this.register(state);
      this.current = state;
      return;
    }
    this.noteLine(raw, lineNo, lineNo, null);
  }

  private directive(raw: string, trimmed: string, lead: number, lineNo: number): void {
    const name = /^@([A-Za-z]*)/.exec(trimmed)?.[1] ?? '';
    const rest = trimmed.slice(1 + name.length);
    const value = rest.trim();
    const valueCol = lead + 1 + name.length + leadingWs(rest) + 1;
    const dirLen = trimmed.length;
    const invalid = (): void => {
      if (value === '') {
        this.diag('invalid-directive-value', lineNo, lead + 1, dirLen, { name, value });
      } else {
        this.diag('invalid-directive-value', lineNo, valueCol, value.length, { name, value });
      }
    };
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
        else invalid();
        return;
      }
      case 'time': {
        const m = TIME_RE.exec(value);
        const num = m ? Number(m[1]) : NaN;
        const den = m ? Number(m[2]) : NaN;
        if (m && isValidTimeSig({ num, den })) this.timeSig = { num, den };
        else invalid();
        return;
      }
      case 'scroll':
        if (value === '+1' || value === '1') this.scrollDir = 1;
        else if (value === '-1') this.scrollDir = -1;
        else invalid();
        return;
      case 'repeat':
        this.repeat(value, lineNo, value === '' ? lead + 1 : valueCol, value || trimmed, raw);
        return;
      default:
        this.diag('unknown-directive', lineNo, lead + 1, 1 + name.length, { name });
    }
  }

  /** Đưa section vào bảng tra `@repeat` (đăng ký sau ghi đè trước cùng tên = "gần nhất"). */
  private register(st: SectionState): void {
    st.registered = true;
    this.byName.set(st.section.name, st);
    this.byKey.set(sectionKey(st.section.name), st);
  }

  /** Khớp tên chính xác trước, rồi theo `sectionKey` (hoa thường, NFC, khoảng trắng — D-012). */
  private findSection(name: string): SectionState | null {
    return this.byName.get(name) ?? this.byKey.get(sectionKey(name)) ?? null;
  }

  private repeat(name: string, lineNo: number, col: number, shown: string, raw: string): void {
    const target = this.findSection(name);
    if (!target) {
      this.diag('unknown-repeat', lineNo, col, shown.length, { name });
      return;
    }
    // snapshot: raw chỉ nối thêm, nên repeat chính section hiện tại chỉ đọc tới độ dài lúc này
    const end = target.raw.length;
    const replay: Replay = { repeatLine: lineNo, repeatLength: Math.max(1, raw.trimEnd().length) };
    for (let i = 0; i < end; i++) {
      const r = target.raw[i];
      if (!r) continue;
      const cost = r.text.length + 1;
      if (cost > this.repeatBudget) {
        // hết ngân sách: bỏ phần còn lại và mọi @repeat sau đó, báo một lần (D-042)
        this.repeatBudget = 0;
        if (!this.repeatLimited) {
          this.repeatLimited = true;
          this.diag('repeat-limit', lineNo, col, shown.length, { name, limit: MAX_REPEAT_CHARS });
        }
        return;
      }
      this.repeatBudget -= cost;
      this.noteLine(r.text, r.sourceLine, r.sourceLine, replay);
    }
  }

  private pushRaw(text: string, sourceLine: number): void {
    const st = this.current;
    st.raw.push({ text, sourceLine });
    if (!st.registered) this.register(st);
  }

  private addLine(line: Line, origin: LineOrigin, span: LineSpan, units: UnitSpan[]): void {
    const st = this.current;
    if (!st.materialized) {
      st.materialized = true;
      this.sections.push(st.section);
    }
    st.section.lines.push(line);
    this.lineOrigins.push(origin);
    this.lineSpans.push(span);
    this.unitSpans.push(units);
  }

  /**
   * Một dòng nốt. `replay` ≠ null khi được chèn bởi @repeat: lỗi token bị nuốt (đã báo ở dòng
   * gốc), lỗi trạng thái hold báo tại dòng @repeat cột 1 kèm `fromLine`; lineSpan/unitSpans trỏ
   * dòng gốc (`raw` chính là văn bản dòng gốc, đã thay dấu donate bằng khoảng trắng).
   */
  private noteLine(raw: string, lineNo: number, sourceLine: number, replay: Replay | null): void {
    this.pushRaw(raw, sourceLine);

    const tokenDiag = (code: DiagnosticCode, column: number, length: number, params: Params) => {
      if (!replay) this.diag(code, lineNo, column, length, params);
    };
    const stateDiag = (code: DiagnosticCode, column: number, length: number, params: Params) => {
      if (replay) {
        this.diag(code, replay.repeatLine, 1, replay.repeatLength, {
          ...params,
          fromLine: sourceLine,
        });
      } else {
        this.diag(code, lineNo, column, length, params);
      }
    };

    // hold mở trong lúc replay nhớ dòng @repeat + dòng gốc (cho 'unclosed-hold', D-041)
    const replayPos: Pos | null = replay
      ? { line: replay.repeatLine, column: 1, length: replay.repeatLength, fromLine: sourceLine }
      : null;

    // tiền tố lời kiểu cũ (tới ":" đầu tiên theo sau là khoảng trắng / hết dòng): bỏ qua
    const split = LEGACY_LYRIC_SPLIT_RE.exec(raw);
    const tokStart = split ? split.index + 1 : 0;

    const { tokens, unclosed } = tokenize(raw, tokStart);
    if (split) {
      // Im lặng với lời thật của file cũ ("Đồ rê mi: Z X C"); cảnh báo khi dấu ":" lạc nuốt mất nốt
      // ("Z X C: V B") hoặc dòng không còn gì sau dấu ":" — người dùng phải thấy vì sao nốt biến mất.
      const prefix = tokenize(raw.slice(0, split.index), 0);
      const prefixIsNotes =
        prefix.tokens.length > 0 &&
        prefix.unclosed === null &&
        prefix.tokens.every((tok) => classifyToken(tok.text).kind !== 'bad');
      const nothingAfter = tokens.length === 0 && unclosed === null;
      if (prefixIsNotes || nothingAfter) {
        const first = prefix.tokens[0]?.start ?? split.index;
        const text = raw.slice(first, split.index + 1).trim();
        tokenDiag('legacy-prefix-ignored', first + 1, split.index + 1 - first, {
          text:
            text.length > LEGACY_PREFIX_SHOWN ? `${text.slice(0, LEGACY_PREFIX_SHOWN - 1)}…` : text,
        });
      }
    }
    const units: Unit[] = [];
    // vị trí nguồn của từng unit (cột 0-based; dòng replay: dòng gốc — cùng văn bản nên cùng cột)
    const spans: UnitSpan[] = [];
    const spanOf = (tok: Token): UnitSpan => {
      const star = tok.text.lastIndexOf('*');
      return {
        line: sourceLine,
        start: tok.start,
        end: tok.start + tok.text.length,
        durStart: star >= 0 ? tok.start + star : null,
      };
    };
    for (const tok of tokens) {
      const col = tok.start + 1;
      const len = tok.text.length;
      const c = classifyToken(tok.text);
      switch (c.kind) {
        case 'bad':
          tokenDiag('unknown-token', col, len, { token: tok.text });
          break;
        case 'mod':
          this.applyMod(
            c.action,
            c.button,
            replayPos ?? { line: lineNo, column: col, length: len },
            (code, params) => stateDiag(code, col, len, params),
          );
          break;
        case 'rest':
          if (c.durError) tokenDiag('invalid-duration', col, len, { token: tok.text });
          units.push({ kind: 'rest', beats: c.beats });
          spans.push(spanOf(tok));
          break;
        case 'notes': {
          if (c.durError) tokenDiag('invalid-duration', col, len, { token: tok.text });
          if (c.prefixConflict) tokenDiag('prefix-conflict', col, len, { token: tok.text });
          let conflict = false;
          const n = c.parts.length;
          const beats = c.total / n;
          const notes: Note[] = c.parts.map((p) => {
            const left = this.holds.left !== null;
            const right = this.holds.right !== null;
            let octave: Octave;
            if ((p.l && right) || (p.r && left)) {
              conflict = true;
              // hold thắng prefix
              octave = right ? 1 : -1;
            } else if (left || p.l) octave = -1;
            else if (right || p.r) octave = 1;
            else octave = 0;
            return {
              kind: 'note',
              key: p.key,
              octave,
              sharp: this.holds.scroll !== null || p.s,
              beats,
            };
          });
          if (conflict) stateDiag('prefix-conflict', col, len, { token: tok.text });
          const first = notes[0];
          if (n === 1 && first) units.push(first);
          else units.push({ kind: 'slur', notes });
          spans.push(spanOf(tok));
          break;
        }
      }
    }
    if (unclosed) {
      tokenDiag('unknown-token', unclosed.start + 1, unclosed.text.length, {
        token: unclosed.text,
      });
    }

    if (units.length === 0) return;
    const line: Line = { units };
    const lineSpan: LineSpan = {
      line: sourceLine,
      // dòng có unit nên luôn có token đầu tiên (= ký tự khác trắng đầu tiên, sau tiền tố lời cũ)
      tokensStart: tokens[0]?.start ?? tokStart,
      repeated: replay !== null,
    };
    this.addLine(
      line,
      replay ? { sourceLine, repeatLine: replay.repeatLine } : { sourceLine },
      lineSpan,
      spans,
    );
  }

  /** Máy trạng thái hold. Lỗi thì trạng thái giữ nguyên. `pos` = nơi nhớ cho 'unclosed-hold'. */
  private applyMod(
    action: HoldAction,
    button: HoldButton,
    pos: Pos,
    report: (code: DiagnosticCode, params: Params) => void,
  ): void {
    if (action === 'release') {
      if (this.holds[button] === null) report('release-without-hold', { button });
      else this.holds[button] = null;
      return;
    }
    if (this.holds[button] !== null) {
      report('hold-duplicate', { button });
      return;
    }
    if (button !== 'scroll') {
      const other: HoldButton = button === 'left' ? 'right' : 'left';
      if (this.holds[other] !== null) {
        report('hold-conflict', { button, other });
        return;
      }
    }
    this.holds[button] = pos;
  }
}

/**
 * Parse văn bản `.harm` (spec mục 3) thành model. Không bao giờ throw: lỗi được
 * trả về trong `diagnostics` (dòng + cột), model là kết quả best-effort.
 */
export function parseHarm(text: string, opts: ParseOptions = {}): ParseResult {
  const parser = new HarmParser(opts?.id ?? '');
  parser.run(typeof text === 'string' ? text : '');
  return parser.result();
}
