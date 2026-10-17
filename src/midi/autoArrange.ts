import type { Melody, MelodyEvent, MelodySection } from '../core/melody';
import { isValidTimeSig } from '../core/parser';
import { DEFAULT_SECTION_NAME, DEFAULT_TIME_SIG } from '../core/types';
import type { ArrangeContext } from './arrange';
import { AUTO_SECTION_PREFIX, snapBeats } from './arrange';
import type { MonoNote } from './types';

/**
 * Chia dòng + section TỰ ĐỘNG (góp ý 2026-10-15 C: máy tự chọn tối ưu, bỏ các ô "ngắt dòng tại chỗ
 * nghỉ", "mỗi dòng tối đa", "mỗi section", "section theo marker"). Thuần TS.
 *
 * Cùng cách dựng event với arrangeMelody: bắt đầu từ ô nhịp chứa nốt đầu (rest đầu bài tính từ đó),
 * rest nằm cuối dòng trước, dòng mới luôn bắt đầu bằng nốt, khoảng trống < grid được cộng vào nốt
 * trước, không cắt nốt; mỗi nốt đầu vào hợp lệ (độ dài > 0 sau khi snap) = đúng một event nốt, giữ
 * thứ tự.
 *
 * - Dòng: quy hoạch động trên các chỗ ngắt giữa hai nốt. Mỗi dòng nhắm ~1–2 ô nhịp và 4–12 nốt.
 *   Chỗ ngắt tốt nhất là chỗ nghỉ (≥ 1 beat), rồi vạch nhịp (vạch mốc 2 / 4 ô nhịp tốt hơn) và sau
 *   nốt dài cuối câu; chỗ nghỉ rõ nằm GIỮA dòng bị phạt (bỏ lỡ chỗ ngắt câu) → nốt đón (anacrusis)
 *   sau chỗ nghỉ tự mở dòng mới.
 * - Section: marker của file nếu hợp lý (≥ 2 section, trung bình ≥ 1,5 ô nhịp mỗi section — marker
 *   dày đặc kiểu tên hợp âm ở mỗi ô nhịp thì bỏ). Marker ép ngắt dòng ở nốt có chỗ nghỉ dài nhất trong nửa ô nhịp
 *   trước marker (nốt đón) hoặc nốt đầu tại / sau marker; dòng trước marker đầu → "Main". Không dùng
 *   marker: quy hoạch động trên dòng, ~4 dòng mỗi section, ưu tiên mở section ở chỗ nghỉ dài / mốc 4
 *   ô nhịp; nghỉ ≥ 2 ô nhịp luôn mở section mới; tên "Phần N".
 */

export interface AutoArrangeResult {
  melody: Melody;
  /** Số section lấy theo marker của file (0 = section chia tự động, marker không dùng). */
  markerSections: number;
}

const EPS = 1e-6;
/** Số nốt tối đa của một dòng mà bộ chia xét tới (dài hơn luôn bị cắt). */
export const MAX_LINE_NOTES = 24;
/** Dải số nốt / dòng (ngoài dải bị phạt nặng). */
export const LINE_NOTES = { min: 4, max: 12 } as const;
/** Số nốt / dòng lý tưởng (kéo nhẹ trong dải). */
const LINE_NOTES_IDEAL = 8;
/** Dải độ dài dòng (ô nhịp, từ đầu nốt đầu tới hết nốt cuối) không bị phạt. */
export const LINE_BARS = { min: 0.75, max: 2.25 } as const;
/** Số dòng lý tưởng mỗi section khi chia tự động. */
export const SECTION_LINES = 4;
/** Nghỉ ≥ số ô nhịp này luôn mở section mới. */
export const SECTION_REST_BARS = 2;
/**
 * Marker dùng được khi trung bình mỗi section marker dài ít nhất chừng này ô nhịp (marker mỗi ô nhịp
 * — kiểu tên hợp âm — thì bỏ).
 */
const MARKER_MIN_BARS = 1.5;
/** Chi phí cố định mỗi dòng / section (hòa thì ít hơn). */
const LINE_COST = 0.5;
const SECTION_COST = 1;

/** Nốt đã chuẩn hóa: beat đã snap, khoảng trống < grid đã cộng vào nốt trước. */
interface ArrItem {
  s: number;
  e: number;
  midi: number;
}

function onMultiple(x: number, step: number): boolean {
  if (!(step > 0)) return false;
  const r = x / step;
  return Math.abs(r - Math.round(r)) < 1e-6;
}

/**
 * Quy hoạch động chia `count` phần tử thành đoạn liên tiếp: `segCost(i, j)` = chi phí đoạn [i, j),
 * `cutCost(j)` = chi phí cắt trước phần tử j (0 < j < count), `forced(k)` = phải cắt trước k,
 * `maxLen` = độ dài đoạn tối đa. Trả các chỉ số bắt đầu đoạn (luôn có 0).
 */
