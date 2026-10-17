/**
 * Kiểu điều khiển Mobile trong Player (SPEC 2026-10-14 "Kiểu điều khiển Mobile"): kế hoạch chạm nút
 * chế độ (core/mobile.ts) + phần nối cho renderer / engine / game bar / banner.
 * - `mobilePlanFor` cache theo object Timeline (renderer và engine dùng chung một kế hoạch).
 * - Tên nút luôn lấy từ ModifierLabels (ui/modLabels.ts) — người dùng đổi tên được.
 * - Game GIỮ chế độ đã chọn qua các lần chơi: phát lại / nhảy dòng / lặp → `MobileEntryTracker` nhớ chế
 *   độ người chơi đang giữ, sinh cue "vào lại" (`MobileEntry`) ở nốt đầu của lượt phát mới.
 */
import { buildMobilePlan, mobileStateAt } from '../core/mobile';
import type { MobileCue, MobileOctaveMode, MobilePlan } from '../core/mobile';
import type { Timeline } from '../core/types';
import type { ModifierLabels } from '../ui/modLabels';
import type { MobileSemitone } from '../ui/settings';
import type { BeatRange } from './transport.types';

/** "SẮP CHẠM" + vòng hổ phách quanh nút khi lần chạm kế còn ≤ chừng này beat (từ hit line). */
export const CUE_SOON_BEATS = 1;

/** Nút trên hàng chế độ của game mobile. */
export type MobileButton = 'scroll' | 'right' | 'natural' | 'left';

/** Thứ tự như trong game (trái → phải): Nửa Cung · Ngẩng Lên · Ngẩng Tự Nhiên · Cúi Xuống. */
export const MOBILE_BUTTONS: readonly MobileButton[] = ['scroll', 'right', 'natural', 'left'];

const cache = new WeakMap<Timeline, Partial<Record<MobileSemitone, MobilePlan>>>();

/** Kế hoạch chạm cho timeline (cache theo object timeline + cách Nửa Cung hoạt động). */
export function mobilePlanFor(tl: Timeline, semitone: MobileSemitone): MobilePlan {
  let entry = cache.get(tl);
  if (!entry) {
    entry = {};
    cache.set(tl, entry);
  }
  let plan = entry[semitone];
  if (!plan) {
    plan = buildMobilePlan(tl, { semitone });
    entry[semitone] = plan;
  }
  return plan;
}

/** Nút chế độ quãng: −1 Cúi Xuống, 0 Ngẩng Tự Nhiên, +1 Ngẩng Lên. */
export function modeButton(mode: MobileOctaveMode): MobileButton {
  return mode < 0 ? 'left' : mode > 0 ? 'right' : 'natural';
}

/** Nút phải chạm cho một cue. */
export function cueButton(cue: MobileCue): MobileButton {
  return cue.kind === 'semitone' ? 'scroll' : modeButton(cue.mode);
}

export function buttonLabel(button: MobileButton, labels: ModifierLabels): string {
  return labels[button];
}

export function cueLabel(cue: MobileCue, labels: ModifierLabels): string {
  return labels[cueButton(cue)];
}

/** Trạng thái mobile tại hit line cho React (game bar, banner). Đổi theo sự kiện, không theo frame. */
export interface MobileUiState {
  mode: MobileOctaveMode;
  semitoneOn: boolean;
  /** Các cue cùng beat với lần chạm kế tiếp (đổi quãng trước, Nửa Cung sau); rỗng nếu hết. */
  nextCues: readonly MobileCue[];
  /** Lần chạm kế còn ≤ CUE_SOON_BEATS beat. */
  cueSoon: boolean;
}

const NO_CUES: readonly MobileCue[] = Object.freeze([]) as readonly MobileCue[];

/** Mọi cue có cùng beat với `first` (cues sắp theo beat), bắt đầu từ `first`. */
export function cuesAtSameBeat(plan: MobilePlan, first: MobileCue | null): readonly MobileCue[] {
  if (!first) return NO_CUES;
  const cues = plan.cues;
  let i = cues.indexOf(first);
  if (i < 0) return [first];
  // Lùi về cue đầu tiên của beat đó (phòng khi nextCue không phải cue đầu).
  while (i > 0 && cues[i - 1].beat === first.beat) i--;
  const out: MobileCue[] = [];
  for (let j = i; j < cues.length && cues[j].beat === first.beat; j++) out.push(cues[j]);
  return out;
}

