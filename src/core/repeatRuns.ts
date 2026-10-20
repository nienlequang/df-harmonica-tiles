import type { Modifiers, NoteKey, Octave, TimelineNote } from './types';

/**
 * "Thanh bấm lặp" (D-447): một đoạn bấm cùng MỘT phím liên tục, nhiều lần, nốt ngắn — renderer vẽ cả đoạn thành
 * MỘT thanh dài trong làn của phím đó, ghi số lần bấm còn lại (đếm lùi khi từng nốt đi qua hit line). Thuần: không
 * React / DOM; chỉ hình vẽ đổi — âm thanh, chấm điểm luyện tập, game bar, vòng "CHẠM", banner giữ vẫn theo từng nốt.
 *
 * Một đoạn (run) = dãy LIÊN TIẾP lớn nhất trong `timeline.notes` gồm ≥ REPEAT_RUN_MIN nốt sao cho:
 * - mọi nốt dài ≤ REPEAT_NOTE_MAX_BEATS beat;
 * - mọi nốt là cùng một lần bấm: cùng phím, cùng quãng, cùng Nửa Cung (→ cùng modifier, cùng chế độ Mobile);
 * - không nốt nào thuộc luyến (`slur === null`);
 * - khoảng nghỉ giữa hai nốt kề nhau (start nốt sau − end nốt trước) ≤ REPEAT_GAP_MAX_BEATS beat.
 * Nốt khác chen vào giữa, nốt dài hơn, nốt luyến hay khoảng nghỉ dài hơn đều cắt đoạn. Sai số ±REPEAT_EPS.
 */

/** Số nốt tối thiểu của một đoạn bấm lặp ("hơn 3 lần liên tục"). */
export const REPEAT_RUN_MIN = 4;
/** Nốt dài hơn chừng này beat không thuộc đoạn bấm lặp ("độ dài 0,5 đổ xuống"). */
export const REPEAT_NOTE_MAX_BEATS = 0.5;
/** Khoảng nghỉ dài hơn chừng này beat giữa hai nốt cắt đoạn. */
export const REPEAT_GAP_MAX_BEATS = 0.25;
/** Sai số so sánh beat (độ dài / khoảng nghỉ / playhead). */
export const REPEAT_EPS = 1e-6;

export interface RepeatRun {
  /** Index trong danh sách đoạn (`findRepeatRuns`). */
  index: number;
  /** Index nốt đầu trong timeline.notes. */
  firstNote: number;
  /** Số nốt (≥ REPEAT_RUN_MIN) = số lần bấm. */
  noteCount: number;
  /** = startBeat của nốt đầu. */
  startBeat: number;
  /** = endBeat của nốt cuối. */
  endBeat: number;
  key: NoteKey;
  octave: Octave;
  sharp: boolean;
  modifiers: Modifiers;
}

/** Phần của TimelineNote mà việc dò đoạn cần. */
export type RepeatNote = Pick<
  TimelineNote,
  'key' | 'octave' | 'sharp' | 'startBeat' | 'endBeat' | 'modifiers' | 'slur'
>;

/** Nốt `n` dùng được trong một đoạn bấm lặp (ngắn, không luyến). */
function eligible(n: RepeatNote): boolean {
  return n.slur === null && n.endBeat - n.startBeat <= REPEAT_NOTE_MAX_BEATS + REPEAT_EPS;
}

/** `b` nối tiếp được đoạn đang có nốt cuối `a`: cùng một lần bấm, khoảng nghỉ đủ ngắn. */
function continues(a: RepeatNote, b: RepeatNote): boolean {
  return (
    a.key === b.key &&
    a.octave === b.octave &&
    a.sharp === b.sharp &&
    a.modifiers.left === b.modifiers.left &&
    a.modifiers.right === b.modifiers.right &&
    a.modifiers.scroll === b.modifiers.scroll &&
    b.startBeat - a.endBeat <= REPEAT_GAP_MAX_BEATS + REPEAT_EPS
  );
}

