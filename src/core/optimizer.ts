import type { KeyChoice } from './keys';
import { DEFAULT_BASE_OCTAVE, keyChoicesForMidi, playableRange } from './keys';
import type { Octave, ScrollDir } from './types';
import { NOTE_KEYS } from './types';

/**
 * Transpose optimizer (spec mục 6): thử mọi transpose, gán (key, octave, sharp) cho từng nốt bằng
 * Viterbi DP, chọn phương án ít scroll / ít lần giữ chuột / ít nốt có modifier nhất.
 * Hold run = dải liên tiếp cùng (octave, sharp) ≠ (0, false); rest phá run, xuống dòng không phá
 * (DECISIONS D-020, D-021) — đúng như buildTimeline.
 *
 * Kiểu Mobile (`scheme: 'mobile'`): nút chế độ là chạm để chọn, giữ trạng thái qua rest (như
 * buildMobilePlan) → cost = 10 × nốt thăng + 4 × lần chạm đổi quãng + 4 × lần chạm Nửa Cung,
 * không có cost theo từng nốt có modifier.
 */

export interface OptimizerOptions {
  /** Z = C{baseOctave}; mặc định 4 (tầm C3..C6). */
  baseOctave?: number;
  /** Chiều Nửa Cung (mặc định +1). */
  scrollDir?: ScrollDir;
  /** Nốt ngoài tầm: gập về quãng gần nhất (đánh dấu `folded`) thay vì loại transpose đó. */
  fold?: boolean;
  /** Số phương án trả về (mặc định 3, tối đa 12 — một phương án mỗi lớp shift). */
  top?: number;
  /** Kiểu điều khiển (mặc định 'pc'): quyết định cost model. */
  scheme?: 'pc' | 'mobile';
  /** Mobile: Nửa Cung bật/tắt giữ trạng thái ('toggle', mặc định) hay chỉ áp 1 nốt ('oneShot'). */
  mobileSemitone?: 'toggle' | 'oneShot';
}

export interface PlacementStats {
  noteCount: number;
  /** Số nốt cần Nửa Cung. */
  scrollNotes: number;
  /** Số hold run (theo tổ hợp octave + scroll). */
  holdRuns: number;
  /** Số nốt có ít nhất 1 modifier. */
  modifiedNotes: number;
  /** Số nốt bị gập quãng cho vừa tầm. */
  foldedNotes: number;
  /** Mobile: số lần chạm đổi chế độ quãng (chỉ có khi scheme === 'mobile'). */
  octaveTaps?: number;
  /** Mobile: số lần chạm Nửa Cung (chỉ có khi scheme === 'mobile'). */
  semitoneTaps?: number;
}

export interface Placement {
  /** Số semitone cộng vào mọi cao độ. */
  transpose: number;
  /** Lớp cung: ((transpose % 12) + 12) % 12. */
  shift: number;
  cost: number;
  stats: PlacementStats;
  /** Một phần tử mỗi event đầu vào; null cho rest. */
  choices: (KeyChoice | null)[];
  /** folded[i] = event i bị gập quãng (rest luôn false). */
  folded: boolean[];
}

/** Trọng số cost (spec mục 6) + phạt mỗi nốt bị gập quãng. */
export const COST = { scroll: 10, run: 4, modified: 1, folded: 1000 } as const;

/** Trọng số cost kiểu Mobile: mỗi nốt thăng, mỗi lần chạm nút chế độ, mỗi nốt bị gập. */
export const MOBILE_COST = { scroll: 10, tap: 4, folded: 1000 } as const;

/** Transpose được thử: [-TRANSPOSE_LIMIT, TRANSPOSE_LIMIT]. */
export const TRANSPOSE_LIMIT = 48;

const DEFAULT_TOP = 3;

/**
 * Cost của một bộ thống kê. Có `octaveTaps` / `semitoneTaps` (thống kê kiểu Mobile) → cost Mobile
 * (10 × scroll + 4 × chạm + 1000 × gập), không có → cost PC như spec mục 6.
 */
export function placementCost(stats: PlacementStats): number {
  if (stats.octaveTaps !== undefined || stats.semitoneTaps !== undefined) {
    return (
      MOBILE_COST.scroll * stats.scrollNotes +
      MOBILE_COST.tap * ((stats.octaveTaps ?? 0) + (stats.semitoneTaps ?? 0)) +
      MOBILE_COST.folded * stats.foldedNotes
    );
  }
  return (
    COST.scroll * stats.scrollNotes +
    COST.run * stats.holdRuns +
    COST.modified * stats.modifiedNotes +
    COST.folded * stats.foldedNotes
  );
}