// ---------------------------------------------------------------------------
// Chế độ đang giữ + cue "vào lại" (phát lại, nhảy dòng, lặp)
// ---------------------------------------------------------------------------

/** Chế độ người chơi đang chọn trên game (game giữ qua nghỉ VÀ qua các lần chơi). */
export interface MobileLatch {
  mode: MobileOctaveMode;
  semitoneOn: boolean;
}

/** Lần chơi đầu tiên: Ngẩng Tự Nhiên, Nửa Cung tắt (như kế hoạch giả định ở đầu bài — D-173). */
export const NATURAL_LATCH: MobileLatch = Object.freeze({ mode: 0, semitoneOn: false });

/**
 * Cue "vào lại" của một lượt phát (lần đầu, chạy lại, phát lại sau khi hết bài, nhảy dòng / section,
 * vòng loop mới): nốt đầu từ điểm bắt đầu có thể cần chế độ khác chế độ người chơi đang giữ
 * (`latch`). `cues` THAY mọi cue của kế hoạch tại nốt `noteIndex` — rỗng = đã đúng chế độ (bỏ cue thừa
 * của kế hoạch; chạm Nửa Cung kiểu bật/tắt thừa sẽ TẮT mất nó). Tới hết `beat` (kể cả đúng `beat`,
 * vd. đang đứng / đếm vào tại nốt đó) chế độ hiện là `latch` và `cues` là lần chạm kế tiếp.
 */
export interface MobileEntry {
  beat: number;
  noteIndex: number;
  cues: readonly MobileCue[];
  latch: MobileLatch;
}

/** Ngưỡng coi là "nhảy" (beat): pause / phát tiếp tại chỗ chỉ lệch cỡ micro-giây. */
const MOVE_EPS = 1e-3;
const BEAT_EPS = 1e-9;

/** Index nốt đầu có startBeat ≥ `beat` (timeline sắp theo startBeat); −1 nếu không có. */
function firstNoteFrom(tl: Timeline, beat: number): number {
  const notes = tl.notes;
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((notes[mid]?.startBeat ?? Infinity) < beat - BEAT_EPS) lo = mid + 1;
    else hi = mid;
  }
  return lo < notes.length ? lo : -1;
}

/** Cue đầu có beat ≥ `beat` (cues sắp theo beat); null nếu hết. */
function firstCueFrom(plan: MobilePlan, beat: number): MobileCue | null {
  return mobileStateAt(plan, beat - 1e-6).nextCue;
}

/** Các cue của kế hoạch đặt tại nốt `noteIndex` (bắt đầu ở `beat`). */
function planCuesAt(plan: MobilePlan, noteIndex: number, beat: number): MobileCue[] {
  const out: MobileCue[] = [];
  const first = firstCueFrom(plan, beat);
  if (!first) return out;
  for (let i = plan.cues.indexOf(first); i >= 0 && i < plan.cues.length; i++) {
    const c = plan.cues[i];
    if (c.beat > beat + BEAT_EPS) break;
    if (c.noteIndex === noteIndex) out.push(c);
  }
  return out;
}

/**
 * Chế độ người chơi đang giữ ở vị trí `beat` (đã chơi tới TRƯỚC `beat` — nốt bắt đầu đúng `beat` chưa
 * chơi), giả sử đã chạm theo mọi cue trước đó. Lượt hiện tại chưa qua nốt vào lại → vẫn là
 * `entry.latch`. Nửa Cung kiểu "chỉ áp 1 nốt" tự tắt → luôn tắt.
 */
export function mobileLatchAt(
  plan: MobilePlan,
  beat: number,
  entry: MobileEntry | null,
): MobileLatch {
  if (entry && beat <= entry.beat + BEAT_EPS) return entry.latch;
  const st = mobileStateAt(plan, beat - 1e-6);
  return { mode: st.mode, semitoneOn: plan.semitone === 'oneShot' ? false : st.semitoneOn };
}

