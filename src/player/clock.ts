import type { Clock } from './transport.types';

/** Clock theo performance.now() (giây). Master clock khi tắt âm thanh. */
export function createPerformanceClock(): Clock {
  return {
    kind: 'performance',
    now: () => performance.now() / 1000,
  };
}

/**
 * Phần AudioContext mà audio clock cần. `AudioContext` thật thỏa mãn interface này;
 * test truyền object giả.
 */
export interface AudioClockSource {
  readonly currentTime: number;
  readonly outputLatency?: number;
  readonly baseLatency?: number;
  getOutputTimestamp?(): AudioTimestamp;
}

/** Thời điểm (trục AudioContext) của mẫu âm đang phát ra loa, chưa clamp. */
function audibleTime(ctx: AudioClockSource, current: number): number {
  if (typeof ctx.getOutputTimestamp === 'function') {
    let ts: AudioTimestamp | undefined;
    try {
      ts = ctx.getOutputTimestamp();
    } catch {
      ts = undefined;
    }
    const contextTime = ts?.contextTime;
    const performanceTime = ts?.performanceTime;
    if (
      typeof contextTime === 'number' &&
      typeof performanceTime === 'number' &&
      performanceTime > 0
    ) {
      // Ngoại suy bằng performance.now() để mượt ở 60 fps.
      return contextTime + (performance.now() - performanceTime) / 1000;
    }
  }
  return current - (ctx.outputLatency || 0) - (ctx.baseLatency || 0);
}

/**
 * Biên an toàn (giây) cộng vào `lead()` của audio clock: bằng một tick scheduler (25 ms) để sự
 * kiện đầu của đoạn phát vẫn ở tương lai kể cả khi currentTime nhảy theo khối render, hoặc
 * scheduler chỉ kịp lên lịch ở tick kế tiếp.
 */
export const AUDIO_START_MARGIN_SEC = 0.025;

/**
 * Clock trên trục AudioContext, trả về thời điểm đang NGHE THẤY (trễ hơn currentTime một khoảng
 * output latency). Nốt được `start(T)` trên ctx sẽ nghe thấy đúng lúc clock này đọc T.
 * Luôn <= ctx.currentTime và đơn điệu không giảm.
 *
 * `lead()` = output latency hiện tại + AUDIO_START_MARGIN_SEC: neo đoạn phát mới tại now() + lead()
 * thì sự kiện đầu (click đếm vào / nốt tại điểm play) rơi vào tương lai trên trục ctx → được
 * `start()` đúng giờ thay vì bị kẹp trễ (hoặc bỏ khi latency > 0.2 s). Hình đứng chờ khoảng đó.
 */
export function createAudioClock(ctx: AudioClockSource): Clock {
  let last = -Infinity;
  const now = (): number => {
    const current = ctx.currentTime;
    let t = audibleTime(ctx, current);
    if (!Number.isFinite(t) || t > current) t = current;
    if (t < last) t = last;
    last = t;
    return t;
  };
  return {
    kind: 'audio',
    now,
    lead(): number {
      const latency = ctx.currentTime - now();
      return (Number.isFinite(latency) && latency > 0 ? latency : 0) + AUDIO_START_MARGIN_SEC;
    },
  };
}

/** Clock điều khiển tay cho test (deterministic). */
export interface ManualClock extends Clock {
  /** Tiến thêm `sec` giây. */
  advance(sec: number): void;
  /** Đặt thời điểm tuyệt đối (giây). */
  set(t: number): void;
}

export function createManualClock(start = 0, kind: Clock['kind'] = 'performance'): ManualClock {
  let t = start;
  return {
    kind,
    now: () => t,
    advance(sec: number): void {
      t += sec;
    },
    set(next: number): void {
      t = next;
    },
  };
}