// ---------------------------------------------------------------------------
// Trạng thái (octave, sharp): 6 trạng thái, đúng thứ tự keyChoicesForMidi
// (không scroll trước; octave 0, -1, 1). Trạng thái 0 = nốt thường.
// ---------------------------------------------------------------------------

const N_STATES = 6;
const STATE_OCTAVE: readonly Octave[] = [0, -1, 1, 0, -1, 1];
const STATE_SHARP: readonly boolean[] = [false, false, false, true, true, true];
/** Cost riêng của nốt theo trạng thái: +1 nếu có modifier, +10 nếu scroll. */
const NOTE_COST: readonly number[] = STATE_OCTAVE.map((o, s) => {
  const sharp = STATE_SHARP[s] === true;
  return (o !== 0 || sharp ? COST.modified : 0) + (sharp ? COST.scroll : 0);
});

function stateOf(octave: Octave, sharp: boolean): number {
  return (sharp ? 3 : 0) + (octave === 0 ? 0 : octave === -1 ? 1 : 2);
}

/**
 * Bảng chuyển trạng thái p → s (index p * N_STATES + s), đã gồm cost riêng của nốt s.
 * PC: run mới (+4) khi s ≠ 0 và (sau rest hoặc p ≠ s) — `PC_FRESH` / `PC_CONT`.
 * Mobile: chạm đổi quãng khi octave khác (+4); Nửa Cung 'toggle' chạm khi sharp khác (+4),
 * 'oneShot' chạm trước mọi nốt thăng (+4, trạng thái tự về tắt); +10 mỗi nốt thăng. Rest không đổi gì.
 */
function transTable(cost: (p: number, s: number) => number): Float64Array {
  const t = new Float64Array(N_STATES * N_STATES);
  for (let p = 0; p < N_STATES; p++) {
    for (let s = 0; s < N_STATES; s++) t[p * N_STATES + s] = cost(p, s);
  }
  return t;
}

const PC_FRESH = transTable((_p, s) => (s !== 0 ? COST.run : 0) + (NOTE_COST[s] ?? 0));
const PC_CONT = transTable((p, s) => (s !== 0 && p !== s ? COST.run : 0) + (NOTE_COST[s] ?? 0));

function mobileTrans(oneShot: boolean): Float64Array {
  return transTable((p, s) => {
    const sharp = STATE_SHARP[s] === true;
    const octaveTap = STATE_OCTAVE[p] !== STATE_OCTAVE[s] ? 1 : 0;
    const semitoneTap = oneShot ? (sharp ? 1 : 0) : STATE_SHARP[p] !== STATE_SHARP[s] ? 1 : 0;
    return MOBILE_COST.tap * (octaveTap + semitoneTap) + (sharp ? MOBILE_COST.scroll : 0);
  });
}

const MOBILE_TOGGLE = mobileTrans(false);
const MOBILE_ONESHOT = mobileTrans(true);

/** Bảng midi (trong tầm) × trạng thái → index phím (NOTE_KEYS) hoặc -1. */
interface KeyTable {
  min: number;
  max: number;
  keys: Int8Array;
}

const tableCache = new Map<string, KeyTable>();

function keyTable(baseOctave: number, scrollDir: ScrollDir): KeyTable {
  const id = `${baseOctave}|${scrollDir}`;
  const cached = tableCache.get(id);
  if (cached) return cached;
  const { min, max } = playableRange(baseOctave);
  const keys = new Int8Array((max - min + 1) * N_STATES).fill(-1);
  for (let m = min; m <= max; m++) {
    // mỗi trạng thái có tối đa 1 phím cho một cao độ (KEY_SEMITONES khác nhau)
    for (const c of keyChoicesForMidi(m, baseOctave, scrollDir)) {
      keys[(m - min) * N_STATES + stateOf(c.octave, c.sharp)] = NOTE_KEYS.indexOf(c.key);
    }
  }
  const table = { min, max, keys };
  tableCache.set(id, table);
  return table;
}

