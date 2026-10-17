import type { Line, ParseResult, Unit } from './types';
import { DEFAULT_BPM } from './types';

/**
 * Tap timing (spec §6): người dùng bấm Space theo nhịp bài gốc, mỗi lần bấm = 1 đơn vị nốt (nốt hoặc
 * cả cụm luyến). Khoảng cách giữa hai lần bấm quy đổi ra beat theo bpm thành độ dài của đơn vị trước.
 * Module thuần: không DOM, không đồng hồ — thời điểm bấm do UI truyền vào (ms, cùng một trục).
 */

/** Một đơn vị hiện lần lượt trong chế độ Tap. */
export interface TapTarget {
  /** Index dòng model (flatten theo section) — khớp `ParseResult.lineSpans` / `unitSpans`. */
  lineIndex: number;
  /** Index unit trong `line.units`. */
  unitIndex: number;
  /** Rest không bấm, chỉ là vách ngăn (giữ nguyên độ dài). */
  kind: 'note' | 'slur' | 'rest';
  /** Độ dài hiện tại (beat); luyến = tổng độ dài các nốt. */
  beats: number;
  /** Dòng do `@repeat` chèn — sửa độ dài sẽ ghi vào dòng gốc (đổi mọi lần lặp). */
  repeated: boolean;
  /** Nhãn hiển thị, chỉ phím (không modifier): `N`, `X-C`, rest `_`. */
  label: string;
}

export interface TapDurationOptions {
  bpm: number;
  /** Làm tròn về bội của `grid` (spec: bội 0.25 beat, bật/tắt). */
  quantize: boolean;
  /** Ô lưới quantize (beat), mặc định 0.25. */
  grid?: number;
  /** Độ dài cho nốt bấm cuối (không có lần bấm sau để đo), mặc định 1. */
  lastBeats?: number;
}

export interface TapDuration {
  lineIndex: number;
  unitIndex: number;
  beats: number;
}

export const DEFAULT_TAP_GRID = 0.25;
export const DEFAULT_TAP_LAST_BEATS = 1;
/** Độ dài tối thiểu khi tắt quantize (1/16 beat). */
export const MIN_FREE_TAP_BEATS = 0.0625;
/** Tắt quantize: làm tròn tới 0.001 beat để `*dur` ghi vào text còn đọc được. */
const FREE_PRECISION = 1000;

function unitLabel(unit: Unit): string {
  if (unit.kind === 'rest') return '_';
  if (unit.kind === 'note') return unit.key;
  return unit.notes.map((n) => n.key).join('-');
}

function unitBeats(unit: Unit): number {
  if (unit.kind !== 'slur') return unit.beats;
  let sum = 0;
  for (const n of unit.notes) sum += n.beats;
  return sum;
}

/** Dòng model `i` có đến từ `@repeat` không. lineSpans chưa có (parser cũ) → suy từ lineOrigins. */
function isRepeatedLine(parsed: ParseResult, i: number): boolean {
  const span = parsed.lineSpans[i];
  if (span !== undefined) return span.repeated;
  return parsed.lineOrigins[i]?.repeatLine !== undefined;
}

function pushLineTargets(out: TapTarget[], line: Line, lineIndex: number, repeated: boolean): void {
  line.units.forEach((unit, unitIndex) => {
    out.push({
      lineIndex,
      unitIndex,
      kind: unit.kind,
      beats: unitBeats(unit),
      repeated,
      label: unitLabel(unit),
    });
  });
}

/**
 * Các unit của section `sectionIndex` (index trong `song.sections`) hoặc cả bài (`null`), theo thứ tự,
 * kể cả rest (vách ngăn, không bấm).
 * - Cả bài: bỏ dòng do `@repeat` chèn — nguồn của chúng được tap ở dòng gốc.
 * - Một section: giữ cả dòng lặp (đánh dấu `repeated`; sửa sẽ ghi vào dòng gốc).
 * Section không tồn tại → [].
 */
export function collectTapTargets(parsed: ParseResult, sectionIndex: number | null): TapTarget[] {
  const out: TapTarget[] = [];
  const sections = parsed.song.sections;
  if (
    sectionIndex !== null &&
    !(Number.isInteger(sectionIndex) && sectionIndex >= 0 && sectionIndex < sections.length)
  ) {
    return out;
  }
  let lineIndex = 0;
  for (let s = 0; s < sections.length; s++) {
    const section = sections[s];
    if (section === undefined) continue;
    for (const line of section.lines) {
      const li = lineIndex++;
      if (sectionIndex !== null && s !== sectionIndex) continue;
      const repeated = isRepeatedLine(parsed, li);
      if (sectionIndex === null && repeated) continue;
      pushLineTargets(out, line, li, repeated);
    }
  }
  return out;
}

/** Index (trong `targets`) của các target cần bấm, theo thứ tự. */
function tappableIndices(targets: readonly TapTarget[]): number[] {
  const out: number[] = [];
  targets.forEach((t, i) => {
    if (t.kind !== 'rest') out.push(i);
  });
  return out;
}

