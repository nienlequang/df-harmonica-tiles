import type { NoteKey, Octave, Timeline } from './types';

/**
 * Kiểu điều khiển Mobile (SPEC "Thay đổi…" 2026-10-14, GAME-UI-REFERENCE mục mobile):
 * 8 nút tròn ghi số giản phổ (chấm trên/dưới theo quãng), hàng nút chế độ "Nửa Cung · Ngẩng Lên ·
 * Ngẩng Tự Nhiên · Cúi Xuống" là CHẠM ĐỂ CHỌN (giữ trạng thái), không phải giữ như chuột PC.
 * Module thuần: nhãn giản phổ + kế hoạch "chạm đổi chế độ" (cue) tính từ Timeline.
 */

// ---------------------------------------------------------------------------
// Nhãn giản phổ
// ---------------------------------------------------------------------------

export interface JianpuLabel {
  digit: '1' | '2' | '3' | '4' | '5' | '6' | '7';
  dotsAbove: 0 | 1 | 2;
  dotsBelow: 0 | 1 | 2;
}

const KEY_DIGIT: Readonly<Record<NoteKey, JianpuLabel['digit']>> = {
  Z: '1',
  X: '2',
  C: '3',
  V: '4',
  B: '5',
  N: '6',
  M: '7',
  ',': '1',
};

/** U+0307 combining dot above. */
const DOT_ABOVE = String.fromCharCode(0x0307);
/** U+0323 combining dot below. */
const DOT_BELOW = String.fromCharCode(0x0323);

/**
 * Số giản phổ của nốt: Z..M → 1..7, chấm theo quãng (−1 → 1 chấm dưới, 0 → không, +1 → 1 chấm trên).
 * `,` = Đố → "1" cao hơn 1 quãng: −1 → không chấm, 0 → 1 chấm trên, +1 → 2 chấm trên.
 */
export function jianpuLabel(key: NoteKey, octave: Octave): JianpuLabel {
  const digit = KEY_DIGIT[key];
  const level = key === ',' ? octave + 1 : octave;
  if (level === 2) return { digit, dotsAbove: 2, dotsBelow: 0 };
  if (level === 1) return { digit, dotsAbove: 1, dotsBelow: 0 };
  if (level === -1) return { digit, dotsAbove: 0, dotsBelow: 1 };
  return { digit, dotsAbove: 0, dotsBelow: 0 };
}

/** Chữ số + U+0307 cho mỗi chấm trên / U+0323 cho mỗi chấm dưới (vd. `1̇` = KEY_DEGREE[',']). */
export function jianpuText(l: JianpuLabel): string {
  return l.digit + DOT_ABOVE.repeat(l.dotsAbove) + DOT_BELOW.repeat(l.dotsBelow);
}

// ---------------------------------------------------------------------------
// Kế hoạch chạm đổi chế độ
// ---------------------------------------------------------------------------

/** −1 = Cúi Xuống, 0 = Ngẩng Tự Nhiên, 1 = Ngẩng Lên (cùng giá trị với Octave). */
export type MobileOctaveMode = -1 | 0 | 1;

/** Cách nút Nửa Cung hoạt động (setting `mobileSemitone`): bật/tắt giữ trạng thái, hay chỉ 1 nốt. */
export type MobileSemitoneMode = 'toggle' | 'oneShot';

/** Một lần chạm nút chế độ, ngay tại đầu nốt `noteIndex` (beat = startBeat của nốt). */
export type MobileCue =
  | { beat: number; noteIndex: number; kind: 'octave'; mode: MobileOctaveMode }
  | { beat: number; noteIndex: number; kind: 'semitone'; on: boolean };

/** Dải nốt liên tiếp (index trong timeline.notes) từ đầu nốt đầu tới cuối nốt cuối. */
export interface MobileSpan {
  startBeat: number;
  endBeat: number;
  firstNote: number;
  lastNote: number;
}

export type MobileOctaveSpan = MobileSpan & { mode: MobileOctaveMode };

export interface MobilePlan {
  /** Theo thứ tự nốt; cùng nốt thì octave trước, semitone sau. */
  cues: MobileCue[];
  /** Mỗi dải = các nốt liên tiếp cùng chế độ quãng (kể cả 0); rest không cắt dải. */
  octaveSpans: MobileOctaveSpan[];
  /**
   * Mỗi dải = một lần bật Nửa Cung: 'toggle' → các nốt thăng liên tiếp (rest không cắt);
   * 'oneShot' → đúng 1 nốt thăng.
   */
  semitoneSpans: MobileSpan[];
  stats: { octaveTaps: number; semitoneTaps: number };
  /**
   * Cách Nửa Cung dùng khi dựng plan (buildMobilePlan luôn ghi). Thiếu → coi như 'toggle'.
   * mobileStateAt cần nó để biết Nửa Cung tự tắt sau nốt ('oneShot') hay giữ tới lần chạm kế.
   */
  semitone?: MobileSemitoneMode;
}

/**
 * Timeline → kế hoạch chạm. Đầu bài: Ngẩng Tự Nhiên (0), Nửa Cung tắt.
 * - Chế độ quãng GIỮ (latch): rest không reset/không cắt. Trước nốt i, nếu octave ≠ chế độ hiện tại
 *   → cue {octave, mode: note.octave} tại startBeat.
 * - Nửa Cung 'toggle': cue {on} mỗi khi sharp ≠ trạng thái hiện tại (cũng giữ qua rest).
 *   'oneShot': cue {on: true} trước mỗi nốt thăng, trạng thái tự về tắt sau nốt đó.
 */