interface Resolved {
  baseOctave: number;
  scrollDir: ScrollDir;
  fold: boolean;
  table: KeyTable;
  /** Bảng chuyển Mobile; null = kiểu PC. */
  mobile: Float64Array | null;
  /** Mobile + Nửa Cung chỉ áp 1 nốt. */
  oneShot: boolean;
}

function resolve(opts: OptimizerOptions): Resolved {
  const baseOctave = opts.baseOctave ?? DEFAULT_BASE_OCTAVE;
  if (!Number.isInteger(baseOctave)) {
    throw new RangeError(`optimizer: baseOctave phải là số nguyên (nhận ${baseOctave})`);
  }
  const scrollDir: ScrollDir = opts.scrollDir === -1 ? -1 : 1;
  const isMobile = opts.scheme === 'mobile';
  const oneShot = isMobile && opts.mobileSemitone === 'oneShot';
  return {
    baseOctave,
    scrollDir,
    fold: opts.fold === true,
    table: keyTable(baseOctave, scrollDir),
    mobile: isMobile ? (oneShot ? MOBILE_ONESHOT : MOBILE_TOGGLE) : null,
    oneShot,
  };
}

/** Chuỗi nốt (bỏ rest) của melody. */
interface NoteSeq {
  n: number;
  /** Cao độ gốc của nốt j. */
  pitch: Float64Array;
  /** Index event của nốt j. */
  event: Int32Array;
  /** 1 nếu ngay trước nốt j là rest hoặc đầu bài (run mới bắt buộc phải bắt đầu). */
  afterRest: Uint8Array;
  /** Cao độ gốc đã sắp tăng dần (đếm nhanh số nốt ngoài tầm). */
  sorted: Float64Array;
  minPitch: number;
  maxPitch: number;
}

/** null nếu có cao độ không phải số nguyên (không bấm được). */
function noteSeq(pitches: readonly (number | null)[]): NoteSeq | null {
  let n = 0;
  for (const p of pitches) {
    if (p === null) continue;
    if (!Number.isInteger(p)) return null;
    n++;
  }
  const pitch = new Float64Array(n);
  const event = new Int32Array(n);
  const afterRest = new Uint8Array(n);
  let minPitch = Infinity;
  let maxPitch = -Infinity;
  let j = 0;
  let rest = true;
  pitches.forEach((p, i) => {
    if (p === null) {
      rest = true;
      return;
    }
    pitch[j] = p;
    event[j] = i;
    afterRest[j] = rest ? 1 : 0;
    rest = false;
    if (p < minPitch) minPitch = p;
    if (p > maxPitch) maxPitch = p;
    j++;
  });
  const sorted = pitch.slice().sort();
  return { n, pitch, sorted, event, afterRest, minPitch, maxPitch };
}

/** Dời theo quãng tám tới cao độ gần nhất trong [min, max] (tầm rộng 36 semitone ≥ 12). */
function foldInto(m: number, min: number, max: number): number {
  if (m < min) return m + 12 * Math.ceil((min - m) / 12);
  if (m > max) return m - 12 * Math.ceil((m - max) / 12);
  return m;
}