function segment(
  count: number,
  segCost: (i: number, j: number) => number,
  cutCost: (j: number) => number,
  forced: (k: number) => boolean,
  maxLen: number,
): number[] {
  const dp = new Array<number>(count + 1).fill(Infinity);
  const from = new Array<number>(count + 1).fill(0);
  dp[0] = 0;
  /** Chỗ cắt bắt buộc gần nhất ≤ j − 1: đoạn kết thúc ở j không được bắt đầu trước nó. */
  let floor = 0;
  for (let j = 1; j <= count; j++) {
    if (j - 1 > 0 && forced(j - 1)) floor = j - 1;
    const tail = j < count ? cutCost(j) : 0;
    for (let i = j - 1; i >= Math.max(floor, j - maxLen); i--) {
      const v = dp[i] + segCost(i, j) + tail;
      if (v < dp[j] - 1e-9) {
        dp[j] = v;
        from[j] = i;
      }
    }
  }
  const starts: number[] = [];
  for (let j = count; j > 0; j = from[j]) starts.push(from[j]);
  return starts.reverse();
}

export function autoArrangeMelody(
  notes: readonly MonoNote[],
  ctx: ArrangeContext,
): AutoArrangeResult {
  const timeSig = isValidTimeSig(ctx.timeSig)
    ? { num: ctx.timeSig.num, den: ctx.timeSig.den }
    : { ...DEFAULT_TIME_SIG };
  const melody: Melody = {
    title: ctx.title,
    ...(ctx.artist !== undefined && ctx.artist.trim() !== '' ? { artist: ctx.artist } : {}),
    bpm: ctx.bpm,
    timeSig,
    sections: [],
  };
  const sorted = notes
    .filter(
      (n) =>
        Number.isFinite(n.startBeat) &&
        Number.isFinite(n.beats) &&
        n.beats > 0 &&
        Number.isFinite(n.midi),
    )
    .map((n, i) => ({ n, i }))
    .sort((a, b) => a.n.startBeat - b.n.startBeat || a.i - b.i)
    .map((x) => x.n);
  if (sorted.length === 0) return { melody, markerSections: 0 };

  const bpb = (timeSig.num * 4) / timeSig.den;
  const grid = ctx.grid > 0 ? ctx.grid : 0;
  // nửa ô nhịp: nốt đón trong khoảng này trước một mốc thuộc về mốc đó
  const pickup = bpb / 2;
  const first = snapBeats(sorted[0].startBeat);
  /** Đầu ô nhịp chứa nốt đầu (rest đầu bài tính từ đây). */
  const origin = Math.floor(first / bpb + 1e-9) * bpb;
  /** Gốc lưới ô nhịp cho mốc 2 / 4 ô nhịp: nốt đầu ở nửa sau ô nhịp = nốt đón → ô nhịp đủ đầu. */
  const gridOrigin = first >= origin + pickup - EPS ? origin + bpb : origin;

  // ── chuẩn hóa nốt (như vòng chia dòng của arrangeMelody) ──
  const items: ArrItem[] = [];
  let cursor = origin;
  for (const n of sorted) {
    let s = snapBeats(n.startBeat);
    const e = snapBeats(n.startBeat + n.beats);
    if (s < cursor) s = cursor; // đầu vào chồng nhau (không nên xảy ra) → nốt sau bắt đầu muộn
    if (e - s <= EPS) continue;
    const gap = snapBeats(s - cursor);
    const last = items[items.length - 1] as ArrItem | undefined;
    if (gap > EPS && grid > 0 && gap < grid - EPS && last !== undefined) {
      last.e = snapBeats(last.e + gap);
    }
    items.push({ s, e, midi: n.midi });
    cursor = e;
  }
  const count = items.length;
  if (count === 0) return { melody, markerSections: 0 };
  /** gapBefore[i] = nghỉ trước nốt i (beat); nốt đầu = Infinity. */
  const gapBefore = items.map((it, i) => (i === 0 ? Infinity : Math.max(0, it.s - items[i - 1].e)));

  // ── marker → chỗ ngắt bắt buộc + tên section ──
  const markerAt = new Map<number, string>();
  const markers = ctx.markers
    .filter((m) => Number.isFinite(m.beat) && m.text.trim() !== '')
    .map((m, i) => ({ beat: m.beat, text: m.text.replace(/\s+/g, ' ').trim(), i }))
    .sort((a, b) => a.beat - b.beat || a.i - b.i);
  for (const m of markers) {
    const lo = m.beat - pickup - EPS;
    let best = -1;
    for (let i = 0; i < count; i++) {
      const s = items[i].s;
      if (s < lo) continue;
      const after = s > m.beat + EPS;
      // sau marker chỉ xét nốt đầu tiên (khi trong nửa ô nhịp trước marker không có nốt nào)
      if (after && best >= 0) break;
      // nghỉ trước dài nhất thắng; bằng nhau → nốt gần marker hơn (muộn hơn)
      if (best < 0 || gapBefore[i] >= gapBefore[best] - EPS) best = i;
      if (after) break;
    }
    if (best >= 0) markerAt.set(best, m.text); // nhiều marker cùng chỗ → marker sau cùng
  }
  const lastEnd = items[count - 1].e;
  const totalBars = Math.max(1, (lastEnd - origin) / bpb);
  const markerSectionCount = markerAt.size + (markerAt.has(0) ? 0 : 1);
  const useMarkers =
    markerAt.size > 0 &&
    markerSectionCount >= 2 &&
    totalBars / markerSectionCount >= MARKER_MIN_BARS - EPS;

  // ── chia dòng ──
  /** Độ "xấu" khi ngắt dòng trước nốt j (0 < j < count). */
  const breakCost = (j: number): number => {
    const g = gapBefore[j];
    let c: number;
    if (g >= 1 - EPS) c = 0;
    else if (g >= 0.5 - EPS) c = 0.5;
    else if (g > EPS) c = 1;
    else c = 1.5;
    const pos = items[j].s - gridOrigin;
    if (onMultiple(pos, 4 * bpb)) c -= 1.25;
    else if (onMultiple(pos, 2 * bpb)) c -= 1;
    else if (onMultiple(pos, bpb)) c -= 0.75;
    else if (!onMultiple(pos, bpb / 2) && g < 0.5 - EPS) c += 1; // ngắt giữa ô nhịp, không nghỉ
    // nốt dài cuối câu
    if (items[j - 1].e - items[j - 1].s >= 2 - EPS) c -= 0.5;
    return Math.max(0, c);
  };
  const lineCost = (i: number, j: number): number => {
    const cnt = j - i;
    // kéo nhẹ về ~8 nốt / dòng; ngoài dải 4–12 phạt nặng
    let c = LINE_COST + (cnt - LINE_NOTES_IDEAL) ** 2 * 0.05;
    if (cnt < LINE_NOTES.min) c += (LINE_NOTES.min - cnt) ** 2;
    else if (cnt > LINE_NOTES.max) c += (cnt - LINE_NOTES.max) ** 2 * 0.5;
    const bars = (items[j - 1].e - items[i].s) / bpb;
    if (bars < LINE_BARS.min) c += (LINE_BARS.min - bars) * 4;
    else if (bars > LINE_BARS.max) c += (bars - LINE_BARS.max) ** 2 * 1.2;
    // chỗ nghỉ rõ nằm giữa dòng = bỏ lỡ chỗ ngắt câu
    for (let k = i + 1; k < j; k++) {
      const g = gapBefore[k];
      if (g >= 2 - EPS) c += 2.5;
      else if (g >= 1 - EPS) c += 1.5;
    }
    return c;
  };
  const starts = segment(
    count,
    lineCost,
    breakCost,
    (k) => useMarkers && markerAt.has(k),
    MAX_LINE_NOTES,
  );

  // ── dựng event từng dòng ──
  const lines: MelodyEvent[][] = starts.map((a, k) => {
    const b = k + 1 < starts.length ? starts[k + 1] : count;
    const events: MelodyEvent[] = [];
    if (k === 0 && items[0].s - origin > EPS) {
      events.push({ midi: null, beats: snapBeats(items[0].s - origin) });
    }
    for (let i = a; i < b; i++) {
      events.push({ midi: items[i].midi, beats: snapBeats(items[i].e - items[i].s) });
      if (i + 1 < count) {
        const g = snapBeats(items[i + 1].s - items[i].e);
        if (g > EPS) events.push({ midi: null, beats: g });
      }
    }
    return events;
  });

  // ── section ──
  const sections: MelodySection[] = [];
  if (useMarkers) {
    starts.forEach((a, k) => {
      const name = markerAt.get(a);
      if (k === 0 || name !== undefined) {
        sections.push({ name: name ?? DEFAULT_SECTION_NAME, lines: [] });
      }
      sections[sections.length - 1].lines.push({ events: lines[k] });
    });
  } else {
    const restBefore = (k: number) => gapBefore[starts[k]];
    const boundaryCost = (k: number): number => {
      const rest = restBefore(k);
      let c = 1.5;
      if (rest >= SECTION_REST_BARS * bpb - EPS) c -= 1.5;
      else if (rest >= bpb - EPS) c -= 1;
      // dòng bắt đầu ở mốc 4 ô nhịp (hoặc nốt đón trong nửa ô nhịp trước mốc)
      const bars = (items[starts[k]].s - gridOrigin + pickup) / bpb;
      const whole = Math.floor(bars + 1e-9);
      if (whole % 4 === 0 && bars - whole <= 0.5 + 1e-9) c -= 0.5;
      return Math.max(0, c);
    };
    const sizeCost = (n: number): number =>
      n < SECTION_LINES ? (SECTION_LINES - n) ** 2 * 0.8 : (n - SECTION_LINES) ** 2 * 0.5;
    const secStarts = segment(
      starts.length,
      (a, b) => SECTION_COST + sizeCost(b - a),
      boundaryCost,
      (k) => restBefore(k) >= SECTION_REST_BARS * bpb - EPS,
      starts.length,
    );
    secStarts.forEach((a, k) => {
      const b = k + 1 < secStarts.length ? secStarts[k + 1] : starts.length;
      sections.push({
        name: `${AUTO_SECTION_PREFIX} ${k + 1}`,
        lines: lines.slice(a, b).map((events) => ({ events })),
      });
    });
  }
  melody.sections = sections;
  return { melody, markerSections: useMarkers ? sections.length : 0 };
}