/**
 * Các đoạn bấm lặp của `notes` (sắp theo startBeat như timeline.notes), theo thứ tự thời gian; hai đoạn không bao
 * giờ chung nốt. O(n).
 */
export function findRepeatRuns(notes: readonly RepeatNote[]): RepeatRun[] {
  const runs: RepeatRun[] = [];
  const n = notes.length;
  let i = 0;
  while (i < n) {
    if (!eligible(notes[i])) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < n && eligible(notes[j]) && continues(notes[j - 1], notes[j])) j++;
    const count = j - i;
    if (count >= REPEAT_RUN_MIN) {
      const a = notes[i];
      runs.push({
        index: runs.length,
        firstNote: i,
        noteCount: count,
        startBeat: a.startBeat,
        endBeat: notes[j - 1].endBeat,
        key: a.key,
        octave: a.octave,
        sharp: a.sharp,
        modifiers: { left: a.modifiers.left, right: a.modifiers.right, scroll: a.modifiers.scroll },
      });
    }
    i = j;
  }
  return runs;
}

/**
 * Bảng nốt → đoạn: phần tử i = index đoạn chứa nốt i, -1 nếu nốt i không thuộc đoạn nào (`noteCount` = số nốt của
 * timeline).
 */
export function repeatRunIndex(runs: readonly RepeatRun[], noteCount: number): Int32Array {
  const out = new Int32Array(Math.max(0, noteCount)).fill(-1);
  for (const r of runs) {
    const end = Math.min(out.length, r.firstNote + r.noteCount);
    for (let i = Math.max(0, r.firstNote); i < end; i++) out[i] = r.index;
  }
  return out;
}

/**
 * Số lần bấm còn lại của đoạn khi playhead ở `beat` = số nốt của đoạn có startBeat CÒN Ở PHÍA TRƯỚC playhead
 * (startBeat > beat, sai số ±REPEAT_EPS nghiêng về "chưa bấm": nốt ĐÚNG ở hit line — dừng ở đầu dòng, chế độ chờ
 * của luyện tập giữ transport ở đầu nốt — vẫn tính). Trước khi thanh chạm hit line và lúc đầu thanh vừa chạm = cả
 * `noteCount`, ngay sau lần bấm đầu = noteCount − 1, sau lần bấm cuối = 0. `starts[i]` = startBeat của nốt i
 * (timeline.notes[i].startBeat — mảng số để renderer truyền thẳng Float64Array, không cấp phát). `until` (loop
 * A-B: loop end) — nốt bắt đầu từ đó trở đi không tính. Tìm nhị phân.
 */
export function repeatRemaining(
  run: Pick<RepeatRun, 'firstNote' | 'noteCount'>,
  starts: ArrayLike<number>,
  beat: number,
  until = Infinity,
): number {
  return pressesAhead(starts, run.firstNote, run.firstNote + run.noteCount, beat, until);
}

/**
 * Như `repeatRemaining` cho dải nốt [first, end) bất kỳ (renderer: phần của đoạn đang vẽ, bỏ các nốt của ô nhịp
 * đếm vào) — không cấp phát, gọi được mỗi frame.
 */
export function pressesAhead(
  starts: ArrayLike<number>,
  firstNote: number,
  endNote: number,
  beat: number,
  until = Infinity,
): number {
  const first = Math.max(0, firstNote);
  const end = Math.min(starts.length, endNote);
  if (end <= first) return 0;
  const t = beat - REPEAT_EPS;
  // Nốt đầu tiên của đoạn có start > t (= chưa bấm).
  let lo = first;
  let hi = end;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (starts[mid] > t) hi = mid;
    else lo = mid + 1;
  }
  // Nốt đầu tiên có start ≥ until (không tính từ đó).
  let stop = end;
  if (until !== Infinity) {
    let a = lo;
    let b = end;
    while (a < b) {
      const mid = (a + b) >>> 1;
      if (starts[mid] >= until) b = mid;
      else a = mid + 1;
    }
    stop = a;
  }
  return stop > lo ? stop - lo : 0;
}