/**
 * Cue vào lại khi phát bắt đầu tại `from` lúc người chơi đang giữ `latch`: so chế độ nốt đầu từ
 * `from` cần (cue của kế hoạch tại nốt đó đã áp) với `latch` — khác quãng → chạm nút quãng đích, khác
 * Nửa Cung (bật/tắt) → chạm Nửa Cung (không bao giờ chạm mò); Nửa Cung "chỉ áp 1 nốt" giữ cue của kế
 * hoạch. Null khi không còn nốt nào từ `from`.
 */
export function mobileEntryFor(
  plan: MobilePlan,
  tl: Timeline,
  from: number,
  latch: MobileLatch,
): MobileEntry | null {
  const k = firstNoteFrom(tl, from);
  const note = k >= 0 ? tl.notes[k] : undefined;
  if (!note) return null;
  const beat = note.startBeat;
  const need = mobileStateAt(plan, beat);
  const cues: MobileCue[] = [];
  if (need.mode !== latch.mode) cues.push({ beat, noteIndex: k, kind: 'octave', mode: need.mode });
  if (plan.semitone === 'oneShot') {
    for (const c of planCuesAt(plan, k, beat)) if (c.kind === 'semitone') cues.push(c);
  } else if (need.semitoneOn !== latch.semitoneOn) {
    cues.push({ beat, noteIndex: k, kind: 'semitone', on: need.semitoneOn });
  }
  return {
    beat,
    noteIndex: k,
    cues: Object.freeze(cues),
    latch: { mode: latch.mode, semitoneOn: latch.semitoneOn },
  };
}

/**
 * Nhớ chế độ người chơi đang giữ qua các lần phát và cue vào lại của lượt hiện tại (PlayerEngine,
 * OverlayEngine). Ban đầu = Ngẩng Tự Nhiên / Nửa Cung tắt, phát từ `start`. Gọi `move(from, to)` mỗi
 * khi transport nhảy (chạy lại, phát lại sau khi hết bài, nhảy dòng / section, vòng overlay mới);
 * pause / phát tiếp tại chỗ không đổi gì. Cue tính lười theo kế hoạch + timeline hiện tại.
 */
export class MobileEntryTracker {
  private from: number;
  private latch: MobileLatch = NATURAL_LATCH;
  private cached: { plan: MobilePlan; tl: Timeline; entry: MobileEntry | null } | null = null;
  private loopCached: {
    plan: MobilePlan;
    tl: Timeline;
    start: number;
    end: number;
    entry: MobileEntry | null;
  } | null = null;

  constructor(start = 0) {
    this.from = Number.isFinite(start) ? Math.max(0, start) : 0;
  }

  /** Cue vào lại của lượt phát hiện tại. */
  entry(plan: MobilePlan, tl: Timeline): MobileEntry | null {
    const c = this.cached;
    if (c && c.plan === plan && c.tl === tl) return c.entry;
    const entry = mobileEntryFor(plan, tl, this.from, this.latch);
    this.cached = { plan, tl, entry };
    return entry;
  }

  /** Transport nhảy từ `from` (vị trí hit line ngay trước) tới `to`. Trả true nếu thật sự nhảy. */
  move(plan: MobilePlan, tl: Timeline, from: number, to: number): boolean {
    if (!Number.isFinite(from) || !Number.isFinite(to) || Math.abs(to - from) <= MOVE_EPS) {
      return false;
    }
    this.latch = mobileLatchAt(plan, from, this.entry(plan, tl));
    this.from = Math.max(0, to);
    this.cached = null;
    return true;
  }

  /**
   * Cue vào lại ở đầu mỗi vòng loop A-B `[start, end)`: chế độ giữ ở loop end (theo kế hoạch) so với
   * nốt đầu vòng. Null khi vòng không có nốt.
   */
  loopEntry(plan: MobilePlan, tl: Timeline, loop: BeatRange): MobileEntry | null {
    const c = this.loopCached;
    if (c && c.plan === plan && c.tl === tl && c.start === loop.start && c.end === loop.end) {
      return c.entry;
    }
    let entry = mobileEntryFor(plan, tl, loop.start, mobileLatchAt(plan, loop.end, null));
    if (entry && entry.beat >= loop.end - BEAT_EPS) entry = null;
    this.loopCached = { plan, tl, start: loop.start, end: loop.end, entry };
    return entry;
  }
}