export function buildMobilePlan(tl: Timeline, opts: { semitone: MobileSemitoneMode }): MobilePlan {
  const oneShot = opts.semitone === 'oneShot';
  const cues: MobileCue[] = [];
  const octaveSpans: MobileOctaveSpan[] = [];
  const semitoneSpans: MobileSpan[] = [];
  let octaveTaps = 0;
  let semitoneTaps = 0;

  let mode: MobileOctaveMode = 0;
  let semiOn = false;
  let octSpan: MobileOctaveSpan | null = null;
  let semiSpan: MobileSpan | null = null;

  tl.notes.forEach((n, i) => {
    const beat = n.startBeat;
    // chế độ quãng
    if (n.octave !== mode) {
      mode = n.octave;
      cues.push({ beat, noteIndex: i, kind: 'octave', mode });
      octaveTaps++;
    }
    if (octSpan !== null && octSpan.mode === mode) {
      octSpan.endBeat = n.endBeat;
      octSpan.lastNote = i;
    } else {
      octSpan = { startBeat: beat, endBeat: n.endBeat, firstNote: i, lastNote: i, mode };
      octaveSpans.push(octSpan);
    }

    // Nửa Cung
    if (oneShot) {
      if (n.sharp) {
        cues.push({ beat, noteIndex: i, kind: 'semitone', on: true });
        semitoneTaps++;
        semitoneSpans.push({ startBeat: beat, endBeat: n.endBeat, firstNote: i, lastNote: i });
      }
      return;
    }
    if (n.sharp !== semiOn) {
      semiOn = n.sharp;
      cues.push({ beat, noteIndex: i, kind: 'semitone', on: semiOn });
      semitoneTaps++;
    }
    if (!n.sharp) {
      semiSpan = null;
    } else if (semiSpan !== null) {
      semiSpan.endBeat = n.endBeat;
      semiSpan.lastNote = i;
    } else {
      semiSpan = { startBeat: beat, endBeat: n.endBeat, firstNote: i, lastNote: i };
      semitoneSpans.push(semiSpan);
    }
  });

  return {
    cues,
    octaveSpans,
    semitoneSpans,
    stats: { octaveTaps, semitoneTaps },
    semitone: oneShot ? 'oneShot' : 'toggle',
  };
}

/** Index phần tử cuối có `beatAt(i) ≤ x` trong dãy tăng dần độ dài `n`; −1 nếu không có. O(log n). */
function lastAtOrBefore(n: number, beatAt: (i: number) => number, x: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (beatAt(mid) <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** Các khoảng [start, end) Nửa Cung đang bật, tăng dần, không chồng nhau. */
interface SemitoneIntervals {
  start: number[];
  end: number[];
}

// plan coi như bất biến sau khi dựng → cache theo object (WeakMap tự dọn khi plan bị bỏ)
const intervalCache = new WeakMap<MobilePlan, SemitoneIntervals>();

function semitoneIntervals(plan: MobilePlan): SemitoneIntervals {
  const cached = intervalCache.get(plan);
  if (cached) return cached;
  const start: number[] = [];
  const end: number[] = [];
  if (plan.semitone === 'oneShot') {
    // tự tắt khi hết nốt thăng
    for (const s of plan.semitoneSpans) {
      start.push(s.startBeat);
      end.push(s.endBeat);
    }
  } else {
    // giữ từ lần chạm bật tới lần chạm tắt (hoặc hết bài)
    let open: number | null = null;
    for (const c of plan.cues) {
      if (c.kind !== 'semitone') continue;
      if (c.on && open === null) open = c.beat;
      else if (!c.on && open !== null) {
        start.push(open);
        end.push(c.beat);
        open = null;
      }
    }
    if (open !== null) {
      start.push(open);
      end.push(Infinity);
    }
  }
  const out = { start, end };
  intervalCache.set(plan, out);
  return out;
}

/**
 * Trạng thái nút chế độ tại `beat` (cue tại đúng `beat` đã được áp) + cue kế tiếp (beat > `beat`,
 * null nếu hết). Trước nốt đầu: Ngẩng Tự Nhiên, Nửa Cung tắt. NaN coi như trước đầu bài. O(log n).
 */
export function mobileStateAt(
  plan: MobilePlan,
  beat: number,
): { mode: MobileOctaveMode; semitoneOn: boolean; nextCue: MobileCue | null } {
  const x = Number.isNaN(beat) ? -Infinity : beat;
  const spans = plan.octaveSpans;
  const si = lastAtOrBefore(spans.length, (i) => spans[i]?.startBeat ?? Infinity, x);
  const mode: MobileOctaveMode = si >= 0 ? (spans[si]?.mode ?? 0) : 0;

  const iv = semitoneIntervals(plan);
  const ii = lastAtOrBefore(iv.start.length, (i) => iv.start[i] ?? Infinity, x);
  const semitoneOn = ii >= 0 && x < (iv.end[ii] ?? -Infinity);

  const cues = plan.cues;
  const ci = lastAtOrBefore(cues.length, (i) => cues[i]?.beat ?? Infinity, x);
  const nextCue = cues[ci + 1] ?? null;
  return { mode, semitoneOn, nextCue };
}
