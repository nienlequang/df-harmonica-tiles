/**
 * Model nội bộ của bài hát (spec mục 3). Đây là contract chung cho mọi module —
 * đổi shape ở đây phải cập nhật parser, serializer, timeline và tests.
 */

export const NOTE_KEYS = ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ','] as const;
export type NoteKey = (typeof NOTE_KEYS)[number];

/** -1 = chuột trái (Cúi Xuống), 0 = thường, 1 = chuột phải (Ngẩng Lên). */
export type Octave = -1 | 0 | 1;

/** Chiều của "Nửa Cung" (scroll): +1 hoặc -1 semitone. */
export type ScrollDir = 1 | -1;

export interface TimeSig {
  num: number;
  den: number;
}

export interface Note {
  kind: 'note';
  key: NoteKey;
  octave: Octave;
  sharp: boolean;
  /** Độ dài tính bằng beat (> 0). */
  beats: number;
}

export interface Rest {
  kind: 'rest';
  beats: number;
}

/** Luyến: các nốt chia đều tổng độ dài (một đơn vị nốt). */
export interface Slur {
  kind: 'slur';
  notes: Note[];
}

export type Unit = Note | Rest | Slur;

export interface Line {
  units: Unit[];
}

export interface Section {
  name: string;
  lines: Line[];
}

export interface Song {
  id: string;
  title: string;
  /** Không có thì bỏ hẳn key (để toEqual/round-trip ổn định). */
  artist?: string;
  bpm: number;
  timeSig: TimeSig;
  scrollDir: ScrollDir;
  sections: Section[];
}

export const DEFAULT_BPM = 90;
export const DEFAULT_TIME_SIG: TimeSig = { num: 4, den: 4 };
export const DEFAULT_SECTION_NAME = 'Main';

// ---------------------------------------------------------------------------
// Diagnostics (parser)
// ---------------------------------------------------------------------------

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export type DiagnosticCode =
  /** `[thả ...]` khi chưa giữ. */
  | 'release-without-hold'
  /** Giữ trái khi đang giữ phải hoặc ngược lại. */
  | 'hold-conflict'
  /** Giữ lặp (đang giữ mà giữ tiếp cùng nút). */
  | 'hold-duplicate'
  /** Prefix L/R xung đột với hold đang giữ (hoặc `LR:`). */
  | 'prefix-conflict'
  /** Token không nhận ra. */
  | 'unknown-token'
  /** dur <= 0 hoặc không phải số. */
  | 'invalid-duration'
  /** `@repeat` tới section chưa tồn tại. */
  | 'unknown-repeat'
  /** Directive không biết (`@foo`) — warning. */
  | 'unknown-directive'
  /** Giá trị directive sai (`@bpm abc`, `@time 4`, `@scroll 2`) — error, giữ mặc định. */
  | 'invalid-directive-value'
  /** Hold còn mở tới hết bài — warning. */
  | 'unclosed-hold'
  /** Comment `//! ...` — warning do công cụ sinh ra (vd. nốt bị gập quãng khi import MIDI). */
  | 'annotation'
  /** `@repeat` vượt ngân sách mở rộng (`MAX_REPEAT_CHARS`) — warning, phần lặp từ đó bị bỏ. */
  | 'repeat-limit'
  /**
   * Phần trước dấu `:` (tiền tố lời kiểu cũ) bị bỏ mà trông như nốt (`Z X C: V`) hoặc sau `:` không còn
   * gì — warning (lời thật của file cũ thì bỏ im lặng).
   */
  | 'legacy-prefix-ignored';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  /** Dòng nguồn, 1-based. */
  line: number;
  /** Cột nguồn (UTF-16 index + 1), 1-based. */
  column: number;
  /** Độ dài vùng lỗi (để gạch chân), tối thiểu 1. */
  length: number;
  /** Tham số cho thông điệp i18n (`diag.<code>`), vd. { token: 'Q' }. */
  params?: Record<string, string | number>;
}

/** Mỗi dòng của model (flatten theo thứ tự section) đến từ dòng nguồn nào. */
export interface LineOrigin {
  /** Dòng nguồn (1-based) nơi token được viết. */
  sourceLine: number;
  /** Nếu dòng này được chèn bởi `@repeat`: số dòng của directive đó. */
  repeatLine?: number;
}

/**
 * Vị trí token của một unit trong văn bản nguồn — để công cụ sửa text tại chỗ (tap timing…).
 * KHÁC Diagnostic: cột ở đây 0-based (UTF-16 index), `end` exclusive, dùng thẳng với String.slice.
 */