/** Số phần tử của mảng đã sắp < x (strict) hoặc ≤ x. */
function countBelow(sorted: Float64Array, x: number, inclusive: boolean): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const v = sorted[mid];
    if (v < x || (inclusive && v === x)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Số nốt nằm ngoài tầm sau khi cộng t (= số nốt sẽ bị gập). O(log n). */
function foldCount(seq: NoteSeq, t: number, table: KeyTable): number {
  if (seq.n === 0) return 0;
  if (seq.minPitch + t >= table.min && seq.maxPitch + t <= table.max) return 0;
  return (
    countBelow(seq.sorted, table.min - t, false) +
    (seq.n - countBelow(seq.sorted, table.max - t, true))
  );
}

/**
 * Cost tối thiểu (chỉ giá trị, không truy vết) — dùng để sàng mọi transpose thật nhanh.
 * dp[s] = cost nhỏ nhất của tiền tố kết thúc ở trạng thái s. Chuyển tới s ≠ 0 tốn +4 trừ khi
 * nốt trước cùng trạng thái và không có rest xen giữa: min(dp[s], minAll + 4).
 * `foldPenalty` = phạt gập của cả transpose (đã biết trước); dừng sớm (Infinity) khi cận dưới
 * minAll + foldPenalty vượt `limit` (cost chỉ tăng dần theo tiền tố).
 */
function minCost(seq: NoteSeq, t: number, r: Resolved, foldPenalty: number, limit: number): number {
  if (r.mobile !== null) return minCostMobile(seq, t, r, r.mobile, foldPenalty, limit);
  const { min, max, keys } = r.table;
  let dp = new Float64Array(N_STATES).fill(Infinity);
  let next = new Float64Array(N_STATES);
  dp[0] = 0; // trạng thái ảo "đầu bài"
  for (let j = 0; j < seq.n; j++) {
    let m = seq.pitch[j] + t;
    if (m < min || m > max) {
      if (!r.fold) return Infinity;
      m = foldInto(m, min, max);
    }
    let minAll = Infinity;
    for (let s = 0; s < N_STATES; s++) {
      const v = dp[s];
      if (v < minAll) minAll = v;
    }
    if (minAll + foldPenalty > limit) return Infinity;
    const row = (m - min) * N_STATES;
    const fresh = seq.afterRest[j] === 1;
    for (let s = 0; s < N_STATES; s++) {
      if (keys[row + s] < 0) {
        next[s] = Infinity;
        continue;
      }
      let base: number;
      if (s === 0) base = minAll;
      else if (fresh) base = minAll + COST.run;
      else base = Math.min(dp[s], minAll + COST.run);
      next[s] = base + NOTE_COST[s];
    }
    const tmp = dp;
    dp = next;
    next = tmp;
  }
  let best = Infinity;
  for (let s = 0; s < N_STATES; s++) best = Math.min(best, dp[s]);
  return best + foldPenalty;
}

/**
 * Như minCost nhưng cost Mobile: trạng thái (chế độ quãng, Nửa Cung) giữ qua rest nên không cần
 * `afterRest`; dp[0] = đầu bài (Ngẩng Tự Nhiên, Nửa Cung tắt). Chuyển p → s tra `trans`.
 */
function minCostMobile(
  seq: NoteSeq,
  t: number,
  r: Resolved,
  trans: Float64Array,
  foldPenalty: number,
  limit: number,
): number {
  const { min, max, keys } = r.table;
  let dp = new Float64Array(N_STATES).fill(Infinity);
  let next = new Float64Array(N_STATES);
  dp[0] = 0;
  for (let j = 0; j < seq.n; j++) {
    let m = seq.pitch[j] + t;
    if (m < min || m > max) {
      if (!r.fold) return Infinity;
      m = foldInto(m, min, max);
    }
    let minAll = Infinity;
    for (let s = 0; s < N_STATES; s++) {
      const v = dp[s];
      if (v < minAll) minAll = v;
    }
    if (minAll + foldPenalty > limit) return Infinity;
    const row = (m - min) * N_STATES;
    for (let s = 0; s < N_STATES; s++) {
      if (keys[row + s] < 0) {
        next[s] = Infinity;
        continue;
      }
      let best = Infinity;
      for (let p = 0; p < N_STATES; p++) {
        const v = dp[p] + trans[p * N_STATES + s];
        if (v < best) best = v;
      }
      next[s] = best;
    }
    const tmp = dp;
    dp = next;
    next = tmp;
  }
  let best = Infinity;
  for (let s = 0; s < N_STATES; s++) best = Math.min(best, dp[s]);
  return best + foldPenalty;
}

/**
 * Viterbi đầy đủ (có truy vết) cho một transpose. Hòa: ưu tiên nốt thường, rồi theo thứ tự
 * keyChoicesForMidi (duyệt trạng thái tăng dần, so sánh chặt `<`).
 */
function solve(
  pitches: readonly (number | null)[],
  seq: NoteSeq,
  transpose: number,
  r: Resolved,
): Placement | null {
  const { min, max, keys } = r.table;
  const n = seq.n;
  const midi = new Int32Array(n);
  const foldedNote = new Uint8Array(n);
  const back = new Int8Array(n * N_STATES);
  let dp = new Float64Array(N_STATES).fill(Infinity);
  let next = new Float64Array(N_STATES);
  dp[0] = 0;
  for (let j = 0; j < n; j++) {
    let m = seq.pitch[j] + transpose;
    if (m < min || m > max) {
      if (!r.fold) return null;
      m = foldInto(m, min, max);
      foldedNote[j] = 1;
    }
    midi[j] = m;
    const row = (m - min) * N_STATES;
    // cost nguyên → cộng sẵn cost nốt vào bảng không đổi thứ tự/hòa so với cộng sau
    const trans = r.mobile ?? (seq.afterRest[j] === 1 ? PC_FRESH : PC_CONT);
    for (let s = 0; s < N_STATES; s++) {
      if (keys[row + s] < 0) {
        next[s] = Infinity;
        back[j * N_STATES + s] = 0;
        continue;
      }
      let best = Infinity;
      let arg = 0;
      for (let p = 0; p < N_STATES; p++) {
        const v = dp[p] + trans[p * N_STATES + s];
        if (v < best) {
          best = v;
          arg = p;
        }
      }
      next[s] = best;
      back[j * N_STATES + s] = arg;
    }
    const tmp = dp;
    dp = next;
    next = tmp;
  }

  let end = 0;
  let endCost = Infinity;
  for (let s = 0; s < N_STATES; s++) {
    const v = dp[s];
    if (v < endCost) {
      endCost = v;
      end = s;
    }
  }
  if (n > 0 && !Number.isFinite(endCost)) return null;

  // truy vết
  const states = new Int8Array(n);
  let s = end;
  for (let j = n - 1; j >= 0; j--) {
    states[j] = s;
    s = back[j * N_STATES + s];
  }

  const choices: (KeyChoice | null)[] = pitches.map(() => null);
  const folded: boolean[] = pitches.map(() => false);
  const stats: PlacementStats = {
    noteCount: n,
    scrollNotes: 0,
    holdRuns: 0,
    modifiedNotes: 0,
    foldedNotes: 0,
  };
  for (let j = 0; j < n; j++) {
    const st = states[j];
    const octave = STATE_OCTAVE[st];
    const sharp = STATE_SHARP[st] === true;
    const key = NOTE_KEYS[keys[(midi[j] - min) * N_STATES + st]];
    const i = seq.event[j];
    choices[i] = { key, octave, sharp };
    if (foldedNote[j] === 1) {
      folded[i] = true;
      stats.foldedNotes++;
    }
    if (st !== 0) {
      stats.modifiedNotes++;
      if (sharp) stats.scrollNotes++;
      if (seq.afterRest[j] === 1 || states[j - 1] !== st) stats.holdRuns++;
    }
  }
  if (r.mobile !== null) {
    // trạng thái nút giữ qua rest; đầu bài Ngẩng Tự Nhiên + Nửa Cung tắt (như buildMobilePlan)
    let octaveTaps = 0;
    let semitoneTaps = 0;
    let prevOctave: Octave = 0;
    let prevSharp = false;
    for (let j = 0; j < n; j++) {
      const st = states[j];
      const octave = STATE_OCTAVE[st];
      const sharp = STATE_SHARP[st] === true;
      if (octave !== prevOctave) octaveTaps++;
      if (r.oneShot ? sharp : sharp !== prevSharp) semitoneTaps++;
      prevOctave = octave;
      prevSharp = sharp;
    }
    stats.octaveTaps = octaveTaps;
    stats.semitoneTaps = semitoneTaps;
  }

  return {
    transpose: transpose === 0 ? 0 : transpose, // không trả -0
    shift: shiftOf(transpose),
    cost: placementCost(stats),
    stats,
    choices,
    folded,
  };
}

function shiftOf(t: number): number {
  return ((t % 12) + 12) % 12;
}

/** Khoảng cách lớp cung tới cung gốc: shift 1 và 11 đều cách 1. */
function shiftDistance(shift: number): number {
  return shift <= 6 ? shift : 12 - shift;
}

interface Candidate {
  transpose: number;
  shift: number;
  cost: number;
}

/** Thứ tự phương án: cost, shift 0 trước, shift gần cung gốc, |transpose| nhỏ, transpose nhỏ. */
function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    a.cost - b.cost ||
    (a.shift === 0 ? 0 : 1) - (b.shift === 0 ? 0 : 1) ||
    shiftDistance(a.shift) - shiftDistance(b.shift) ||
    Math.abs(a.transpose) - Math.abs(b.transpose) ||
    a.transpose - b.transpose
  );
}

