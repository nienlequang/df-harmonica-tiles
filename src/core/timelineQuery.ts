import type { Timeline } from './types';

/**
 * Truy vấn timeline theo beat — tìm nhị phân, không cấp phát (gọi mỗi frame).
 * Giả định của timeline (buildTimeline bảo đảm): notes / lines / sections / holdRuns sắp theo
 * startBeat không giảm; notes và holdRuns rời nhau (endBeat của mục trước <= startBeat mục sau).
 */

/** Sai số so sánh beat khi seek (tránh kẹt ở đầu dòng do làm tròn float). */
const SEEK_EPS = 1e-6;

/** Index nốt có startBeat <= beat < endBeat, ngược lại -1. */
export function noteIndexAt(tl: Timeline, beat: number): number {
  const i = lastNoteStartingAtOrBefore(tl, beat);
  return i >= 0 && beat < tl.notes[i].endBeat ? i : -1;
}

/** Index nhỏ nhất có notes[i].endBeat > beat (= notes.length nếu không có) — dùng để cull. */
export function firstNoteEndingAfter(tl: Timeline, beat: number): number {
  const notes = tl.notes;
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (notes[mid].endBeat > beat) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Index lớn nhất có notes[i].startBeat < beat (-1 nếu không có). */
export function lastNoteStartingBefore(tl: Timeline, beat: number): number {
  const notes = tl.notes;
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (notes[mid].startBeat < beat) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** Index lớn nhất có notes[i].startBeat <= beat (-1 nếu không có). */
function lastNoteStartingAtOrBefore(tl: Timeline, beat: number): number {
  const notes = tl.notes;
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (notes[mid].startBeat <= beat) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** Hold run có startBeat <= beat < endBeat, ngược lại -1. */
export function runIndexAt(tl: Timeline, beat: number): number {
  const runs = tl.holdRuns;
  let lo = 0;
  let hi = runs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (runs[mid].startBeat <= beat) lo = mid + 1;
    else hi = mid;
  }
  const i = lo - 1;
  return i >= 0 && beat < runs[i].endBeat ? i : -1;
}

/** Dòng cuối cùng có startBeat <= beat (-1 trước dòng đầu; sau khi hết bài giữ dòng cuối). */
export function lineIndexAt(tl: Timeline, beat: number): number {
  const lines = tl.lines;
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (lines[mid].startBeat <= beat) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/**
 * Section cuối cùng có độ dài > 0 và startBeat <= beat (-1 nếu không có).
 * Section rỗng (vd. `# RAP` chỉ có comment) bị bỏ qua; sau khi hết bài giữ section cuối.
 */
export function sectionIndexAt(tl: Timeline, beat: number): number {
  const sections = tl.sections;
  let lo = 0;
  let hi = sections.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sections[mid].startBeat <= beat) lo = mid + 1;
    else hi = mid;
  }
  let i = lo - 1;
  while (i >= 0 && sections[i].endBeat <= sections[i].startBeat) i--;
  return i;
}

/** Beat đầu dòng kế tiếp (startBeat > beat) cho phím →; không còn dòng thì trả totalBeats. */
export function nextLineStart(tl: Timeline, beat: number): number {
  const lines = tl.lines;
  let lo = 0;
  let hi = lines.length;
  const target = beat + SEEK_EPS;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (lines[mid].startBeat <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo < lines.length ? lines[lo].startBeat : tl.totalBeats;
}

/**
 * Beat để seek khi bấm ←: đã vào dòng hiện tại quá `threshold` beat thì về đầu dòng, ngược lại
 * về đầu dòng trước. Không bao giờ < 0.
 */
export function prevLineStart(tl: Timeline, beat: number, threshold = 0.5): number {
  const li = lineIndexAt(tl, beat);
  if (li < 0) return 0;
  const lines = tl.lines;
  const start = lines[li].startBeat;
  if (beat - start > threshold) return Math.max(0, start);
  // Bỏ qua các dòng trùng startBeat (dòng không có độ dài).
  let j = li - 1;
  while (j >= 0 && lines[j].startBeat >= start - SEEK_EPS) j--;
  return j >= 0 ? Math.max(0, lines[j].startBeat) : 0;
}