export interface UnitSpan {
  /** Dòng nguồn 1-based nơi token được viết (dòng chèn bởi @repeat: dòng GỐC của token). */
  line: number;
  /** Cột bắt đầu (0-based) của cả token, gồm prefix và `*dur`. */
  start: number;
  /** Cột kết thúc (exclusive) của cả token. */
  end: number;
  /** Cột của ký tự `*` nếu token có ghi độ dài, null nếu không. */
  durStart: number | null;
}

/** Vị trí phần token của một dòng model trong nguồn (cột 0-based như UnitSpan). */
export interface LineSpan {
  /** Dòng nguồn 1-based (dòng chèn bởi @repeat: dòng gốc). */
  line: number;
  /**
   * Cột bắt đầu phần token: token đầu tiên của dòng (sau khoảng trắng đầu dòng, sau tiền tố lời
   * kiểu cũ `lời: ` nếu file cũ còn — parser bỏ qua phần đó, SPEC 2026-10-15).
   */
  tokensStart: number;
  /** true nếu dòng model đến từ @repeat — sửa nguồn sẽ ảnh hưởng mọi lần lặp của dòng đó. */
  repeated: boolean;
}

export interface ParseResult {
  song: Song;
  diagnostics: Diagnostic[];
  /** Song song với danh sách dòng flatten (section 0 lines..., section 1 lines...). */
  lineOrigins: LineOrigin[];
  /** Song song với lineOrigins: vị trí phần token của từng dòng model trong nguồn. */
  lineSpans: LineSpan[];
  /** unitSpans[i][j] = vị trí token của unit j thuộc dòng model i (song song với line.units). */
  unitSpans: UnitSpan[][];
  /** true khi không có diagnostic severity 'error'. */
  ok: boolean;
}

export interface ParseOptions {
  /** Gán vào song.id (mặc định ''). */
  id?: string;
}

export interface SerializeOptions {
  /** Ghi `*dur` (mặc định true). false → mọi nốt/rest coi như 1 beat khi đọc lại. */
  durations?: boolean;
  /** Ghi `# Section` (mặc định true). */
  sectionHeaders?: boolean;
  /** Ghi `@title/@artist/@bpm/@time/@scroll` (mặc định true). */
  directives?: boolean;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export interface Modifiers {
  left: boolean;
  right: boolean;
  scroll: boolean;
}

export interface TimelineNote {
  /** Index trong timeline.notes. */
  index: number;
  key: NoteKey;
  octave: Octave;
  sharp: boolean;
  startBeat: number;
  endBeat: number;
  /** Cao độ âm thanh = 12*(baseOctave+1) + semitone(key) + 12*octave + (sharp ? scrollDir : 0). */
  midi: number;
  modifiers: Modifiers;
  /** Index trong timeline.lines. */
  lineIndex: number;
  sectionIndex: number;
  /** Index của unit chứa nốt này trong line.units. */
  unitIndex: number;
  /** Thông tin luyến nếu nốt thuộc Slur. */
  slur: { id: number; pos: number; count: number } | null;
  /** Index trong timeline.holdRuns nếu nốt có modifier, ngược lại null. */
  runIndex: number | null;
}

export interface TimelineLine {
  index: number;
  sectionIndex: number;
  startBeat: number;
  endBeat: number;
  /** Nốt đầu tiên của dòng trong timeline.notes (= notes.length nếu dòng toàn rest). */
  firstNote: number;
  noteCount: number;
}

export interface TimelineSection {
  index: number;
  name: string;
  startBeat: number;
  endBeat: number;
  firstLine: number;
  lineCount: number;
}

/**
 * Dải liên tiếp các nốt cùng (octave, sharp) ≠ (0, false). Rest phá vỡ run
 * (xem DECISIONS.md D-020). Xuống dòng không phá run.
 */
export interface HoldRun {
  index: number;
  octave: Octave;
  sharp: boolean;
  modifiers: Modifiers;
  /** = startBeat của nốt đầu. */
  startBeat: number;
  /** = endBeat của nốt cuối. */
  endBeat: number;
  firstNote: number;
  noteCount: number;
}

export interface Timeline {
  bpm: number;
  timeSig: TimeSig;
  /** Số beat (quarter) mỗi ô nhịp = num * 4 / den. */
  beatsPerBar: number;
  scrollDir: ScrollDir;
  baseOctave: number;
  notes: TimelineNote[];
  lines: TimelineLine[];
  sections: TimelineSection[];
  holdRuns: HoldRun[];
  /** Tổng độ dài bài (beat), gồm cả rest. */
  totalBeats: number;
}

export interface TimelineOptions {
  /** Z = C{baseOctave}; mặc định 4. */
  baseOctave?: number;
  /** Ghi đè chiều Nửa Cung của bài (mặc định song.scrollDir). */
  scrollDir?: ScrollDir;
}
