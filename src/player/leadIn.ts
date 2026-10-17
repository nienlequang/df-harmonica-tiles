/**
 * Quãng dẫn vào của lần phát khi Cài đặt bật "Đếm vào khi bấm Phát" (v1.0.1, góp ý "khoảng cách phím đầu rớt xuống ra
 * quá, cho nó bớt đi 35%"). Trước đây đoạn chạy bắt đầu đúng một ô nhịp trước điểm phát `from`, nên nốt đầu tiên
 * (từ `from` trở đi) đi từ chỗ đứng yên (khung pre-roll lúc đếm ngược) tới hit line một quãng = 1 ô nhịp + khoảng
 * lặng trước nó (Quốc ca: 4 + 2,75 = 6,75 beat — xuất phát từ ngoài màn với lookahead 6). Giờ quãng đó còn
 * LEAD_IN_TRAVEL_RATIO (65 %): đếm vào dài `max(0, 0,65 × ô nhịp − 0,35 × khoảng lặng)` beat (Quốc ca 1,6375 beat →
 * nốt đầu đi 4,3875 beat; bài vào ngay beat 0 như TAKEDISKRUSH: 0,65 ô nhịp = 2,6 beat).
 *
 * Khoảng lặng đầu đã dài (≥ 0,65 / 0,35 ≈ 1,86 ô nhịp) → không đếm vào (0): đoạn chạy bắt đầu ngay tại `from`, nốt
 * đầu vẫn đi quãng ngắn hơn trước (chỉ còn khoảng lặng) — không bao giờ bỏ qua phần nào của bài.
 *
 * Ít nhất LEAD_IN_MIN_CLICKS beat nguyên trước nốt đầu (D-439): click đếm vào ở mọi beat nguyên từ đầu đếm vào tới nốt
 * đầu (scheduler.ts, D-428) — 0,65 ô nhịp của bài 2/4 / 3/4 vào ngay đầu ô nhịp (1,3 / 1,95 beat) chỉ chứa MỘT beat
 * nguyên (−1): một tick lẻ, mất cảm giác tempo. Khi đó đếm vào nới tới beat nguyên thứ hai trước nốt đầu (+ 0,001
 * beat để beat đó nằm hẳn trong đếm vào — transport bắt đầu ở `from − đếm vào`): 3/4 → 2 beat (quãng 0,667 × cũ), 2/4
 * → 2 beat (= 1 ô nhịp như trước — ngắn nhất để có 2 tick). Không bao giờ dài hơn đếm vào cũ 1 ô nhịp (nhịp 1/4, 3/8
 * giữ như trước). Áp cho mọi bề mặt, có tiếng hay không (hình khớp nhau ở màn chơi / overlay / trang mini). Ô nhịp
 * ≥ 4 beat luôn có ≥ 2 beat nguyên → không đổi.
 *
 * Thuần (không DOM): PlayerEngine (màn chơi, Cửa sổ nổi) và OverlayEngine (overlay tự chạy, trang mini) dùng chung;
 * overlay theo Player chép nguyên dải đếm vào trong tin `state` nên tự khớp.
 */
import type { Timeline } from '../core/types';

/** Quãng nốt đầu đi tới hit line = tỉ lệ này × quãng cũ (đếm vào đủ 1 ô nhịp + khoảng lặng trước nốt). */
export const LEAD_IN_TRAVEL_RATIO = 0.65;
/** Số beat nguyên (= số click dẫn vào) ít nhất từ đầu đếm vào tới trước nốt đầu (D-439). */
export const LEAD_IN_MIN_CLICKS = 2;
/** Đếm vào nới thêm chừng này beat khi phải chứa đủ LEAD_IN_MIN_CLICKS: beat đầu nằm hẳn trong đếm vào (sai số float). */
export const LEAD_IN_CLICK_MARGIN = 0.001;

/** Làm tròn 1e-6 beat: dải đếm vào ổn định (so sánh / gửi follow không mang sai số float). */
const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** Beat bắt đầu của nốt đầu tiên có `startBeat >= from` (notes sắp theo startBeat); null = không còn nốt. */
export function firstNoteStartFrom(tl: Pick<Timeline, 'notes'>, from: number): number | null {
  const notes = tl.notes;
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (notes[mid].startBeat < from - 1e-9) lo = mid + 1;
    else hi = mid;
  }
  return lo < notes.length ? notes[lo].startBeat : null;
}

/**
 * Số beat đếm vào thật của lần phát từ `from` (đã chuẩn hóa như Transport.play) khi đếm vào đủ là `bar` beat.
 * `bar` ≤ 0 → 0 (đếm vào tắt). Không còn nốt nào từ `from` → 0,65 × `bar`. Có đếm vào thì đoạn từ đầu đếm vào tới
 * nốt đầu chứa ít nhất LEAD_IN_MIN_CLICKS beat nguyên (D-439).
 */
export function leadInBeats(tl: Pick<Timeline, 'notes'>, from: number, bar: number): number {
  if (!(bar > 0) || !Number.isFinite(bar)) return 0;
  const first = Number.isFinite(from) ? firstNoteStartFrom(tl, from) : null;
  const gap = first === null ? 0 : Math.max(0, first - from);
  let n = LEAD_IN_TRAVEL_RATIO * bar - (1 - LEAD_IN_TRAVEL_RATIO) * gap;
  if (!(n > 1e-6)) return 0;
  if (first !== null) {
    // Beat nguyên thứ LEAD_IN_MIN_CLICKS tính lùi từ nốt đầu (beat nguyên lớn nhất < nốt đầu là ceil − 1).
    // Không bao giờ dài hơn đếm vào cũ (1 ô nhịp) — nhịp 1/4, 3/8… giữ như trước v1.0.1.
    const k = Math.ceil(first - 1e-6) - LEAD_IN_MIN_CLICKS;
    n = Math.min(Math.max(n, from - k + LEAD_IN_CLICK_MARGIN), bar);
  }
  return round6(n);
}

/**
 * Điểm bắt đầu thật của `transport.play({ fromBeat })` — cùng chuẩn hóa như Transport.play: không truyền = beat
 * đang đứng; không hữu hạn / âm → 0; tại / sau cuối bài → 0.
 */
export function playStartBeat(
  fromBeat: number | undefined,
  current: number,
  endBeat: number,
): number {
  let from = fromBeat ?? current;
  if (!Number.isFinite(from) || from < 0) from = 0;
  if (from >= endBeat) from = 0;
  return from;
}