function checkTranspose(transpose: number): void {
  if (!Number.isInteger(transpose)) {
    throw new RangeError(`optimizer: transpose phải là số nguyên (nhận ${transpose})`);
  }
}

/**
 * Đặt melody với một transpose cố định. null nếu có nốt ngoài tầm (khi không bật `fold`) hoặc
 * cao độ không phải số nguyên. Bật `fold`: nốt ngoài tầm được dời theo quãng tám tới cao độ gần
 * nhất trong tầm, đánh dấu `folded[i]`, mỗi nốt +1000 cost.
 */
export function evaluateTranspose(
  pitches: readonly (number | null)[],
  transpose: number,
  opts: OptimizerOptions = {},
): Placement | null {
  checkTranspose(transpose);
  const r = resolve(opts);
  const seq = noteSeq(pitches);
  if (!seq) return null;
  return solve(pitches, seq, transpose, r);
}

/**
 * Duyệt transpose trong `ts`, trả ứng viên tốt nhất theo từng lớp shift (đã sắp). Branch-and-bound:
 * thử trước transpose ít nốt bị gập nhất; bỏ / dừng sớm transpose có cận dưới vượt cost tốt nhất
 * của lớp đó (vượt chặt, nên kết quả hòa vẫn được so đầy đủ — không phụ thuộc thứ tự duyệt).
 */