/** Ngữ cảnh lượt phát cho `mobileUiAt`. */
export interface MobileUiContext {
  /** Cue vào lại của lượt hiện tại (null = kế hoạch đúng từ đầu bài). */
  entry?: MobileEntry | null;
  /**
   * Loop A-B mà transport sẽ wrap tại `end`: lần chạm kế không bao giờ là cue từ `end` trở đi (vòng
   * không tới đó) — sau `end` là vòng kế từ `start`, mở đầu bằng `entry` của vòng.
   */
  loop?: { start: number; end: number; entry: MobileEntry | null } | null;
}

/** Lần chạm kế: cue đầu của nhóm, nhóm (null = nhóm của kế hoạch) và số beat từ hit line tới đó. */
interface NextTap {
  first: MobileCue;
  group: readonly MobileCue[] | null;
  dist: number;
}

/** Cue đầu của kế hoạch có beat ≥ `beat` và < `end`, bỏ nhóm cue bị `entry` thay. */
function planTapFrom(
  plan: MobilePlan,
  beat: number,
  entry: MobileEntry | null,
  end: number,
): MobileCue | null {
  let c = firstCueFrom(plan, beat);
  if (c && entry && c.noteIndex === entry.noteIndex) c = mobileStateAt(plan, c.beat).nextCue;
  return c && c.beat < end - BEAT_EPS ? c : null;
}

function nextTap(
  plan: MobilePlan,
  beat: number,
  entry: MobileEntry | null,
  pending: boolean,
  loop: MobileUiContext['loop'],
): NextTap | null {
  const end = loop ? loop.end : Infinity;
  let tap: NextTap | null = null;
  if (pending && entry) {
    if (entry.cues.length > 0) {
      tap = { first: entry.cues[0], group: entry.cues, dist: entry.beat - beat };
    } else {
      const c = planTapFrom(plan, entry.beat, entry, end);
      if (c) tap = { first: c, group: null, dist: c.beat - beat };
    }
  } else {
    const c = mobileStateAt(plan, beat).nextCue;
    if (c && c.beat < end - BEAT_EPS) tap = { first: c, group: null, dist: c.beat - beat };
  }
  if (tap || !loop || !(loop.end > loop.start)) return tap;
  // Hết cue trong vòng này → lần chạm kế ở vòng sau (từ loop start).
  const toWrap = Math.max(0, loop.end - beat);
  const le = loop.entry;
  if (le && le.cues.length > 0) {
    return { first: le.cues[0], group: le.cues, dist: toWrap + le.beat - loop.start };
  }
  const c = planTapFrom(plan, loop.start, le, loop.end);
  return c ? { first: c, group: null, dist: toWrap + c.beat - loop.start } : null;
}

/**
 * State mobile tại `beat` (hit line), tái dùng `prev` khi không có gì đổi (để React không render lại
 * mỗi frame). `nextCues` chỉ tính lại khi cue kế tiếp đổi. `ctx`: cue vào lại của lượt + loop A-B.
 */
export function mobileUiAt(
  plan: MobilePlan,
  beat: number,
  prev: MobileUiState | null,
  ctx: MobileUiContext = {},
): MobileUiState {
  const entry = ctx.entry ?? null;
  const pending = entry !== null && beat <= entry.beat + BEAT_EPS;
  let mode: MobileOctaveMode;
  let semitoneOn: boolean;
  if (entry !== null && pending) {
    mode = entry.latch.mode;
    semitoneOn = entry.latch.semitoneOn;
  } else {
    const st = mobileStateAt(plan, beat);
    mode = st.mode;
    semitoneOn = st.semitoneOn;
  }
  const tap = nextTap(plan, beat, entry, pending, ctx.loop ?? null);
  const next = tap ? tap.first : null;
  const prevFirst = prev && prev.nextCues.length > 0 ? prev.nextCues[0] : null;
  const nextCues =
    prev && prevFirst === next
      ? prev.nextCues
      : tap && tap.group
        ? tap.group
        : cuesAtSameBeat(plan, next);
  const cueSoon = tap !== null && tap.dist <= CUE_SOON_BEATS + BEAT_EPS;
  if (
    prev &&
    prev.mode === mode &&
    prev.semitoneOn === semitoneOn &&
    prev.nextCues === nextCues &&
    prev.cueSoon === cueSoon
  ) {
    return prev;
  }
  return { mode, semitoneOn, nextCues, cueSoon };
}
