/**
 * Trượt mượt vào / ra khung đầu của đếm vào (vòng 7 — sửa sau review, D-389). Khi đếm vào bật, lần phát kế
 * tiếp bắt đầu chạy từ `from − n` (một ô nhịp trước điểm bắt đầu). Khung đứng yên lúc dừng vẽ ở `from`, khung
 * đếm ngược vẽ ở `from − n` (pre-roll, D-377) → giữa hai khung đó ô sẽ NHẢY lên một ô nhịp đúng lúc bấm Phát
 * (Quốc ca: mọi ô đang thấy biến mất). Thay vì nhảy, beat vẽ trượt từ khung cũ sang khung mới trong
 * PRE_ROLL_GLIDE_SEC (smoothstep): bấm Phát → ô lùi mượt về đầu ô nhịp đếm vào rồi đứng yên (số to), hết đếm
 * ngược thì rơi. Đếm ngược = Tắt (đếm vào chạy ngay) → phần bù cộng vào beat đang chạy, mờ dần trong cùng
 * khoảng — khung đầu sau khi bấm vẫn đúng là khung đứng yên, transport (âm thanh, nốt đầu) không đổi giờ.
 * Hủy đếm ngược / dừng giữa lúc đếm vào → trượt ngược lại về điểm bắt đầu.
 *
 * Chỉ trượt khi đổi kiểu khung giữa đứng yên / pre-roll / đang đếm vào (trừ pre-roll → đếm vào, vốn liền
 * mạch) và khoảng nhảy ≤ độ dài ô nhịp đếm vào: chơi lại giữa bài, tua, đổi dòng vẫn nhảy thẳng như cũ; đang
 * trượt mà vị trí nhảy thật (> JUMP_BEATS) thì bỏ phần bù. Thuần (không DOM): PlayerEngine và OverlayEngine
 * gọi `beatFor` mỗi khung với đồng hồ của mình (giây; test truyền ManualClock).
 */

/** Kiểu khung đang vẽ. */
export type DrawMode = 'idle' | 'pre' | 'countIn' | 'play';

/** Thời gian trượt (giây). */
export const PRE_ROLL_GLIDE_SEC = 0.36;

const EPS = 1e-3;
/** Cùng kiểu khung mà beat đích đổi hơn chừng này giữa hai khung = nhảy thật (tua / đổi dòng). */
const JUMP_BEATS = 0.75;

const smoothstep = (k: number): number => k * k * (3 - 2 * k);

/** Đổi kiểu khung nào thì trượt (pre-roll → đếm vào đã liền mạch; có 'play' = chơi lại / dừng: không). */
function glides(from: DrawMode, to: DrawMode): boolean {
  if (from === to || from === 'play' || to === 'play') return false;
  return !(from === 'pre' && to === 'countIn');
}

export class PreRollGlide {
  private lastMode: DrawMode | null = null;
  private lastBeat = Number.NaN;
  private lastTarget = Number.NaN;
  private lastSpan = 0;
  /** Phần bù (beat) lúc bắt đầu trượt; 0 = không trượt. */
  private offset = 0;
  private startedAt = 0;

  /** Đang trượt — engine phải xin thêm khung dù transport đứng yên. */
  get active(): boolean {
    return this.offset !== 0;
  }

  /**
   * Beat để vẽ khung này.
   * @param target beat khung này vẽ nếu không trượt (beat transport, hoặc `start` của pre-roll)
   * @param mode kiểu khung
   * @param span độ dài ô nhịp đếm vào của khung này (pre-roll / đếm vào đang chạy), 0 = không có
   * @param now đồng hồ của engine (giây)
   */
  beatFor(target: number, mode: DrawMode, span: number, now: number): number {
    const prev = this.lastMode;
    if (prev !== null && Number.isFinite(this.lastBeat) && Number.isFinite(target)) {
      const delta = this.lastBeat - target;
      const limit = Math.max(span, this.lastSpan);
      if (
        glides(prev, mode) &&
        limit > 0 &&
        Math.abs(delta) > EPS &&
        Math.abs(delta) <= limit + EPS
      ) {
        this.offset = delta;
        this.startedAt = now;
      } else if (this.offset !== 0 && Math.abs(target - this.lastTarget) > JUMP_BEATS) {
        this.offset = 0;
      }
    }
    let beat = target;
    if (this.offset !== 0) {
      const k = (now - this.startedAt) / PRE_ROLL_GLIDE_SEC;
      if (!(k < 1 - 1e-9)) this.offset = 0;
      else beat = target + this.offset * (1 - smoothstep(Math.max(0, k)));
    }
    this.lastMode = mode;
    this.lastBeat = beat;
    this.lastTarget = target;
    this.lastSpan = Math.max(0, span);
    return beat;
  }

  /** Quên khung trước (attach lại, đổi bài): khung kế vẽ thẳng, không trượt. */
  reset(): void {
    this.lastMode = null;
    this.lastBeat = Number.NaN;
    this.lastTarget = Number.NaN;
    this.lastSpan = 0;
    this.offset = 0;
  }
}