function positiveOr(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Bội gần nhất của grid (>= grid). Grid dạng 1/k chia cho k để ra đúng số (vd. 2/3, 0.3). */
function quantizeTo(raw: number, grid: number): number {
  const steps = Math.max(1, Math.round(raw / grid));
  const inv = 1 / grid;
  const invInt = Math.round(inv);
  return invInt > 0 && Math.abs(inv - invInt) < 1e-9 ? steps / invInt : steps * grid;
}

/**
 * Hai target liên tiếp trong `targets` không liền nhau trong bài (giữa chúng có dòng bị bỏ — dòng
 * `@repeat` khi tap cả bài) → khoảng cách tap không đo được độ dài nốt trước.
 */
function hasBreak(targets: readonly TapTarget[], from: number, to: number): boolean {
  for (let a = from; a < to; a++) {
    const cur = targets[a];
    const next = targets[a + 1];
    if (cur !== undefined && next !== undefined && next.lineIndex > cur.lineIndex + 1) return true;
  }
  return false;
}

/**
 * Lần bấm → độ dài (beat) cho từng unit đã bấm, theo thứ tự (mỗi target không phải rest = 1 lần bấm,
 * bấm thừa bị bỏ). Độ dài unit k = (tap[k+1] − tap[k]) / 60000 × bpm trừ độ dài các rest nằm giữa
 * (rest giữ nguyên độ dài, không có trong kết quả). Quantize: bội gần nhất của grid, tối thiểu grid;
 * tắt: làm tròn 0.001, tối thiểu 1/16 beat. Unit bấm cuối cùng (kể cả khi bấm chưa hết) và unit đứng
 * ngay trước chỗ đứt (dòng bị bỏ) lấy `lastBeats` — spec: "nốt cuối lấy dur mặc định".
 */
export function computeTapDurations(
  targets: readonly TapTarget[],
  tapsMs: readonly number[],
  opts: TapDurationOptions,
): TapDuration[] {
  const bpm = positiveOr(opts.bpm, DEFAULT_BPM);
  const grid = positiveOr(opts.grid, DEFAULT_TAP_GRID);
  const lastBeats = positiveOr(opts.lastBeats, DEFAULT_TAP_LAST_BEATS);
  const order = tappableIndices(targets);
  const count = Math.min(order.length, tapsMs.length);
  const out: TapDuration[] = [];

  for (let k = 0; k < count; k++) {
    const i = order[k] ?? 0;
    const target = targets[i];
    if (target === undefined) continue;
    let beats = lastBeats;
    const j = order[k + 1];
    if (k < count - 1 && j !== undefined && !hasBreak(targets, i, j)) {
      let restBeats = 0;
      for (let r = i + 1; r < j; r++) restBeats += targets[r]?.beats ?? 0;
      const dtMs = (tapsMs[k + 1] ?? NaN) - (tapsMs[k] ?? NaN);
      const raw = (dtMs / 60000) * bpm - restBeats;
      if (Number.isFinite(raw)) {
        beats = opts.quantize
          ? quantizeTo(raw, grid)
          : Math.max(MIN_FREE_TAP_BEATS, Math.round(raw * FREE_PRECISION) / FREE_PRECISION);
      }
    }
    out.push({ lineIndex: target.lineIndex, unitIndex: target.unitIndex, beats });
  }
  return out;
}

/**
 * Phiên tap: nhớ thời điểm từng lần bấm, tự bỏ qua rest. Không giữ đồng hồ — UI truyền
 * `event.timeStamp` (hoặc performance.now()).
 */
export class TapSession {
  private readonly order: readonly number[];
  private readonly targetCount: number;
  private readonly times: number[] = [];

  constructor(targets: readonly TapTarget[]) {
    this.order = tappableIndices(targets);
    this.targetCount = targets.length;
  }

  /** Index (trong targets) của target sẽ nhận lần bấm kế; xong hết → `targets.length`. */
  get index(): number {
    return this.order[this.times.length] ?? this.targetCount;
  }

  /** Đã bấm đủ mọi target (bài không có nốt nào → true ngay). */
  get done(): boolean {
    return this.times.length >= this.order.length;
  }

  /** Số lần đã bấm. */
  get count(): number {
    return this.times.length;
  }

  /** Tổng số lần cần bấm (target không phải rest). */
  get total(): number {
    return this.order.length;
  }

  /** Ghi một lần bấm. Bỏ qua khi đã xong hoặc thời điểm không hữu hạn; lùi giờ → kẹp bằng lần trước. */
  tap(timeMs: number): void {
    if (this.done || !Number.isFinite(timeMs)) return;
    const prev = this.times[this.times.length - 1];
    this.times.push(prev !== undefined && timeMs < prev ? prev : timeMs);
  }

  /** Bỏ lần bấm cuối (quay lại target trước). */
  undo(): void {
    this.times.pop();
  }

  reset(): void {
    this.times.length = 0;
  }

  /** Bản sao các thời điểm đã bấm (ms) — đưa thẳng vào computeTapDurations. */
  taps(): readonly number[] {
    return this.times.slice();
  }
}
