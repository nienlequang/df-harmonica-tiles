/**
 * Điều khiển của trang mini (SPEC 2026-10-15 Phase 4m (c)): ▶ → đếm ngược (theo Cài đặt → Phát bài —
 * góp ý 2026-10-16: không còn ô chọn riêng; `?delay=` của link vẫn đè được) → ô tự chạy, KHÔNG cần chạm thêm (người chơi chạm vào game, không chạm cửa sổ này);
 * chạm bất kỳ đâu = tạm dừng / chạy tiếp (chạy tiếp cũng đếm ngược lại — người chơi cần thời gian
 * quay về game); chạm khi đang đếm ngược = hủy đếm ngược. Hết bài → chạm = chơi lại từ đầu.
 *
 * Thuần (không React / DOM): `target` là engine (OverlayEngine với delaySec 0 — im lặng), timer tiêm
 * được cho test. Đọc state qua `subscribe` / `getState` (useSyncExternalStore).
 */

export type MiniPhase = 'ready' | 'countdown' | 'playing' | 'paused' | 'ended';

/** Những gì controller điều khiển (OverlayEngine thỏa mãn). */
export interface MiniTarget {
  /** Chạy (tiếp) từ vị trí hiện tại ngay lập tức. */
  play(): void;
  pause(): void;
  /** Chạy lại từ đầu bài ngay lập tức. */
  restart(): void;
  /**
   * Đếm ngược bắt đầu (việc sẽ làm khi hết đếm) / bị hủy (null): engine vẽ frame đầu của đếm vào sắp chạy
   * để lúc chạy ô không nhảy (OverlayEngine.prepare). Tùy chọn.
   */
  prepare?(action: 'play' | 'restart' | null): void;
}

export interface MiniTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface MiniState {
  phase: MiniPhase;
  /** Số giây đếm ngược còn lại; null = không đếm. */
  countdown: number | null;
  /** Đếm ngược đang chọn (giây). */
  delay: number;
}

/**
 * Ô đang đứng yên (chưa chạy / tạm dừng / hết bài) → trang mini hiện panel điều khiển (▶, đếm ngược,
 * ⓘ, video, nút "◂" về màn chơi). Đang đếm ngược / đang chạy → không có gì ngoài ô rơi (góp ý 2026-10-16).
 */
export function isMiniStopped(phase: MiniPhase): boolean {
  return phase === 'ready' || phase === 'paused' || phase === 'ended';
}

/** Đếm ngược mặc định (= Cài đặt mặc định) khi không có giá trị hợp lệ. */
export const MINI_DEFAULT_DELAY = 3;
/** Trần đếm ngược (giây) — như Cài đặt → Phát bài (`startDelaySec` 0..10). */
export const MINI_DELAY_MAX = 10;

/** Số giây nguyên 0..MINI_DELAY_MAX (số hoặc chuỗi số, vd. `?delay=5`) hoặc null. */
export function parseMiniDelay(raw: unknown): number | null {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && /^\s*\d{1,2}\s*$/.test(raw)
        ? Number(raw)
        : NaN;
  return Number.isInteger(n) && n >= 0 && n <= MINI_DELAY_MAX ? n : null;
}

/** Bài mở trang mini lần trước (hộp thoại trang mini không có bài cho sẵn thì chọn sẵn bài này). */
export const MINI_SONG_STORAGE_KEY = 'dfht-mini-song';

export function readLastMiniSong(): string | null {
  try {
    const v = localStorage.getItem(MINI_SONG_STORAGE_KEY);
    return v && v.length <= 200 ? v : null;
  } catch {
    return null;
  }
}

export function rememberMiniSong(id: string): void {
  if (!id || id.length > 200) return;
  try {
    localStorage.setItem(MINI_SONG_STORAGE_KEY, id);
  } catch {
    // storage bị chặn
  }
}

const defaultTimers: MiniTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

type Action = 'play' | 'restart';

export class MiniController {
  private readonly target: MiniTarget;
  private readonly timers: MiniTimers;
  private state: MiniState;
  private readonly listeners = new Set<() => void>();
  private timer: unknown = null;
  /** Pha quay về khi hủy đếm ngược. */
  private resumePhase: MiniPhase = 'ready';
  /** Việc làm khi hết đếm ngược. */
  private action: Action = 'play';