function bestPerShift(seq: NoteSeq, ts: readonly number[], r: Resolved): Candidate[] {
  const order: { t: number; bound: number }[] = [];
  for (const t of ts) {
    const folds = foldCount(seq, t, r.table);
    if (folds > 0 && !r.fold) continue;
    order.push({ t, bound: COST.folded * folds });
  }
  order.sort((a, b) => a.bound - b.bound || Math.abs(a.t) - Math.abs(b.t) || a.t - b.t);

  const best = new Map<number, Candidate>();
  for (const { t, bound } of order) {
    const shift = shiftOf(t);
    const cur = best.get(shift);
    const limit = cur ? cur.cost : Infinity;
    if (bound > limit) continue;
    const cost = minCost(seq, t, r, bound, limit);
    if (!Number.isFinite(cost)) continue;
    const c: Candidate = { transpose: t, shift, cost };
    if (!cur || compareCandidates(c, cur) < 0) best.set(shift, c);
  }
  return [...best.values()].sort(compareCandidates);
}

function transposeRange(step: number): number[] {
  const out: number[] = [];
  for (let t = -TRANSPOSE_LIMIT; t <= TRANSPOSE_LIMIT; t += step) out.push(t);
  return out;
}

const ALL_TRANSPOSES = transposeRange(1);
const OCTAVE_TRANSPOSES = transposeRange(12);

function normalizeTop(top: number | undefined): number {
  if (top === undefined || Number.isNaN(top)) return DEFAULT_TOP;
  return Math.max(0, Math.min(12, Math.floor(top)));
}

/**
 * Thử mọi transpose trong [-48, 48] vừa tầm (hoặc mọi transpose khi bật `fold`), giữ phương án
 * tốt nhất của mỗi lớp shift, sắp theo cost → shift 0 trước → shift gần cung gốc → |transpose|
 * nhỏ → transpose nhỏ; trả `top` phương án đầu (mặc định 3). [] khi không phương án nào vừa.
 * Melody không có nốt nào: chỉ trả phương án transpose 0 (mọi phương án đều như nhau).
 */
export function optimizeTranspose(
  pitches: readonly (number | null)[],
  opts: OptimizerOptions = {},
): Placement[] {
  const r = resolve(opts);
  const top = normalizeTop(opts.top);
  const seq = noteSeq(pitches);
  if (!seq || top === 0) return [];
  if (seq.n === 0) {
    const p = solve(pitches, seq, 0, r);
    return p ? [p] : [];
  }
  const out: Placement[] = [];
  for (const c of bestPerShift(seq, ALL_TRANSPOSES, r).slice(0, top)) {
    const p = solve(pitches, seq, c.transpose, r);
    if (p) out.push(p);
  }
  return out;
}

/** Phương án tốt nhất giữ cung gốc (shift 0, chỉ dời quãng tám) — nút "giữ cung gốc". */
export function keepOriginalKey(
  pitches: readonly (number | null)[],
  opts: OptimizerOptions = {},
): Placement | null {
  const r = resolve(opts);
  const seq = noteSeq(pitches);
  if (!seq) return null;
  if (seq.n === 0) return solve(pitches, seq, 0, r);
  const best = bestPerShift(seq, OCTAVE_TRANSPOSES, r)[0];
  return best ? solve(pitches, seq, best.transpose, r) : null;
}
