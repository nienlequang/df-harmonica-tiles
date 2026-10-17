/**
 * Contract giữa Transport (src/player/transport.ts), audio scheduler (src/audio/scheduler.ts)
 * và renderer. Thời gian tính bằng GIÂY trên trục của Clock đang dùng.
 */

export interface Clock {
  /** 'audio' = trục AudioContext (master khi bật âm thanh), 'performance' = performance.now()/1000. */
  readonly kind: 'audio' | 'performance';
  /** Thời điểm hiện tại (giây), đơn điệu không giảm. */
  now(): number;
  /**
   * Khoảng chờ (giây) nên chừa khi bắt đầu một đoạn phát: đoạn neo tại `now() + lead()` để sự kiện
   * đầu tiên còn ở tương lai trên trục AudioContext (lên lịch kịp, nghe đúng lúc hình chạm hit line).
   * Bỏ trống = 0 (performance clock).
   */
  lead?(): number;
}

export interface BeatRange {
  start: number;
  end: number;
}

export interface TransportSnapshot {
  playing: boolean;
  /**
   * Trên trục clock: tại thời điểm `anchorTime` thì beat = `anchorBeat`.
   * Khi playing: beat(t) = anchorBeat + (t - anchorTime) * bpm / 60 với t >= anchorTime; trước
   * anchorTime (khoảng chờ `Clock.lead`) beat đứng ở anchorBeat. Khi pause: beat = anchorBeat.
   */
  anchorTime: number;
  anchorBeat: number;
  bpm: number;
  /**
   * Tăng mỗi lần vị trí gián đoạn: play, pause, seek, loop wrap, đổi clock, hết bài. Đổi bpm và
   * setLoop KHÔNG tăng (vị trí liên tục) — chỉ notify.
   */
  epoch: number;
  /** Vùng loop A-B (beat), null nếu tắt. */
  loop: BeatRange | null;
  /** Vùng đếm vào (beat) của lần play hiện tại; null nếu không có. */
  countIn: BeatRange | null;
  /**
   * Vị trí (beat, không tính count-in) nơi đoạn phát hiện tại bắt đầu: điểm play/seek, loop.start sau
   * wrap, hoặc vị trí lúc đặt loop. Loop chỉ wrap khi giá trị này < loop end (xem `wrapEndOf`).
   */
  segmentStart: number;
  /** Beat kết thúc bài (dừng khi tới, nếu không loop). */
  endBeat: number;
}