  constructor(target: MiniTarget, opts: { delaySec?: number; timers?: MiniTimers } = {}) {
    this.target = target;
    this.timers = opts.timers ?? defaultTimers;
    this.state = {
      phase: 'ready',
      countdown: null,
      delay: parseMiniDelay(opts.delaySec) ?? MINI_DEFAULT_DELAY,
    };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getState = (): MiniState => this.state;

  /** Ô đang chạy hoặc sắp chạy (đếm ngược) — giữ màn hình sáng. */
  get active(): boolean {
    return this.state.phase === 'playing' || this.state.phase === 'countdown';
  }

  setDelay(sec: number): void {
    const d = parseMiniDelay(sec);
    if (d === null || d === this.state.delay) return;
    this.set({ delay: d });
  }

  /** ▶: chạy (sau đếm ngược). Đang chạy / đang đếm thì bỏ qua. Hết bài → chơi lại từ đầu. */
  start(): void {
    const p = this.state.phase;
    if (p === 'playing' || p === 'countdown') return;
    this.begin(p === 'ended' ? 'restart' : 'play', p);
  }

  /** ↺: chơi lại từ đầu (sau đếm ngược), từ bất kỳ pha nào. */
  restart(): void {
    const p = this.state.phase;
    if (p === 'playing') this.target.pause();
    this.clearTimer();
    this.begin('restart', p);
  }

  /** Chạm bất kỳ đâu: chạy ↔ tạm dừng; đang đếm ngược → hủy. */
  tap(): void {
    switch (this.state.phase) {
      case 'countdown':
        this.cancelCountdown();
        return;
      case 'playing':
        this.pause();
        return;
      default:
        this.start();
    }
  }

  pause(): void {
    if (this.state.phase !== 'playing') return;
    this.target.pause();
    this.set({ phase: 'paused' });
  }

  /** Hủy đếm ngược, về pha trước đó. */
  cancelCountdown(): void {
    if (this.state.phase !== 'countdown') return;
    this.clearTimer();
    this.target.prepare?.(null);
    this.set({ phase: this.resumePhase, countdown: null });
  }

  /** Engine báo hết bài (đang chạy). */
  markEnded(): void {
    if (this.state.phase !== 'playing') return;
    this.set({ phase: 'ended' });
  }

  /**
   * Gỡ khỏi trang (unmount): hủy timer đếm ngược (về pha trước). Dùng lại được sau đó (StrictMode gắn /
   * gỡ hai lần với cùng một controller).
   */
  dispose(): void {
    this.cancelCountdown();
    this.clearTimer();
  }

  private begin(action: Action, from: MiniPhase): void {
    this.action = action;
    // Hủy đếm ngược → về pha trước: đang chạy thì coi như đã tạm dừng; đếm lại (↺) giữ pha gốc.
    if (from !== 'countdown') this.resumePhase = from === 'playing' ? 'paused' : from;
    const delay = this.state.delay;
    if (delay <= 0) {
      this.run();
      return;
    }
    // Ô đứng yên ở frame đầu của đếm vào suốt lúc đếm ngược → hết đếm ô chỉ việc rơi (không nhảy).
    this.target.prepare?.(action);
    this.set({ phase: 'countdown', countdown: delay });
    this.timer = this.timers.setTimeout(this.tick, 1000);
  }

  private readonly tick = (): void => {
    this.timer = null;
    if (this.state.phase !== 'countdown') return;
    const left = (this.state.countdown ?? 1) - 1;
    if (left > 0) {
      this.set({ countdown: left });
      this.timer = this.timers.setTimeout(this.tick, 1000);
      return;
    }
    this.run();
  };

  private run(): void {
    if (this.action === 'restart') this.target.restart();
    else this.target.play();
    this.set({ phase: 'playing', countdown: null });
  }

  private clearTimer(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  private set(patch: Partial<MiniState>): void {
    const next = { ...this.state, ...patch };
    if (
      next.phase === this.state.phase &&
      next.countdown === this.state.countdown &&
      next.delay === this.state.delay
    ) {
      return;
    }
    this.state = next;
    for (const l of Array.from(this.listeners)) l();
  }
}
